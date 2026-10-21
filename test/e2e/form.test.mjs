// Assertions describe the dedicated fixture; the MCP host adapter does not interpret them.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { app, required, session } from '../support/acceptance.mjs';

test('form: owned desktop attachment and cleanup', async (t) => {
  const index = Number(required('E2E_FORM_INDEX'));
  const max_pages = Number(process.env.E2E_FORM_MAX_PAGES ?? 12);
  assert.ok(Number.isInteger(index) && index >= 0);
  assert.ok(Number.isInteger(max_pages) && max_pages >= 1 && max_pages <= 30);
  const { call, job, receipt } = await session(t);
  const project = required('E2E_PROJECT'), target = required('E2E_TARGET');
  assert.ok(path.isAbsolute(project));
  const device = await call('device', { action: 'info', target });
  await call('run', { action: 'launch', project, target });
  const before = (await job('ui', { action: 'form', form_action: 'inventory', target, max_pages, wait: 0 })).result;
  assert.equal(before.complete, true);
  const exercised = await job('ui', { action: 'form', form_action: 'exercise', project, target, form_index: index, max_pages, wait: 0 });
  assert.equal(exercised.result.attachment_verified, true);
  assert.equal(exercised.result.business_correctness, 'not-judged');
  assert.equal(exercised.result.cleanup.removed, true);
  assert.equal(exercised.result.cleanup.preexisting_preserved, true);
  const after = (await job('ui', { action: 'form', form_action: 'inventory', target, max_pages, wait: 0 })).result;
  assert.equal(after.complete, true);
  const identities = (inventory) => inventory.instances.map((v) => `${v.bundle}:${v.instance_id}`).sort();
  assert.deepEqual(identities(after), identities(before));
  receipt('host-evidence.json', { device, before, result: exercised.result, after });
});

test('form: owned attachment, fixture interaction, configuration page and removal', async (t) => {
  const index = Number(required('E2E_FORM_INDEX'));
  assert.ok(Number.isInteger(index) && index >= 0);
  const { call, job, project, target, bundle, receipt, defer } = await app(t);
  await job('run', { action: 'build_run', project, target, run_mode: 'full', wait: 0 });
  await call('ui', { action: 'act', op: 'key', key: 'home', target });
  const before = (await job('ui', { action: 'form', form_action: 'inventory', target, wait: 0 })).result;
  assert.equal(before.complete, true);
  const root = fs.realpathSync(project), id = `form-fixture-${crypto.randomUUID()}`;
  const directory = path.join(root, '.arkpilot/flows'), file = path.join(directory, `${id}.json`);
  for (const parent of [path.join(root, '.arkpilot'), directory]) {
    if (fs.existsSync(parent)) assert.equal(fs.realpathSync(parent), parent, 'Refuse redirected flow directories');
  }
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true });
  assert.equal(fs.realpathSync(directory), directory);
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
  const ownedFlow = fs.readFileSync(file);
  defer(() => {
    assert.equal(fs.realpathSync(directory), directory);
    assert.equal(fs.realpathSync(file), file); assert.ok(fs.lstatSync(file).isFile());
    assert.deepEqual(fs.readFileSync(file), ownedFlow, 'Refuse to remove a changed flow');
    fs.rmSync(file);
    if (!existed && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  });
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
