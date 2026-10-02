import { z } from "zod";
import { version } from "./core/config.js";
import { errorResult, ToolError } from "./core/errors.js";
import { McpServer } from "./mcp.js";
import { MAX_WAIT_MS, SYNC_WAIT_MS, type ToolDef } from "./registry.js";
import { allTools } from "./tools/index.js";

const instructions = [
  "HarmonyOS/ArkTS development tools. Start with doctor when the environment is unknown.",
  "Always pass absolute project paths. Long operations (build, run, sync) return a job; use job action=wait rather than repeating the call.",
  "Before answering ArkTS/ArkUI/@kit API questions from memory, use knowledge search/read; for exact API signatures use code action=lsp op=hover/definition against the project SDK.",
  "If sources disagree, trust in this order: project SDK declarations and a successful build > official docs (local pack, cloud sections marked official) > community articles (hints only, never the API contract).",
  "project build and run build_run already run the ArkTS check on the files edited since the last build: do not call code action=check before them (use it only when you want to check without building).",
  "Fewest calls: ui act steps=[...] walks a whole UI path in one call and every act returns what changed on screen (after), so observe is rarely needed; save a path you walk repeatedly (save_flow) and pass run then_flow=<id> to land on that page after each deploy.",
  "Verify UI outcomes with ui assert, not screenshots alone. Never retry a job in needs_input without inspecting it.",
  "Several devices connected (DEVICE_AMBIGUOUS) or several developer teams (TEAM_AMBIGUOUS): ask the user which one to use; never pick one yourself.",
  "Unknown or misplaced parameters are rejected and nothing runs: use the names from the error.",
  "Responses are summaries: every artifact id in them (log_artifact, report_artifact, full_artifact, artifact_id...) holds the complete text (full build log, crash report, hilog, cloud answer); read it with job action=read artifact_id=<id> (line/limit to page, grep to filter). Artifacts expire after about a day.",
].join(" ");

const ARTIFACT_ID = /^a_[0-9a-f]{16}$/;
/** Every artifact id in a response, wherever it is nested (result, error.details, reports[]...). Pure. */
export function artifactIds(value: unknown, out = new Map<string, string>(), key = "", depth = 0): Map<string, string> {
  if (depth > 6 || value === null || value === undefined) return out;
  if (typeof value === "string") { if (ARTIFACT_ID.test(value) && !out.has(value)) out.set(value, key || "artifact_id"); return out; }
  if (Array.isArray(value)) { for (const v of value.slice(0, 50)) artifactIds(v, out, key, depth + 1); return out; }
  if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (k !== "_image") artifactIds(v, out, k, depth + 1);
  return out;
}

/**
 * One line telling the host where the complete content is, for every response carrying an
 * artifact: hosts (especially smaller models) do not reliably connect an id field to job read.
 * Added centrally so no tool can forget it. Undefined when there is nothing to read or the
 * response already is a job read.
 */
export function artifactHint(tool: string, value: unknown, action?: unknown) {
  if (tool === "job" && action === "read") return undefined;
  const ids = [...artifactIds(value)];
  if (!ids.length) return undefined;
  const shown = ids.slice(0, 3).map(([id, field]) => `${field}: job action=read artifact_id=${id}`).join("; ");
  return `Complete content (summarised above) - ${shown}${ids.length > 3 ? `; +${ids.length - 3} more` : ""}. Page with line/limit, filter with grep`;
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Structured, bounded response. Errors carry code/category/hint so hosts can self-correct. */
function respond(value: unknown, isError = false) {
  const content: Content[] = [];
  if (value && typeof value === "object" && "_image" in value) {
    const { _image, ...rest } = value as { _image?: { data: string; mime: string } };
    if (_image) content.push({ type: "image", data: _image.data, mimeType: _image.mime });
    value = rest;
  }
  content.unshift({ type: "text", text: JSON.stringify(value) });
  return { content, ...(isError ? { isError: true } : {}) };
}

/** Edit distance, for "did you mean" on misspelled parameters. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
function closest(name: string, known: string[]) {
  const best = known.map((k) => [k, distance(name, k)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(name.length / 3)) ? best[0] : undefined;
}

/**
 * Arguments are checked before the schema: an unknown or misplaced parameter must never be ignored
 * (it silently ran with defaults before, e.g. rollback with version=...). `wait` above the cap is
 * clamped instead of rejected, because hosts routinely ask for long waits.
 */
export function checkArguments(tool: ToolDef, raw: Record<string, unknown>) {
  const args = { ...raw };
  const notes: string[] = [];
  const shape = (tool.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const known = Object.keys(shape);
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length)
    throw new ToolError("INVALID_INPUT", `Unknown parameter(s) for ${tool.name}: ${unknown.join(", ")}`,
      { unknown, did_you_mean: Object.fromEntries(unknown.map((u) => [u, closest(u, known) ?? null])), accepted: known },
      "Nothing was executed. Use the parameter names listed in accepted and call again");
  const action = typeof args.action === "string" ? args.action : undefined;
  const allowed = action && tool.params?.[action];
  if (allowed) {
    const misplaced = Object.keys(args).filter((k) => k !== "action" && args[k] !== undefined && !allowed.includes(k));
    if (misplaced.length)
      throw new ToolError("INVALID_INPUT", `${tool.name} action=${action} does not use: ${misplaced.join(", ")}`,
        { not_used: misplaced, accepted_for_action: allowed },
        "Nothing was executed. Remove these parameters (they belong to other actions) and call again");
  }
  for (const key of ["wait"]) {
    if (typeof args[key] === "number" && (args[key] as number) > MAX_WAIT_MS) {
      notes.push(`${key}=${args[key]} capped at ${MAX_WAIT_MS} ms; if the job is still running, call job action=wait again`);
      args[key] = MAX_WAIT_MS;
    }
  }
  // Synchronous waits (ui assert/test_step timeout_ms, per-step timeout_ms) run inside one request:
  // above the cap the host's request timeout fires first and it gets nothing back.
  const capTimeout = (obj: Record<string, unknown>, where: string) => {
    if (typeof obj.timeout_ms === "number" && obj.timeout_ms > SYNC_WAIT_MS) {
      notes.push(`${where}timeout_ms=${obj.timeout_ms} capped at ${SYNC_WAIT_MS} ms (one call must finish before the host's request timeout)`);
      obj.timeout_ms = SYNC_WAIT_MS;
    }
  };
  capTimeout(args, "");
  for (const key of ["assert"]) if (args[key] && typeof args[key] === "object") { args[key] = { ...(args[key] as object) }; capTimeout(args[key] as Record<string, unknown>, `${key}.`); }
  if (Array.isArray(args.steps)) {
    const before = notes.length;
    args.steps = (args.steps as unknown[]).map((s, i) => {
      if (!s || typeof s !== "object") return s;
      const copy = { ...(s as Record<string, unknown>) };
      capTimeout(copy, `steps[${i}].`);
      return copy;
    });
    // One note for the batch, not one per step.
    if (notes.length - before > 1) notes.splice(before, notes.length - before, `${notes.length - before} steps had timeout_ms above ${SYNC_WAIT_MS} ms and were capped; the whole call is limited to ${SYNC_WAIT_MS} ms`);
  }
  return { args, notes };
}

/**
 * tools/list goes into every host's model context: drop JSON Schema noise that carries no meaning
 * for the model (zod's int() emits +/-2^53 bounds on every integer). Validation is unaffected: the
 * server validates with the zod schema, not with this JSON. Pure.
 */
export function compactSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === "minimum" && v === Number.MIN_SAFE_INTEGER) || (k === "maximum" && v === Number.MAX_SAFE_INTEGER)) continue;
    out[k] = compactSchema(v);
  }
  return out;
}

/** Told once per process: the state database was found corrupted and recreated. */
async function recoveryNote() {
  const { takeRecoveryNote } = await import("./core/db.js");
  return takeRecoveryNote();
}

export async function serve() {
  const tools = allTools;
  const byName = new Map<string, ToolDef>(tools.map((tool) => [tool.name, tool]));
  let listed: unknown[] | undefined; // JSON Schemas are built on first tools/list, not at startup

  const server = new McpServer({ name: "deveco-mcp", version }, { tools: {}, resources: {}, prompts: {} }, instructions);
  server.on("tools/list", async () => {
    listed ??= tools.map((tool) => {
      const { $schema: _s, ...schema } = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
      return {
        name: tool.name, title: tool.title, description: tool.description,
        inputSchema: { ...(compactSchema(schema) as object), type: "object" },
        annotations: { readOnlyHint: tool.readOnly ?? false, openWorldHint: false },
      };
    });
    return { tools: listed };
  });
  server.on("tools/call", async (params, signal) => {
    const name = String(params.name);
    const tool = byName.get(name);
    if (!tool) return respond({ error: errorResult(new ToolError("INVALID_INPUT", `Unknown tool ${name}`)) }, true);
    let notes: string[] = [];
    try {
      const checked = checkArguments(tool, (params.arguments ?? {}) as Record<string, unknown>);
      const args = checked.args;
      notes = checked.notes;
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) throw new ToolError("INVALID_INPUT", z.prettifyError(parsed.error), undefined, "Fix the listed fields and call again");
      const result = await tool.handler(parsed.data, { signal });
      const recovery = await recoveryNote();
      if (recovery) notes.push(recovery);
      const read = artifactHint(name, result, (params.arguments as Record<string, unknown> | undefined)?.action);
      const extra = { ...(notes.length ? { notes } : {}), ...(read ? { read_full: read } : {}) };
      return respond(Object.keys(extra).length && result && typeof result === "object" && !Array.isArray(result) ? { ...(result as object), ...extra } : result);
    } catch (error) {
      const recovery = await recoveryNote();
      if (recovery) notes.push(recovery);
      const err = errorResult(error);
      const read = artifactHint(name, err, (params.arguments as Record<string, unknown> | undefined)?.action);
      return respond({ error: err, ...(notes.length ? { notes } : {}), ...(read ? { read_full: read } : {}) }, true);
    }
  });
  server.on("resources/list", async () => {
    const { listResources } = await import("./domains/resources.js");
    return { resources: await listResources() };
  });
  server.on("resources/templates/list", async () => ({ resourceTemplates: [] }));
  server.on("resources/read", async (params) => {
    const { readResource } = await import("./domains/resources.js");
    return { contents: [await readResource(String(params.uri))] };
  });
  server.on("prompts/list", async () => {
    const { listPrompts } = await import("./domains/resources.js");
    return { prompts: listPrompts() };
  });
  server.on("prompts/get", async (params) => {
    const { getPrompt } = await import("./domains/resources.js");
    return getPrompt(String(params.name), (params.arguments ?? {}) as Record<string, string>);
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const [{ shutdownJobs }, { closeAllSessions }, { killAll }, { closeDatabase }] = await Promise.all([
      import("./core/jobs.js"), import("./core/sessions.js"), import("./core/proc.js"), import("./core/db.js"),
    ]);
    await Promise.race([Promise.all([shutdownJobs(), closeAllSessions()]), new Promise((r) => setTimeout(r, 3000))]);
    killAll();
    closeDatabase();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.start(() => void shutdown());
  // Mark jobs from dead processes as interrupted, off the handshake path.
  setTimeout(() => void import("./core/jobs.js").then((m) => m.recoverJobs()).catch(() => {}), 2000).unref();
  // Retention also applies to sessions that never run a job (screenshots, cloud answers, UI tests).
  void import("./core/artifacts.js").then((m) => m.scheduleCleanup()).catch(() => {});
}
