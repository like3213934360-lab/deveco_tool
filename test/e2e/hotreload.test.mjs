import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { test } from "node:test";
import { app } from "../support/acceptance.mjs";
import { waitJob as terminal } from "../support/mcp.mjs";

test("hot reload and deploy", async (t) => {
  const { call, directory: work, project, target, bundle, defer } = await app(t);
  const waitJob = (status) => terminal(call, status);
  const source = path.join(project, "entry/src/main/ets/pages/Index.ets"), originalSource = fs.readFileSync(source);
  defer(() => fs.writeFileSync(source, originalSource));
  const verifyReset = async (patchedText) => {
    const reset = await call("hot_reload", { action: "reset", project, target });
    assert.equal(reset.reset, true);
    assert.equal(reset.method, "restore_baseline_packages");
    assert.equal(reset.patch_version, 0);
    const retained = await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: "SELECT * FROM proof WHERE id = 71" });
    assert.deepEqual(retained.rows, [{ id: 71, value: "preserved across reset" }]);
    const query = await call("device", { action: "shell", target, command: `bm quickfix -q -b ${bundle}` });
    assert.match(query.output, /^\s*patch version code:\s*0\s*$/m);
    await call("run", { action: "launch", project, target });
    assert.equal((await call("ui", { action: "assert", target, visible: { text: "Hello World", exact: true }, timeout_ms: 5000 })).passed, true);
    await call("ui", { action: "act", target, op: "click", selector: { text: "Hello World", exact: true } });
    assert.equal((await call("ui", { action: "assert", target, visible: { text: "Welcome", exact: true }, timeout_ms: 5000 })).passed, true);
    assert.equal((await call("ui", { action: "assert", target, hidden: { text: patchedText, exact: true }, timeout_ms: 5000 })).passed, true);
  };

  await t.test("hot reload patches the running app without restart", async () => {
    const status = await waitJob(await call("run", { action: "build_run", project, target, hot_reload: true, wait: 60000 }));
    assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 2000));
    await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: "INSERT OR REPLACE INTO proof VALUES (71, 'preserved across reset')", write: true });
    const pid = status.result.launch.pid;
    const page = path.join(project, "entry/src/main/ets/pages/Index.ets");
    fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("this.message = 'Welcome'", "this.message = 'Patched Live'"));
    const applied = await call("hot_reload", { action: "apply", project });
    assert.equal(applied.applied, true);
    assert.equal(applied.pid, pid, "app must not restart");
    await call("ui", { action: "act", target, op: "click", selector: { text: "Hello World" } });
    const verdict = await call("ui", { action: "assert", target, visible: { text: "Patched Live" }, timeout_ms: 5000 });
    assert.equal(verdict.passed, true);
    // Keep patched sources during reset: rebuilding them would fail the original-behavior assertion.
    try { await verifyReset("Patched Live"); }
    finally { fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("'Patched Live'", "'Welcome'")); }
  });

  await t.test("deploy without building + uninstall first; hot reload of explicit files with restart", async () => {
    const base = await waitJob(await call("run", { action: "build_run", project, target, hot_reload: true, wait: 60000 }));
    assert.equal(base.status, "succeeded", JSON.stringify(base.error ?? base).slice(0, 2000));
    const redeploy = await waitJob(await call("run", { action: "build_run", project, target, skip_build: true, uninstall_first: true, hot_reload: true, wait: 60000 }));
    assert.equal(redeploy.status, "succeeded", JSON.stringify(redeploy.error ?? redeploy).slice(0, 2000));
    assert.equal(redeploy.kind, "deploy");
    await call("device", { action: "sqlite", target, bundle, module: "entry", db: "audit.db", sql: "INSERT OR REPLACE INTO proof VALUES (71, 'preserved across reset')", write: true });
    const page = path.join(project, "entry/src/main/ets/pages/Index.ets");
    const original = fs.readFileSync(page, "utf8");
    fs.writeFileSync(page, original.replace("'Hello World'", "'Hello Files'"));
    try {
      const applied = await call("hot_reload", { action: "apply", project, files: ["entry/src/main/ets/pages/Index.ets"], restart: true });
      assert.equal(applied.restarted, true);
      assert.equal((await call("ui", { action: "assert", target, visible: { text: "Hello Files" }, timeout_ms: 5000 })).passed, true);
      await verifyReset("Hello Files");
    } finally {
      fs.writeFileSync(page, original);
    }
  });

  await t.test("auto deploy relaunches unchanged installs and fully deploys dependency changes", async () => {
    const deploy = async () => {
      const status = await waitJob(await call("run", { action: "build_run", project, target, wait: 60000 }));
      assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 2000));
      return status.result;
    };
    const stamp = async () => {
      const dump = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
      const text = dump.output;
      const match = /"updateTime"\s*:\s*(\d+)/.exec(text);
      assert.ok(match, "device bundle metadata must contain updateTime");
      return match[1];
    };
    await deploy();
    const baseline = await deploy(), before = await stamp();
    const unchanged = await deploy();
    assert.equal(unchanged.path, "relaunch");
    assert.ok(!unchanged.installed, "relaunch must not include an install receipt");
    assert.equal(unchanged.build, undefined);
    assert.notEqual(unchanged.launch.pid, baseline.launch.pid, "the app really restarted");
    assert.equal(await stamp(), before, "the installed bundle really stayed unchanged");
    const manifest = path.join(project, "entry/oh-package.json5"), original = fs.readFileSync(manifest, "utf8");
    const dependency = path.join(work, "LocalDependency");
    fs.mkdirSync(dependency);
    fs.writeFileSync(path.join(dependency, "oh-package.json5"), JSON.stringify({ name: "audit-local", version: "1.0.0", main: "Index.ets" }));
    fs.writeFileSync(path.join(dependency, "Index.ets"), "export const auditValue: number = 1;\n");
    const edited = JSON5.parse(original);
    edited.dependencies = { ...edited.dependencies, "audit-local": `file:${dependency}` };
    fs.writeFileSync(manifest, JSON.stringify(edited, null, 2));
    try {
      const changed = await deploy();
      assert.equal(changed.path, "full");
      assert.match(changed.fallback_reason, /dependencies changed.*oh-package/);
      assert.ok(changed.installed && changed.build);
      assert.notEqual(await stamp(), before, "dependency change really reinstalled the bundle");
      assert.ok(fs.existsSync(path.join(project, "entry/oh_modules/audit-local")), "OHPM really installed the local dependency");
    } finally {
      fs.writeFileSync(manifest, original);
    }
  });

  await t.test("three successive patches keep the original six-second budget", async (t) => {
    assert.equal((await terminal(call, await call("run", { action: "build_run", project, target, hot_reload: true, run_mode: "full", wait: 0 }))).status, "succeeded");
    t.after(async () => {
      fs.writeFileSync(source, originalSource);
      assert.equal((await call("hot_reload", { action: "reset", project, target })).reset, true);
    });
    let previous = "Hello World";
    for (const next of ["Hello One", "Hello Two", "Hello Three"]) await t.test(next, async () => {
      fs.writeFileSync(source, fs.readFileSync(source, "utf8").replace(`'${previous}'`, `'${next}'`));
      previous = next;
      const started = performance.now();
      const applied = await call("hot_reload", { action: "apply", project, target, restart: true });
      assert.equal(applied.applied, true);
      const elapsed = performance.now() - started;
      assert.ok(applied.timings_ms.compile > 0 && applied.timings_ms.total >= applied.timings_ms.compile);
      assert.ok(Object.values(applied.timings_ms).every((ms) => Number.isFinite(ms) && ms >= 0));
      t.diagnostic(JSON.stringify({ patch: next, elapsed_ms: Math.round(elapsed), timings_ms: applied.timings_ms }));
      assert.equal((await call("ui", { action: "assert", target, visible: { text: next, exact: true }, timeout_ms: 5000 })).passed, true);
      assert.ok(elapsed <= 6000, `Patch and restart took ${Math.round(elapsed)} ms; budget is 6000 ms`);
    });
  });
});
