import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

const [root, preparedFile, target] = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]).parse(process.argv.slice(2));
const prepared = z.object({
  bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
  project_path: z.string(), module: z.string(), ability: z.string(),
}).parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity(), results: Record<string, unknown> = {};
let client: Client | undefined, transport: StdioClientTransport | undefined;
let completed = false, closed = false;
const file = path.join(root, "evidence.json");
const save = () => atomicWrite(file, JSON.stringify({ results, scope: "Candidate public stdio MCP; startup check and final control assertion on the owned app, then fresh MCP process with the same state" }, null, 2));
async function call(name: string, args: Record<string, unknown>) {
  assert.ok(client);
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const envelope = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional() }).parse(response.structuredContent);
  if (!envelope.ok) throw new ToolError(envelope.error!.code, envelope.error!.message, envelope.error!.details);
  return envelope.data;
}
async function connect() {
  client = new Client({ name: "native-startup-mcp-acceptance", version: "1" });
  transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(packageRoot, "dist/src/cli.js")], cwd: packageRoot, stderr: "pipe",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((v): v is [string, string] => v[1] !== undefined && !v[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(v[0]))),
      DEVECO_STATE_DIR: path.join(root, "state"), DEVECO_CONFIG: path.join(root, "config.json"),
    },
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    const log = path.join(root, "mcp.ndjson"), size = fs.existsSync(log) ? fs.statSync(log).size : 0;
    if (size < 4 * 1024 * 1024) fs.appendFileSync(log, chunk.subarray(0, 4 * 1024 * 1024 - size), { mode: 0o600 });
  });
  await client.connect(transport);
}
async function disconnect() {
  try { await client?.close(); } finally { await transport?.close(); client = undefined; transport = undefined; }
}
async function navigate(key: string) {
  const submitted = z.object({ run_id: z.string() }).parse(await call("ui_flow", {
    action: "navigate", project_path: prepared.project_path, target,
    route: { module: prepared.module, ability: prepared.ability },
    assert: { visible: { key: "mcp-status", bundle_name: prepared.bundle_name }, timeoutMs: 10000 },
    request_key: `startup:${key}`,
  }));
  results[key] = submitted; save();
  const deadline = performance.now() + 90000;
  while (performance.now() < deadline) {
    const state = z.object({ status: z.string(), result: z.unknown(), error: z.unknown().optional() }).parse(await call("workflow_run", { action: "status", run_id: submitted.run_id, wait_ms: 1000 }));
    results[key] = { ...submitted, ...state }; save();
    if (["queued", "running", "cancelling"].includes(state.status)) continue;
    assert.equal(state.status, "succeeded", JSON.stringify(state.error));
    const verified = z.object({
      execute_ui_path: z.object({ commandAccepted: z.literal(true), processVerified: z.literal(true), startupVerified: z.literal(true), outcomeVerified: z.literal(false),
        startup_check: z.object({ status: z.literal("passed"), screen: z.literal("nonuniform"), process_samples: z.array(z.unknown()).min(2), frames: z.array(z.object({ frame: z.object({ artifact_id: z.string().uuid() }) })).min(1), evidence: z.object({ artifact_id: z.string().uuid() }) }),
      }), final_assertion: z.object({ verified: z.literal(true) }),
    }).parse(state.result);
    results[`${key}_startup_evidence`] = await call("workflow_run", { action: "read_artifact", artifact_id: verified.execute_ui_path.startup_check.evidence.artifact_id });
    save(); console.log(`${key}: startup and separate final assertion passed`); return submitted.run_id;
  }
  throw new ToolError("ACCEPTANCE_TIMEOUT", "Inspect the persisted run before any repeated effect");
}
try {
  await connect();
  results.device = await call("device_info", { target });
  results.doctor = await call("deveco_doctor", {}); save();
  const run = await navigate("initial");
  await disconnect(); await connect();
  results.preserved = await call("workflow_run", { action: "status", run_id: run });
  await navigate("after_restart");
  completed = true;
} catch (error) { results.error = errorResult(error); console.error(error); }
finally {
  try { await disconnect(); closed = true; } catch (error) { results.close_error = errorResult(error); }
  save(); const passed = finishAcceptance(file, tested, completed, closed);
  console.log(`Real startup MCP acceptance: ${passed ? "passed" : "failed"}`);
}
