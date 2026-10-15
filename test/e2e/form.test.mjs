// Existing attachment is explicitly selected; this test removes only that dedicated test form.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app, required } from '../support/acceptance.mjs';

test('form: desktop host interaction, configuration page and owned removal', async (t) => {
  const host = required('E2E_FORM_HOST'), key = required('E2E_FORM_KEY');
  assert.equal(host, 'desktop', 'Only desktop host automation is implemented');
  const { ui, call, job, project, target, bundle, visible, receipt, info } = await app(t);
  assert.ok(key.startsWith(`FormItem_${bundle}_`) && /^\d+$/.test(key.slice(`FormItem_${bundle}_`.length)));
  await job('run', { action: 'build_run', project, target, run_mode: 'full', wait: 0 });
  const desktop = async () => {
    await ui({ action: 'act', op: 'key', key: 'Home' });
    for (let page = 0; page < 3; page++) {
      if ((await ui({ action: 'find', selector: { key } })).count === 1) return;
      await ui({ action: 'act', op: 'swipe', x: Math.round(info.screen.width * .85), y: Math.round(info.screen.height * .63), x2: Math.round(info.screen.width * .15), y2: Math.round(info.screen.height * .63) });
    }
    assert.fail('Selected test form was not found on the first three desktop pages');
  };
  await desktop();
  await visible('MCP Form Probe');
  await ui({ action: 'act', op: 'click', selector: { text: 'Refresh', exact: true } });
  await visible('Card tapped');
  await ui({ action: 'screenshot' });
  receipt('host-tree.json', await ui({ action: 'tree', interactive: false, node: key }));
  await ui({ action: 'act', op: 'long_click', selector: { key } });
  await ui({ action: 'act', op: 'click', selector: { text: '编辑', exact: true } });
  await visible('Hello World');
  receipt('configuration-page.json', await ui({ action: 'tree' }));
  await desktop();
  await ui({ action: 'act', op: 'long_click', selector: { key } });
  await ui({ action: 'act', op: 'click', selector: { text: '移除', exact: true } });
  // Removal may show a confirmation sheet; inspect it rather than issuing a blind second click.
  const remaining = await ui({ action: 'find', selector: { text: '移除', exact: true } });
  if (remaining.count === 1) await ui({ action: 'act', op: 'click', selector: { text: '移除', exact: true } });
  assert.equal((await ui({ action: 'assert', hidden: { key }, timeout_ms: 5000 })).passed, true);
  receipt('cleanup.json', { host, key, removed: true, other_forms_touched: false });
});
