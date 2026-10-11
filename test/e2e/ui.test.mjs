// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { app } from "../support/acceptance.mjs";

test("UI failure boundaries and stability", async (t) => {
  const { raw, job, target, project, bundle, ui, launch, visible, run, defer } = await app(t);
  await launch(); await visible("Hello World");
  await t.test("invalid batches and keys are rejected", async () => {
    for (const args of [
      { steps: Array.from({ length: 31 }, () => ({ op: "wait", ms: 0 })) },
      { op: "click", x: 1, y: 1, steps: [{ op: "wait", ms: 0 }] },
      { steps: [{ op: "wait", ms: 0 }], save_flow: { project, id: run } },
      { op: "key", key: "not-a-key" },
    ]) assert.equal((await raw("ui", { action: "act", target, ...args })).isError, true);
  });
  await t.test("missing controls respect the original timeout budget", async () => {
    const started = performance.now();
    const missing = await ui({ action: "act", steps: [{ op: "click", selector: { text: "missing-test-element" }, timeout_ms: 3000 }] });
    assert.equal(missing.passed, false); assert.equal(missing.error.code, "UI_NOT_FOUND");
    assert.ok(performance.now() - started < 5500);
  });
  const tap = { op: "click", selector: { key: "TapBox" } }, hello = { op: "click", selector: { key: "HelloWorld" } };
  await t.test("flow suggestions require the same repeated sequence", async () => {
    const suggestions = [];
    for (const steps of [[tap, hello], [hello, tap], [tap, hello]]) {
      await launch(); suggestions.push((await ui({ action: "act", steps })).suggest);
    }
    assert.ok(!suggestions[0] && !suggestions[1] && suggestions[2]);
  });
  await t.test("chained actions retain the original output and latency budgets", async (t) => {
    await launch();
    const actStart = performance.now(), acted = await ui({ action: "act", ...hello });
    assert.ok(JSON.stringify(acted.after).length <= 1024);
    // Warm before-tree cache, so this measures a chained action, as in the original regression.
    const warmStart = performance.now();
    const chained = await ui({ action: "act", ...tap });
    assert.ok(chained.after); assert.ok(performance.now() - warmStart < 2500);
    t.diagnostic(`First act: ${Math.round(warmStart - actStart)} ms`);
  });
  await t.test("visual comparison stays stable and rejects corrupt baselines", async () => {
    await launch();
    const name = run, baseline = await ui({ action: "visual", project, name });
    assert.equal(baseline.baseline, "created");
    defer(() => fs.rmSync(baseline.file));
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      assert.equal((await ui({ action: "visual", project, name })).changed_ratio, 0);
    }
    await ui({ action: "act", op: "scroll", selector: { key: "Rows" }, direction: "down" });
    assert.ok((await ui({ action: "visual", project, name })).changed_ratio > 0);
    fs.writeFileSync(baseline.file, "not a png");
    const corrupt = await raw("ui", { action: "visual", target, project, name });
    assert.equal(corrupt.isError, true); assert.match(corrupt.data.error.hint, /update=true/);
  });
  await t.test("scroll performance remains repeatable and idle samples stay inconclusive", async () => {
    const rates = [];
    for (let i = 0; i < 3; i++) {
      const perf = await ui({ action: "perf", bundle }); assert.equal(perf.source, "composer"); rates.push(perf.avg_fps);
    }
    assert.ok(Math.max(...rates) - Math.min(...rates) < 10);
    const still = await ui({ action: "perf", steps: [{ op: "swipe", x: 30, y: 300, x2: 31, y2: 301 }] });
    assert.ok(!still.verdict || still.note || still.frames < 30);
  });
  await t.test("unsupported performance, layout and screenshot inputs are rejected", async () => {
    for (const args of [{ action: "perf", steps: [{ op: "click", x: 1, y: 1 }] }, { action: "layout", project, forms: ["tablet"] }, { action: "screenshot", display: 99 }]) {
      assert.equal((await raw("ui", { target, ...args })).isError, true);
    }
  });
  await t.test("failed flows remain failed and missing variables fail before deployment", async () => {
    const flowDir = path.join(project, ".arkpilot/flows"); fs.mkdirSync(flowDir, { recursive: true });
    const fixture = { version: 2, id: run, name: run, app: { bundleName: bundle, module: "entry", ability: "EntryAbility" }, start: { mode: "restart" }, variables: {}, steps: [{ id: "s1", action: "tap", timeoutMs: 3000, selector: { text: "missing-test-element", textMode: "exact" } }] };
    const file = path.join(flowDir, `${run}.json`); defer(() => fs.rmSync(file));
    fs.writeFileSync(file, JSON.stringify(fixture));
    const deploy = await job("run", { action: "build_run", project, target, then_flow: run, wait: 0 });
    assert.equal(deploy.result.flow.passed, false); assert.ok(deploy.result.flow.hint);
    fixture.variables = { input1: { required: true, secret: true } }; fixture.steps = [{ id: "s1", action: "focusInput", value: "${input1}" }];
    fs.writeFileSync(file, JSON.stringify(fixture));
    const before = performance.now();
    assert.equal((await raw("run", { action: "build_run", project, target, then_flow: run })).isError, true);
    assert.ok(performance.now() - before < 3000);
  });
});
