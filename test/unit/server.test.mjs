import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-test-"));
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

test("skills are exposed as tools, resources and prompts", async () => {
  const client = connect(env);
  await client.initialize();
  const skills = await client.call("skills", { action: "list" });
  assert.ok(skills.data.skills.length >= 5);
  const resources = await client.request("resources/list");
  assert.ok(resources.result.resources.some((r) => r.uri === "deveco://skills/deveco-arkts-standards"));
  const read = await client.request("resources/read", { uri: "deveco://skills/deveco-arkts-standards" });
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