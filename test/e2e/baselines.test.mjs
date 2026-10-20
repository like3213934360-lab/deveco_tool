import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { app } from '../support/acceptance.mjs';

test('baselines: measured SDK/device evidence with explicit record and compare', async (t) => {
  const { call, job, ui, project, target, directory, receipt, defer, info } = await app(t);
  const prefix = `acceptance-${crypto.randomUUID()}`;
  const names = Object.fromEntries(['build', 'diagnostics', 'launch', 'visual'].map((kind) => [kind, `${prefix}-${kind}`]));
  const root = fs.realpathSync(project), state = path.join(root, '.arkpilot');
  if (fs.existsSync(state)) assert.equal(fs.realpathSync(state), state, 'Project state directory must not be redirected');
  const model = info.model ?? info.name ?? target;
  assert.equal(typeof model, 'string'); assert.ok(model.length > 0);
  const visual = path.join(root, '.arkpilot', 'baselines', `${names.visual}@${model.replace(/[^\w.-]+/g, '_')}.png`);
  const files = [...['build', 'diagnostics', 'launch'].map((kind) => path.join(root, '.arkpilot', 'quality-baselines', `${names[kind]}.json`)), visual, `${visual}.json`];
  // Claim only absent, exact UUID-scoped files before recording, including partial-failure outputs.
  for (const file of files) {
    const parent = path.dirname(file);
    if (fs.existsSync(parent)) assert.equal(fs.realpathSync(parent), parent, 'Baseline directory must not be redirected');
    assert.equal(fs.lstatSync(file, { throwIfNoEntry: false }), undefined, `Refusing to overwrite ${file}`);
  }
  for (const file of files) defer(() => {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    assert.equal(fs.realpathSync(path.dirname(file)), path.dirname(file), 'Baseline directory changed; retain for inspection');
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Not an owned baseline file: ${file}`);
    fs.rmSync(file); // No directory/glob deletion; all pre-existing baselines remain untouched.
  });
  receipt('baseline-ownership.json', { names, files });
  let sequence = 0;
  const verify = async (checks, mode = 'compare') => {
    const n = sequence++, plan = path.join(directory, `plan-${n}.json`);
    fs.writeFileSync(plan, JSON.stringify({ schema: 1, checks }));
    const result = await job('project', { action: 'verify', project, target, plan, output: path.join(directory, `evidence-${n}`), baseline_mode: mode, wait: 0 });
    receipt(`result-${n}.json`, result); return result.result;
  };
  await t.test('build-size-warning-diagnostics-and-launch-baselines', async () => {
    const checks = [
      { id: 'build', type: 'build', options: { clean: true }, baseline: names.build, repeats: 3, tolerance_percent: 25 },
      { id: 'diagnostics', type: 'diagnostics', options: { files: ['entry/src/main/ets/pages/Util.ets'] }, baseline: names.diagnostics },
      { id: 'launch', type: 'launch', baseline: names.launch, repeats: 3, tolerance_percent: 25 },
    ];
    assert.equal((await verify(checks, 'record')).verdict, 'recorded');
    assert.equal((await verify(checks)).verdict, 'passed');
  });
  await t.test('visual-record-compare-and-missing-baseline', async () => {
    const checks = [{ id: 'visual', type: 'visual', options: { name: names.visual, context: 'fixture-home-default' } }];
    assert.equal((await verify(checks)).verdict, 'blocked');
    assert.equal((await verify(checks, 'record')).verdict, 'recorded');
    assert.equal((await verify(checks)).verdict, 'passed');
  });
  await t.test('performance-retains-evidence-and-inconclusive-boundaries', async () => {
    const result = await verify([{ id: 'perf', type: 'perf', options: { repeat: 1 }, max: { p95_ms: 100 }, repeats: 3 }]);
    // No assertion of smoothness: insufficient samples/gaps must not be a passing performance claim.
    const report = JSON.parse(fs.readFileSync(path.join(result.evidence.directory, 'report.json'), 'utf8'));
    const perf = report.results.find((r) => r.id === 'perf');
    assert.ok(['passed', 'failed', 'inconclusive'].includes(perf.verdict));
    assert.ok(perf.detail.samples.every((s) => s.diagnostic_artifact));
    receipt('performance-verdict.json', { verdict: perf.verdict, samples: perf.detail.samples.map((s) => ({ source: s.source, verdict: s.verdict, excluded: s.excluded_intervals?.length })) });
  });
  await t.test('UI-checklist-missing-requirement-remains-inconclusive', async () => {
    await call('run', { action: 'launch', project, target });
    const started = await ui({ action: 'test_start', project, plan: '1. Hello World visible\n2. Field visible' });
    assert.equal((await ui({ action: 'test_step', test_id: started.test_id, checklist_item: 1, visible: { key: 'HelloWorld' } })).passed, true);
    const finished = await ui({ action: 'test_finish', test_id: started.test_id });
    assert.equal(finished.status, 'inconclusive'); assert.equal(finished.checklist_coverage.missing[0].checklist_item, 2);
    receipt('ui-incomplete.json', finished);
  });
});
