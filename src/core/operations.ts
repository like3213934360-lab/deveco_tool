import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildInfo, stateDir } from "./config.js";
import { invariant } from "./errors.js";

interface Owner { token: string; keys: Set<string> }
const context = new AsyncLocalStorage<Owner>();
let coordinator: Promise<DatabaseSync> | undefined;
const session = crypto.randomUUID();

/** Shared by all state directories on this host. An explicit override selects a coordination domain. */
export function coordinationDirectory() {
  return path.resolve(process.env.DEVECO_COORDINATION_DIR ?? path.join(os.homedir(), ".deveco-mcp", "coordination"));
}

async function coordination() {
  return coordinator ??= (async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = coordinationDirectory();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(dir, "resources.db"));
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec("CREATE TABLE IF NOT EXISTS locks(resource TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, operation TEXT NOT NULL, acquired INTEGER NOT NULL)");
    return db;
  })();
}

/** Called after operations stop, so Windows can release the coordinator file as well. */
export async function closeCoordination() {
  if (coordinator) (await coordinator).close();
  coordinator = undefined;
}

/** A dead process is evidence of interruption, never permission to repeat its effects. */
export async function resourceStatus() {
  const db = await coordination();
  return db.prepare("SELECT resource,pid,operation,acquired FROM locks ORDER BY resource").all().map((r) => ({ ...r, owner_alive: alive(Number(r.pid)) }));
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** Canonical paths prevent symlink aliases from bypassing project ownership. */
export function projectResource(project: string) {
  const full = path.resolve(project);
  let parent = full;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const canonical = path.join(fs.realpathSync.native(parent), path.relative(parent, full));
  return `project:${process.platform === "win32" ? canonical.toLowerCase() : canonical}`;
}

/** Acquire all resources atomically; nested operations inherit ownership, other requests do not. */
export async function withResources<T>(keys: string[], operation: string, fn: () => Promise<T>): Promise<T> {
  if (!keys.length) return fn();
  const inherited = context.getStore();
  const owner = inherited ?? { token: crypto.randomUUID(), keys: new Set<string>() };
  const acquired = [...new Set(keys)].filter((k) => !owner.keys.has(k)).sort();
  const db = await coordination();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const key of acquired) {
      const previous = db.prepare("SELECT pid,operation,acquired FROM locks WHERE resource=?").get(key);
      invariant(!previous, "RESOURCE_BUSY", `Resource is reserved: ${key}`, previous ? { resource: key, ...previous, owner_alive: alive(Number(previous.pid)) } : undefined,
        "Wait for the owning operation. For a dead owner inspect effects, then job release_resource with the exact resource and owner_pid; resources are never stolen automatically");
      db.prepare("INSERT INTO locks VALUES(?,?,?,?,?)").run(key, owner.token, process.pid, operation, Date.now());
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  acquired.forEach((k) => owner.keys.add(k));
  try { return await context.run(owner, fn); }
  finally {
    for (const key of acquired) {
      db.prepare("DELETE FROM locks WHERE resource=? AND token=?").run(key, owner.token);
      owner.keys.delete(key);
    }
  }
}

/** Release only a verified dead owner after explicit reconciliation by the caller. */
export async function releaseResource(resource: string, ownerPid: number) {
  const db = await coordination();
  invariant(!alive(ownerPid), "RESOURCE_BUSY", "The owner is still alive; cancel its job instead");
  const result = db.prepare("DELETE FROM locks WHERE resource=? AND pid=?").run(resource, ownerPid);
  invariant(result.changes === 1, "CONFLICT", "Resource ownership changed or the resource was already released");
  return { released: resource, owner_pid: ownerPid, effects_replayed: false };
}

const asynchronous = new Set(["project.clean", "project.sync", "project.build", "project.test", "project.verify", "run.build_run", "run.deploy", "ui_flow.replay", "sign.auto", "hot_reload.apply", "hot_reload.reset", "knowledge.update", "ui.form"]);

/** Resolve aliases before locking and before executing; the caller then uses this exact device. */
export async function operationResources(name: string, input: Record<string, any>, signal: AbortSignal): Promise<string[]> {
  const action = String(input.action ?? "");
  if (name === "device" && ["app", "file", "clipboard", "screen", "system", "font"].includes(action)) {
    (await import("../domains/device-controls.js")).validateControl(input);
    if (action === "app" && input.operation === "install") return [];
  }
  if (name === "device" && action === "sqlite" && input.db && !input.db.startsWith("/") && input.db !== ":memory:") {
    const { appDatabasePath } = await import("../domains/device.js");
    appDatabasePath(input.bundle ?? "", input.db, input.module);
  }
  if (!name.startsWith("job:") && (asynchronous.has(`${name}.${action}`) || (name === "ui" && action === "layout" && input.forms))) return [];
  const job = name.startsWith("job:") ? name.slice(4) : undefined;
  const device = job ? ["device_install", "build_run", "deploy", "flow_replay", "hot_reload", "hot_reset", "form_check", "form_inventory"].includes(job) || (job === "project_test" && input.kind === "instrument") || (job === "verify" && !!input.target)
    : name === "run" || (name === "device" && ["app", "file", "clipboard", "screen", "system", "font", "sqlite", "send", "recv", "scenario", "databases", "fixture", "trace"].includes(action))
      || (name === "ui" && !["test_finish", "test_export", "test_log", "record_receipts", "record_archive", "record_restore"].includes(action))
      || (name === "ui_flow" && ["record", "stop"].includes(action));
  const keys: string[] = [];
  if (input.project && job !== "form_matrix" && (job || (["project", "run", "code", "hot_reload", "ui_flow", "sign"].includes(name) || name === "ui" && ["visual", "test_start", "test_export"].includes(action)))) keys.push(projectResource(input.project));
  if (name === "ui" && input.test_id) keys.push(`ui-test:${input.test_id}`);
  if (device) {
    const { resolveTarget } = await import("../domains/device.js");
    const sessionTarget = name === "ui" && input.test_id ? await (await import("../domains/uitest.js")).testTarget(input.test_id) : undefined;
    input.target = await resolveTarget(input.target ?? sessionTarget, signal);
    invariant(!sessionTarget || input.target === sessionTarget, "CONFLICT", "UI test belongs to a different target", { target: sessionTarget });
    keys.push(`device:${input.target}`);
  }
  if (job === "layout_check" || name === "emulator" && !["list", "images", "license_view"].includes(action)) keys.push("emulator:manager");
  return keys;
}

/** Durable operation metadata, without argument values, credentials, SQL, or application contents. */
export async function withOperation<T>(name: string, input: Record<string, any>, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const keys = await operationResources(name, input, signal);
  if (!keys.length) return fn();
  const id = crypto.randomUUID(), dir = path.join(stateDir(), "audit");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = { id, session, pid: process.pid, operation: name, action: input.action, resources: keys, bundle: typeof input.bundle === "string" ? input.bundle : null,
    caller_claim: process.env.DEVECO_CALLER ?? null, caller_authenticated: false, build_id: buildInfo.input_hash };
  const record = (phase: string, code?: string) => {
    const owner_id = context.getStore()?.token;
    const fd = fs.openSync(path.join(dir, "operations.jsonl"), "a", 0o600);
    try { fs.writeSync(fd, JSON.stringify({ ...base, owner_id, job_id: input._job_id, at: new Date().toISOString(), phase, code }) + "\n"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  };
  return withResources(keys, name, async () => {
    signal.throwIfAborted(); record("intent");
    try { const result = await fn(); record("returned"); return result; }
    catch (error) { record("error", (error as { code?: string }).code ?? "INTERNAL"); throw error; }
  });
}

/** Current composite operation only; unrelated caller/device audit history is never exported. */
export function currentAudit() {
  const owner = context.getStore()?.token, file = path.join(stateDir(), "audit", "operations.jsonl");
  if (!owner || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.owner_id === owner);
}
