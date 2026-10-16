// Assertions describe the dedicated fixture; the MCP host adapter does not interpret them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { app, required } from '../support/acceptance.mjs';

test('form: owned attachment, fixture interaction, configuration page and removal', async (t) => {
  const index = Number(required('E2E_FORM_INDEX'));
  assert.ok(Number.isInteger(index) && index >= 0);
  const { job, project, target, bundle, receipt, defer } = await app(t);
  await job('run', { action: 'build_run', project, target, run_mode: 'full', wait: 0 });
  const before = (await job('ui', { action: 'form', form_action: 'inventory', target, wait: 0 })).result;
  assert.equal(before.complete, true);
  const id = 'mcp-form-fixture', directory = path.join(project, '.arkpilot/flows'), file = path.join(directory, `${id}.json`);
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 2, id, name: 'Dedicated form fixture assertions', app: { bundleName: bundle, module: 'entry', ability: 'EntryAbility' },
    start: { mode: 'attach' }, variables: {}, steps: [
      { id: 'initial', action: 'assertVisible', selector: { text: 'MCP Form Probe', textMode: 'exact' } },
      { id: 'tap', action: 'tap', selector: { text: 'Refresh', textMode: 'exact' } },
      { id: 'message', action: 'assertVisible', selector: { text: 'Card tapped', textMode: 'exact' } },
      { id: 'menu', action: 'longTap', selector: { text: 'MCP Form Probe', textMode: 'exact' } },
      { id: 'configure', action: 'tap', selector: { text: '编辑', textMode: 'exact' } },
    ], assert: { visible: { text: 'Hello World', textMode: 'exact' } },
  }), { flag: 'wx' });
  defer(() => { fs.rmSync(file); if (!existed && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); });
  const exercised = await job('ui', { action: 'form', form_action: 'exercise', project, target, form_index: index, then_flow: id, wait: 0 });
  assert.equal(exercised.result.attachment_verified, true);
  assert.equal(exercised.result.project_assertions.passed, true);
  assert.equal(exercised.result.cleanup.preexisting_preserved, true);
  assert.equal(exercised.result.cleanup.removed, true);
  const after = (await job('ui', { action: 'form', form_action: 'inventory', target, wait: 0 })).result;
  assert.equal(after.complete, true);
  const identities = (inventory) => inventory.instances.map((v) => `${v.bundle}:${v.instance_id}`).sort();
  assert.deepEqual(identities(after), identities(before));
  receipt('host-evidence.json', exercised.result);
});
