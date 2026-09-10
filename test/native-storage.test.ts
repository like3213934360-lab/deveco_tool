import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../src/core/store.js";
import { StorageService } from "../src/services/storage.js";
import { captureFile } from "../src/core/captured-file.js";
import { fileDigest } from "../src/core/files.js";
import { WorkerClient } from "../src/core/worker-client.js";
import { z } from "zod";

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-storage-")),
  );
  const store = new StateStore(path.join(root, "state")),
    storage = new StorageService(store);
  return {
    root,
    store,
    storage,
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
function completed(store: StateStore, bytes = 32) {
  const run = store.create("app_deploy", { private_input: "not exported" }).run;
  const artifact = store.artifact(run.id, Buffer.alloc(bytes, 71));
  store.update(run.id, "succeeded", { installed: true });
  return { run, artifact };
}

test("quiescent recoverable history can be exported while cleanup and concurrent resume remain blocked", async () => {
  const f = fixture(),
    peer = new StateStore(f.store.root);
  try {
    const run = f.store.create("ui_test", {
      private_input: "not in export",
    }).run;
    f.store.artifact(run.id, Buffer.alloc(2 * 1024 * 1024, 9));
    f.store.update(run.id, "needs_input", { test_id: run.id });
    assert.throws(() => f.storage.plan([run.id]), { code: "RUN_PROTECTED" });
    const exporting = f.storage.export(
      [run.id],
      path.join(f.root, "paused-test"),
    );
    assert.throws(() => peer.claim(run.id), { code: "RUN_BUSY" });
    assert.equal((await exporting).status, "complete");
    assert.equal(f.store.get(run.id).status, "needs_input");
    peer.claim(run.id);
    peer.update(run.id, "failed", undefined, { code: "EFFECT_UNCERTAIN" });
    assert.throws(() => f.storage.plan([run.id]), { code: "RUN_PROTECTED" });
    assert.equal(
      (await f.storage.export([run.id], path.join(f.root, "failed-test")))
        .status,
      "complete",
    );
    assert.equal(f.store.get(run.id).status, "failed");
  } finally {
    peer.close();
    f.close();
  }
});

test("storage cleanup requires the exact current preview, preserves active and recoverable work and has a durable receipt", () => {
  const f = fixture();
  try {
    const { run, artifact } = completed(f.store);
    const pending = f.store.create("pending", {}).run;
    const failed = f.store.create("failed", {}).run;
    f.store.update(failed.id, "failed");
    for (const id of [pending.id, failed.id])
      assert.throws(() => f.storage.plan([id]), { code: "RUN_PROTECTED" });
    const plan = f.storage.plan([run.id]);
    f.store.artifact(run.id, "later evidence");
    assert.throws(() => f.storage.apply([run.id], plan.plan_hash), {
      code: "CLEANUP_PLAN_STALE",
    });
    assert.ok(f.store.readArtifact(artifact.artifact_id));
    const fresh = f.storage.plan([run.id]);
    const result = f.storage.apply([run.id], fresh.plan_hash);
    assert.equal(result.references_removed, true);
    assert.throws(() => f.store.get(run.id), { code: "RUN_NOT_FOUND" });
    assert.throws(() => f.store.readArtifact(artifact.artifact_id), {
      code: "ARTIFACT_NOT_FOUND",
    });
    assert.equal(
      f.storage.apply([run.id], fresh.plan_hash).receipt_id,
      fresh.plan_hash,
    );
    assert.throws(() => f.storage.apply([failed.id], fresh.plan_hash), {
      code: "CLEANUP_SELECTION_CHANGED",
    });
    const peer = new StateStore(f.store.root);
    try {
      assert.equal(
        new StorageService(peer).receipt(fresh.plan_hash).data
          .references_removed,
        true,
      );
    } finally {
      peer.close();
    }
  } finally {
    f.close();
  }
});

test("cleanup transaction failure retains artifacts and creates no successful receipt", () => {
  const f = fixture();
  try {
    const { run, artifact } = completed(f.store);
    const plan = f.storage.plan([run.id]);
    f.store.db.exec(
      "CREATE TRIGGER reject_cleanup BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END",
    );
    assert.throws(
      () => f.storage.apply([run.id], plan.plan_hash),
      /fixture cleanup failure/,
    );
    assert.ok(f.store.readArtifact(artifact.artifact_id));
    assert.deepEqual(f.store.db.prepare("SELECT * FROM artifact_gc").all(), []);
    assert.throws(() => f.storage.receipt(plan.plan_hash), {
      code: "STORAGE_RECEIPT_NOT_FOUND",
    });
  } finally {
    f.close();
  }
});

test("pending deletion stays charged and can be retried through the same cleanup receipt", (t) => {
  const f = fixture();
  try {
    const { run, artifact } = completed(f.store, 65536);
    const plan = f.storage.plan([run.id]);
    const file = path.join(f.store.root, "artifacts", artifact.artifact_id),
      remove = fs.rmSync;
    const mock = t.mock.method(
      fs,
      "rmSync",
      (target: fs.PathLike, options?: fs.RmOptions) => {
        if (target === file) throw new Error("fixture locked file");
        return remove(target, options);
      },
    );
    f.storage.apply([run.id], plan.plan_hash);
    assert.equal(f.storage.capacity().breakdown.pending_deletion, 65536);
    mock.mock.restore();
    f.storage.apply([run.id], plan.plan_hash);
    assert.equal(fs.existsSync(file), false);
    assert.equal(f.storage.capacity().breakdown.pending_deletion, 0);
  } finally {
    t.mock.restoreAll();
    f.close();
  }
});

test("package capacity failure can be recovered without raising the limit or touching the source HAP", async () => {
  const f = fixture(),
    previous = process.env.DEVECO_CONFIG;
  const source = path.join(f.root, "source.hap"),
    config = path.join(f.root, "config.json");
  try {
    fs.writeFileSync(source, Buffer.alloc(2 * 1024 * 1024, 39));
    const sourceHash = fileDigest(source),
      runs: string[] = [];
    const submit = async () => {
      const capture = await captureFile(f.store, "workflow-input", source);
      const { run } = f.store.create(
        "app_deploy",
        { deployment: [capture] },
        undefined,
        {},
        [capture.artifact_id],
      );
      f.store.update(run.id, "succeeded", {
        fixture: "capture only, no device install",
      });
      return run.id;
    };
    for (let index = 0; index < 6; index++) runs.push(await submit());
    const limit = f.storage.capacity().used_bytes + 65536;
    fs.writeFileSync(config, JSON.stringify({ max_bytes: limit }));
    process.env.DEVECO_CONFIG = config;
    assert.equal(f.storage.capacity(2 * 1024 * 1024).fits, false);
    await assert.rejects(submit(), { code: "STATE_CAPACITY" });
    const selected = runs.slice(0, 3),
      plan = f.storage.plan(selected);
    f.storage.apply(selected, plan.plan_hash);
    runs.push(await submit(), await submit());
    assert.equal(runs.length, 8);
    assert.equal(f.storage.capacity().max_bytes, limit);
    assert.equal(fileDigest(source), sourceHash);
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    f.close();
  }
});

test("export pins evidence across connections, verifies copied bytes, excludes private inputs and blocks overwrite", async () => {
  const f = fixture(),
    peer = new StateStore(f.store.root);
  try {
    const { run, artifact } = completed(f.store, 4 * 1024 * 1024);
    f.store.artifact(
      run.id,
      "private signing secret",
      "application/x-deveco-encrypted",
    );
    const target = path.join(f.root, "export");
    const exportTask = f.storage.export([run.id], target);
    assert.throws(() => new StorageService(peer).plan([run.id]), {
      code: "RUN_PROTECTED",
    });
    assert.throws(() => peer.discardArtifacts(run.id, [artifact.artifact_id]), {
      code: "RUN_PINNED",
    });
    peer.prune();
    const receipt = await exportTask;
    const manifestFile = path.join(target, "manifest.json");
    assert.equal(fileDigest(manifestFile), receipt.manifest_sha256);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.omitted.length, 1);
    assert.equal(
      fileDigest(path.join(target, artifact.artifact_id)),
      manifest.artifacts[0].sha256,
    );
    assert.doesNotMatch(
      JSON.stringify(manifest.runs),
      /private_input|not exported|private signing secret/,
    );
    assert.equal(fs.existsSync(path.join(target, "incomplete.json")), false);
    await assert.rejects(f.storage.export([run.id], target), {
      code: "EXPORT_EXISTS",
    });
    await assert.rejects(
      f.storage.export([run.id], path.join(f.store.root, "unsafe")),
      { code: "EXPORT_INSIDE_STATE" },
    );
    const plan = f.storage.plan([run.id]);
    f.storage.apply([run.id], plan.plan_hash);
    assert.equal(
      fileDigest(path.join(target, artifact.artifact_id)),
      manifest.artifacts[0].sha256,
    );
  } finally {
    peer.close();
    f.close();
  }
});

test("cancelled exports leave marked partial evidence and release pins; a dead exporter is recovered on restart", async () => {
  const f = fixture();
  try {
    const { run } = completed(f.store, 4 * 1024 * 1024),
      controller = new AbortController();
    const task = f.storage.export(
      [run.id],
      path.join(f.root, "cancelled"),
      controller.signal,
    );
    controller.abort();
    await assert.rejects(task, { code: "CANCELLED" });
    assert.deepEqual(f.store.db.prepare("SELECT * FROM run_pins").all(), []);
    assert.equal(
      fs.existsSync(path.join(f.root, "cancelled", "incomplete.json")),
      true,
    );
    const id = "dead-export";
    f.store.db.prepare("INSERT INTO storage_receipts VALUES (?,?,?,?)").run(
      id,
      "export",
      JSON.stringify({
        status: "copying",
        destination: "owned incomplete export",
      }),
      Date.now(),
    );
    f.store.db
      .prepare("INSERT INTO run_pins VALUES (?,?,?,?,?)")
      .run(id, run.id, "2147483647:dead", "export", Date.now());
    const reopened = new StateStore(f.store.root);
    try {
      assert.equal(
        new StorageService(reopened).receipt(id).data.status,
        "interrupted",
      );
      assert.ok(new StorageService(reopened).plan([run.id]));
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test(
  "a real MCP worker can recover from failed quota telemetry and continue without restart",
  { timeout: 20000 },
  async () => {
    const f = fixture(),
      config = path.join(f.root, "worker-config.json");
    fs.writeFileSync(config, JSON.stringify({ max_bytes: 16 * 1024 * 1024 }));
    const { run } = completed(f.store, 8 * 1024 * 1024),
      failures: Error[] = [];
    const client = new WorkerClient(
      (error) => failures.push(error),
      () =>
        new Worker(new URL("../src/worker.js", import.meta.url), {
          stdout: true,
          stderr: true,
          env: {
            ...process.env,
            DEVECO_STATE_DIR: f.store.root,
            DEVECO_CONFIG: config,
          },
        }),
    );
    try {
      await client.call("workflow_run", { action: "capacity" });
      fs.writeFileSync(config, JSON.stringify({ max_bytes: 4 * 1024 * 1024 }));
      const deadline = Date.now() + 5000;
      let failed = false;
      while (!failed && Date.now() < deadline) {
        try {
          await client.call("workflow_run", { action: "list" });
        } catch (error) {
          assert.equal((error as { code: string }).code, "STATE_CAPACITY");
          failed = true;
        }
        if (!failed) await delay(25);
      }
      assert.equal(failed, true);
      const capacity = z
        .object({ fits: z.boolean() })
        .parse(await client.call("workflow_run", { action: "capacity" }));
      assert.equal(capacity.fits, false);
      const plan = z.object({ plan_hash: z.string() }).parse(
        await client.call("workflow_run", {
          action: "cleanup_plan",
          run_ids: [run.id],
        }),
      );
      await client.call("workflow_run", {
        action: "cleanup_apply",
        run_ids: [run.id],
        plan_hash: plan.plan_hash,
      });
      const list = z
        .object({ total: z.number() })
        .parse(await client.call("workflow_run", { action: "list" }));
      assert.equal(list.total, 0);
      assert.deepEqual(failures, []);
      assert.deepEqual(await client.close(), { closed: true });
      // Restart against an already full state: logger initialization itself
      // cannot be allowed to make the storage tools unreachable.
      const restarted = completed(f.store, 8 * 1024 * 1024);
      const initialCapacity = z
        .object({ fits: z.boolean() })
        .parse(await client.call("workflow_run", { action: "capacity" }));
      assert.equal(initialCapacity.fits, false);
      const restartPlan = z.object({ plan_hash: z.string() }).parse(
        await client.call("workflow_run", {
          action: "cleanup_plan",
          run_ids: [restarted.run.id],
        }),
      );
      await client.call("workflow_run", {
        action: "cleanup_apply",
        run_ids: [restarted.run.id],
        plan_hash: restartPlan.plan_hash,
      });
      assert.equal(
        z
          .object({ total: z.number() })
          .parse(await client.call("workflow_run", { action: "list" })).total,
        0,
      );
      assert.deepEqual(await client.close(), { closed: true });
    } finally {
      await client.close().catch(() => {});
      f.close();
    }
  },
);

test("large completed history stays exportable and cleanable with a streamed evidence log", async () => {
  const f = fixture();
  try {
    const { run } = completed(f.store);
    const insert = f.store.db.prepare(
      "INSERT INTO events(run_id,kind,data,created) VALUES (?,?,?,?)",
    );
    f.store.db.transaction(() => {
      for (let i = 0; i < 10010; i++)
        insert.run(
          run.id,
          "fixture",
          JSON.stringify({ i, text: "x".repeat(512) }),
          Date.now(),
        );
    })();
    const plan = f.storage.plan([run.id]);
    assert.ok(plan.event_count >= 10010);
    const directory = path.join(f.root, "long-history");
    await f.storage.export([run.id], directory);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.events.count, plan.event_count);
    assert.equal(
      fileDigest(path.join(directory, manifest.events.file)),
      manifest.events.sha256,
    );
    f.storage.apply([run.id], plan.plan_hash);
    assert.throws(() => f.store.get(run.id), { code: "RUN_NOT_FOUND" });
  } finally {
    f.close();
  }
});
