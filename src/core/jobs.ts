import crypto from "node:crypto";
import { cleanup, saveArtifact } from "./artifacts.js";
import { database } from "./db.js";
import { errorResult, invariant, ToolError } from "./errors.js";
import { sha256 } from "./files.js";
import { MAX_WAIT_MS } from "../registry.js";

/**
 * Minimal durable task runner (replaces LangGraph):
 * - each step's output is persisted before the next starts;
 * - effect steps record intent before running and a receipt after, so a crash
 *   between the two is detected on restart and never blindly replayed;
 * - a restarted process resumes from the first incomplete step.
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted" | "needs_input";
export interface StepContext<I = any> {
  job_id: string;
  input: I;
  outputs: Record<string, any>;
  signal: AbortSignal;
  log(message: string): void;
}
export interface Step<I = any> {
  id: string;
  /** Mutates external state (install, sign, click). Guarded by intent/receipt records. */
  effect?: boolean;
  /** Even an explicit force-resume must reconcile this effect, never replay it blindly. */
  replay?: false;
  run(ctx: StepContext<I>): Promise<unknown>;
  /** After an interrupted effect: return the observed outcome, or undefined when unknown. */
  reconcile?(ctx: StepContext<I>): Promise<unknown>;
  /** Skip this step (output recorded as null). */
  when?(ctx: StepContext<I>): boolean;
}
export interface JobDefinition<I = any> {
  kind: string;
  steps: Step<I>[];
  summarize?(outputs: Record<string, any>, input: I): unknown;
  /** Domain-owned compensation; the runner persists its outcome with the step journal. */
  onFailure?(ctx: StepContext<I>, error: unknown): Promise<void>;
}

interface JobRow {
  id: string; kind: string; key: string | null; status: JobStatus; input: string; step: string | null;
  outputs: string; result: string | null; error: string | null; owner: number | null; created: number; updated: number;
}

const definitions = new Map<string, JobDefinition>();
const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

export function defineJob<I>(definition: JobDefinition<I>) {
  definitions.set(definition.kind, definition as JobDefinition);
  return definition;
}

async function row(id: string): Promise<JobRow> {
  const found = (await database()).prepare("SELECT * FROM jobs WHERE id=?").get(id) as JobRow | undefined;
  invariant(found, "NOT_FOUND", `Job ${id} does not exist`);
  return found;
}
async function update(id: string, fields: Partial<Omit<JobRow, "id">>) {
  const keys = Object.keys(fields);
  (await database())
    .prepare(`UPDATE jobs SET ${keys.map((k) => `${k}=?`).join(",")},updated=? WHERE id=?`)
    .run(...keys.map((k) => (fields as Record<string, any>)[k] ?? null), Date.now(), id);
}
async function event(id: string, message: string) {
  (await database()).prepare("INSERT INTO events(job_id,at,message) VALUES(?,?,?)").run(id, Date.now(), message.slice(0, 2000));
}

/** Start a job. The same `key` with the same input returns the existing job (idempotent). */
export async function startJob<I>(kind: string, input: I, key?: string) {
  invariant(definitions.has(kind), "INVALID_INPUT", `Unknown job kind ${kind}`);
  const db = await database();
  const payload = JSON.stringify(input);
  if (key) {
    const existing = db.prepare("SELECT id,input FROM jobs WHERE key=?").get(key) as { id: string; input: string } | undefined;
    if (existing) {
      invariant(sha256(existing.input) === sha256(payload), "CONFLICT", `request_key ${key} was already used with different input`,
        { job_id: existing.id }, "Use a new request_key for a new intent");
      return { job_id: existing.id, deduplicated: true };
    }
  }
  const id = `j_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  db.prepare("INSERT INTO jobs(id,kind,key,status,input,created,updated,owner) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, kind, key ?? null, "queued", payload, now, now, process.pid);
  execute(id);
  return { job_id: id, deduplicated: false };
}

function execute(id: string) {
  const controller = new AbortController();
  const done = (async () => {
    const current = await row(id);
    const definition = definitions.get(current.kind);
    invariant(definition, "INTERNAL", `Job kind ${current.kind} is not registered`);
    const input = JSON.parse(current.input);
    const outputs: Record<string, any> = JSON.parse(current.outputs);
    await update(id, { status: "running", owner: process.pid, error: null });
    const ctx: StepContext = { job_id: id, input, outputs, signal: controller.signal, log: (m) => void event(id, m) };
    try {
      for (const step of definition.steps) {
        if (step.id in outputs) continue;
        controller.signal.throwIfAborted();
        if (step.when && !step.when(ctx)) {
          outputs[step.id] = null;
          continue;
        }
        await update(id, { step: step.id });
        await event(id, `step ${step.id} started`);
        let value: unknown;
        if (step.effect) {
          const db = await database();
          const effect = db.prepare("SELECT state,receipt FROM effects WHERE job_id=? AND step=?").get(id, step.id) as { state: string; receipt: string | null } | undefined;
          if (effect?.state === "done") value = JSON.parse(effect.receipt ?? "null");
          else if (effect?.state === "intent") {
            // The previous attempt may or may not have taken effect.
            value = step.reconcile ? await step.reconcile(ctx) : undefined;
            if (value === undefined)
              throw new ToolError("EFFECT_UNCERTAIN", `Step ${step.id} was interrupted and its outcome is unknown`,
                { step: step.id }, step.replay === false ? "Inspect external state, then resume to reconcile; force cannot replay this step" : "Inspect the device/project, then call job resume with force=true to run the step again");
          } else {
            db.prepare("INSERT OR REPLACE INTO effects(job_id,step,state,updated) VALUES(?,?,?,?)").run(id, step.id, "intent", Date.now());
            value = await step.run(ctx);
          }
          db.prepare("UPDATE effects SET state='done',receipt=?,updated=? WHERE job_id=? AND step=?").run(JSON.stringify(value ?? null), Date.now(), id, step.id);
        } else value = await step.run(ctx);
        outputs[step.id] = value ?? null;
        await update(id, { outputs: JSON.stringify(outputs) });
        await event(id, `step ${step.id} finished`);
      }
      const result = definition.summarize ? definition.summarize(outputs, input) : outputs;
      await update(id, { status: "succeeded", step: null, result: await boundedJson(result, id) });
    } catch (error) {
      try { await definition.onFailure?.(ctx, error); } catch (compensationError) { error = compensationError; }
      const failure = errorResult(error);
      const shutdown = (controller.signal.reason as ToolError | undefined)?.code === "SHUTDOWN";
      const status: JobStatus = shutdown ? "interrupted" : failure.code === "EFFECT_UNCERTAIN" ? "needs_input" : controller.signal.aborted ? "cancelled" : "failed";
      await update(id, { status, error: JSON.stringify(failure), outputs: JSON.stringify(outputs) });
      await event(id, `${status}: ${failure.code} ${failure.message}`);
    } finally {
      running.delete(id);
      void cleanup().catch(() => {});
    }
  })();
  running.set(id, { controller, done: done.catch(() => {}) });
}

/** Large results go to an artifact so job rows and responses stay small. */
async function boundedJson(value: unknown, jobId: string) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= 64 * 1024) return json;
  const artifact = await saveArtifact(json, "application/json", jobId);
  return JSON.stringify({ result_artifact: artifact.artifact_id, note: "Result too large; read it with job read" });
}

/**
 * A queued/running row that no live process owns belongs to a crashed server: mark it interrupted
 * on first read (startup recovery runs later, off the handshake path, and may not have run yet).
 */
async function settleOrphan(id: string) {
  const current = await row(id);
  if ((current.status === "queued" || current.status === "running") && !running.has(id)
    && !(current.owner && current.owner !== process.pid && alive(current.owner))) {
    (await database()).prepare("UPDATE jobs SET status='interrupted',updated=? WHERE id=? AND status IN ('queued','running')").run(Date.now(), id);
    return row(id);
  }
  return current;
}

export async function jobStatus(id: string, detail = false) {
  const current = await settleOrphan(id);
  const events = (await database())
    .prepare("SELECT at,message FROM events WHERE job_id=? ORDER BY id DESC LIMIT ?")
    .all(id, detail ? 50 : 5) as { at: number; message: string }[];
  const base = {
    job_id: current.id,
    kind: current.kind,
    status: current.status,
    ...(current.step ? { step: current.step } : {}),
    elapsed_ms: current.updated - current.created,
    ...(current.result ? { result: JSON.parse(current.result) } : {}),
    ...(current.error ? { error: JSON.parse(current.error) } : {}),
    recent_events: events.reverse().map((e) => e.message),
  };
  if (current.status === "needs_input" || current.status === "interrupted")
    return { ...base, next: { tool: "job", action: "resume", job_id: id } };
  if (current.status === "queued" || current.status === "running")
    return { ...base, next: { tool: "job", action: "wait", job_id: id } };
  return detail ? { ...base, input: JSON.parse(current.input), outputs: JSON.parse(current.outputs) } : base;
}

/** Wait up to `ms` for completion without polling the database. */
export async function waitJob(id: string, ms = 1000) {
  const handle = running.get(id);
  if (handle && ms > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([handle.done, new Promise<void>((resolve) => (timer = setTimeout(resolve, Math.min(ms, MAX_WAIT_MS))))]);
    clearTimeout(timer);
  }
  return jobStatus(id);
}

export async function cancelJob(id: string) {
  const handle = running.get(id);
  if (handle) {
    handle.controller.abort(new ToolError("CANCELLED", "Cancelled by request"));
    await handle.done;
  } else {
    const current = await settleOrphan(id);
    if (["queued", "interrupted", "needs_input"].includes(current.status)) await update(id, { status: "cancelled" });
  }
  return jobStatus(id);
}

export async function resumeJob(id: string, force = false) {
  const current = await settleOrphan(id);
  invariant(!running.has(id), "CONFLICT", "Job is already running");
  invariant(["interrupted", "needs_input", "failed"].includes(current.status), "INVALID_INPUT", `Job is ${current.status}; only interrupted, needs_input or failed jobs can resume`);
  if (force) {
    const db = await database();
    for (const step of definitions.get(current.kind)?.steps ?? [])
      if (step.replay !== false) db.prepare("DELETE FROM effects WHERE job_id=? AND step=? AND state='intent'").run(id, step.id);
  }
  // Mark it running before answering: the caller must see the resumed state (and be told to wait),
  // not the old "interrupted" with next=resume, which invited a second, conflicting resume.
  (await database()).prepare("UPDATE jobs SET status='running',owner=?,updated=? WHERE id=?").run(process.pid, Date.now(), id);
  execute(id);
  return jobStatus(id);
}

export async function listJobs(limit = 20, status?: string) {
  const db = await database();
  const rows = (status
    ? db.prepare("SELECT id,kind,status,step,created,updated FROM jobs WHERE status=? ORDER BY updated DESC LIMIT ?").all(status, limit)
    : db.prepare("SELECT id,kind,status,step,created,updated FROM jobs ORDER BY updated DESC LIMIT ?").all(limit)) as Pick<JobRow, "id" | "kind" | "status" | "step" | "created" | "updated">[];
  return rows.map((r) => ({ job_id: r.id, kind: r.kind, status: r.status, step: r.step, updated: new Date(r.updated).toISOString() }));
}

/** On startup: jobs owned by dead processes become interrupted (never auto-replayed). */
export async function recoverJobs() {
  const db = await database();
  const rows = db.prepare("SELECT id,owner FROM jobs WHERE status IN ('queued','running')").all() as { id: string; owner: number | null }[];
  for (const { id, owner } of rows) {
    if (running.has(id)) continue; // started by this process
    if (owner && owner !== process.pid && alive(owner)) continue; // another live server owns it
    db.prepare("UPDATE jobs SET status='interrupted',updated=? WHERE id=? AND status IN ('queued','running')").run(Date.now(), id);
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function shutdownJobs() {
  for (const { controller } of running.values()) controller.abort(new ToolError("SHUTDOWN", "Server shutting down"));
  await Promise.all([...running.values()].map((r) => r.done));
}
