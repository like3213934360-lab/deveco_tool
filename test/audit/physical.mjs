// Explicit physical target + disposable signed project. Real MCP calls only; no environment setup.
// Raw traces and images stay in AUDIT_DIR. A failed assertion is retained and exits nonzero.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import JSON5 from "json5";
import { connect } from "../../tools/mcp-client.mjs";

const target = process.env.AUDIT_TARGET, project = process.env.AUDIT_PROJECT, directory = process.env.AUDIT_DIR;
const phase = process.argv[2];
assert.ok(target && project && directory && phase, "AUDIT_TARGET, AUDIT_PROJECT, AUDIT_DIR and phase are required");
assert.ok(["host", "sdk", "device", "gestures", "flows", "review", "review_finish", "signing", "jobs", "variants", "lifecycle"].includes(phase), "Unknown audit phase");
assert.ok(path.isAbsolute(project) && path.isAbsolute(directory));
const bundle = JSON5.parse(fs.readFileSync(path.join(project, "AppScope/app.json5"), "utf8")).app.bundleName;
assert.match(bundle, /^com\.devecomcp\./, "Only a dedicated MCP test app may be mutated");
fs.mkdirSync(directory, { recursive: true });
const client = connect(), results = [];
let current = "preflight", kind = "positive", sequence = 0;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const run = `${phase}-${Date.now()}`, trace = path.join(directory, `${run}.jsonl`);
const redact = (value) => JSON.parse(JSON.stringify(value, (key, v) => /password/i.test(key) ? "[redacted]" : v));

async function raw(tool, args = {}) {
  const at = new Date().toISOString(), start = performance.now();
  const response = await client.call(tool, args);
  const images = response.content.filter((c) => c.type === "image").map((c, i) => {
    const bytes = Buffer.from(c.data, "base64"), file = `${run}-${sequence}-${i}.${c.mimeType === "image/png" ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(directory, file), bytes);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
  fs.appendFileSync(trace, JSON.stringify({ sequence: sequence++, case: current, kind, at, ms: Math.round(performance.now() - start), tool, args: redact(args), isError: response.isError, data: response.data, images }) + "\n");
  return { ...response, images };
}
async function call(tool, args = {}) {
  const r = await raw(tool, args);
  assert.equal(r.isError, false, JSON.stringify(r.data));
  return r.data;
}
async function job(tool, args) {
  let d = await call(tool, args);
  while (["queued", "running"].includes(d.status)) d = await call("job", { action: "wait", job_id: d.job_id, wait: 55000 });
  assert.equal(d.status, "succeeded", JSON.stringify(d));
  return d;
}
async function check(id, fn, type = "positive") {
  current = id; kind = type; const start = performance.now();
  try {
    await fn(); results.push({ id, kind, status: "passed", ms: Math.round(performance.now() - start) });
    console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, kind, status: "failed", error: error.message, ms: Math.round(performance.now() - start) });
    console.log(`FAIL ${id}: ${error.message.slice(0, 1500)}`);
  }
  fs.writeFileSync(path.join(directory, `${phase}-results.json`), JSON.stringify({ phase, trace, results }, null, 2));
}
const ui = (args) => call("ui", { target, ...args });
const visible = async (text) => assert.equal((await ui({ action: "assert", visible: { text, exact: true }, timeout_ms: 5000 })).passed, true);
const launch = () => call("run", { action: "launch", project, target });
const file = "entry/src/main/ets/pages/Index.ets";
const lsp = (op, args = {}) => call("code", { action: "lsp", project, file, op, ...args });

try {
  const initialized = await client.initialize();
  fs.writeFileSync(path.join(directory, `${phase}-initialize.json`), JSON.stringify(initialized, null, 2));
  const inventory = await client.request("tools/list");
  fs.writeFileSync(path.join(directory, "tools.json"), JSON.stringify(inventory.result.tools, null, 2));
  const info = await call("device", { action: "info", target });
  assert.ok(!target.includes(":") && !/emulator/i.test(`${info.model} ${info.name}`), "This audit requires the selected USB physical device");

  if (phase === "host") {
    await check("doctor", async () => assert.equal((await call("doctor", { project, target })).ok, true));
    await check("device.list-info", async () => {
      assert.ok((await call("device", { action: "list" })).devices.some((d) => d.target === target));
      assert.ok(info.api_level >= 26 && info.screen.width > 0);
    });
    await check("knowledge.local-search-read", async () => {
      const d = await call("knowledge", { action: "search", query: "Scroll", kind: "docs", limit: 5 });
      assert.ok(d.results.length > 0);
      const read = await call("knowledge", { action: "read", id: d.results[0].id });
      assert.ok(read.content.length > 100);
    });
    await check("knowledge.catalog-status-update-check", async () => {
      const catalog = await call("knowledge", { action: "catalog" });
      assert.ok(JSON.stringify(catalog).includes("harmonyos-guides"));
      const state = await call("knowledge", { action: "status", check: false });
      assert.ok(state.installed.version);
      const update = await call("knowledge", { action: "update", check: true });
      assert.ok(update);
      assert.equal((await call("knowledge", { action: "status", check: false })).installed.version, state.installed.version);
    });
    await check("knowledge.cloud-search", async () => {
      const d = await call("knowledge", { action: "search", source: "cloud", query: "HarmonyOS ArkUI Scroll 滚动容器", limit: 3 });
      assert.ok(d.full_artifact);
      const text = await call("job", { action: "read", artifact_id: d.full_artifact, limit: 30 });
      assert.ok(text.content.length > 50);
    });
    await check("auth.status-teams", async () => {
      const status = await call("auth", { action: "status" });
      assert.ok(JSON.stringify(status).includes('"logged_in":true'));
      assert.ok((await call("auth", { action: "teams" })).teams.length > 0);
    });
    await check("skills.list-read-search", async () => {
      assert.ok((await call("skills", { action: "list" })).skills.length >= 3);
      assert.match((await call("skills", { action: "read", name: "deveco-mcp-workflow" })).content, /action/);
      const found = await call("skills", { action: "search", query: "harmony", limit: 5 });
      assert.ok(found.skills.length > 0);
    });
    await check("emulator.readonly-inventory", async () => {
      assert.ok((await call("emulator", { action: "list" })).emulators.length > 0);
      const images = await call("emulator", { action: "images" }); assert.ok(images);
      const license = await call("emulator", { action: "license_view" }); assert.ok(JSON.stringify(license).length > 100);
    });
  }

  if (phase === "sdk") {
    await check("project.info-sync-build", async () => {
      assert.equal((await call("project", { action: "info", project })).bundle_name, bundle);
      await job("project", { action: "sync", project, wait: 0 });
      const built = await job("project", { action: "build", project, wait: 0 });
      assert.ok(built.result.artifacts.some((a) => a.path.endsWith("-signed.hap") && fs.statSync(a.path).size > 0));
      fs.writeFileSync(path.join(directory, "build.json"), JSON.stringify(built, null, 2));
      const status = await call("job", { action: "status", job_id: built.job_id, detail: true });
      assert.equal(status.status, "succeeded");
      assert.ok((await call("job", { action: "list", limit: 100 })).jobs.some((j) => j.job_id === built.job_id));
      const log = await call("job", { action: "read", artifact_id: built.result.log_artifact, grep: "BUILD SUCCESSFUL" });
      assert.ok(log.matched_lines > 0);
    });
    await check("code.check", async () => assert.equal((await call("code", { action: "check", project, files: [file] })).errors, 0));
    await check("code.lint", async () => {
      const d = await call("code", { action: "lint", project });
      assert.ok(d.report_artifact); assert.equal(d.exit_code, 0);
    });
    await check("code.api-versions-scan", async () => {
      const d = await call("code", { action: "api_versions" }); assert.ok(d.versions.length >= 2);
      const scan = await call("code", { action: "api_scan", project, from: d.versions.at(-2), to: d.versions.at(-1) });
      assert.ok(scan.findings !== undefined);
    });
    await check("code.lsp.hover", async () => assert.match((await lsp("hover", { symbol: "message" })).hover, /string/));
    for (const op of ["definition", "declaration"]) await check(`code.lsp.${op}`, async () => {
      assert.ok((await lsp(op, { symbol: "middle", line: 1 })).locations.some((l) => l.file.endsWith("Util.ets")));
    });
    await check("code.lsp.implementation", async () => {
      assert.ok((await lsp("implementation", { file: "entry/src/main/ets/pages/Shape.ets", symbol: "Shape" })).locations.some((l) => l.file.endsWith("Shape.ets") && l.line >= 5));
    });
    await check("code.lsp.references", async () => assert.ok((await lsp("references", { symbol: "message" })).references.length >= 2));
    await check("code.lsp.symbols", async () => assert.ok((await lsp("symbols")).symbols.length > 0));
    await check("code.lsp.workspace_symbols", async () => assert.ok((await lsp("workspace_symbols", { query: "Square" })).symbols.some((s) => s.name === "Square")));
    await check("code.lsp.diagnostics", async () => assert.equal((await lsp("diagnostics")).errors, 0));
    await check("code.lsp.completion", async () => {
      const d = await lsp("completion", { file: "entry/src/main/ets/pages/Util.ets", line: 6, column: 14 });
      assert.ok(d.items.some((i) => i.label === "leaf(n: number): number"));
    });
    await check("code.lsp.signature", async () => {
      const d = await lsp("signature", { file: "entry/src/main/ets/pages/Util.ets", line: 6, column: 15 });
      assert.match(JSON.stringify(d), /leaf/);
    });
    await check("code.lsp.call_hierarchy", async () => {
      assert.deepEqual((await lsp("call_hierarchy", { file: "entry/src/main/ets/pages/Util.ets", symbol: "leaf" })).calls.map((c) => c.name), ["middle"]);
      assert.deepEqual((await lsp("call_hierarchy", { file: "entry/src/main/ets/pages/Util.ets", symbol: "middle", line: 5, direction: "outgoing" })).calls.map((c) => c.name), ["leaf"]);
    });
    await check("code.lsp.cpp", async () => {
      await job("project", { action: "build", task: "compileNative", project, wait: 0 });
      const d = await lsp("hover", { file: "entry/src/main/cpp/napi_init.cpp", symbol: "Add", line: 2 }); assert.match(d.hover, /int/);
      const definition = await lsp("definition", { file: "entry/src/main/cpp/napi_init.cpp", symbol: "Add", line: 5 }); assert.ok(definition.locations.some((l) => l.line === 2));
    });
    await check("code.lsp_restart", async () => assert.ok((await call("code", { action: "lsp_restart", project, language: "all" })).restarted.includes("arkts")));
  }

  if (phase === "device") {
    await check("run.build_run", async () => {
      const d = await job("run", { action: "build_run", project, target, run_mode: "full", hot_reload: true, wait: 0,
        assert: { visible: { text: "Hello World", exact: true }, timeout_ms: 8000 } });
      assert.equal(d.result.launch.started, true); assert.equal(d.result.assert.passed, true);
    });
    await check("device.shell", async () => {
      const d = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
      assert.equal(d.exit_code, 0); assert.ok(d.output.includes(bundle));
    });
    await check("device.send-recv", async () => {
      const source = path.join(directory, "transfer.bin"), dest = path.join(directory, "transfer-return.bin");
      fs.writeFileSync(source, crypto.randomBytes(65536));
      const remote = `/data/local/tmp/mcp-audit-${Date.now()}.bin`;
      await call("device", { action: "send", target, local: source, remote });
      await call("device", { action: "recv", target, local: dest, remote });
      assert.equal(sha(fs.readFileSync(source)), sha(fs.readFileSync(dest)));
    });
    await check("device.sqlite", async () => {
      await call("device", { action: "sqlite", target, bundle, db: "audit.db", write: true, sql: "INSERT OR REPLACE INTO proof VALUES (1,'physical-audit')" });
      const d = await call("device", { action: "sqlite", target, bundle, db: "audit.db", sql: "SELECT * FROM proof ORDER BY id" });
      assert.deepEqual(d.rows, [{ id: 1, value: "physical-audit" }]);
    });
    await check("device.sqlite.readonly-rejection", async () => {
      const r = await raw("device", { action: "sqlite", target, bundle, db: "audit.db", sql: "DELETE FROM proof" });
      assert.equal(r.isError, true);
      assert.equal((await call("device", { action: "sqlite", target, bundle, db: "audit.db", sql: "SELECT * FROM proof" })).rows.length, 1);
    }, "negative");
    await check("device.log-window-follow", async () => {
      const d = await call("device", { action: "log", target, bundle, project, from: "2m", to: "0s", lines: 50 });
      assert.ok(d.lines > 0 && d.window.from < d.window.to);
      const first = await call("device", { action: "log", target, bundle, follow: true, lines: 5, wait_ms: 1000 });
      assert.match(first.cursor, /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      const next = await call("device", { action: "log", target, bundle, follow: true, cursor: first.cursor, lines: 5, wait_ms: 1000 });
      assert.ok(next.cursor >= first.cursor);
    });
    await check("ui.observe-screenshot-tree-find-windows", async () => {
      const r = await raw("ui", { action: "observe", target, bundle });
      assert.equal(r.isError, false); assert.ok(r.images.length > 0); assert.match(r.data.elements, /Hello World/);
      const shot = path.join(directory, "physical.png");
      await ui({ action: "screenshot", save_path: shot, format: "png" }); assert.ok(fs.statSync(shot).size > 1000);
      const windows = await ui({ action: "windows" });
      assert.ok(windows.windows.some((w) => w.focused));
      const tree = await ui({ action: "tree", depth: 12, all_windows: true, limit: 100 }); assert.ok(tree.nodes > 10);
      const found = await ui({ action: "find", selector: { key: "Field" } }); assert.equal(found.count, 1);
    });
    await check("sign.verify", async () => {
      const build = JSON.parse(fs.readFileSync(path.join(directory, "build.json"), "utf8"));
      const hap = build.result.artifacts.find((a) => a.path.endsWith("-signed.hap")).path;
      const verified = await call("sign", { action: "verify", file: hap });
      assert.equal(verified.verified, true); assert.equal(verified.profile.bundle, bundle);
    });
  }

  if (phase === "gestures") {
    await launch(); await visible("Hello World");
    const node = async (key) => {
      const d = await ui({ action: "find", selector: { key } }); assert.equal(d.count, 1, key); return d.matches[0];
    };
    const at = async (key) => { const m = await node(key); return { m, x: Math.round((m.bounds[0] + m.bounds[2]) / 2), y: Math.round((m.bounds[1] + m.bounds[3]) / 2) }; };
    const act = (args) => ui({ action: "act", ...args });
    const text = async (key, expected) => assert.equal((await node(key)).text, expected);
    await check("ui.act.click", async () => { await act({ op: "click", selector: { key: "TapBox" } }); await text("TapBox", "taps:1"); });
    await check("ui.act.double_click", async () => { await act({ op: "double_click", selector: { key: "DoubleBox" } }); await text("DoubleBox", "doubles:1"); });
    await check("ui.act.long_click", async () => { await act({ op: "long_click", selector: { key: "LongBox" } }); await text("LongBox", "longs:1"); });
    await check("ui.act.swipe", async () => {
      const b = await at("SwipeBox"); await act({ op: "swipe", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await text("SwipeBox", "swipe:right");
    });
    await check("ui.act.fling", async () => {
      const b = await at("SwipeBox"); await act({ op: "fling", x: b.m.bounds[2] - 60, y: b.y, x2: b.m.bounds[0] + 60, y2: b.y, speed: 3000 }); await text("SwipeBox", "swipe:left");
    });
    await check("ui.act.drag", async () => {
      const b = await at("DragBox"); await act({ op: "drag", x: b.x, y: b.y, x2: b.x, y2: b.y + 300 }); await text("DragBox", "dragged:1");
    });
    for (const [op, key, expected] of [["mouse_click", "TapBox", "taps:2"], ["mouse_double_click", "DoubleBox", "doubles:2"], ["mouse_long_click", "LongBox", "longs:2"]]) await check(`ui.act.${op}`, async () => {
      const b = await at(key); await act({ op, x: b.x, y: b.y }); await text(key, expected);
    });
    await check("ui.act.mouse_drag", async () => {
      const b = await at("SwipeBox"); await act({ op: "mouse_drag", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await text("SwipeBox", "swipe:right");
    });
    const firstRow = async () => (await ui({ action: "tree", node: "Rows", interactive: false, limit: 80 })).tree.match(/"row \d+"/)?.[0];
    for (const op of ["scroll", "mouse_scroll"]) await check(`ui.act.${op}`, async () => {
      const before = await firstRow(); assert.ok(before);
      const b = await at("Rows"); await act({ op, x: b.x, y: b.y, direction: "down", ticks: 5 });
      const after = await firstRow(); assert.ok(after); assert.notEqual(after, before);
    });
    await check("ui.act.mouse_move", async () => {
      const b = await at("TapBox"); const d = await act({ op: "mouse_move", x: b.x, y: b.y }); assert.equal(d.performed, "mouse_move");
    });
    await check("ui.act.input-type-key", async () => {
      await act({ op: "input", selector: { key: "Field" }, text: `a b$c'd "q"` }); await text("Echo", `typed:a b$c'd "q"`);
      await act({ op: "input", selector: { key: "Field" }, text: "你好 鸿蒙" }); await text("Echo", "typed:你好 鸿蒙");
      await act({ op: "type", text: " xyz" }); await text("Echo", "typed:你好 鸿蒙 xyz");
      await act({ op: "input", selector: { key: "Field" }, text: "!", append: true }); await text("Echo", "typed:你好 鸿蒙 xyz!");
      await act({ op: "key", key: "back" });
      await text("Echo", "typed:你好 鸿蒙 xyz!");
    });
    await check("ui.act.batch", async () => {
      await launch();
      const d = await act({ steps: [{ op: "click", selector: { key: "TapBox" } }, { op: "click", selector: { key: "HelloWorld" } }],
        assert: { visible: { text: "Welcome", exact: true } }, save_flow: { project, id: "batch-audit" } });
      assert.ok(d); await visible("Welcome"); await text("TapBox", "taps:1");
    });
  }

  if (phase === "flows") {
    await launch(); await visible("Hello World");
    const flow = (args) => call("ui_flow", { project, ...(["record", "stop", "replay"].includes(args.action) ? { target } : {}), ...args });
    await check("ui_flow.record-stop-list-show-replay", async () => {
      await flow({ action: "record", id: "physical-audit" });
      await ui({ action: "act", op: "click", selector: { key: "HelloWorld" } });
      assert.equal((await flow({ action: "stop", assert: { visible: { text: "Welcome", exact: true } } })).saved, "physical-audit");
      assert.ok(JSON.stringify(await flow({ action: "list" })).includes("physical-audit"));
      assert.ok(JSON.stringify(await flow({ action: "show", id: "physical-audit" })).includes("HelloWorld"));
      const replay = await job("ui_flow", { action: "replay", project, target, id: "physical-audit", snapshot: true, wait: 0 });
      assert.equal(replay.result.passed, true); await visible("Welcome");
      const again = await job("ui_flow", { action: "replay", project, target, id: "physical-audit", snapshot: true, wait: 0 });
      assert.equal(again.result.passed, true); assert.equal(again.result.visual.same, true);
    });
    await check("run.deploy-then_flow", async () => {
      const d = await job("run", { action: "deploy", project, target, then_flow: "physical-audit", wait: 0 });
      assert.equal(d.result.flow.passed, true); assert.equal(d.result.launch.started, true); await visible("Welcome");
    });
    await check("ui.visual", async () => {
      await launch(); await visible("Hello World");
      const name = `physical-${Date.now()}`;
      assert.equal((await ui({ action: "visual", project, name })).baseline, "created");
      assert.equal((await ui({ action: "visual", project, name })).same, true);
      await ui({ action: "act", op: "click", selector: { key: "HelloWorld" } });
      const changed = await ui({ action: "visual", project, name });
      assert.equal(changed.same, false); assert.ok(changed.changed_ratio > 0 && changed.diff_artifact);
      const diff = await raw("job", { action: "read", artifact_id: changed.diff_artifact }); assert.ok(diff.images.length);
      assert.equal((await ui({ action: "visual", project, name, update: true })).baseline, "updated");
      assert.equal((await ui({ action: "visual", project, name })).same, true);
    });
    await check("ui.layout", async () => {
      const d = await ui({ action: "layout", project }); assert.ok(d.checked > 10 && d.counts);
    });
    await check("ui.perf", async () => {
      const found = await ui({ action: "find", selector: { key: "Rows" } }); assert.equal(found.count, 1);
      const [x1, y1, x2, y2] = found.matches[0].bounds, x = Math.round((x1 + x2) / 2);
      const d = await ui({ action: "perf", bundle, steps: [
        { op: "fling", x, y: y2 - 80, x2: x, y2: y1 + 80, speed: 3000 },
        { op: "fling", x, y: y1 + 80, x2: x, y2: y2 - 80, speed: 3000 },
      ] });
      assert.equal(d.source, "composer"); assert.equal(d.gestures, 2);
      assert.ok(d.frames > 10 && d.frame_ms.p95 > 0 && d.avg_fps > 0, JSON.stringify(d));
    });
    await check("ui_flow.delete", async () => {
      await flow({ action: "delete", id: "physical-audit" });
      assert.ok(!JSON.stringify(await flow({ action: "list" })).includes("physical-audit"));
    });
  }

  if (phase === "review") {
    await check("ui.test_start-step-review-capture", async () => {
      const started = await ui({ action: "test_start", project, fresh_start: true, plan: "1. 显示 Hello World\n2. 点击后显示 Welcome" });
      assert.equal(started.checklist.length, 2);
      const test_id = started.test_id;
      assert.equal((await ui({ action: "test_step", test_id, visible: { text: "Hello World", exact: true } })).passed, true);
      assert.equal((await ui({ action: "test_step", test_id, op: "click", selector: { key: "HelloWorld" } })).passed, true);
      assert.equal((await ui({ action: "test_step", test_id, visible: { text: "Welcome", exact: true } })).passed, true);
      const review = await raw("ui", { action: "review", target, test_id, requirement: "Welcome is visible at the top of the test app, with the gesture controls below it" });
      assert.equal(review.isError, false); assert.equal(review.images.length, 1);
      fs.writeFileSync(path.join(directory, "pending-review.json"), JSON.stringify({ test_id, review_id: review.data.review_id, image: review.images[0].file }, null, 2));
    });
  }

  if (phase === "review_finish") {
    await check("ui.review-finish-log-export", async () => {
      const pending = JSON.parse(fs.readFileSync(path.join(directory, "pending-review.json"), "utf8"));
      // A host must actually inspect the image and write this decision; the test never auto-approves it.
      const decision = JSON.parse(fs.readFileSync(path.join(directory, "review-decision.json"), "utf8"));
      assert.equal(decision.test_id, pending.test_id); assert.equal(decision.review_id, pending.review_id);
      assert.equal(decision.image_sha256, sha(fs.readFileSync(path.join(directory, pending.image))));
      assert.ok(decision.reason && ["passed", "failed", "insufficient"].includes(decision.outcome));
      const test_id = pending.test_id;
      await ui({ action: "review", test_id, review_id: pending.review_id, outcome: decision.outcome, reason: decision.reason });
      assert.equal((await ui({ action: "test_finish", test_id })).status, "passed");
      assert.ok((await ui({ action: "test_log", test_id, max_chars: 5000 })).chars > 0);
      const out = path.join(directory, "review-export");
      const exported = await ui({ action: "test_export", test_id, directory: out });
      assert.ok(exported.files.includes("report.md") && exported.files.includes("test.json"));
      const report = JSON.parse(fs.readFileSync(path.join(out, "test.json"), "utf8"));
      assert.equal(report.status, "passed"); assert.equal(report.reviews[0].reason, decision.reason);
      assert.ok(exported.files.some((f) => f.startsWith("review0") && fs.statSync(path.join(out, f)).size > 1000));
    });
    await check("ui.test-failed-assertion", async () => {
      const { test_id } = await ui({ action: "test_start", project, plan: "A missing control must fail the session" });
      const step = await ui({ action: "test_step", test_id, visible: { text: "MCP_MISSING_CONTROL", exact: true }, timeout_ms: 500 });
      assert.equal(step.passed, false);
      assert.equal((await ui({ action: "test_finish", test_id })).status, "failed");
    }, "negative");
  }

  if (phase === "signing") {
    const team = process.env.AUDIT_TEAM;
    assert.ok(team, "AUDIT_TEAM must be explicitly selected by the user");
    await check("sign.certificates-devices", async () => {
      const certificates = await call("sign", { action: "certificates", team });
      assert.ok(certificates.certificates.some((c) => c.type === "debug" && c.expires > Date.now()));
      const devices = await call("sign", { action: "devices", team });
      const registration = await call("sign", { action: "register_device", team, target });
      assert.ok(devices.devices.some((d) => d.udid === registration.udid), JSON.stringify(registration));
    });
    await check("sign.keypair-csr", async () => {
      const keystore = path.join(directory, `audit-${Date.now()}.p12`), password = crypto.randomBytes(24).toString("hex"), out = keystore + ".csr";
      await call("sign", { action: "keypair", out: keystore, keystore_password: password, key_alias: "AuditKey" });
      execFileSync("openssl", ["pkcs12", "-in", keystore, "-passin", "stdin", "-noout"], { input: password + "\n", stdio: ["pipe", "pipe", "pipe"] });
      await call("sign", { action: "csr", keystore, keystore_password: password, key_alias: "AuditKey", out });
      assert.match(fs.readFileSync(out, "utf8"), /BEGIN (NEW )?CERTIFICATE REQUEST/);
      execFileSync("openssl", ["req", "-in", out, "-verify", "-noout"], { stdio: "pipe" });
    });
    await check("sign.sign-verify", async () => {
      const build = JSON.parse(fs.readFileSync(path.join(directory, "build.json"), "utf8"));
      const unsigned = build.result.artifacts.find((a) => a.path.endsWith("-signed.hap")).path.replace(/-signed\.hap$/, "-unsigned.hap");
      assert.ok(fs.existsSync(unsigned));
      const out = path.join(directory, `${run}-signed.hap`);
      await call("sign", { action: "sign", project, file: unsigned, out });
      const d = await call("sign", { action: "verify", file: out }); assert.equal(d.verified, true); assert.equal(d.profile.bundle, bundle);
    });
  }

  if (phase === "jobs") {
    await check("project.clean", async () => {
      assert.equal((await call("project", { action: "clean", project })).cleaned, true);
      assert.ok(!fs.existsSync(path.join(project, "entry/build/default/outputs/default/entry-default-signed.hap")));
    });
    await check("job.cancel", async () => {
      const started = await call("project", { action: "build", project, clean: true, wait: 0 });
      assert.ok(["queued", "running"].includes(started.status));
      const cancelled = await call("job", { action: "cancel", job_id: started.job_id });
      assert.equal(cancelled.status, "cancelled");
      const refused = await raw("job", { action: "resume", job_id: started.job_id });
      assert.equal(refused.isError, true); assert.equal(refused.data.error.code, "INVALID_INPUT");
    });
    await check("diagnose.build-job.resume", async () => {
      const full = path.join(project, file), original = fs.readFileSync(full, "utf8");
      let failed;
      try {
        fs.writeFileSync(full, original.replace("message: string", "message: any"));
        failed = await call("project", { action: "build", project, wait: 0 });
        while (["queued", "running"].includes(failed.status)) failed = await call("job", { action: "wait", job_id: failed.job_id, wait: 55000 });
        assert.equal(failed.status, "failed", JSON.stringify(failed));
        const diagnostics = failed.error?.details?.diagnostics ?? failed.result?.diagnostics;
        assert.ok(diagnostics?.length, JSON.stringify(failed));
        const explanation = await call("diagnose", { action: "build", diagnostics });
        assert.match(JSON.stringify(explanation), /any\/unknown|explicit types/);
      } finally { fs.writeFileSync(full, original); }
      const resumed = await job("job", { action: "resume", job_id: failed.job_id });
      assert.equal(resumed.result.success, true);
      fs.writeFileSync(path.join(directory, "build.json"), JSON.stringify(resumed, null, 2));
    });
  }

  if (phase === "variants") {
    const full = path.join(project, file), original = fs.readFileSync(full, "utf8");
    try {
      await check("ui.act.mouse_move.effect", async () => {
        fs.writeFileSync(full, original.replace(".id('TapBox')", ".id('TapBox').onHover((hover: boolean) => { this.message = hover ? 'Hover entered' : 'Hover exited'; })"));
        await job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
        await ui({ action: "act", op: "mouse_move", selector: { key: "TapBox" } });
        await visible("Hover entered");
        await ui({ action: "act", op: "mouse_move", selector: { key: "LongBox" } });
        await visible("Hover exited");
      });
      await check("ui.onboarding-preserves-defaults", async () => {
        fs.copyFileSync(new URL("../e2e/onboarding-page.ets", import.meta.url), full);
        await job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
        assert.match((await ui({ action: "tree" })).tree, /欢迎使用示例工具/);
        const started = await ui({ action: "test_start", project, plan: "默认选项保留，引导完成后进入订单页面" });
        const test_id = started.test_id;
        const result = await ui({ action: "test_step", test_id, op: "click", selector: { key: "Business" }, visible: { key: "Result" } });
        assert.equal(result.passed, true); assert.equal(result.onboarding_completed.length, 3);
        assert.equal(result.onboarding_completed[1].text, "请选择应用主题: 下一步 (system)");
        assert.match(result.onboarding_completed[2].text, /跳过介绍/);
        assert.equal((await ui({ action: "find", selector: { key: "Result" } })).matches[0].text, "orders:0;theme:system");
        assert.equal((await ui({ action: "test_step", test_id, visible: { text: "orders:0;theme:system", exact: true } })).passed, true);
        assert.equal((await ui({ action: "test_finish", test_id })).status, "passed");
        await ui({ action: "test_export", test_id, directory: path.join(directory, "onboarding") });
        const report = JSON.parse(fs.readFileSync(path.join(directory, "onboarding/test.json"), "utf8"));
        assert.deepEqual(report.steps[1].onboarding_completed, result.onboarding_completed);
      });
      await check("diagnose.crash-real-startup", async () => {
        fs.writeFileSync(full, original.replace("  build() {", "  aboutToAppear() { throw new Error('MCP_PHYSICAL_AUDIT_CRASH'); }\n\n  build() {"));
        let failed = await call("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
        while (["queued", "running"].includes(failed.status)) failed = await call("job", { action: "wait", job_id: failed.job_id, wait: 55000 });
        assert.equal(failed.status, "failed", JSON.stringify(failed));
        assert.equal(failed.error.code, "LAUNCH_FAILED");
        assert.ok(failed.error.details.crash.source.some((s) => s.file.endsWith("Index.ets")), JSON.stringify(failed));
        const d = await call("diagnose", { action: "crash", project, target, bundle, since_minutes: 5 });
        assert.ok(d.reports.some((r) => r.message.includes("MCP_PHYSICAL_AUDIT_CRASH") && r.source.some((s) => s.file.endsWith("Index.ets"))), JSON.stringify(d));
        assert.ok((await call("job", { action: "read", artifact_id: d.reports[0].report_artifact })).content.includes("MCP_PHYSICAL_AUDIT_CRASH"));
      }, "negative");
    } finally {
      fs.writeFileSync(full, original);
      await job("run", { action: "build_run", project, target, run_mode: "full", hot_reload: true, wait: 0,
        assert: { visible: { text: "Hello World", exact: true }, timeout_ms: 8000 } });
    }
  }

  if (phase === "lifecycle") {
    await check("run.auto-baseline", async () => {
      // Manual hot_reload=true and auto mode keep distinct state. Exercise auto's own setup.
      await job("run", { action: "build_run", project, target, wait: 0 });
      await job("run", { action: "build_run", project, target, wait: 0 });
      await visible("Hello World");
    });
    await check("run.stop-launch", async () => {
      await call("run", { action: "stop", project, target });
      assert.equal((await call("device", { action: "shell", target, command: `pidof ${bundle}` })).output.trim(), "");
      await launch(); await visible("Hello World");
      assert.match((await call("device", { action: "shell", target, command: `pidof ${bundle}` })).output.trim(), /^\d+$/);
    });
    await check("run.auto-relaunch", async () => {
      const hap = path.join(project, "entry/build/default/outputs/default/entry-default-signed.hap");
      const before = { sha256: sha(fs.readFileSync(hap)), mtime: fs.statSync(hap).mtimeMs };
      const installedAt = async () => {
        const d = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
        const install = /"installTime":\s*(\d+)/.exec(d.output)?.[1], update = /"updateTime":\s*(\d+)/.exec(d.output)?.[1];
        assert.ok(install && update); return `${install}:${update}`;
      };
      const stamp = await installedAt();
      const d = await job("run", { action: "build_run", project, target, wait: 0 });
      assert.equal(d.result.path, "relaunch"); await visible("Hello World");
      assert.equal(d.result.installed, null); assert.equal(d.result.build, undefined);
      assert.deepEqual({ sha256: sha(fs.readFileSync(hap)), mtime: fs.statSync(hap).mtimeMs }, before);
      assert.equal(await installedAt(), stamp);
    });
    await check("ui.record-start-status-stop-decode", async () => {
      const out = path.join(directory, `physical-${Date.now()}.mp4`);
      await ui({ action: "record_start" });
      const status = await ui({ action: "record_status" }); assert.ok(status.recording || status.status === "recording", JSON.stringify(status));
      await ui({ action: "act", op: "click", selector: { key: "HelloWorld" } }); await visible("Welcome");
      await ui({ action: "record_stop", save_path: out }); assert.ok(fs.statSync(out).size > 10000);
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", out], { encoding: "utf8" }));
      assert.ok(probe.streams.some((s) => s.codec_type === "video" && Number(s.nb_read_frames) > 10));
      execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", out, "-f", "null", "-"], { stdio: "pipe" });
      fs.writeFileSync(out + ".json", JSON.stringify(probe, null, 2));
    });
    await check("run.uninstall", async () => {
      await call("run", { action: "uninstall", project, target });
      const d = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
      assert.match(d.output, /not found|failed|error/i); assert.ok(!d.output.includes('"bundleName"'));
    });
    await check("hot_reload.stop_daemon", async () => assert.equal((await call("hot_reload", { action: "stop_daemon", project })).stopped, true));
  }
} catch (error) {
  await check("phase.setup-or-cleanup", async () => { throw error; });
} finally {
  await client.close();
}
console.log(JSON.stringify({ phase, passed: results.filter((r) => r.status === "passed").length, failed: results.filter((r) => r.status === "failed").length, trace }));
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
