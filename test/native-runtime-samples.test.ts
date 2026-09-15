import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { RuntimeSamples, runtimeSamplePolicy, type RuntimeCounters } from "../src/core/runtime-samples.js";

const counters: RuntimeCounters = { active_requests: 0, owned_processes: 0, owned_listeners: 0,
  owned_connections: 0, parser_active: 0, parser_queued: 0, parser_workers: 0, lsp_active_requests: 0, ui_cache_entries: 0 };
const read = (store: StateStore) => (store.db.prepare("SELECT data FROM events WHERE kind='runtime_sample' ORDER BY id").all() as { data: string }[])
  .map(row => JSON.parse(row.data));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-runtime-samples-"));
  const store = new StateStore(root);
  return { store, close() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test("runtime samples are periodic, instance-scoped, allowlisted and stop after one final observation", t => {
  const { store, close } = fixture(), failures: unknown[] = [];
  t.mock.timers.enable({ apis: ["setInterval"] });
  const activity = { ...counters, secret: "private-runtime-input", active_requests: 2 };
  const samples = new RuntimeSamples(store, () => activity, error => failures.push(error));
  try {
    assert.equal(read(store).length, 1);
    t.mock.timers.tick(runtimeSamplePolicy.interval_ms - 1);
    assert.equal(read(store).length, 1);
    activity.active_requests = 0;
    t.mock.timers.tick(1);
    samples.close();
    samples.close();
    t.mock.timers.tick(5 * runtimeSamplePolicy.interval_ms);
    const rows = read(store);
    assert.deepEqual(rows.map(row => [row.reason, row.sequence, row.active_requests]), [["startup", 1, 2], ["interval", 2, 0], ["shutdown", 3, 0]]);
    for (const row of rows) {
      assert.equal(row.instance_id, store.owner);
      assert.equal(row.pid, process.pid);
      assert.ok(row.rss_bytes > 0 && row.heap_used_bytes > 0 && row.heap_total_bytes >= row.heap_used_bytes);
      assert.ok(row.external_bytes >= 0 && row.array_buffers_bytes >= 0);
      assert.ok(Buffer.byteLength(JSON.stringify(row)) < 4096);
      assert.doesNotMatch(JSON.stringify(row), /private-runtime-input|secret/);
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(store.db.prepare("SELECT * FROM artifact_streams").all(), []);
  } finally { samples.close(); close(); }
});

test("sample retention is shared across runtime instances and never deletes request or workflow evidence", () => {
  const { store, close } = fixture();
  const insert = store.db.prepare("INSERT INTO events(run_id,kind,data,created) VALUES (?, ?, ?, ?)");
  store.db.transaction(() => {
    for (let index = 0; index < runtimeSamplePolicy.maximum_samples + 3; index++)
      insert.run(null, "runtime_sample", JSON.stringify({ instance_id: "old-instance", sequence: index }), Date.now());
    insert.run(null, "request_failed", '{"code":"RETAIN_ME"}', Date.now());
    insert.run("workflow-receipt", "runtime_sample", '{"evidence":"retain-me"}', Date.now());
  })();
  const peer = new StateStore(store.root);
  const samples = new RuntimeSamples(store, () => counters, error => { throw error; });
  const peerSamples = new RuntimeSamples(peer, () => counters, error => { throw error; });
  try {
    assert.notEqual(store.owner, peer.owner);
    assert.deepEqual(store.db.prepare("SELECT COUNT(*) AS count FROM events WHERE run_id IS NULL AND kind='runtime_sample'").get(), { count: runtimeSamplePolicy.maximum_samples });
    assert.deepEqual(read(store).slice(-2).map(row => row.instance_id), [store.owner, peer.owner]);
    assert.deepEqual(store.db.prepare("SELECT data FROM events WHERE kind='request_failed' OR run_id='workflow-receipt' ORDER BY id").all(),
      [{ data: '{"code":"RETAIN_ME"}' }, { data: '{"evidence":"retain-me"}' }]);
  } finally { peerSamples.close(); samples.close(); peer.close(); close(); }
});

test("sample failures do not block requests, buffer retries or flood warnings; recovery exposes a sequence gap", t => {
  const { store, close } = fixture(), failures: unknown[] = [];
  t.mock.timers.enable({ apis: ["setInterval"] });
  store.db.exec("CREATE TRIGGER reject_sample BEFORE INSERT ON events WHEN NEW.kind='runtime_sample' BEGIN SELECT RAISE(ABORT,'private-error-detail'); END");
  const samples = new RuntimeSamples(store, () => counters, error => failures.push(error));
  try {
    t.mock.timers.tick(2 * runtimeSamplePolicy.interval_ms);
    assert.equal(failures.length, 1);
    assert.deepEqual(read(store), []);
    store.event(null, "request_finish", { elapsed_ms: 1 });
    store.db.exec("DROP TRIGGER reject_sample");
    t.mock.timers.tick(runtimeSamplePolicy.interval_ms);
    assert.equal(read(store).length, 1, "Dropped samples must not be replayed as a batch");
    assert.equal(read(store)[0]!.sequence, 4);
    assert.equal(read(store)[0]!.failed_samples, 3);
    assert.doesNotMatch(JSON.stringify(read(store)), /private-error-detail/);
    store.db.exec("CREATE TRIGGER reject_sample BEFORE INSERT ON events WHEN NEW.kind='runtime_sample' BEGIN SELECT RAISE(ABORT,'another-error'); END");
    t.mock.timers.tick(runtimeSamplePolicy.interval_ms);
    assert.equal(failures.length, 2, "A new failure after recovery remains visible");
  } finally { samples.close(); close(); }
});

test("sampling respects shared storage quota and resumes without retaining failed payloads", t => {
  const { store, close } = fixture(), failures: unknown[] = [], previous = process.env.DEVECO_CONFIG;
  t.mock.timers.enable({ apis: ["setInterval"] });
  const config = path.join(store.root, "quota.json");
  fs.writeFileSync(config, '{"max_bytes":1}');
  process.env.DEVECO_CONFIG = config;
  const samples = new RuntimeSamples(store, () => counters, error => failures.push(error));
  try {
    assert.equal((failures[0] as { code: string }).code, "STATE_CAPACITY");
    assert.deepEqual(read(store), []);
    fs.writeFileSync(config, "{}");
    t.mock.timers.tick(runtimeSamplePolicy.interval_ms);
    assert.equal(read(store)[0]!.failed_samples, 1);
    assert.equal(read(store)[0]!.sequence, 2);
  } finally {
    samples.close();
    if (previous === undefined) delete process.env.DEVECO_CONFIG; else process.env.DEVECO_CONFIG = previous;
    close();
  }
});
