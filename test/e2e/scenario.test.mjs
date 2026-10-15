import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../support/acceptance.mjs';

test('scenario: explicit dedicated application on the selected device', async (t) => {
  const { call, raw, job, project, target, bundle, receipt } = await app(t);
  await job('run', { action: 'build_run', project, target, run_mode: 'full', wait: 0 });
  await t.test('entry-graph-and-want', async () => {
    const entries = await call('project', { action: 'entries', project }); receipt('entries.json', entries);
    assert.equal(entries.issues.length, 0); assert.ok(entries.entries.some((e) => e.kind === 'form'));
    const launched = await call('run', { action: 'launch', project, target, want: { uri: 'probe://verify/item', parameters: { probe: 'hello world', value: 3, enabled: true } } });
    assert.equal(launched.started, true);
    const origin = await call('code', { action: 'origin', project, key: 'HelloWorld' }); assert.ok(origin.locations.length); assert.equal(origin.runtime_identity_verified, false);
    receipt('origin.json', origin);
    const doctor = await call('doctor', { project, target, remote: false }); receipt('capabilities.json', doctor.capabilities);
    assert.ok(doctor.capabilities.matrix.every((item) => item.executed === false));
    assert.equal(doctor.capabilities.matrix.find((item) => item.action === 'ui.source').status, 'unsupported');
    const knowledge = await call('knowledge', { action: 'search', project, query: 'Text', limit: 1 }); receipt('knowledge-context.json', knowledge);
    assert.equal(knowledge.project_api.product, 'default'); assert.match(knowledge.document_version_filter, /^unknown:/);
  });
  await t.test('database-discovery-owned-fixture-conflict-cleanup', async () => {
    const databases = await call('device', { action: 'databases', target, bundle }); receipt('databases.json', databases);
    const db = databases.databases.find((d) => d.name === 'audit.db'); assert.ok(db);
    const fixture = await call('device', { action: 'fixture', operation: 'prepare', target, bundle, db: db.path, rows: [{ kind: 'dirty' }] });
    assert.equal((await call('device', { action: 'fixture', operation: 'inspect', target, fixture_id: fixture.fixture_id })).matches, true);
    await call('device', { action: 'sqlite', target, db: db.path, write: true, sql: `UPDATE ${fixture.table} SET value='changed'` });
    const conflict = await raw('device', { action: 'fixture', operation: 'cleanup', target, fixture_id: fixture.fixture_id });
    assert.equal(conflict.isError, true); assert.equal(conflict.data.error.code, 'CONFLICT');
    // Revert only the mutation this test just made; an application writer is never overwritten.
    await call('device', { action: 'sqlite', target, db: db.path, write: true, sql: `UPDATE ${fixture.table} SET value='{"kind":"dirty"}'` });
    assert.equal((await call('device', { action: 'fixture', operation: 'cleanup', target, fixture_id: fixture.fixture_id })).cleaned, true);
    const tables = await call('device', { action: 'sqlite', target, db: db.path, sql: 'SELECT name FROM sqlite_master' }); assert.ok(!tables.rows.some((r) => r.name === fixture.table));
  });
  await t.test('permission-and-clear-data', async () => {
    for (const operation of ['grant', 'revoke']) {
      const result = await raw('device', { action: 'scenario', target, bundle, operation, permission: 'ohos.permission.APPROXIMATELY_LOCATION' });
      receipt(`permission-${operation}.json`, result.data); assert.equal(result.isError, false, JSON.stringify(result.data));
    }
    const reset = await call('device', { action: 'scenario', operation: 'clear_data', target, bundle, allow_data_reset: true }); assert.equal(reset.installation_preserved, true);
    await call('run', { action: 'launch', project, target });
  });
  await t.test('official-trace-capture', async () => {
    const trace = await call('device', { action: 'trace', target, seconds: 2, categories: ['ace', 'app', 'sched'] }); receipt('trace.json', trace); assert.equal(trace.verdict, 'captured'); assert.ok(trace.events > 0);
  });
  await t.test('background-foreground', async () => {
    await call('device', { action: 'scenario', operation: 'background', target });
    receipt('background.json', await call('ui', { action: 'windows', target }));
    assert.equal((await call('run', { action: 'launch', project, target })).started, true);
  });
});
