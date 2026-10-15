// Real MCP/jobs + project commands. No fake SDK test verdicts or device success.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { connect, waitJob } from '../support/mcp.mjs';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-gate-'));
const project = path.join(work, 'project'), clt = path.join(work, 'clt');
fs.mkdirSync(path.join(project, 'AppScope'), { recursive: true }); fs.mkdirSync(clt);
fs.writeFileSync(path.join(project, 'AppScope/app.json5'), JSON.stringify({ app: { bundleName: 'com.devecomcp.gate' } }));
fs.writeFileSync(path.join(project, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'default', compileSdkVersion: 26, compatibleSdkVersion: 23 }] }, modules: [] }));
const config = path.join(work, 'config.json'); fs.writeFileSync(config, JSON.stringify({ clt }));
const client = connect({ DEVECO_STATE_DIR: path.join(work, 'state'), DEVECO_COORDINATION_DIR: path.join(work, 'coordination'), DEVECO_CONFIG: config });
await client.initialize();
after(async () => { await client.close(); fs.rmSync(work, { recursive: true, force: true }); });
const call = async (name, args) => { const r = await client.call(name, args); assert.equal(r.isError, false, JSON.stringify(r.data)); return r.data; };
let sequence = 0;
const cmd = (script) => ({ file: process.execPath, args: ['-e', script] });
const check = (id, verdict) => ({ id, type: 'command', command: cmd(`console.log(JSON.stringify({verdict:${JSON.stringify(verdict)}}))`) });
async function verify(plan, extra = {}) {
  const id = sequence++, file = path.join(work, `plan-${id}.json`), output = path.join(work, `out-${id}`);
  fs.writeFileSync(file, JSON.stringify(plan));
  const result = await waitJob(call, await call('project', { action: 'verify', project, plan: file, output, allow_commands: true, wait: 0, ...extra }));
  return { result, output, report: fs.existsSync(path.join(output, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8')) : undefined };
}
test('MCP acceptance verdict survives completed job and required failure', async () => {
  const { result, report } = await verify({ schema: 1, checks: [check('first', 'passed'), check('second', 'failed')] });
  assert.equal(result.status, 'succeeded'); assert.equal(result.result.verdict, 'failed'); assert.equal(report.results[1].verdict, 'failed');
});
test('exit zero without business verdict is rejected', async () => {
  const { result } = await verify({ schema: 1, checks: [{ id: 'empty', type: 'command', command: cmd('console.log("{}")') }] });
  assert.equal(result.result.verdict, 'failed');
});
test('prepare failure always attempts cleanup and prevents checks', async () => {
  const { report } = await verify({ schema: 1, prepare: cmd('console.log(JSON.stringify({verdict:"failed"}))'), cleanup: cmd('console.log(JSON.stringify({verdict:"passed"}))'), checks: [check('unexecuted', 'passed')] });
  assert.equal(report.verdict, 'failed'); assert.equal(report.results.find((r) => r.id === 'cleanup').verdict, 'passed'); assert.equal(report.results.find((r) => r.id === 'unexecuted').verdict, 'not_run');
});
test('cleanup failure and source contamination cannot pass', async () => {
  const { result, report } = await verify({ schema: 1, cleanup: cmd('console.log(JSON.stringify({verdict:"failed"}))'), checks: [{ id: 'dirty', type: 'command', command: cmd('require("fs").writeFileSync("unexpected.ets","dirty"); console.log(JSON.stringify({verdict:"passed"}))') }] });
  assert.equal(result.result.verdict, 'failed'); assert.equal(report.results.find((r) => r.id === 'source-integrity').verdict, 'failed');
  fs.unlinkSync(path.join(project, 'unexpected.ets'));
});
test('all tool options validate before prepare can mutate anything', async () => {
  const { result } = await verify({ schema: 1, prepare: cmd('require("fs").writeFileSync("should-not-exist","bad")'), cleanup: cmd('console.log(JSON.stringify({verdict:"passed"}))'), checks: [{ id: 'bad', type: 'entries', options: { nonexistent: true } }] });
  assert.equal(result.status, 'failed'); assert.equal(fs.existsSync(path.join(project, 'should-not-exist')), false);
});
test('changed-only reports unmapped files and does not execute checks', async () => {
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']]) assert.equal(spawnSync('git', args, { cwd: project }).status, 0);
  fs.writeFileSync(path.join(project, 'unmapped.ets'), 'new');
  const origin = await call('code', { action: 'origin', project, file: 'unmapped.ets', line: 1 });
  assert.equal(origin.locations[0].changed, true); assert.equal(origin.locations[0].tracked, false);
  const { report } = await verify({ schema: 1, checks: [{ ...check('mapped', 'passed'), affects: ['entry'] }] }, { changed_only: true, base: 'HEAD' });
  assert.equal(report.verdict, 'blocked'); assert.deepEqual(report.results[0].detail.uncovered, ['unmapped.ets']); fs.unlinkSync(path.join(project, 'unmapped.ets'));
});
test('recording and absent or incompatible baselines remain distinct from pass', async () => {
  const plan = { schema: 1, checks: [{ id: 'metric', type: 'command', baseline: 'sample', command: cmd('console.log(JSON.stringify({verdict:"passed",metrics:{count:1}}))') }] };
  assert.equal((await verify(plan)).report.verdict, 'blocked');
  assert.equal((await verify(plan, { baseline_mode: 'record' })).report.verdict, 'recorded');
  assert.equal((await verify(plan)).report.verdict, 'passed');
  plan.checks[0].command.args[1] += '; // different measurement command';
  assert.equal((await verify(plan)).report.verdict, 'blocked');
});

test('missing requested metric cannot become a pass or a measured regression', async () => {
  const { report } = await verify({ schema: 1, checks: [{ ...check('measurement', 'passed'), max: { missing: 10 } }] });
  assert.equal(report.verdict, 'inconclusive'); assert.deepEqual(report.results[0].detail.missing_metrics, ['missing']);
});

test('headless CLI exits zero only for a complete passing verdict', () => {
  for (const verdict of ['passed', 'failed', 'blocked', 'inconclusive']) {
    const file = path.join(work, `cli-${verdict}.json`), out = path.join(work, `cli-${verdict}-out`);
    fs.writeFileSync(file, JSON.stringify({ schema: 1, checks: [check('business', verdict)] }));
    const result = spawnSync(process.execPath, ['bin/deveco-mcp.mjs', 'verify', '--project', project, '--plan', file, '--out', out, '--allow-commands'], { cwd: path.resolve(import.meta.dirname, '../..'), env: { ...process.env, DEVECO_STATE_DIR: path.join(work, `cli-${verdict}-state`), DEVECO_COORDINATION_DIR: path.join(work, 'coordination'), DEVECO_CONFIG: config }, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, verdict === 'passed' ? 0 : 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).result.verdict, verdict);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).verdict, verdict);
  }
});

test('command timeout records failure and runs independent cleanup', async () => {
  const { report } = await verify({ schema: 1, cleanup: cmd('console.log(JSON.stringify({verdict:"passed"}))'), checks: [{ id: 'slow', type: 'command', command: { ...cmd('setTimeout(()=>{},5000)'), timeout_ms: 100 } }] });
  assert.equal(report.verdict, 'failed'); assert.equal(report.results.find((r) => r.id === 'cleanup').verdict, 'passed');
});

test('cancellation completes cleanup and releases ownership before returning', async () => {
  const file = path.join(work, 'cancel.json'), output = path.join(work, 'cancel-evidence');
  fs.writeFileSync(file, JSON.stringify({ schema: 1, cleanup: cmd('console.log(JSON.stringify({verdict:"passed"}))'), checks: [{ id: 'slow', type: 'command', command: cmd('setTimeout(()=>{},30000)') }] }));
  const started = await call('project', { action: 'verify', project, plan: file, output, allow_commands: true, wait: 0 });
  // Wait for the intent to start; cancelled-before-start is a different path.
  for (let i = 0; i < 100; i++) {
    const status = await call('job', { action: 'status', job_id: started.job_id });
    if (status.step === 'verify') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const cancelled = await call('job', { action: 'cancel', job_id: started.job_id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await call('job', { action: 'resources' })).length, 0);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.notEqual(report.verdict, 'passed'); assert.equal(report.results.find((r) => r.id === 'cleanup').verdict, 'passed');
});
