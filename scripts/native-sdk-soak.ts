import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, fileDigest, readObject } from "../src/core/files.js";
import { errorResult, invariant, ToolError } from "../src/core/errors.js";
import { moduleTargetsSchema, type ToolName } from "../src/core/contracts.js";
import { processMetrics } from "./lib/process-metrics.js";
import { retainedSchema, writeSoakReport } from "./lib/soak-gate.js";
import { nativeOperation } from "./lib/native-operation.js";
import { evidenceIdentity } from "./lib/evidence.js";

// Use a dedicated personally signed canary, prepared by native-hot-target-prepare.
// The driver never imports Runtime: every capability runs through shipped stdio MCP.
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const duration = z.coerce.number().int().min(3600).max(7200).parse(process.argv[3] ?? 3600);
const preparedRoot = path.resolve(z.string().min(1).parse(process.argv[4]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
const prepared = z.object({ project_path: z.string(), bundle_name: z.string().startsWith("com.deveco.mcpacceptance."), module: z.string(), ability: z.string(), product: z.string().optional(), module_targets: moduleTargetsSchema.optional() }).parse(readObject(path.join(preparedRoot, "prepared.json")));
const journal = z.object({ operations: z.object({ preflight: z.object({ result: z.object({ target: z.string() }) }), configure: z.object({ status: z.literal("succeeded"), result: z.object({ build_profile_sha256: z.string() }) }) }) }).parse(readObject(path.join(preparedRoot, "operations.private.json")));
assert.equal(fileDigest(path.join(prepared.project_path, "build-profile.json5")), journal.operations.configure.result.build_profile_sha256);
const target = journal.operations.preflight.result.target;
const selection = { project_path: prepared.project_path, product: prepared.product, module_targets: prepared.module_targets };
const source = path.join(prepared.project_path, prepared.module, "src/main/ets/pages/Index.ets");
const original = fs.readFileSync(source, "utf8");
assert.equal(original.split("确认输入").length, 2);
const lines = original.split("\n"), line = lines.findIndex((value) => value.includes("Text(this.message)"));
assert.ok(line >= 0);
const character = lines[line]!.indexOf("message") + 1;
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity(), installation = fileURLToPath(new URL("../../", import.meta.url));
const client = new Client({ name: "native-sdk-soak", version: "3" });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(installation, "dist/src/cli.js")], cwd: installation, stderr: "pipe", env: {
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]))),
  DEVECO_STATE_DIR: path.join(root, "state"), DEVECO_CONFIG: path.join(root, "config.json"),
} });
transport.stderr?.on("data", (chunk: Buffer) => fs.appendFileSync(path.join(root, "mcp-stderr.log"), chunk, { mode: 0o600 }));
const remoteSchema = z.object({ pid: z.number().int().positive(), cpu: z.object({ user: z.number().nonnegative(), system: z.number().nonnegative() }), rss_bytes: z.number().positive(), retained: retainedSchema, sdk: z.object({ process_starts: z.number().int().nonnegative(), processes: z.number().int().nonnegative(), sessions: z.number().int().nonnegative(), listeners: z.number().int().nonnegative(), pids: z.array(z.number().int().positive()) }) });
let connected = false, running = 0, activeElapsed = 0, idleElapsed = 0, cycles = 0, patches = 0, lspRequests = 0, uiRequests = 0;
let written = original, failure: unknown, finalMetrics: z.infer<typeof retainedSchema> | undefined;
let mcpPid: number | undefined, toolchainHash: string | undefined, requestsRecorded = 0, closeConfirmed = false, transportClosed = false;
const started = performance.now(), samples: unknown[] = [], idleSamples: unknown[] = [], cancellations: { scope: string; elapsed_ms: number; confirmed: boolean }[] = [];
async function call(name: ToolName, input: unknown): Promise<unknown> {
  const result = await client.callTool({ name, arguments: z.record(z.string(), z.unknown()).parse(input) }, undefined, { timeout: 180000 });
  if (result.isError) {
    const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(result.structuredContent).error;
    throw new ToolError(error.code, error.message);
  }
  return z.object({ ok: z.literal(true), data: z.unknown() }).parse(result.structuredContent).data;
}
async function doctor() {
  const value = z.object({ runtime: remoteSchema, toolchain: z.object({ fingerprint: z.string() }) }).parse(await call("deveco_doctor", {}));
  if (mcpPid === undefined) mcpPid = value.runtime.pid;
  assert.equal(value.runtime.pid, transport.pid, "Telemetry must come from the connected MCP child");
  assert.equal(value.runtime.pid, mcpPid, "MCP must reuse one process throughout the soak");
  assert.notEqual(mcpPid, process.pid, "Driver CPU/RSS must not be labeled MCP");
  if (toolchainHash === undefined) toolchainHash = value.toolchain.fingerprint;
  assert.equal(value.toolchain.fingerprint, toolchainHash, "SDK changed during soak");
  return value.runtime;
}
function save(status: "running" | "idle_reclamation" | "passed" | "failed") {
  writeSoakReport(path.join(root, "evidence.json"), {
    format: 3, tested, status, passed: status === "passed", scopes: ["sdk", "lsp", "ui", "watch"],
    duration_seconds: duration, elapsed_ms: activeElapsed, total_elapsed_ms: performance.now() - started,
    execution: { transport: "stdio", runtime: "worker", driver_pid: process.pid, mcp_pid: mcpPid, requests_recorded: requestsRecorded, runtime_close_confirmed: closeConfirmed, transport_closed: transportClosed },
    scope: "Shipped stdio MCP and Runtime Worker, durable native hot reload tasks, personally signed HQF patches with unchanged application PID and final UI text assertions, real LSP and HDC UI. MCP CPU/RSS exclude this driver. SDK samples cover live owned process trees and known watch PIDs; exited CPU and unsupported disk byte counters remain explicitly unavailable. Six minutes of idle reclamation follows explicit watch stop.",
    toolchain_sha256: toolchainHash, cycles, patches, lsp_requests: lspRequests, ui_requests: uiRequests,
    samples, idle_samples: idleSamples, idle_elapsed_ms: idleElapsed, final: finalMetrics,
    cancellations, cancel_ms: cancellations.map((item) => item.elapsed_ms), error: failure === undefined ? null : errorResult(failure),
  });
}
async function sample() {
  const remote = await doctor();
  const status = z.object({ active: z.literal(true) }).parse(await call("hot_reload", { action: "status", ...selection }));
  samples.push({ elapsed_ms: performance.now() - running, ...(await processMetrics({ metrics: remote.sdk }, [], remote)), retained: remote.retained,
    activity: { sdk_builds: patches, lsp_requests: lspRequests, ui_requests: uiRequests, watch_connected: status.active },
    mcp_pid: remote.pid, sdk_pids: remote.sdk.pids });
}
async function stopWatch() {
  await call("hot_reload", { action: "stop", ...selection });
  assert.equal(z.object({ active: z.boolean() }).parse(await call("hot_reload", { action: "status", ...selection })).active, false);
}
function restore() {
  invariant(fs.readFileSync(source, "utf8") === written, "CANARY_SOURCE_CONFLICT", "Canary changed outside soak; preserve source for review");
  if (written !== original) { atomicWrite(source, original); written = original; }
}
try {
  await client.connect(transport); connected = true;
  await doctor();
  await nativeOperation({ call }, "hot_reload", { action: "start", ...selection, target, modules: [prepared.module], app: { bundle_name: prepared.bundle_name, module: prepared.module, ability: prepared.ability } }, path.join(root, "start.operation.private.json"));
  running = performance.now();
  let lastSample = -Infinity;
  do {
    if (cycles % 12 === 0) {
      assert.equal(fs.readFileSync(source, "utf8"), written);
      const text = `长稳补丁 ${patches + 1}`;
      written = original.replace("确认输入", text); atomicWrite(source, written);
      z.object({ applied: z.literal(true), processPreserved: z.literal(true) }).parse(await nativeOperation({ call }, "hot_reload", { action: "apply", ...selection, target, files: [source] }, path.join(root, `patch-${patches + 1}.operation.private.json`)));
      await call("verify_ui", { target, assert: { visible: { key: "mcp-confirm", text, textMode: "exact", bundle_name: prepared.bundle_name }, timeoutMs: 15000 } });
      patches++;
    }
    const hover = await call("lsp", { ...selection, action: "hover", file: source, line, character });
    assert.match(JSON.stringify(hover), /message|string/); lspRequests++;
    z.object({ node_count: z.number().int().positive(), signature: z.string().min(1) }).parse(await call("ui_snapshot", { target, mode: "tree" })); uiRequests++;
    cycles++; activeElapsed = performance.now() - running;
    if (activeElapsed - lastSample >= 30000) {
      await sample(); lastSample = performance.now() - running; save("running");
      process.stdout.write(`MCP SDK soak: ${cycles} cycles, ${patches} verified HQF patches, ${Math.round(activeElapsed / 1000)} seconds\n`);
    }
    await delay(Math.min(5000, Math.max(0, running + duration * 1000 - performance.now())));
  } while (performance.now() - running < duration * 1000);
  await sample(); activeElapsed = performance.now() - running;
  let cancelledAt = performance.now(); await stopWatch();
  cancellations.push({ scope: "sdk_watch", elapsed_ms: performance.now() - cancelledAt, confirmed: true }); restore();
  const idleStarted = performance.now();
  do {
    const remote = await doctor(); idleElapsed = performance.now() - idleStarted;
    idleSamples.push({ elapsed_ms: idleElapsed, ...remote.retained }); finalMetrics = remote.retained; save("idle_reclamation");
    process.stdout.write(`MCP soak idle reclamation: ${Math.round(idleElapsed / 1000)}/360 seconds\n`);
    if (idleElapsed < 360000) await delay(Math.min(30000, 360000 - idleElapsed));
  } while (idleElapsed < 360000);
  cancelledAt = performance.now();
  closeConfirmed = z.object({ closed: z.literal(true) }).parse(await call("deveco_restart", {})).closed;
  await client.close(); await transport.close(); connected = false;
  assert.ok(mcpPid);
  assert.throws(() => process.kill(mcpPid!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  transportClosed = true;
  cancellations.push({ scope: "mcp_runtime", elapsed_ms: performance.now() - cancelledAt, confirmed: closeConfirmed && transportClosed });
  const db = new Database(path.join(root, "state/state.sqlite"), { readonly: true });
  try { requestsRecorded = z.object({ count: z.number().int().positive() }).parse(db.prepare("SELECT count(*) AS count FROM events WHERE kind='request_finish'").get()).count; } finally { db.close(); }
  assert.equal(evidenceIdentity().compiled_sha256, tested.compiled_sha256);
  save("passed");
} catch (error) {
  failure = error; process.exitCode = 1;
  if (connected) {
    try { await stopWatch(); } catch (cleanup) { samples.push({ cleanup_error: errorResult(cleanup) }); }
    try { await call("deveco_restart", {}); } catch (cleanup) { samples.push({ cleanup_error: errorResult(cleanup) }); }
  }
  try { restore(); } catch (cleanup) { samples.push({ cleanup_error: errorResult(cleanup) }); }
  try { await client.close(); await transport.close(); } catch (cleanup) { samples.push({ cleanup_error: errorResult(cleanup) }); }
  save("failed");
}
