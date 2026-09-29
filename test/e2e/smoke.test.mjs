// End-to-end smoke test against a real DevEco toolchain (and optionally a device/emulator).
// Env: DEVECO_CONFIG (toolchain), E2E_TARGET (hdc serial, e.g. 127.0.0.1:5555 for an emulator).
// The test app is installed on E2E_TARGET only and uninstalled at the end.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { makeCallChain, makeGesturePage, makeInterface } from "./fixtures.mjs";

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

test("lsp implementation of an interface", async () => {
  makeInterface(project);
  const impl = await call("code", { action: "lsp", op: "implementation", project, file: "entry/src/main/ets/pages/Shape.ets", symbol: "Shape" });
  assert.ok(impl.locations?.some((l) => l.file.endsWith("Shape.ets") && l.line >= 5), JSON.stringify(impl));
});

test("job status / list / read / cancel / resume", async () => {
  const done = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
  assert.equal(done.status, "succeeded", JSON.stringify(done.error ?? done).slice(0, 2000));
  const status = await call("job", { action: "status", job_id: done.job_id, detail: true });
  assert.equal(status.status, "succeeded");
  assert.ok(status.recent_events.length > 0);
  const listed = await call("job", { action: "list", status: "succeeded", limit: 50 });
  assert.ok(listed.jobs.some((j) => j.job_id === done.job_id));
  // The build log is an artifact: page it and grep it.
  const page = await call("job", { action: "read", artifact_id: done.result.log_artifact, limit: 20 });
  assert.ok(page.total_lines > 0 && page.content.length > 0);
  const grep = await call("job", { action: "read", artifact_id: done.result.log_artifact, grep: "BUILD SUCCESSFUL|Finished" });
  assert.ok(grep.matched_lines >= 1, JSON.stringify(grep).slice(0, 500));
  // Cancel a running clean build, then resume the cancelled... not allowed; a failed job can resume.
  const running = await call("project", { action: "build", project, clean: true, wait: 0 });
  const cancelled = await call("job", { action: "cancel", job_id: running.job_id });
  assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
  const refused = await client.call("job", { action: "resume", job_id: running.job_id });
  assert.equal(refused.data.error.code, "INVALID_INPUT");
  const missing = await client.call("job", { action: "status", job_id: "nope" });
  assert.equal(missing.isError, true);
});

test("hot_reload stop_daemon", async () => {
  const stopped = await call("hot_reload", { action: "stop_daemon", project });
  assert.equal(stopped.stopped, true, JSON.stringify(stopped));
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

test("ui act: every gesture, text input and mouse operation has its effect", { skip: !target }, async () => {
  makeGesturePage(project);
  const deployed = await waitJob(await call("run", { action: "build_run", project, target, wait: 60000 }));
  assert.equal(deployed.status, "succeeded", JSON.stringify(deployed.error ?? deployed).slice(0, 2000));
  const node = async (id) => (await call("ui", { action: "find", target, selector: { id } })).matches[0];
  const at = async (id) => { const m = await node(id); return { m, x: Math.round((m.bounds[0] + m.bounds[2]) / 2), y: Math.round((m.bounds[1] + m.bounds[3]) / 2) }; };
  const expect = async (id, re, what) => { const m = await node(id); assert.match(m?.text ?? "", re, what); };
  const act = (args) => call("ui", { action: "act", target, ...args });

  let b = await at("TapBox");
  await act({ op: "click", x: b.x, y: b.y }); await expect("TapBox", /taps:1/, "click");
  b = await at("DoubleBox");
  await act({ op: "double_click", x: b.x, y: b.y }); await expect("DoubleBox", /doubles:1/, "double_click");
  b = await at("LongBox");
  await act({ op: "long_click", x: b.x, y: b.y }); await expect("LongBox", /longs:1/, "long_click");
  b = await at("SwipeBox");
  await act({ op: "swipe", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await expect("SwipeBox", /swipe:right/, "swipe");
  await act({ op: "fling", x: b.m.bounds[2] - 60, y: b.y, x2: b.m.bounds[0] + 60, y2: b.y, speed: 3000 }); await expect("SwipeBox", /swipe:left/, "fling");
  b = await at("DragBox");
  await act({ op: "drag", x: b.x, y: b.y, x2: b.x, y2: b.y + 300 }); await expect("DragBox", /dragged:1/, "drag");

  b = await at("Field");
  await act({ op: "input", x: b.x, y: b.y, text: `a b$c'd "q"` }); await expect("Echo", /^typed:a b\$c'd "q"$/, "input keeps spaces, $ and straight quotes");
  await act({ op: "input", x: b.x, y: b.y, text: "你好 鸿蒙" }); await expect("Echo", /^typed:你好 鸿蒙$/, "input replaces, Chinese");
  await act({ op: "type", text: " xyz" }); await expect("Echo", /^typed:你好 鸿蒙 xyz$/, "type into focused field");
  await act({ op: "input", x: b.x, y: b.y, text: "!", append: true }); await expect("Echo", /^typed:你好 鸿蒙 xyz!$/, "input append");
  await act({ op: "key", key: "back" }); // hide the soft keyboard
  await new Promise((r) => setTimeout(r, 800));

  b = await at("TapBox");
  await act({ op: "mouse_click", x: b.x, y: b.y }); await expect("TapBox", /taps:2/, "mouse_click");
  b = await at("DoubleBox");
  await act({ op: "mouse_double_click", x: b.x, y: b.y }); await expect("DoubleBox", /doubles:2/, "mouse_double_click");
  b = await at("LongBox");
  await act({ op: "mouse_long_click", x: b.x, y: b.y }); await expect("LongBox", /longs:2/, "mouse_long_click");
  b = await at("SwipeBox");
  await act({ op: "mouse_drag", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await expect("SwipeBox", /swipe:right/, "mouse_drag");
  const firstRow = async () => (await call("ui", { action: "tree", target, node: "Rows", interactive: false, limit: 40 })).tree.match(/"row \d+"/)?.[0];
  const before = await firstRow();
  const rows = await at("Rows");
  await act({ op: "mouse_scroll", x: rows.x, y: rows.y, direction: "down", ticks: 5 });
  assert.notEqual(await firstRow(), before, "mouse_scroll moves the list");
  await act({ op: "mouse_move", x: rows.x, y: rows.y });
  b = await at("TapBox");
  assert.equal((await act({ op: "click", x: b.x, y: b.y, verify_change: true })).changed, true, "verify_change sees the label update");
  const bad = await client.call("ui", { action: "act", target, op: "key", key: "not-a-key" });
  assert.equal(bad.data.error.code, "INVALID_INPUT");
});
