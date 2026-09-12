import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { flowSchema } from "../src/core/contracts.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";

const [root, preparedFile, target] = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]).parse(process.argv.slice(2));
const prepared = z.object({ bundle_name: z.string().startsWith("com.deveco.mcpacceptance."), project_path: z.string(), module: z.string(), ability: z.string() }).parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 }); atomicWrite(path.join(root, "config.json"), "{}\n");
const mcp = new AcceptanceMcp(root, "native-recording-v2-mcp-acceptance"), tested = evidenceIdentity();
const results: Record<string, unknown> = {}, flowId = `extended-${randomUUID().slice(0, 8)}`;
let completed = false, closed = false, recording: string | undefined;
const file = path.join(root, "evidence.json"), save = () => atomicWrite(file, JSON.stringify({ results, flowId, recording, scope: "Public MCP record/save/restart/replay on an owned app; focused Unicode text, numeric key chord and mouse click. Other mouse/gesture semantics have separate coverage." }, null, 2));
async function observe(name: string, args: Record<string, unknown>) {
  try { const result = await mcp.call(name, args); results[`${name}:${Object.keys(results).length}`] = result; save(); return result; }
  catch (error) { results[`${name}:error`] = errorResult(error); save(); throw error; }
}
async function settle(id: string, expected: string) {
  const deadline = performance.now() + 180000;
  while (performance.now() < deadline) {
    const state = z.object({ status: z.string(), error: z.unknown().optional() }).parse(await mcp.call("workflow_run", { action: "status", run_id: id, wait_ms: 1000 }));
    if (["queued", "running", "cancelling"].includes(state.status)) continue;
    results[`run:${id}`] = state; save(); assert.equal(state.status, expected, JSON.stringify(state.error)); return state;
  }
  throw new ToolError("ACCEPTANCE_TIMEOUT", "Inspect the captured run before any repeated effect");
}
const selector = (key: string, text?: string) => ({ key, bundle_name: prepared.bundle_name, ...(text === undefined ? {} : { text, textMode: "exact" }) });
const finalText = "焦点输入中文🙂回放成功", finalAssertion = { visible: selector("mcp-status", finalText), timeoutMs: 10000 };
try {
  await mcp.connect();
  await observe("device_info", { target });
  const start = z.object({ recording_id: z.string() }).parse(await observe("ui_flow", { action: "record_start", project_path: prepared.project_path, target, id: flowId, name: "v2 焦点与组合操作验收", route: { module: prepared.module, ability: prepared.ability }, mode: "restart", request_key: `${flowId}:record` }));
  recording = start.recording_id; save(); await settle(recording, "needs_input");
  const act = (operation: Record<string, unknown>) => observe("ui_control", { target, operation });
  await act({ action: "click", selector: selector("mcp-input") });
  await act({ action: "text", window: { bundle_name: prepared.bundle_name }, text: "待替换的中文" });
  await act({ action: "keyEvent", keys: ["2072", "2017"] });
  await act({ action: "text", window: { bundle_name: prepared.bundle_name }, text: finalText });
  await act({ action: "keyEvent", keys: ["Back"] });
  await act({ action: "mouseClick", selector: selector("mcp-confirm"), button: "left" });
  await observe("verify_ui", { target, assert: finalAssertion });
  await observe("ui_flow", { action: "record_stop", recording_id: recording, assert: finalAssertion });
  await settle(recording, "succeeded");
  const saved = flowSchema.parse(await observe("ui_flow", { action: "read", project_path: prepared.project_path, id: flowId }));
  assert.equal(saved.version, 2); assert.equal(saved.steps.length, 6);
  assert.deepEqual(saved.steps.map(step => step.action), ["tap", "focusInput", "key", "focusInput", "key", "mouseClick"]);
  assert.deepEqual(saved.steps[2]!.keys, ["2072", "2017"]);
  for (const step of saved.steps.filter(step => step.action === "focusInput")) {
    assert.equal(step.selector?.key, "mcp-input"); assert.equal(step.selector?.text, undefined);
    assert.equal(saved.variables[step.value!.slice(2, -1)]?.secret, true);
  }
  assert.equal(JSON.stringify(saved.steps).includes(finalText), false);
  const savedHash = digest(saved);
  await mcp.close(); await mcp.connect();
  assert.equal(digest(await observe("ui_flow", { action: "read", project_path: prepared.project_path, id: flowId })), savedHash);
  const replay = z.object({ run_id: z.string() }).parse(await observe("ui_flow", { action: "run", project_path: prepared.project_path, target, id: flowId, variables: { input1: "待替换的中文", input2: finalText }, request_key: `${flowId}:replay` }));
  await settle(replay.run_id, "succeeded");
  await observe("verify_ui", { target, assert: finalAssertion });
  completed = true;
} catch (error) { results.error = errorResult(error); console.error(error); }
finally {
  if (!completed && recording) try { results.recording_cleanup = await mcp.call("ui_flow", { action: "record_cancel", recording_id: recording }); } catch (error) { results.cleanup_error = errorResult(error); }
  try { await mcp.close(); closed = true; } catch (error) { results.close_error = errorResult(error); }
  save(); const passed = finishAcceptance(file, tested, completed, closed); console.log(`Recording v2 MCP acceptance: ${passed ? "passed" : "failed"}`);
}
