// End-to-end smoke test against a real DevEco toolchain (and optionally a device/emulator).
// Env: DEVECO_CONFIG (toolchain), E2E_TARGET (hdc serial, e.g. 127.0.0.1:5555 for an emulator).
// The test app is installed on E2E_TARGET only and uninstalled at the end.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

const target = process.env.E2E_TARGET;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-e2e-"));
const project = path.join(work, "SmokeApp");
const bundle = "com.devecomcp.smoke";
let client;

before(async () => {
  client = connect({ DEVECO_STATE_DIR: path.join(work, "state"), DEVECO_TOOL_GROUPS: "all" });
  await client.initialize();
});
after(async () => {
  if (target) await client.call("run", { action: "uninstall", project, target }).catch(() => {});
  await client.close();
});

const call = async (name, args) => {
  const result = await client.call(name, args);
  assert.equal(result.isError, false, `${name} ${JSON.stringify(args)} -> ${JSON.stringify(result.data).slice(0, 2000)}`);
  return result.data;
};
const waitJob = async (status) => {
  while (status.status === "running" || status.status === "queued") status = await call("job", { action: "wait", job_id: status.job_id, wait: 60000 });
  return status;
};

test("doctor", async () => {
  const report = await call("doctor", {});
  assert.equal(report.ok, true, JSON.stringify(report.checks));
});

test("create + info", async () => {
  const created = await call("project", { action: "create", project, app_name: "Smoke", bundle_name: bundle });
  assert.ok(created.files > 10);
  const info = await call("project", { action: "info", project });
  assert.equal(info.bundle_name, bundle);
  assert.deepEqual(info.modules.map((m) => m.name), ["entry"]);
});

test("code check (ArkTS static)", async () => {
  const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Index.ets"] });
  assert.equal(check.errors, 0, JSON.stringify(check.issues));
});

test("broken code is reported with location", async () => {
  const file = path.join(project, "entry/src/main/ets/pages/Broken.ets");
  fs.writeFileSync(file, "let x: any = 1;\nexport function f(): number { return x; }\n");
  const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Broken.ets"] });
  assert.ok(check.errors >= 1, JSON.stringify(check));
  assert.ok(check.issues[0].file.includes("Broken.ets"));
  fs.rmSync(file);
});

test("build (job) produces a HAP", async () => {
  const status = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
  assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 3000));
  assert.ok(status.result.artifacts[0].path.endsWith(".hap"));
});

test("lsp hover and definition by symbol", async () => {
  const hover = await call("code", { action: "lsp", op: "hover", project, file: "entry/src/main/ets/pages/Index.ets", symbol: "message" });
  assert.ok(hover.hover, JSON.stringify(hover));
  const symbols = await call("code", { action: "lsp", op: "symbols", project, file: "entry/src/main/ets/pages/Index.ets" });
  assert.ok(symbols.symbols.length > 0);
});

test("run build_run + ui observe/find/act/assert", { skip: !target }, async () => {
  const status = await waitJob(await call("run", { action: "build_run", project, target, assert: { visible: { text: "Hello World" } }, wait: 60000 }));
  assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 3000));
  assert.equal(status.result.launch.started, true);
  const observed = await client.call("ui", { action: "observe", target, bundle });
  assert.equal(observed.isError, false);
  assert.ok(observed.content.some((c) => c.type === "image"));
  assert.match(observed.data.elements, /Hello World/);
  const found = await call("ui", { action: "find", target, selector: { text: "Hello World" } });
  assert.ok(found.count >= 1);
  await call("ui", { action: "act", target, op: "click", selector: { text: "Hello World" } });
  const verdict = await call("ui", { action: "assert", target, visible: { text: "Welcome" }, timeout_ms: 5000 });
  assert.equal(verdict.passed, true, JSON.stringify(verdict));
});

test("device info + log", { skip: !target }, async () => {
  const info = await call("device", { action: "info", target });
  assert.ok(info.api_level);
  const log = await call("device", { action: "log", target, lines: 50 });
  assert.ok(log.lines >= 0);
});

test("hot reload patches the running app without restart", { skip: !target }, async () => {
  const status = await waitJob(await call("run", { action: "build_run", project, target, hot_reload: true, wait: 60000 }));
  assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 2000));
  const pid = status.result.launch.pid;
  const page = path.join(project, "entry/src/main/ets/pages/Index.ets");
  fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("this.message = 'Welcome';", "this.message = 'Patched Live';"));
  const applied = await call("hot_reload", { action: "apply", project });
  assert.equal(applied.applied, true);
  assert.equal(applied.pid, pid, "app must not restart");
  await call("ui", { action: "act", target, op: "click", selector: { text: "Hello World" } });
  const verdict = await call("ui", { action: "assert", target, visible: { text: "Patched Live" }, timeout_ms: 5000 });
  assert.equal(verdict.passed, true);
  fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("'Patched Live'", "'Welcome'"));
  const reset = await call("hot_reload", { action: "reset", project, target });
  assert.equal(reset.reset, true);
});

test("flow record/replay", { skip: !target }, async () => {
  // Fresh install (the previous test left a hot-reload build) so the page starts at "Hello World".
  const deployed = await waitJob(await call("run", { action: "build_run", project, target, wait: 60000 }));
  assert.equal(deployed.status, "succeeded", JSON.stringify(deployed.error ?? deployed).slice(0, 2000));
  await call("ui_flow", { action: "record", project, target, id: "smoke" });
  await call("ui", { action: "act", target, op: "click", selector: { text: "Hello World" } });
  const saved = await call("ui_flow", { action: "stop", project, target, assert: { visible: { text: "Welcome" } } });
  assert.equal(saved.saved, "smoke");
  const replay = await waitJob(await call("ui_flow", { action: "replay", project, target, id: "smoke", wait: 60000 }));
  assert.equal(replay.status, "succeeded", JSON.stringify(replay.error ?? replay).slice(0, 2000));
});
