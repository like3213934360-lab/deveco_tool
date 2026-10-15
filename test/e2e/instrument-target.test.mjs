// Explicit emulator selection with another connected device; never substitute a physical target.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../support/acceptance.mjs';
import { waitJob } from '../support/mcp.mjs';

test('verification: selected emulator while other devices stay connected', async (t) => {
  const { call, job, project, target, receipt } = await app(t, true, 'emulator');
  const before = await call('device', { action: 'list' }); receipt('devices-before.json', before);
  // Device enumeration is read-only; all test operations use the explicit emulator target.
  assert.ok(before.devices.some((d) => d.target === target) && before.devices.length > 1, 'This scenario requires a selected emulator and another connected device');
  await t.test('ambiguous-and-missing-target-do-not-run', async () => {
    for (const [selected, code] of [[undefined, 'DEVICE_AMBIGUOUS'], ['mcp-no-such-connected-target', 'DEVICE_UNAVAILABLE']]) {
      const result = await waitJob(call, await call('project', { action: 'test', project, target: selected, kind: 'instrument', allow_data_reset: true, wait: 0 }));
      receipt(`rejected-${code}.json`, result);
      assert.equal(result.status, 'failed'); assert.equal(result.error.code, code);
    }
    const doctor = await call('doctor', { project, target, remote: false });
    receipt('capabilities.json', doctor.capabilities);
    assert.equal(doctor.capabilities.matrix.find((item) => item.action === 'project.test:instrument').status, 'ready_for_attempt');
  });
  for (const [name, coverage, scope, verdict] of [
    ['coverage', true, 'Acceptance#addition', 'passed'],
    ['execution', false, 'Acceptance#addition', 'passed'],
    ['negative', false, 'Acceptance#negative', 'failed'],
  ]) await t.test(name, async () => {
    const result = await job('project', { action: 'test', project, target, kind: 'instrument', coverage, scope: [scope], expected_tests: 1, allow_data_reset: true, wait: 0 });
    receipt(`instrument-${name}.json`, result); assert.equal(result.result.verdict, verdict);
    assert.equal(result.result.counts.total, 1); assert.equal(result.result.target, target);
    assert.equal(result.result.routing.target, target); assert.ok(result.result.routing.commands > 0);
    if (coverage) assert.ok(result.result.results[0].coverage.artifact_id);
  });
  const after = await call('device', { action: 'list' }); receipt('devices-after.json', after);
  assert.deepEqual(after.devices.map((d) => d.target).toSorted(), before.devices.map((d) => d.target).toSorted());
});
