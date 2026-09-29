// End-to-end smoke test against a real DevEco toolchain (and optionally a device/emulator).
// Env: DEVECO_CONFIG (toolchain), E2E_TARGET (hdc serial, e.g. 127.0.0.1:5555 for an emulator).
// The test app is installed on E2E_TARGET only and uninstalled at the end.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { makeCallChain } from "./fixtures.mjs";

const target = process.env.E2E_TARGET;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-e2e-"));
const project = path.join(work, "SmokeApp");
const bundle = "com.devecomcp.smoke";
let client;

before(async () => {
  client = connect({ DEVECO_STATE_DIR: path.join(work, "state") });
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
  // Keep the app installable on the test device: compatible API = the device's API level.
  const api = target ? (await call("device", { action: "info", target })).api_level : undefined;
  const created = await call("project", { action: "create", project, app_name: "Smoke", bundle_name: bundle, ...(api ? { compatible_api: api } : {}) });
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

test("lsp call hierarchy (both directions) and declaration", async () => {
  makeCallChain(project);
  const util = "entry/src/main/ets/pages/Util.ets";
  const incoming = await call("code", { action: "lsp", op: "call_hierarchy", project, file: util, symbol: "leaf" });
  assert.deepEqual(incoming.calls.map((c) => c.name), ["middle"]);
  const outgoing = await call("code", { action: "lsp", op: "call_hierarchy", direction: "outgoing", project, file: util, symbol: "middle", line: 5 });
  assert.deepEqual(outgoing.calls.map((c) => c.name), ["leaf"]);
  const decl = await call("code", { action: "lsp", op: "declaration", project, file: "entry/src/main/ets/pages/Index.ets", symbol: "middle", line: 1 });
  assert.equal(decl.locations[0].file, util);
  assert.deepEqual((await call("code", { action: "lsp_restart", project, language: "arkts" })).restarted, ["arkts"]);
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

test("device info + log (time window, follow cursor)", { skip: !target }, async () => {
  const info = await call("device", { action: "info", target });
  assert.ok(info.api_level);
  const log = await call("device", { action: "log", target, lines: 50 });
  assert.ok(log.lines >= 0);
  const windowed = await call("device", { action: "log", target, from: "2m", to: "0s", lines: 20 });
  assert.ok(windowed.window.from < windowed.window.to);
  const first = await call("device", { action: "log", target, follow: true, lines: 5, wait_ms: 3000 });
  assert.match(first.cursor, /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  const next = await call("device", { action: "log", target, follow: true, cursor: first.cursor, lines: 5, wait_ms: 5000 });
  assert.ok(next.cursor >= first.cursor);
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

test("deploy without building + uninstall first; hot reload of explicit files with restart", { skip: !target }, async () => {
  const base = await waitJob(await call("run", { action: "build_run", project, target, hot_reload: true, wait: 60000 }));
  assert.equal(base.status, "succeeded", JSON.stringify(base.error ?? base).slice(0, 2000));
  const redeploy = await waitJob(await call("run", { action: "build_run", project, target, skip_build: true, uninstall_first: true, hot_reload: true, wait: 60000 }));
  assert.equal(redeploy.status, "succeeded", JSON.stringify(redeploy.error ?? redeploy).slice(0, 2000));
  assert.equal(redeploy.kind, "deploy");
  const page = path.join(project, "entry/src/main/ets/pages/Index.ets");
  const original = fs.readFileSync(page, "utf8");
  fs.writeFileSync(page, original.replace("'Hello World'", "'Hello Files'"));
  try {
    const applied = await call("hot_reload", { action: "apply", project, files: ["entry/src/main/ets/pages/Index.ets"], restart: true });
    assert.equal(applied.restarted, true);
    assert.equal((await call("ui", { action: "assert", target, visible: { text: "Hello Files" }, timeout_ms: 5000 })).passed, true);
  } finally {
    fs.writeFileSync(page, original);
    await call("hot_reload", { action: "reset", project, target });
  }
});

test("windows, window-scoped tree, record_status", { skip: !target }, async () => {
  const { windows } = await call("ui", { action: "windows", target });
  const app = windows.find((w) => w.focused) ?? windows[0];
  assert.ok(app, JSON.stringify(windows));
  const tree = await call("ui", { action: "tree", target, window: app.id, depth: 8 });
  assert.ok(tree.nodes > 0);
  const status = await call("ui", { action: "record_status", target });
  assert.ok(["idle", "recording", "busy"].includes(status.status));
  const all = await call("ui", { action: "tree", target, all_windows: true, limit: 50 });
  assert.ok(all.nodes >= tree.nodes);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-shot-"));
  const shot = await call("ui", { action: "screenshot", target, display: 0, save_path: dir });
  assert.ok(fs.existsSync(shot.saved));
});

test("device sqlite on the app's RDB store (read-only by default)", { skip: !target }, async () => {
  const page = path.join(project, "entry/src/main/ets/pages/Index.ets");
  const original = fs.readFileSync(page, "utf8");
  fs.writeFileSync(page, `import { relationalStore } from '@kit.ArkData';\n` + original.replace(/build\(\)\s*\{/, `aboutToAppear(): void {
    relationalStore.getRdbStore(getContext(this), { name: 'e2e.db', securityLevel: relationalStore.SecurityLevel.S1 }).then(async (store) => {
      await store.executeSql('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, title TEXT)');
      await store.executeSql("INSERT OR REPLACE INTO notes VALUES (1, 'hello')");
    });
  }

  build() {`));
  try {
    const deployed = await waitJob(await call("run", { action: "build_run", project, target, wait: 60000 }));
    assert.equal(deployed.status, "succeeded", JSON.stringify(deployed.error ?? deployed).slice(0, 2000));
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await call("device", { action: "sqlite", target, bundle, db: "e2e.db", sql: "select * from notes" });
    assert.deepEqual(rows.rows, [{ id: 1, title: "hello" }]);
    const blocked = await client.call("device", { action: "sqlite", target, bundle, db: "e2e.db", sql: "delete from notes" });
    assert.equal(blocked.isError, true);
  } finally {
    fs.writeFileSync(page, original);
  }
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

test("UI test session: steps, review, report, export", { skip: !target }, async () => {
  const started = await call("ui", { action: "test_start", target, project, fresh_start: true, plan: "1. 显示 Hello World\n2. 点击后显示 Welcome" });
  assert.equal(started.checklist.length, 2);
  const id = started.test_id;
  const first = await call("ui", { action: "test_step", target, test_id: id, visible: { text: "Hello World" } });
  assert.equal(first.passed, true, JSON.stringify({ started, first }).slice(0, 3000));
  const click = await call("ui", { action: "test_step", target, test_id: id, op: "click", selector: { text: "Hello World" } });
  assert.equal(click.passed, true, JSON.stringify(click).slice(0, 2000));
  const welcome = await call("ui", { action: "test_step", target, test_id: id, visible: { text: "Welcome" } });
  assert.equal(welcome.passed, true, JSON.stringify(welcome).slice(0, 2000));
  const review = await client.call("ui", { action: "review", target, test_id: id, requirement: "Welcome is shown" });
  assert.ok(review.content.some((c) => c.type === "image"));
  await call("ui", { action: "review", target, test_id: id, outcome: "passed", reason: "visible" });
  const finished = await call("ui", { action: "test_finish", test_id: id });
  assert.equal(finished.status, "passed", JSON.stringify(finished));
  const dir = path.join(work, "ui-export");
  const exported = await call("ui", { action: "test_export", test_id: id, directory: dir });
  assert.ok(exported.files.includes("report.md") && fs.existsSync(path.join(dir, "test.json")));
  assert.ok((await call("ui", { action: "test_log", test_id: id, max_chars: 200 })).chars >= 0);
});
