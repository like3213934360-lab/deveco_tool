import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { RequestLog } from "../src/core/request-log.js";

function fixture(onFailure: (error: unknown) => void = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-request-log-"));
  const store = new StateStore(root), log = new RequestLog(store, onFailure);
  return { store, log, close() {
    try { log.close(); }
    finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
  } };
}

test("request telemetry reserves shared capacity, copies input, flushes at its deadline and closes without retained buffers", (t) => {
  const { store, log, close } = fixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const data = { request_id: "request-1", tool: "lsp" };
    log.write("request_start", data);
    data.request_id = "changed-after-enqueue";
    log.write("request_finish", { request_id: "request-1", elapsed_ms: 4 });
    assert.deepEqual(store.db.prepare("SELECT bytes FROM artifact_streams WHERE run_id='request-log-buffer'").all(), [{ bytes: 65536 }]);
    assert.deepEqual(store.db.prepare("SELECT * FROM events").all(), []);
    t.mock.timers.tick(19);
    assert.equal(log.metrics.pending_events, 2);
    t.mock.timers.tick(1);
    const rows = store.db.prepare("SELECT kind,data,created FROM events ORDER BY id").all() as { kind: string; data: string; created: number }[];
    assert.deepEqual(rows.map((row) => [row.kind, (JSON.parse(row.data) as { request_id: string }).request_id]), [["request_start", "request-1"], ["request_finish", "request-1"]]);
    assert.ok(rows.every((row) => Number.isSafeInteger(row.created)));
    assert.equal(log.metrics.pending_events, 0);
    log.write("request_failed", { request_id: "request-2", code: "CANCELLED" });
    log.close();
    assert.deepEqual(store.db.prepare("SELECT COUNT(*) AS count FROM events").get(), { count: 3 });
    assert.deepEqual(store.db.prepare("SELECT * FROM artifact_streams").all(), []);
    assert.throws(() => log.write("request_start", {}), { code: "REQUEST_LOG_CLOSED" });
  } finally { close(); }
});

test("request telemetry applies bounded backpressure without dropping events or buffering unbounded payloads", () => {
  const { store, log, close } = fixture();
  try {
    for (let index = 0; index < 500; index++) {
      log.write("request_start", { request_id: String(index), detail: "中文".repeat(500) });
      assert.ok(log.metrics.pending_events <= 128);
      assert.ok(log.metrics.pending_bytes <= log.metrics.maximum_bytes);
    }
    assert.throws(() => log.write("request_start", { detail: "中文".repeat(3000) }), { code: "EVENT_TOO_LARGE" });
    assert.throws(() => log.write("request_start", undefined), { code: "EVENT_INVALID" });
    log.close();
    const rows = store.db.prepare("SELECT data FROM events ORDER BY id").all() as { data: string }[];
    assert.equal(rows.length, 500);
    assert.deepEqual(rows.map((row) => (JSON.parse(row.data) as { request_id: string }).request_id), Array.from({ length: 500 }, (_, index) => String(index)));
  } finally { close(); }
});

test("a failed request-log batch rolls back atomically, reports the failure and prevents subsequent requests from silently continuing", (t) => {
  const failures: unknown[] = [];
  const { store, log, close } = fixture((error) => failures.push(error));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    store.db.exec("CREATE TRIGGER reject_request_finish BEFORE INSERT ON events WHEN NEW.kind='request_finish' BEGIN SELECT RAISE(ABORT,'fixture log failure'); END");
    log.write("request_start", { request_id: "request" });
    log.write("request_finish", { request_id: "request" });
    t.mock.timers.tick(20);
    assert.equal(failures.length, 1);
    assert.equal(log.metrics.failed, true);
    assert.equal(log.metrics.pending_events, 2);
    assert.deepEqual(store.db.prepare("SELECT * FROM events").all(), []);
    assert.throws(() => log.write("request_start", {}), (error: unknown) => error === failures[0]);
    assert.throws(() => log.close(), (error: unknown) => error === failures[0]);
    assert.deepEqual(store.db.prepare("SELECT * FROM artifact_streams").all(), []);
    t.mock.timers.tick(100);
    assert.equal(failures.length, 1, "A failed logger must not loop or emit repeated errors");
  } finally { close(); }
});

test("request-log quota failure preserves the batch and releases its reservation on close", () => {
  const { store, log, close } = fixture();
  const previous = process.env.DEVECO_CONFIG;
  const file = path.join(store.root, "small-capacity.json");
  try {
    log.write("request_start", { request_id: "bounded" });
    fs.writeFileSync(file, JSON.stringify({ max_bytes: 1 }));
    process.env.DEVECO_CONFIG = file;
    assert.throws(() => log.flush(), { code: "STATE_CAPACITY" });
    assert.equal(log.metrics.pending_events, 1);
    assert.deepEqual(store.db.prepare("SELECT * FROM events").all(), []);
    assert.throws(() => log.close(), { code: "STATE_CAPACITY" });
    assert.deepEqual(store.db.prepare("SELECT * FROM artifact_streams").all(), []);
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    close();
  }
});
