import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-test-"));
process.on("exit", () => { try { fs.rmSync(state, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };

test("handshake, tools/list and schema validation", async () => {
  const client = connect(env);
  const init = await client.initialize();
  assert.equal(init.result.serverInfo.name, "deveco-mcp");
  assert.match(init.result.instructions, /HarmonyOS/);
  const list = await client.request("tools/list");
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["doctor", "project", "run", "job", "code", "device", "ui", "ui_flow", "diagnose", "knowledge", "skills", "auth", "sign", "emulator", "hot_reload"]);
  for (const tool of list.result.tools) assert.equal(tool.inputSchema.type, "object");
  const bad = await client.call("project", { action: "nope" });
  assert.equal(bad.isError, true);
  assert.equal(bad.data.error.code, "INVALID_INPUT");
  assert.equal(bad.data.error.category, "input");
  const unknown = await client.request("tools/call", { name: "missing", arguments: {} });
  assert.equal(unknown.result.isError, true);
  const ping = await client.request("ping");
  assert.deepEqual(ping.result, {});
  await client.close();
});

test("arguments: unknown/misplaced parameters are refused, long waits are capped", async () => {
  const client = connect(env);
  await client.initialize();
  const typo = await client.call("job", { action: "list", limit: 1, wiat: 5 });
  assert.equal(typo.data.error.code, "INVALID_INPUT");
  assert.equal(typo.data.error.details.did_you_mean.wiat, "wait");
  const misplaced = await client.call("knowledge", { action: "rollback", version: "1.0.0" });
  assert.equal(misplaced.data.error.code, "INVALID_INPUT");
  assert.deepEqual(misplaced.data.error.details.not_used, ["version"]);
  const capped = await client.call("job", { action: "list", limit: 1 });
  assert.equal(capped.isError, false);
  // wait above the cap is clamped (not rejected) and noted; job_id missing is the only error here
  const waited = await client.call("job", { action: "wait", job_id: "j_none", wait: 600000 });
  assert.equal(waited.data.error.code, "NOT_FOUND");
  await client.close();
});

test("skills are exposed as tools, resources and prompts", async () => {
  const client = connect(env);
  await client.initialize();
  const skills = await client.call("skills", { action: "list" });
  assert.deepEqual(skills.data.skills.map((s) => s.name).sort(), ["deveco-mcp-workflow", "hmos-arkui-develop-skill", "hmos-runtime-fix-skill"]);
  const card = await client.call("skills", { action: "read", name: "hmos-arkui-develop-skill", reference: "quick-apis/_index.md" });
  assert.match(card.data.content, /ArkUI API/);
  const escape = await client.call("skills", { action: "read", name: "hmos-arkui-develop-skill", reference: "../../../package.json" });
  assert.equal(escape.isError, true);
  const resources = await client.request("resources/list");
  assert.ok(resources.result.resources.some((r) => r.uri === "deveco://skills/hmos-arkui-develop-skill"));
  const read = await client.request("resources/read", { uri: "deveco://skills/hmos-arkui-develop-skill" });
  assert.match(read.result.contents[0].text, /ArkTS/);
  const prompts = await client.request("prompts/list");
  assert.ok(prompts.result.prompts.some((p) => p.name === "fix-build"));
  const prompt = await client.request("prompts/get", { name: "fix-build", arguments: { project: "/p" } });
  assert.match(prompt.result.messages[0].content.text, /\/p/);
  await client.close();
});

test("project info and create errors are structured", async () => {
  const client = connect(env);
  await client.initialize();
  const missing = await client.call("project", { action: "info", project: state });
  assert.equal(missing.isError, true);
  assert.equal(missing.data.error.code, "PROJECT_INVALID");
  assert.ok(missing.data.error.hint);
  await client.close();
});

test("diagnose crash from pasted jscrash text matches the pattern library", async () => {
  const client = connect(env);
  await client.initialize();
  const log = [
    "Module name:com.example.demo",
    "Error name:TypeError",
    "Error message:Cannot read property name of undefined",
    "Stacktrace:",
    "    at onClick (entry/src/main/ets/pages/Index.ets:25:13)",
  ].join("\n");
  const result = await client.call("diagnose", { action: "crash", log });
  assert.equal(result.isError, false, JSON.stringify(result.data));
  const report = result.data.reports[0];
  assert.equal(report.kind, "TypeError");
  assert.equal(report.bundle, "com.example.demo");
  assert.ok(report.app_frames[0].includes("Index.ets"));
  assert.ok(report.candidates.length > 0, "should match Cannot read property pattern");
  await client.close();
});