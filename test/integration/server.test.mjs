import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../support/mcp.mjs";
import { promptMetrics } from "../support/prompts.mjs";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-test-"));
process.on("exit", () => { try { fs.rmSync(state, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };

test("handshake, tools/list and schema validation", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  const init = await client.initialize();
  assert.equal(init.result.serverInfo.name, "deveco-mcp");
  assert.match(init.result.instructions, /HarmonyOS/);
  const list = await client.request("tools/list");
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["doctor", "project", "run", "job", "code", "device", "ui", "ui_flow", "diagnose", "knowledge", "skills", "auth", "sign", "emulator", "hot_reload"]);
  for (const tool of list.result.tools) assert.equal(tool.inputSchema.type, "object");
  // The 1.5 schema adds test/verify/scenario contracts without adding tools; cap at 44 KiB. Keep guidance inside the host's default truncation boundary.
  const metrics = promptMetrics(init.result.instructions, list.result.tools);
  assert.ok(metrics.tools_list_bytes <= 44 * 1024, `tools/list: ${metrics.tools_list_bytes} bytes > 44 KB`);
  assert.ok(metrics.instructions_chars <= 2048, `instructions: ${metrics.instructions_chars} characters > 2048`);
  assert.ok(metrics.longest_description_chars <= 2048, `description: ${metrics.longest_description_chars} characters > 2048`);
  assert.doesNotMatch(JSON.stringify(list.result), /9007199254740991/, "no +/-2^53 integer bounds");
  // Over-long sync waits are capped instead of outliving the host's request timeout.
  const capped = await client.call("ui", { action: "assert", timeout_ms: 70000, visible: { text: "x" }, target: "none" });
  assert.ok(capped.data.notes?.some((n) => /timeout_ms=70000 capped at 52000/.test(n)), JSON.stringify(capped.data).slice(0, 200));
  const steps = await client.call("ui", { action: "act", target: "none", steps: [{ op: "click", x: 1, y: 1, timeout_ms: 60000 }, { op: "click", x: 1, y: 1, timeout_ms: 60000 }] });
  assert.ok(steps.data.notes?.some((n) => /2 steps had timeout_ms above 52000/.test(n)), JSON.stringify(steps.data).slice(0, 200));
  // The host is told where the complete content of summarised responses lives.
  assert.match(init.result.instructions, /job action=read artifact_id=<id>/);
  const bad = await client.call("project", { action: "nope" });
  assert.equal(bad.isError, true);
  assert.equal(bad.data.error.code, "INVALID_INPUT");
  assert.equal(bad.data.error.category, "input");
  const unknown = await client.request("tools/call", { name: "missing", arguments: {} });
  assert.equal(unknown.error.code, -32602);
  assert.equal(unknown.result, undefined);
  const ping = await client.request("ping");
  assert.deepEqual(ping.result, {});
});

test("tools/list annotations cover every action and external interaction", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const list = await client.request("tools/list");
  const readOnly = new Set(["doctor", "diagnose"]);
  const closedWorld = new Set(["code", "diagnose"]);
  for (const tool of list.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, readOnly.has(tool.name), `${tool.name}: include optional write actions`);
    assert.equal(tool.annotations.openWorldHint, !closedWorld.has(tool.name), `${tool.name}: include services, devices and other external interactions`);
  }
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
  // 1.3 guidance: the build re-checks edited files itself; a startup crash already carries its source.
  assert.doesNotMatch(prompt.result.messages[0].content.text, /then use code action=check/);
  const crash = (await client.request("prompts/get", { name: "debug-crash", arguments: { project: "/p" } })).result.messages[0].content.text;
  assert.match(crash, /crash\.source/);
  assert.match(crash, /diagnose action=crash project=\/p/);
  await client.close();
});

test("documented action boundaries reject cross-action fields before execution", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  for (const [name, args, rejected, accepted] of [
    ["project", { action: "info", project: state, wait: 1000 }, "wait", "product"],
    ["run", { action: "launch", project: state, wait: 1000 }, "wait", "ability"],
    ["run", { action: "stop", project: state, assert: {} }, "assert", "target"],
    ["code", { action: "check", project: state, file: "Index.ets" }, "file", "files"],
    ["ui", { action: "test_step", test_id: "none", assert: { visible: { text: "Hi" } } }, "assert", "visible"],
    ["ui", { action: "review", test_id: "none", visible: { text: "Hi" } }, "visible", "requirement"],
    ["ui", { action: "test_start", plan: "Hello", wait: 1000 }, "wait", "plan"],
    ["ui_flow", { action: "show", project: state, id: "none", variables: {} }, "variables", "id"],
    ["auth", { action: "teams", provider: "developer" }, "provider", undefined],
    ["sign", { action: "verify", file: "missing.hap", wait: 1000 }, "wait", "file"],
  ]) {
    const result = await client.call(name, args);
    assert.equal(result.isError, true, `${name}.${args.action}`);
    assert.equal(result.data.error.code, "INVALID_INPUT");
    assert.deepEqual(result.data.error.details.not_used, [rejected]);
    const allowed = result.data.error.details.accepted_for_action;
    if (accepted) assert.ok(allowed.includes(accepted), `${name}.${args.action}: ${accepted}`);
    else assert.deepEqual(allowed, []);
    assert.match(result.data.error.hint, /Nothing was executed/);
  }
});

test("invalid source and device operations fail before SDK or device resolution", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const mixed = await client.call("code", { action: "check", project: state, files: ["Native.cpp", "Index.ets"] });
  assert.equal(mixed.isError, true);
  assert.equal(mixed.data.error.code, "INVALID_INPUT");
  assert.match(mixed.data.error.message, /separate calls/);
  const sqlite = await client.call("device", { action: "sqlite", target: "missing-device", bundle: "com.example.app", db: "app.db", sql: ".tables" });
  assert.equal(sqlite.isError, true);
  assert.equal(sqlite.data.error.code, "INVALID_INPUT");
  assert.match(sqlite.data.error.hint, /module\.json5/);
  for (const command of ["ifconfig wlan0 down", "date -s 20261015", "mount -o remount,rw /", "hilog -w start"]) {
    const shell = await client.call("device", { action: "shell", target: "missing-device", command });
    assert.equal(shell.isError, true, command);
    assert.equal(shell.data.error.code, "INVALID_INPUT", command);
    assert.match(shell.data.error.message, /Unsupported read-only command form/);
  }
  assert.deepEqual((await client.call("job", { action: "list" })).data.jobs, []);
});

test("assertion combinations fail before device resolution or job creation", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const visible = { text: "Ready" }, hidden = { text: "Error" };
  for (const [name, args] of [
    ["run", { action: "build_run", project: state, assert: {} }],
    ["run", { action: "deploy", project: state, assert: { visible, hidden } }],
    ["ui_flow", { action: "stop", project: state, assert: {} }],
    ["ui", { action: "assert", visible, hidden }],
    ["ui", { action: "test_step", test_id: "none", visible, hidden }],
    ["ui", { action: "act", op: "click", x: 1, y: 1, assert: { visible } }],
    ["ui", { action: "act", steps: [{ op: "click", x: 1, y: 1 }], assert: {} }],
  ]) {
    const result = await client.call(name, args);
    assert.equal(result.isError, true, `${name}.${args.action}`);
    assert.equal(result.data.error.code, "INVALID_INPUT");
    assert.match(result.data.error.message, /exactly one visible or hidden|assert\/save_flow require steps/);
  }
  assert.deepEqual((await client.call("job", { action: "list" })).data.jobs, []);
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


test("recording receipt tools are offline and preserve legacy bytes", async (t) => {
  const client = connect(env); t.after(() => client.close()); await client.initialize();
  const listed = await client.call("ui", { action: "record_receipts", target: "offline:5555" });
  assert.equal(listed.isError, false); assert.deepEqual(listed.data.pending, []);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(state, "state.db"));
  const raw = JSON.stringify({ name: "legacy.mp4", started: 1, unknown: { keep: true } });
  db.prepare("INSERT INTO kv(key,value) VALUES(?,?)").run("screenrecord:offline:5555", raw); db.close();
  const archive = await client.call("ui", { action: "record_archive", target: "offline:5555", name: "legacy.mp4", reason: "old instance" });
  assert.equal(archive.isError, false); assert.equal(archive.data.raw, raw);
  const restored = await client.call("ui", { action: "record_restore", receipt_id: archive.data.receipt_id });
  assert.equal(restored.isError, false); assert.equal(restored.data.restored, true);
  const again = await client.call("ui", { action: "record_receipts", target: "offline:5555" });
  assert.equal(again.data.pending[0].raw, raw);
});
