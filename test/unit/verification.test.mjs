// Gate accounting and baseline semantics are independent of SDK command success.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '../..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-verify-'));
process.env.DEVECO_STATE_DIR = path.join(work, 'state');
process.env.DEVECO_COORDINATION_DIR = path.join(work, 'coordination');
fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'junction');
const entry = path.join(work, 'entry.ts'), bundle = path.join(work, 'entry.mjs');
fs.writeFileSync(entry, ['domains/project-test', 'domains/evidence', 'domains/quality', 'domains/verify', 'core/operations', 'core/artifacts', 'core/db', 'domains/device', 'domains/entries', 'domains/uitest'].map((p) => `export * from ${JSON.stringify(path.join(root, 'src', p + '.ts'))}`).join('\n'));
await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error' });
const m = await import(pathToFileURL(bundle));
after(async () => { await m.closeCoordination(); m.closeDatabase(); fs.rmSync(work, { recursive: true, force: true }); });
const report = (outcome, summary) => `class=Suite\ntest=one\nresult=${outcome}\nTests run: ${summary}\n`;

test('SDK exit zero never substitutes for complete test accounting', () => {
  assert.equal(m.parseTestReport(report('Failure', '1, Failure: 1, Error: 0, Pass: 0, Ignore: 0')).verdict, 'failed');
  assert.equal(m.parseTestReport(report('Success', '1, Failure: 0, Error: 0, Pass: 1, Ignore: 0').replaceAll('\n', '\r\n')).verdict, 'passed');
  assert.equal(m.parseTestReport(report('Ignore', '1, Failure: 0, Error: 0, Pass: 0, Ignore: 1')).verdict, 'inconclusive');
  assert.equal(m.parseTestReport('Tests run: 0, Failure: 0, Error: 0, Pass: 0, Ignore: 0').verdict, 'inconclusive');
  for (const raw of ['', report('Success', '2, Failure: 0, Error: 0, Pass: 2, Ignore: 0'), report('Unknown', '1, Failure: 0, Error: 0, Pass: 1, Ignore: 0')]) assert.throws(() => m.parseTestReport(raw), { code: 'TEST_REPORT_INVALID' });
});
test('required incomplete work and recording cannot be aggregated green', () => {
  for (const verdict of ['failed', 'blocked', 'inconclusive', 'not_run', 'recorded']) {
    assert.equal(m.aggregate([{ required: true, verdict: 'passed' }, { required: true, verdict }]), verdict);
    assert.match(m.junit([{ id: '<check>', type: 'x', required: true, verdict, elapsed_ms: 10, detail: '</failure>' }]), verdict === 'failed' ? /<failure/ : /<error/);
  }
  assert.equal(m.aggregate([]), 'inconclusive');
  assert.equal(m.aggregate([{ required: true, verdict: 'passed' }, { required: false, verdict: 'failed' }]), 'passed');
});
test('changed-only maps prefixes explicitly and reports unknown shared files', () => {
  const checks = m.planSchema.parse({ schema: 1, checks: [{ id: 'entry', type: 'test', affects: ['entry'] }] }).checks;
  const selected = m.selectChanged(checks, ['entry/src/A.ets', 'build-profile.json5', 'entry-other/A.ets']);
  assert.deepEqual(selected.selected.map((c) => c.id), ['entry']);
  assert.deepEqual(selected.uncovered, ['build-profile.json5', 'entry-other/A.ets']);
  assert.throws(() => m.planSchema.parse({ schema: 1, prepare: { file: 'node' }, checks }));
  assert.throws(() => m.planSchema.parse({ schema: 1, checks: [checks[0], checks[0]] }));
  for (const id of ['prepare', 'cleanup', 'change-coverage', 'source-integrity']) assert.throws(() => m.planSchema.parse({ schema: 1, checks: [{ id, type: 'entries' }] }));
});
test('baselines require explicit recording and matching measurement identity', () => {
  const measurement = { metrics: { size: { value: 100, direction: 'lower' } }, diagnostics: ['old'] };
  assert.throws(() => m.qualityBaseline(work, 'quality', { api: 26 }, measurement, 'compare'), { code: 'BASELINE_MISSING' });
  assert.equal(m.qualityBaseline(work, 'quality', { api: 26 }, measurement, 'record').verdict, 'recorded');
  assert.throws(() => m.qualityBaseline(work, 'quality', { api: 25 }, measurement, 'compare'), { code: 'BASELINE_INCOMPATIBLE' });
  const changed = { metrics: { size: { value: 111, direction: 'lower' } }, diagnostics: ['new'] };
  const result = m.qualityBaseline(work, 'quality', { api: 26 }, changed, 'compare', 10);
  assert.equal(result.verdict, 'failed'); assert.equal(result.regression.length, 1); assert.deepEqual(result.diagnostics.added, ['new']);
});
test('source identity detects untracked contamination, excluding generated test output', async () => {
  const project = path.join(work, 'identity'); fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'App.ets'), 'one');
  const first = await m.sourceIdentity(project); fs.mkdirSync(path.join(project, '.test')); fs.writeFileSync(path.join(project, '.test', 'report'), 'generated');
  assert.equal((await m.sourceIdentity(project)).sha256, first.sha256);
  fs.writeFileSync(path.join(project, 'untracked.ets'), 'two'); assert.notEqual((await m.sourceIdentity(project)).sha256, first.sha256);
});
test('permanent evidence is complete after original artifacts are removed', async () => {
  const artifact = await m.saveArtifact('raw evidence', 'text/plain');
  const out = path.join(work, 'export');
  await m.exportEvidence(out, { verdict: 'passed', results: [{ id: 'probe', type: 'test', required: true, verdict: 'passed', elapsed_ms: 10, detail: { log_artifact: artifact.artifact_id } }] });
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.ok(manifest.files.some((f) => f.file.startsWith(artifact.artifact_id)));
  fs.unlinkSync(path.join(m.artifactDir(), `${artifact.artifact_id}.txt`));
  assert.equal(fs.readFileSync(path.join(out, `${artifact.artifact_id}.txt`), 'utf8'), 'raw evidence');
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('junit.xml'));
  await assert.rejects(m.exportEvidence(out, { results: [] }), { code: 'CONFLICT' });
  await assert.rejects(m.exportEvidence(path.join(work, 'missing'), { results: [], missing: 'a_0123456789abcdef' }), { code: 'EVIDENCE_MISSING' });
});
test('locks coordinate processes with different state directories and preserve nested ownership', async () => {
  const key = m.projectResource(work);
  await m.withResources([key], 'parent', async () => {
    await m.withResources([key], 'child', async () => assert.equal((await m.resourceStatus()).length, 1));
    const code = `const m=await import(${JSON.stringify(pathToFileURL(bundle).href)}); try{await m.withResources([${JSON.stringify(key)}],'other',async()=>{});process.exitCode=2}catch(e){console.log(e.code)}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DEVECO_STATE_DIR: path.join(work, 'other-state') } });
    let output = ''; child.stdout.on('data', (c) => output += c); const [exit] = await once(child, 'exit');
    assert.equal(exit, 0); assert.match(output, /RESOURCE_BUSY/);
  });
  assert.equal((await m.resourceStatus()).length, 0);
  await assert.rejects(m.withResources([key], 'failed', async () => { throw new Error('failure'); }));
  assert.equal((await m.resourceStatus()).length, 0);
});
test('Want values are shell-quoted and integer/line boundaries are enforced', () => {
  const args = m.wantArgs({ uri: 'demo://x?quote=\'&a=$(secret)', parameters: { n: 2, yes: true, text: 'hello world' } });
  assert.ok(args.includes('--pi') && args.includes('--pb') && args.includes('--ps'));
  assert.match(args[1], /^'/); assert.match(args[1], /'\\''/);
  assert.throws(() => m.wantArgs({ parameters: { n: 1.1 } }), { code: 'INVALID_INPUT' });
  assert.throws(() => m.wantArgs({ uri: 'x\ny' }), { code: 'INVALID_INPUT' });
});

test('partial UI checklist evidence never covers unseen requirements', () => {
  const session = { checklist: ['first', 'second'], steps: [{ n: 1, kind: 'assert', passed: true, checklist_item: 1, at: 0 }, { n: 2, kind: 'act', passed: true, checklist_item: 2, at: 0 }], reviews: [] };
  assert.deepEqual(m.missingChecklist(session), [{ checklist_item: 2, requirement: 'second' }]);
  session.reviews.push({ checklist_item: 2, outcome: 'passed', step: 3, requirement: 'second', screenshot: 'artifact' });
  assert.deepEqual(m.missingChecklist(session), []);
});
