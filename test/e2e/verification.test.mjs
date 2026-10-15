// Requires the explicitly selected dedicated project and device; failures are evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { app } from '../support/acceptance.mjs';

test('verification: real SDK accounting and permanent acceptance gate', async (t) => {
  const { call, job, project, target, directory, receipt } = await app(t);
  await t.test('local-positive-negative-and-coverage', async () => {
    const passed = await job('project', { action: 'test', project, kind: 'local', scope: ['Acceptance#addition'], expected_tests: 1, wait: 0 });
    receipt('local-positive.json', passed); assert.equal(passed.result.verdict, 'passed'); assert.equal(passed.result.counts.passed, 1); assert.ok(passed.result.results[0].coverage.artifact_id);
    const failed = await job('project', { action: 'test', project, kind: 'local', scope: ['Acceptance#negative'], expected_tests: 1, wait: 0 });
    receipt('local-negative.json', failed); assert.equal(failed.result.verdict, 'failed'); assert.equal(failed.result.counts.failed, 1);
  });
  await t.test('instrument-positive-and-coverage', async () => {
    const result = await job('project', { action: 'test', project, target, kind: 'instrument', scope: ['Acceptance#addition'], expected_tests: 1, allow_data_reset: true, wait: 0 });
    receipt('instrument.json', result); assert.equal(result.result.verdict, 'passed'); assert.equal(result.result.counts.passed, 1);
  });
  await t.test('instrument-execution-without-coverage', async () => {
    const result = await job('project', { action: 'test', project, target, kind: 'instrument', coverage: false, scope: ['Acceptance#addition'], expected_tests: 1, allow_data_reset: true, wait: 0 });
    receipt('instrument-without-coverage.json', result); assert.equal(result.result.verdict, 'passed'); assert.equal(result.result.counts.passed, 1);
    assert.equal(result.result.results[0].coverage, undefined);
  });
  await t.test('plan-build-test-deploy-assert-crash', async () => {
    const plan = path.join(directory, 'verify.json');
    fs.writeFileSync(plan, JSON.stringify({ schema: 1, checks: [
      { id: 'build', type: 'build', options: { clean: true } },
      { id: 'local', type: 'test', options: { kind: 'local', scope: ['Acceptance#addition'], expected_tests: 1 } },
      { id: 'deploy', type: 'deploy' },
      { id: 'screen', type: 'assert', options: { visible: { key: 'HelloWorld' } } },
      { id: 'crash', type: 'crash', options: { since_minutes: 5 } },
      { id: 'entries', type: 'entries' },
    ] }, null, 2));
    const result = await job('project', { action: 'verify', project, target, plan, output: path.join(directory, 'evidence'), wait: 0 });
    receipt('verify.json.result', result); assert.equal(result.result.verdict, 'passed');
    const manifest = JSON.parse(fs.readFileSync(result.result.evidence.manifest, 'utf8')); assert.ok(manifest.files.some((f) => f.file === 'junit.xml'));
  });
});
