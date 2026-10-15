// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { app, required, session, sha } from "../support/acceptance.mjs";
import { waitJob } from "../support/mcp.mjs";

test("device", async (t) => {
  const hdc = required("E2E_HDC"); assert.ok(path.isAbsolute(hdc) && fs.statSync(hdc).isFile());
  const { call, raw, job, directory, target, project, bundle, ui, defer, receipt } = await app(t);

  await t.test("run.build_run", async () => {
    const d = await job("run", { action: "build_run", project, target, run_mode: "full", hot_reload: true, wait: 0,
      assert: { visible: { text: "Hello World", exact: true }, timeout_ms: 8000 } });
    assert.equal(d.result.launch.started, true); assert.equal(d.result.assert.passed, true);
  });
  await t.test("device.shell", async () => {
    const d = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
    assert.equal(d.exit_code, 0); assert.ok(d.output.includes(bundle));
  });
  await t.test("device.send-recv", async () => {
    const source = path.join(directory, "transfer.bin"), dest = path.join(directory, "transfer-return.bin");
    fs.writeFileSync(source, crypto.randomBytes(65536));
    const remote = `/data/local/tmp/mcp-transfer-${crypto.randomUUID()}.bin`;
    await call("device", { action: "send", target, local: source, remote });
    // MCP shell is read-only; the selected SDK HDC removes only this test-owned transfer.
    defer(() => {
      const output = execFileSync(hdc, ["-t", target, "shell", `rm ${remote} && test ! -e ${remote} && echo removed`], { encoding: "utf8", timeout: 10000 });
      receipt("transfer-cleanup.json", { remote, output }); assert.equal(output.trim(), "removed");
    });
    await call("device", { action: "recv", target, local: dest, remote });
    assert.equal(sha(fs.readFileSync(source)), sha(fs.readFileSync(dest)));
  });
  const table = `proof_${crypto.randomUUID().replaceAll("-", "")}`;
  await t.test("device.sqlite", async () => {
    await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", write: true, sql: `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO ${table} VALUES (1,'physical-audit')` });
    defer(() => call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", write: true, sql: `DROP TABLE ${table}` }));
    const d = await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: `SELECT * FROM ${table} ORDER BY id` });
    assert.deepEqual(d.rows, [{ id: 1, value: "physical-audit" }]);
  });
  await t.test("device.sqlite.readonly-rejection", async () => {
    const r = await raw("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: `DELETE FROM ${table}` });
    assert.equal(r.isError, true);
    assert.equal((await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: `SELECT * FROM ${table}` })).rows.length, 1);
  });
  await t.test("device.log-window-follow", async () => {
    const d = await call("device", { action: "log", target, bundle, project, from: "2m", to: "0s", lines: 50 });
    assert.ok(d.lines > 0 && d.window.from < d.window.to);
    const first = await call("device", { action: "log", target, bundle, follow: true, lines: 5, wait_ms: 1000 });
    assert.match(first.cursor, /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    const next = await call("device", { action: "log", target, bundle, follow: true, cursor: first.cursor, lines: 5, wait_ms: 1000 });
    assert.ok(next.cursor >= first.cursor);
  });
  await t.test("ui.observe-screenshot-tree-find-windows", async () => {
    const r = await raw("ui", { action: "observe", target, bundle });
    assert.equal(r.isError, false); assert.ok(r.images.length > 0); assert.match(r.data.elements, /Hello World/);
    const shot = path.join(directory, "physical.png");
    await ui({ action: "screenshot", save_path: shot, format: "png" }); assert.ok(fs.statSync(shot).size > 1000);
    const windows = await ui({ action: "windows" });
    assert.ok(windows.windows.some((w) => w.focused));
    const tree = await ui({ action: "tree", depth: 12, all_windows: true, limit: 100 }); assert.ok(tree.nodes > 10);
    const found = await ui({ action: "find", selector: { key: "Field" } }); assert.equal(found.count, 1);
  });
  await t.test("sign.verify", async () => {
    const build = await job("project", { action: "build", project, wait: 0 });
    const hap = build.result.artifacts.find((a) => a.path.endsWith("-signed.hap")).path;
    const verified = await call("sign", { action: "verify", file: hap });
    assert.equal(verified.verified, true); assert.equal(verified.profile.bundle, bundle);
  });

});

test("gestures", async (t) => {
  const { call, project, ui, visible, launch, run, defer } = await app(t);

  await launch(); await visible("Hello World");
  const node = async (key) => {
    const d = await ui({ action: "find", selector: { key } }); assert.equal(d.count, 1, key); return d.matches[0];
  };
  const at = async (key) => { const m = await node(key); return { m, x: Math.round((m.bounds[0] + m.bounds[2]) / 2), y: Math.round((m.bounds[1] + m.bounds[3]) / 2) }; };
  const act = (args) => ui({ action: "act", ...args });
  const text = async (key, expected) => assert.equal((await node(key)).text, expected);
  await t.test("ui.act.click", async () => { await act({ op: "click", selector: { key: "TapBox" } }); await text("TapBox", "taps:1"); });
  await t.test("ui.act.double_click", async () => { await act({ op: "double_click", selector: { key: "DoubleBox" } }); await text("DoubleBox", "doubles:1"); });
  await t.test("ui.act.long_click", async () => { await act({ op: "long_click", selector: { key: "LongBox" } }); await text("LongBox", "longs:1"); });
  await t.test("ui.act.swipe", async () => {
    const b = await at("SwipeBox"); await act({ op: "swipe", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await text("SwipeBox", "swipe:right");
  });
  await t.test("ui.act.fling", async () => {
    const b = await at("SwipeBox"); await act({ op: "fling", x: b.m.bounds[2] - 60, y: b.y, x2: b.m.bounds[0] + 60, y2: b.y, speed: 3000 }); await text("SwipeBox", "swipe:left");
  });
  await t.test("ui.act.drag", async () => {
    const b = await at("DragBox"); await act({ op: "drag", x: b.x, y: b.y, x2: b.x, y2: b.y + 300 }); await text("DragBox", "dragged:1");
  });
  for (const [op, key, expected] of [["mouse_click", "TapBox", "taps:2"], ["mouse_double_click", "DoubleBox", "doubles:2"], ["mouse_long_click", "LongBox", "longs:2"]]) await t.test(`ui.act.${op}`, async () => {
    const b = await at(key); await act({ op, x: b.x, y: b.y }); await text(key, expected);
  });
  await t.test("ui.act.mouse_drag", async () => {
    const b = await at("SwipeBox"); await act({ op: "mouse_drag", x: b.m.bounds[0] + 60, y: b.y, x2: b.m.bounds[2] - 60, y2: b.y }); await text("SwipeBox", "swipe:right");
  });
  const firstRow = async () => (await ui({ action: "tree", node: "Rows", interactive: false, limit: 80 })).tree.match(/"row \d+"/)?.[0];
  for (const op of ["scroll", "mouse_scroll"]) await t.test(`ui.act.${op}`, async () => {
    const before = await firstRow(); assert.ok(before);
    const b = await at("Rows"); await act({ op, x: b.x, y: b.y, direction: "down", ticks: 5 });
    const after = await firstRow(); assert.ok(after); assert.notEqual(after, before);
  });
  await t.test("ui.act.mouse_move", async () => {
    const b = await at("TapBox"); const d = await act({ op: "mouse_move", x: b.x, y: b.y }); assert.equal(d.performed, "mouse_move");
  });
  await t.test("ui.act.input-type-key", async () => {
    await act({ op: "input", selector: { key: "Field" }, text: `a b$c'd "q"` }); await text("Echo", `typed:a b$c'd "q"`);
    await act({ op: "input", selector: { key: "Field" }, text: "你好 鸿蒙" }); await text("Echo", "typed:你好 鸿蒙");
    await act({ op: "type", text: " xyz" }); await text("Echo", "typed:你好 鸿蒙 xyz");
    await act({ op: "input", selector: { key: "Field" }, text: "!", append: true }); await text("Echo", "typed:你好 鸿蒙 xyz!");
    await act({ op: "key", key: "back" });
    await text("Echo", "typed:你好 鸿蒙 xyz!");
  });
  await t.test("ui.act.batch", async () => {
    await launch();
    const d = await act({ steps: [{ op: "click", selector: { key: "TapBox" } }, { op: "click", selector: { key: "HelloWorld" } }],
      assert: { visible: { text: "Welcome", exact: true } }, save_flow: { project, id: run } });
    defer(() => call("ui_flow", { action: "delete", project, id: run }));
    assert.ok(d); await visible("Welcome"); await text("TapBox", "taps:1");
  });

});

test("flows", async (t) => {
  const { call, raw, job, run, target, project, bundle, ui, visible, launch, defer } = await app(t);

  await launch(); await visible("Hello World");
  const flow = (args) => call("ui_flow", { project, ...(["record", "stop", "replay"].includes(args.action) ? { target } : {}), ...args });
  let saved = false;
  defer(async () => { if (saved) await flow({ action: "delete", id: run }); });
  await t.test("ui_flow.record-stop-list-show-replay", async () => {
    await flow({ action: "record", id: run });
    await ui({ action: "act", op: "click", selector: { key: "HelloWorld" } });
    assert.equal((await flow({ action: "stop", assert: { visible: { text: "Welcome", exact: true } } })).saved, run);
    saved = true;
    assert.ok(JSON.stringify(await flow({ action: "list" })).includes(run));
    assert.ok(JSON.stringify(await flow({ action: "show", id: run })).includes("HelloWorld"));
    const replay = await job("ui_flow", { action: "replay", project, target, id: run, snapshot: true, wait: 0 });
    assert.equal(replay.result.passed, true); await visible("Welcome");
    const again = await job("ui_flow", { action: "replay", project, target, id: run, snapshot: true, wait: 0 });
    assert.equal(again.result.passed, true); assert.equal(again.result.visual.same, true);
  });
  await t.test("run.deploy-then_flow", async () => {
    const d = await job("run", { action: "deploy", project, target, then_flow: run, wait: 0 });
    assert.equal(d.result.flow.passed, true); assert.equal(d.result.launch.started, true); await visible("Welcome");
  });
  await t.test("ui.visual", async () => {
    await launch(); await visible("Hello World");
    const name = run, baseline = await ui({ action: "visual", project, name });
    assert.equal(baseline.baseline, "created");
    defer(() => fs.rmSync(baseline.file));
    assert.equal((await ui({ action: "visual", project, name })).same, true);
    await ui({ action: "act", op: "click", selector: { key: "HelloWorld" } });
    const changed = await ui({ action: "visual", project, name });
    assert.equal(changed.same, false); assert.ok(changed.changed_ratio > 0 && changed.diff_artifact);
    const diff = await raw("job", { action: "read", artifact_id: changed.diff_artifact }); assert.ok(diff.images.length);
    assert.equal((await ui({ action: "visual", project, name, update: true })).baseline, "updated");
    assert.equal((await ui({ action: "visual", project, name })).same, true);
  });
  await t.test("ui.layout", async () => {
    const d = await ui({ action: "layout", project }); assert.ok(d.checked > 10 && d.counts);
  });
  await t.test("ui.perf", async () => {
    const found = await ui({ action: "find", selector: { key: "Rows" } }); assert.equal(found.count, 1);
    const [x1, y1, x2, y2] = found.matches[0].bounds, x = Math.round((x1 + x2) / 2);
    const d = await ui({ action: "perf", bundle, steps: [
      { op: "fling", x, y: y2 - 80, x2: x, y2: y1 + 80, speed: 3000 },
      { op: "fling", x, y: y1 + 80, x2: x, y2: y2 - 80, speed: 3000 },
    ] });
    assert.equal(d.source, "composer"); assert.equal(d.gestures, 2);
    assert.ok(d.frames > 10 && d.frame_ms.p95 > 0 && d.avg_fps > 0, JSON.stringify(d));
  });
  await t.test("ui_flow.delete", async () => {
    await flow({ action: "delete", id: run }); saved = false;
    assert.ok(!JSON.stringify(await flow({ action: "list" })).includes(run));
  });

});

test("jobs", async (t) => {
  const { call, raw, job, directory, project, file } = await app(t);

  await t.test("project.clean", async () => {
    assert.equal((await call("project", { action: "clean", project })).cleaned, true);
    assert.ok(!fs.existsSync(path.join(project, "entry/build/default/outputs/default/entry-default-signed.hap")));
  });
  await t.test("job.cancel", async () => {
    const started = await call("project", { action: "build", project, clean: true, wait: 0 });
    assert.ok(["queued", "running"].includes(started.status));
    const cancelled = await call("job", { action: "cancel", job_id: started.job_id });
    assert.equal(cancelled.status, "cancelled");
    const refused = await raw("job", { action: "resume", job_id: started.job_id });
    assert.equal(refused.isError, true); assert.equal(refused.data.error.code, "INVALID_INPUT");
  });
  await t.test("diagnose.build-job.resume", async () => {
    const full = path.join(project, file), original = fs.readFileSync(full, "utf8");
    let failed;
    try {
      fs.writeFileSync(full, original.replace("message: string", "message: any"));
      failed = await call("project", { action: "build", project, wait: 0 });
      failed = await waitJob(call, failed);
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

});

test("variants", async (t) => {
  const { call, job, directory, target, project, bundle, ui, visible, file } = await app(t);

  const full = path.join(project, file), original = fs.readFileSync(full, "utf8");
  try {
    await t.test("ui.act.mouse_move.effect", async () => {
      fs.writeFileSync(full, original.replace(".id('TapBox')", ".id('TapBox').onHover((hover: boolean) => { this.message = hover ? 'Hover entered' : 'Hover exited'; })"));
      await job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
      await ui({ action: "act", op: "mouse_move", selector: { key: "TapBox" } });
      await visible("Hover entered");
      await ui({ action: "act", op: "mouse_move", selector: { key: "LongBox" } });
      await visible("Hover exited");
    });
    await t.test("ui.onboarding-preserves-defaults", async () => {
      fs.copyFileSync(new URL("../fixtures/onboarding-page.ets", import.meta.url), full);
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
    await t.test("diagnose.crash-real-startup", async () => {
      fs.writeFileSync(full, original.replace("  build() {", "  aboutToAppear() { throw new Error('MCP_PHYSICAL_E2E_CRASH'); }\n\n  build() {"));
      let failed = await call("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
      failed = await waitJob(call, failed);
      assert.equal(failed.status, "failed", JSON.stringify(failed));
      assert.equal(failed.error.code, "LAUNCH_FAILED");
      assert.ok(failed.error.details.crash.source.some((s) => s.file.endsWith("Index.ets")), JSON.stringify(failed));
      const d = await call("diagnose", { action: "crash", project, target, bundle, since_minutes: 5 });
      assert.ok(d.reports.some((r) => r.message.includes("MCP_PHYSICAL_E2E_CRASH") && r.source.some((s) => s.file.endsWith("Index.ets"))), JSON.stringify(d));
      assert.ok((await call("job", { action: "read", artifact_id: d.reports[0].report_artifact })).content.includes("MCP_PHYSICAL_E2E_CRASH"));
    });
  } finally {
    fs.writeFileSync(full, original);
    await job("run", { action: "build_run", project, target, run_mode: "full", hot_reload: true, wait: 0,
      assert: { visible: { text: "Hello World", exact: true }, timeout_ms: 8000 } });
  }

});

test("lifecycle", async (t) => {
  const { call, job, target, project, bundle, visible, launch } = await app(t);

  await t.test("run.auto-baseline", async () => {
    // Manual hot_reload=true and auto mode keep distinct state. Exercise auto's own setup.
    await job("run", { action: "build_run", project, target, wait: 0 });
    await job("run", { action: "build_run", project, target, wait: 0 });
    await visible("Hello World");
  });
  await t.test("run.stop-launch", async () => {
    await call("run", { action: "stop", project, target });
    assert.equal((await call("device", { action: "shell", target, command: `pidof ${bundle}` })).output.trim(), "");
    await launch(); await visible("Hello World");
    assert.match((await call("device", { action: "shell", target, command: `pidof ${bundle}` })).output.trim(), /^\d+$/);
  });
  await t.test("run.auto-relaunch", async () => {
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
  await t.test("run.uninstall", async () => {
    await call("run", { action: "uninstall", project, target });
    const d = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
    assert.match(d.output, /not found|failed|error/i); assert.ok(!d.output.includes('"bundleName"'));
  });
  await t.test("hot_reload.stop_daemon", async () => assert.equal((await call("hot_reload", { action: "stop_daemon", project })).stopped, true));

});

test("equivalence", async (t) => {
  const { call } = await session(t);

  const project = process.env.E2E_PROJECT, target = process.env.E2E_TARGET;
  assert.ok(project && path.isAbsolute(project) && target && !target.includes(":"));
  const info = await call("project", { action: "info", project });
  assert.match(info.bundle_name, /^com\.devecomcp\./, "Only a dedicated audit app may be installed");
  await t.test("model-live.install-dedicated-app", async () => {
    let d = await call("run", { action: "build_run", project, target });
    d = await waitJob(call, d);
    assert.equal(d.status, "succeeded", JSON.stringify(d));
    assert.equal((await call("ui", { action: "assert", target, visible: { text: "Hello World" } })).passed, true);
  });
  await t.test("ui.tree-default-depth-equals-zero", async () => {
    const args = { action: "tree", target, all_windows: true, interactive: false };
    assert.deepEqual(await call("ui", args), await call("ui", { ...args, depth: 0 }));
  });
  await t.test("code.check-relative-and-absolute-path-equivalent", async () => {
    const file = "entry/src/main/ets/pages/Index.ets", args = { action: "check", project };
    const relative = await call("code", { ...args, files: [file] });
    const absolute = await call("code", { ...args, files: [path.join(project, file)] });
    assert.deepEqual(absolute, relative);
  });

});


test("device read-only command contracts", async (t) => {
  const target = required("E2E_TARGET");
  const { call, raw } = await session(t);
  assert.ok((await call("device", { action: "shell", target, command: "uname -a" })).output.trim());
  assert.ok((await call("device", { action: "shell", target, command: "date" })).output.trim());
  assert.ok((await call("device", { action: "shell", target, command: "ifconfig" })).output.trim());
  assert.deepEqual((await call("device", { action: "sqlite", target, db: ":memory:", sql: "SELECT 1 AS probe" })).rows, [{ probe: 1 }]);
  // Every forbidden form is rejected locally before HDC; never execute device mutations.
  for (const command of ["ifconfig wlan0 down", "mount -o remount,rw /", "date -s 2026-01-01", "hilog -w start"]) {
    const result = await raw("device", { action: "shell", target, command });
    assert.equal(result.isError, true); assert.equal(result.data.error.code, "INVALID_INPUT");
  }
  const missing = await raw("device", { action: "sqlite", target, bundle: "com.devecomcp.probe", db: "app.db", sql: "SELECT 1" });
  assert.equal(missing.data.error.code, "INVALID_INPUT"); assert.match(missing.data.error.hint, /module.json5/);
});
