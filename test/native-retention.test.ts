import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StateStore } from "../src/core/store.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-retention-"));
  const store = new StateStore(root);
  return {
    store,
    close: () => {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("artifact ranges complete short reads and reject truncated persisted data", (t) => {
  const f = fixture();
  try {
    const reference = f.store.artifact("fixture", "0123456789abcdef");
    const read = fs.readSync;
    const short = t.mock.method(
      fs,
      "readSync",
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: fs.ReadPosition | null,
      ) => read(fd, buffer, offset, Math.min(length, 3), position),
    );
    const part = f.store.readArtifact(reference.artifact_id, 2, 8);
    assert.equal(Buffer.from(part.data, "base64").toString(), "23456789");
    assert.equal(part.next_offset, 10);
    short.mock.restore();
    assert.throws(() => f.store.readArtifact(reference.artifact_id, 0, 0.5), {
      code: "INVALID_RANGE",
    });
    fs.truncateSync(
      path.join(f.store.root, "artifacts", reference.artifact_id),
      3,
    );
    assert.throws(() => f.store.readArtifact(reference.artifact_id), {
      code: "ARTIFACT_CHANGED",
    });
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test("retention in another database connection cannot unlink between artifact lookup and open", (t) => {
  const f = fixture(),
    peer = new StateStore(f.store.root);
  peer.db.pragma("busy_timeout = 1");
  try {
    const run = f.store.create("complete", {}).run;
    const artifact = f.store.artifact(run.id, "concurrent evidence");
    f.store.update(run.id, "succeeded");
    f.store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
    const file = path.join(f.store.root, "artifacts", artifact.artifact_id);
    const open = fs.openSync;
    let attempted = false;
    t.mock.method(
      fs,
      "openSync",
      (target: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
        if (target === file) {
          attempted = true;
          assert.throws(() => peer.prune(), { code: "SQLITE_BUSY" });
        }
        return open(target, flags, mode);
      },
    );
    assert.equal(
      Buffer.from(
        f.store.readArtifact(artifact.artifact_id).data,
        "base64",
      ).toString(),
      "concurrent evidence",
    );
    assert.equal(attempted, true);
    t.mock.restoreAll();
    peer.prune();
    assert.equal(fs.existsSync(file), false);
  } finally {
    t.mock.restoreAll();
    peer.close();
    f.close();
  }
});
test("a failed retention transaction preserves every byte of the retained run's evidence", () => {
  const f = fixture();
  try {
    const run = f.store.create("completed", {}).run;
    const artifact = f.store.artifact(run.id, "evidence survives rollback");
    f.store.update(run.id, "succeeded");
    f.store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
    f.store.db.exec(
      "CREATE TRIGGER fail_retention BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END",
    );
    assert.throws(() => f.store.prune(), /simulated disk failure/);
    assert.equal(f.store.get(run.id).status, "succeeded");
    assert.equal(
      Buffer.from(
        f.store.readArtifact(artifact.artifact_id).data,
        "base64",
      ).toString(),
      "evidence survives rollback",
    );
    assert.equal(
      f.store.db.prepare("SELECT * FROM artifact_gc").all().length,
      0,
    );
    f.store.db.exec("DROP TRIGGER fail_retention");
    f.store.prune();
    assert.throws(() => f.store.readArtifact(artifact.artifact_id), {
      code: "ARTIFACT_NOT_FOUND",
    });
  } finally {
    f.close();
  }
});
test("locked obsolete artifacts stay charged and their durable tombstones are retried after restart", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-retention-retry-"),
  );
  let store = new StateStore(root);
  try {
    const run = store.create("completed", {}).run;
    const artifact = store.artifact(run.id, "locked evidence");
    const file = path.join(root, "artifacts", artifact.artifact_id);
    store.update(run.id, "succeeded");
    store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
    const unlink = fs.rmSync;
    const mocked = t.mock.method(
      fs,
      "rmSync",
      (target: fs.PathLike, options?: fs.RmOptions) => {
        if (target === file)
          throw Object.assign(new Error("locked"), { code: "EBUSY" });
        return unlink(target, options);
      },
    );
    store.prune();
    assert.equal(store.runCount(), 0);
    assert.ok(fs.existsSync(file));
    assert.deepEqual(store.db.prepare("SELECT * FROM artifact_gc").all(), [
      { file, bytes: artifact.bytes },
    ]);
    mocked.mock.restore();
    store.close();
    store = new StateStore(root);
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.db.prepare("SELECT * FROM artifact_gc").all().length, 0);
  } finally {
    t.mock.restoreAll();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("terminal retention is enforced without restarting and never deletes unresolved mutation evidence", async () => {
  const f = fixture();
  try {
    const uncertain = f.store.create("install", {}).run;
    await assert.rejects(
      f.store.effect(uncertain.id, "install", {}, async () => {
        throw new Error("lost receipt");
      }),
    );
    f.store.update(uncertain.id, "failed");
    const artifact = f.store.artifact(uncertain.id, "receipt evidence");
    f.store.db
      .prepare("UPDATE runs SET updated=0 WHERE id=?")
      .run(uncertain.id);
    for (let i = 0; i < 110; i++) {
      const run = f.store.create("complete", { i }).run;
      f.store.update(run.id, "succeeded");
    }
    assert.equal(f.store.runCount(), 101);
    assert.equal(f.store.get(uncertain.id).status, "failed");
    assert.equal(f.store.uncertainOperations(uncertain.id).length, 1);
    assert.equal(
      Buffer.from(
        f.store.readArtifact(artifact.artifact_id).data,
        "base64",
      ).toString(),
      "receipt evidence",
    );
  } finally {
    f.close();
  }
});

test("pagination reaches every unfinished run beyond the first one hundred", () => {
  const f = fixture();
  try {
    const expected = new Set<string>();
    for (let i = 0; i < 115; i++)
      expected.add(f.store.create("unfinished", { i }).run.id);
    f.store.prune();
    const actual = new Set(
      [...f.store.list(), ...f.store.list(100)].map((run) => run.id),
    );
    assert.deepEqual(actual, expected);
    assert.equal(f.store.runCount(), 115);
    assert.throws(() => f.store.list(0, 101), { code: "PAGINATION_INVALID" });
  } finally {
    f.close();
  }
});

test("finished process and SDK session history is bounded while unresolved records survive", () => {
  const f = fixture();
  try {
    const now = Date.now();
    f.store.db.transaction(() => {
      for (let i = 0; i < 1010; i++) {
        f.store.db
          .prepare(
            "INSERT INTO managed_processes VALUES (?,?,NULL,NULL,'[]','exited',?,?,NULL)",
          )
          .run(`process-${i}`, f.store.owner, now + i, now + i);
        f.store.db
          .prepare(
            "INSERT INTO external_sessions VALUES (?,?,NULL,'fixture','[]','{}','closed',?)",
          )
          .run(`session-${i}`, f.store.owner, now + i);
      }
    })();
    const guard = f.store.trackExternalSession(
      "unresolved",
      ["project:fixture"],
      {},
    );
    guard.unconfirmed();
    f.store.prune();
    assert.equal(
      (
        f.store.db
          .prepare("SELECT COUNT(*) AS count FROM managed_processes")
          .get() as { count: number }
      ).count,
      1000,
    );
    assert.equal(
      (
        f.store.db
          .prepare("SELECT COUNT(*) AS count FROM external_sessions")
          .get() as { count: number }
      ).count,
      1001,
    );
    assert.equal(f.store.externalGuards()[0]?.id, guard.id);
  } finally {
    f.close();
  }
});

test("a runtime cannot silently overwrite a run after losing ownership", () => {
  const f = fixture();
  try {
    const run = f.store.create("read", {}).run;
    f.store.db
      .prepare("UPDATE runs SET owner='another-runtime' WHERE id=?")
      .run(run.id);
    assert.throws(() => f.store.update(run.id, "succeeded"), {
      code: "RUN_OWNERSHIP_LOST",
    });
    assert.equal(f.store.get(run.id).status, "queued");
  } finally {
    f.close();
  }
});
