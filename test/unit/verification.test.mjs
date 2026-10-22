import { temporaryDirectory } from "../support/workspace.mjs";
// Gate accounting and baseline semantics are independent of SDK command success.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '../..'), work = temporaryDirectory("deveco-verify-");
process.env.DEVECO_STATE_DIR = path.join(work, 'state');
process.env.DEVECO_COORDINATION_DIR = path.join(work, 'coordination');
fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'junction');
const entry = path.join(work, 'entry.ts'), bundle = path.join(work, 'entry.mjs');
fs.writeFileSync(entry, ['domains/project-test', 'domains/evidence', 'domains/quality', 'domains/verify', 'core/operations', 'core/artifacts', 'core/audit', 'core/db', 'domains/device', 'domains/entries', 'domains/uitest', 'domains/hotreload'].map((p) => `export * from ${JSON.stringify(path.join(root, 'src', p + '.ts'))}`).join('\n'));
await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error' });
const m = await import(pathToFileURL(bundle));
after(async () => { await m.stopCleanup(); await m.closeCoordination(); m.closeDatabase(); fs.rmSync(work, { recursive: true, force: true }); });

test('audit expiry preserves active operation evidence and captures only the current owner', async () => {
  const db = await m.database(), cutoff = Date.now() - 86400000;
  await m.appendAudit({ id: 'unrelated', owner_id: 'another-owner', at: new Date(0).toISOString() });
  await m.withOperation('code', { action: 'check', project: work, password: 'private-value' }, new AbortController().signal, async () => {
    const own = await m.currentAudit(); assert.equal(own.length, 1); assert.equal(own[0].phase, 'intent');
    assert.doesNotMatch(JSON.stringify(own), /private-value|unrelated/);
    db.prepare('UPDATE audit_events SET created=0 WHERE owner=?').run(own[0].owner_id);
    await m.cleanupAudit(cutoff);
    assert.equal((await m.currentAudit()).length, 1, 'a running operation retains its evidence even beyond the retention limit');
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_events WHERE owner='another-owner'").get().n, 0);
  });
  await m.cleanupAudit(cutoff);
  assert.equal(db.prepare('SELECT count(*) AS n FROM audit_events WHERE created=0').get().n, 0);
  assert.deepEqual(await m.currentAudit(), []);
});

test('legacy audit import waits for writers, is idempotent and preserves malformed input', async () => {
  const dir = path.join(work, 'state/audit'), file = path.join(dir, 'operations.jsonl'); fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ id: 'legacy', owner_id: 'legacy-owner', at: new Date().toISOString(), phase: 'returned' }) + '\n';
  fs.writeFileSync(file, line);
  await m.withResources(['audit-fixture'], 'legacy-writer', async () => {
    await m.cleanupAudit(Date.now() - 86400000); assert.equal(fs.readFileSync(file, 'utf8'), line);
  });
  await m.cleanupAudit(Date.now() - 86400000); assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, line); await m.cleanupAudit(Date.now() - 86400000);
  const db = await m.database();
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_events WHERE owner='legacy-owner'").get().n, 1);
  fs.writeFileSync(file, '{interrupted log');
  try { await assert.rejects(m.cleanupAudit(0), SyntaxError); assert.equal(fs.readFileSync(file, 'utf8'), '{interrupted log'); }
  finally { fs.rmSync(file); }
});
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
function hotProject() {
  const dir = fs.mkdtempSync(path.join(work, 'hot-')), module = path.join(dir, 'entry');
  fs.mkdirSync(path.join(dir, 'AppScope')); fs.mkdirSync(path.join(module, 'src/main/ets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AppScope/app.json5'), JSON.stringify({ app: { bundleName: 'com.devecomcp.hot', versionName: '1.0.0', versionCode: 1 } }));
  fs.writeFileSync(path.join(dir, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'default' }] }, modules: [{ name: 'entry', srcPath: './entry' }] }));
  fs.writeFileSync(path.join(module, 'src/main/module.json5'), JSON.stringify({ module: { name: 'entry', type: 'entry', mainElement: 'EntryAbility', deviceTypes: ['phone'], abilities: [{ name: 'EntryAbility' }] } }));
  const baseline = path.join(module, 'build/default/intermediates/deveco-mcp-hot.json');
  fs.mkdirSync(path.dirname(baseline), { recursive: true });
  fs.writeFileSync(baseline, JSON.stringify({ module: 'entry', bundle: 'com.devecomcp.hot', target: 'baseline-device', files: {}, at: 1 }));
  return { dir, baseline, project: { root: dir, product: 'default', bundleName: 'com.devecomcp.hot', modules: [{ name: 'entry', root: module, type: 'entry', target: 'default', deviceTypes: ['phone'] }] } };
}
test('direct hot apply and reset reserve their project and recorded device', async () => {
  const p = hotProject(), signal = new AbortController().signal;
  for (const action of ['apply', 'reset']) {
    const input = { action, project: p.dir, module: 'entry' };
    assert.deepEqual((await m.operationResources('hot_reload', input, signal)).sort(), [m.projectResource(p.dir), 'device:baseline-device'].sort());
    assert.equal(input.target, 'baseline-device');
  }
});
test('hot apply rejects a conflicting explicit target before compiling or changing its baseline', async () => {
  const p = hotProject(), before = fs.readFileSync(p.baseline);
  await assert.rejects(m.applyHotReload(p.project, 'entry', new AbortController().signal, () => {}, { target: 'another-device' }), { code: 'CONFLICT' });
  assert.deepEqual(fs.readFileSync(p.baseline), before);
  assert.equal(fs.existsSync(path.join(p.dir, 'entry/build/config/buildConfig.json')), false);
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

test('performance verification cannot pass missing or failed frame sampling', () => {
  const complete = { source: 'composer', verdict: 'smooth', activity_verified: true, excluded_intervals: [], sampling: { status: 'overlapping' } };
  assert.equal(m.judge('perf', complete), 'passed');
  for (const sampling of [undefined, { status: 'gaps' }, { status: 'insufficient' }]) assert.equal(m.judge('perf', { ...complete, sampling }), 'inconclusive');
  assert.equal(m.judge('perf', { ...complete, verdict: 'inconclusive' }), 'inconclusive');
  assert.equal(m.judge('perf', { ...complete, excluded_intervals: [{ duration_ms: 500 }] }), 'inconclusive');
});

test('card verification separates attachment, project assertions and owned cleanup', () => {
  const technical = { attachment_verified: true, cleanup: { removed: true, preexisting_preserved: true } };
  assert.equal(m.judge('form', technical), 'inconclusive');
  assert.equal(m.judge('form', { ...technical, project_assertions: { passed: true } }), 'passed');
  assert.equal(m.judge('form', { ...technical, project_assertions: { passed: false } }), 'failed');
  for (const cleanup of [{ removed: false, preexisting_preserved: true }, { removed: true }, { removed: true, preexisting_preserved: false }]) {
    assert.equal(m.judge('form', { ...technical, cleanup, project_assertions: { passed: true } }), 'failed');
  }
  assert.equal(m.planNeedsDevice(m.planSchema.parse({ schema: 1, checks: [{ id: 'card', type: 'form' }] })), true);
});
