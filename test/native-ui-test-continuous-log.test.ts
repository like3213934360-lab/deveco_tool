import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../src/core/store.js";
import { StorageService } from "../src/services/storage.js";
import { UiTestContinuousLogService } from "../src/services/ui-test-continuous-log.js";
import { LogStreamCollector, type LogTransport } from "../src/services/ui-log-stream.js";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "condition timed out");
    await delay(10);
  }
}
function source() {
  let emit: ((chunk: Buffer) => void) | undefined,
    streams = 0,
    closed = 0;
  const transport: LogTransport = {
    async identify() {
      const now = Date.now();
      return {
        epoch_ns: String(BigInt(now) * 1000000n),
        host_start: now,
        host_end: now,
        processes: { "42": "999" },
      };
    },
    async stream(_pids, signal, hooks) {
      streams++;
      emit = hooks.output;
      hooks.pause({ pause() {}, resume() {} });
      try {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        emit = undefined;
        closed++;
      }
    },
  };
  return {
    transport,
    stats: () => ({ streams, closed }),
    ready: () => !!emit,
    emit(count: number, text = "持久化中文🙂") {
      const now = BigInt(Date.now()) * 1000000n;
      const bytes = Buffer.from(
        Array.from(
          { length: count },
          (_, i) =>
            `${now / 1000000000n}.${String(now % 1000000000n).padStart(9, "0")} 42 42 I APP ${i} ${text}\n`,
        ).join(""),
      );
      assert.ok(emit);
      emit(bytes);
    },
  };
}

test("continuous artifacts and hashes survive restart; resumed collection doesn't replay app actions and cancellation releases its lease", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-log-persistence-"),
  );
  let store = new StateStore(path.join(root, "state"));
  const fixture = source();
  let logs = new UiTestContinuousLogService(store, () => fixture.transport);
  const id = store.create("ui_test", {}).run.id;
  store.update(id, "needs_input");
  try {
    await logs.ensure(id, "owned", "com.test.owned", "one", "act", [
      "secret中文",
    ]);
    await until(fixture.ready);
    await assert.rejects(logs.ensure(id, "other-target", "com.test.owned", "one", "act"), { code: "UI_LOG_SCOPE_CHANGED" });
    await assert.rejects(logs.ensure(id, "owned", "com.test.other", "one", "act"), { code: "UI_LOG_SCOPE_CHANGED" });
    await delay(2);
    fixture.emit(3000, "secret中文");
    await until(() => logs.status(id).chunk_count > 0);
    const first = logs.chunk(id, 500)!;
    assert.equal(first.line_count, 3000);
    const artifact = store.readBinaryArtifact(first.artifact_id, 512 * 1024, [
      "text/plain",
    ]).data;
    assert.equal(
      createHash("sha256").update(artifact).digest("hex"),
      first.sha256,
    );
    assert.doesNotMatch(artifact.toString(), /secret中文/);
    const other = new UiTestContinuousLogService(
      store,
      () => fixture.transport,
    );
    await other.ensure(id, "owned", "com.test.owned", "other", "resume");
    assert.equal(
      fixture.stats().streams,
      1,
      "another service must not spawn a second PID reader",
    );
    await other.close();
    const storage = new StorageService(store);
    await assert.rejects(
      storage.export([id], path.join(root, "while-active")),
      { code: "RUN_PROTECTED" },
    );
    await logs.close();
    assert.equal(fixture.stats().streams, fixture.stats().closed);
    assert.equal(
      (
        store.db
          .prepare(
            "SELECT COUNT(*) n FROM leases WHERE resource LIKE 'ui-log:%'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    store.close();
    store = new StateStore(path.join(root, "state"));
    logs = new UiTestContinuousLogService(store, () => fixture.transport);
    assert.deepEqual(logs.chunk(id, 500), first);
    await logs.ensure(id, "owned", "com.test.owned", "two", "resume");
    await until(fixture.ready);
    await delay(2);
    fixture.emit(3);
    await until(() => logs.status(id).chunk_count > 1);
    await logs.stop(id, "test_cancelled");
    assert.equal(logs.status(id).state, "stopped");
    assert.equal(logs.status(id).complete, false);
    assert.equal(fixture.stats().streams, fixture.stats().closed);
    store.claim(id);
    store.update(id, "cancelled");
    const lifecycle = new StorageService(store);
    await lifecycle.export([id], path.join(root, "export"));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "export/manifest.json"), "utf8"),
    );
    assert.ok(
      manifest.artifacts.some(
        (item: { sha256: string }) => item.sha256 === first.sha256,
      ),
    );
    // Cleanup must include the new session/chunk tables, not leave orphan state.
    lifecycle.apply([id], lifecycle.plan([id]).plan_hash);
    assert.equal(logs.chunks(id).length, 0);
  } finally {
    await logs.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unclosed metadata is reported as an interrupted interval rather than complete historical coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-log-gap-")),
    store = new StateStore(root),
    fixture = source(),
    logs = new UiTestContinuousLogService(store, () => fixture.transport);
  const id = store.create("ui_test", {}).run.id;
  try {
    store.db.prepare("INSERT INTO ui_log_sessions VALUES (?,?,?,?,?)").run(
      id,
      store.owner,
      "running",
      JSON.stringify({
        format: 1,
        target: "owned",
        bundle_name: "com.test.owned",
        started_at: Date.now(),
        step_id: "one",
        stage: "act",
        bytes: 0,
        lines: 0,
        chunk_count: 0,
        gaps: [],
      }),
      Date.now(),
    );
    const status = logs.status(id);
    assert.equal(status.state, "interrupted");
    assert.equal(status.complete, false);
    assert.equal(
      "pending_gap" in status && status.pending_gap,
      "runtime_interrupted_or_storage_failure",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const budget of ["bytes", "chunks"] as const)
  test(`continuous ${budget} quota rejects publication, preserves history and stays exhausted after restart`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-log-quota-"));
    let store = new StateStore(root);
    const fixture = source();
    let logs = new UiTestContinuousLogService(store, () => fixture.transport);
    const id = store.create("ui_test", {}).run.id;
    store.update(id, "needs_input");
    try {
      await logs.ensure(id, "owned", "com.test.owned", "first", "resume");
      await until(fixture.ready);
      await delay(2);
      fixture.emit(2);
      await until(() => logs.status(id).chunk_count === 1);
      await logs.close();
      const first = logs.chunk(id, 500)!;
      const retained = store.readBinaryArtifact(first.artifact_id, 512 * 1024, [
        "text/plain",
      ]).data;
      const artifactCount = () =>
        (
          store.db
            .prepare("SELECT COUNT(*) n FROM artifacts WHERE run_id=?")
            .get(id) as { n: number }
        ).n;
      const before = artifactCount();
      const row = store.db
        .prepare("SELECT payload FROM ui_log_sessions WHERE run_id=?")
        .get(id) as { payload: string };
      const session = JSON.parse(row.payload);
      // Deterministic boundary injection, not a claim of a real 64 MiB /
      // 8192-chunk device run. The first retained artifact is produced normally.
      if (budget === "bytes") session.bytes = 64 * 1024 * 1024;
      else session.chunk_count = 8192;
      store.db
        .prepare("UPDATE ui_log_sessions SET payload=? WHERE run_id=?")
        .run(JSON.stringify(session), id);
      logs = new UiTestContinuousLogService(store, () => fixture.transport);
      await logs.ensure(id, "owned", "com.test.owned", "second", "resume");
      await until(fixture.ready);
      await delay(2);
      fixture.emit(1, "must not be published");
      await until(() => logs.status(id).state === "exhausted");
      const expected =
        budget === "bytes" ? "UI_LOG_DISK_BUDGET" : "UI_LOG_CHUNK_BUDGET";
      const exhausted = logs.status(id);
      assert.ok("stop_reason" in exhausted && "gaps" in exhausted);
      assert.equal(exhausted.stop_reason, expected);
      assert.ok(exhausted.gaps.some((gap) => gap.code === expected));
      assert.equal(artifactCount(), before);
      assert.deepEqual(logs.chunk(id, 500), first);
      assert.deepEqual(
        store.readBinaryArtifact(first.artifact_id, 512 * 1024, ["text/plain"])
          .data,
        retained,
      );
      assert.equal(logs.chunks(id).length, 1);
      await logs.close();
      const streams = fixture.stats().streams;
      assert.equal(streams, fixture.stats().closed);
      store.close();
      store = new StateStore(root);
      logs = new UiTestContinuousLogService(store, () => fixture.transport);
      await logs.ensure(id, "owned", "com.test.owned", "third", "resume");
      await assert.rejects(logs.ensure(id, "other-target", "com.test.owned", "third", "resume"), { code: "UI_LOG_SCOPE_CHANGED" });
      assert.equal(logs.status(id).state, "exhausted");
      assert.equal(fixture.stats().streams, streams);
      assert.deepEqual(logs.chunk(id, 500), first);
      assert.deepEqual(
        store.db
          .prepare("SELECT resource FROM leases WHERE resource=?")
          .all(`ui-log:${id}`),
        [],
      );
    } finally {
      await logs.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test("chunk transaction rollback preserves the last committed sequence and totals", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-log-rollback-")), store = new StateStore(root), fixture = source();
  const logs = new UiTestContinuousLogService(store, () => fixture.transport), id = store.create("ui_test", {}).run.id;
  store.update(id, "needs_input");
  try {
    await logs.ensure(id, "owned", "com.test.owned", "one", "resume");
    await until(fixture.ready); await delay(2); fixture.emit(2);
    await until(() => logs.status(id).chunk_count === 1);
    const before = logs.status(id), first = logs.chunk(id, 500);
    store.db.exec("CREATE TRIGGER fail_chunk_commit BEFORE INSERT ON ui_log_chunks BEGIN SELECT RAISE(ABORT,'controlled metadata rollback'); END");
    fixture.emit(3);
    await until(() => fixture.stats().closed > 0);
    await logs.stop(id, "test_cancelled");
    const after = logs.status(id);
    assert.ok("bytes" in before && "bytes" in after && "lines" in before && "lines" in after);
    assert.equal(after.chunk_count, before.chunk_count);
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.lines, before.lines);
    assert.deepEqual(logs.chunk(id, 500), first);
    assert.equal(logs.chunks(id).length, 1);
    assert.equal(fixture.stats().streams, fixture.stats().closed);
  } finally { await logs.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("checkpoint failure still aborts and joins the log transport and releases its lease", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-log-checkpoint-")), store = new StateStore(root), fixture = source();
  const logs = new UiTestContinuousLogService(store, () => fixture.transport), id = store.create("ui_test", {}).run.id;
  store.update(id, "needs_input");
  try {
    await logs.ensure(id, "owned", "com.test.owned", "one", "resume");
    await until(fixture.ready);
    const failure = t.mock.method(LogStreamCollector.prototype, "checkpoint", async () => { throw new Error("controlled checkpoint failure"); });
    await assert.rejects(logs.stop(id, "test_finished"), /controlled checkpoint failure/);
    failure.mock.restore();
    assert.equal(fixture.stats().streams, fixture.stats().closed);
    assert.equal(store.db.prepare("SELECT resource FROM leases WHERE resource=?").all(`ui-log:${id}`).length, 0);
  } finally { await logs.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("artifact ENOSPC stops and joins the collector without replacing readable history", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-log-disk-"));
  const store = new StateStore(root),
    fixture = source();
  const logs = new UiTestContinuousLogService(store, () => fixture.transport);
  const id = store.create("ui_test", {}).run.id;
  store.update(id, "needs_input");
  try {
    await logs.ensure(id, "owned", "com.test.owned", "first", "resume");
    await until(fixture.ready);
    await delay(2);
    fixture.emit(2);
    await until(() => logs.status(id).chunk_count === 1);
    const first = logs.chunk(id, 500)!;
    const failure = t.mock.method(store, "artifact", () => {
      throw Object.assign(new Error("Controlled storage failure"), {
        code: "ENOSPC",
      });
    });
    fixture.emit(2, "not durable");
    await until(() => logs.status(id).state === "exhausted");
    const exhausted = logs.status(id);
    assert.ok("stop_reason" in exhausted && "gaps" in exhausted);
    assert.equal(exhausted.stop_reason, "ENOSPC");
    assert.equal(logs.status(id).chunk_count, 1);
    assert.ok(exhausted.gaps.some((gap) => gap.code === "ENOSPC"));
    assert.equal(failure.mock.callCount(), 1);
    failure.mock.restore();
    assert.deepEqual(logs.chunk(id, 500), first);
    const bytes = store.readBinaryArtifact(first.artifact_id, 512 * 1024, [
      "text/plain",
    ]).data;
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      first.sha256,
    );
    assert.equal(fixture.stats().streams, fixture.stats().closed);
    await logs.ensure(id, "owned", "com.test.owned", "later", "resume");
    assert.equal(fixture.stats().streams, 1);
    assert.deepEqual(
      store.db
        .prepare("SELECT resource FROM leases WHERE resource=?")
        .all(`ui-log:${id}`),
      [],
    );
  } finally {
    await logs.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
