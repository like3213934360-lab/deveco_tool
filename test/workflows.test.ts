import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../src/core/store.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { ToolError } from "../src/core/errors.js";

function fixture(definition: WorkflowDefinition) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-workflows-")),
    store = new StateStore(root),
    engine = new WorkflowEngine(store, [definition], async () => {});
  return {
    root,
    store,
    engine,
    async close() {
      await engine.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
async function finish(engine: WorkflowEngine, id: string) {
  for (let i = 0; i < 100; i++) {
    const state = await engine.status(id, 100);
    if (
      [
        "succeeded",
        "failed",
        "cancelled",
        "needs_input",
        "interrupted",
      ].includes(state.status)
    )
      return state;
  }
  throw new Error("Workflow did not terminate");
}
test("checkpointed execution deduplicates requests and rejects conflicting input", async () => {
  let effects = 0;
  const f = fixture({
    id: "test",
    description: "test",
    capabilities: [],
    completion: "done",
    resources: () => [],
    steps: [
      {
        id: "read",
        kind: "read",
        async execute() {
          return { ready: true };
        },
      },
      {
        id: "write",
        kind: "effect",
        async execute() {
          effects++;
          return { done: true };
        },
      },
    ],
  });
  try {
    const first = f.engine.start("test", { parameters: { x: 1 } }, "request");
    assert.equal((await finish(f.engine, first.run_id)).status, "succeeded");
    const second = f.engine.start("test", { parameters: { x: 1 } }, "request");
    assert.equal(second.run_id, first.run_id);
    assert.equal(second.deduplicated, true);
    assert.equal(effects, 1);
    assert.throws(
      () => f.engine.start("test", { parameters: { x: 2 } }, "request"),
      /different input/,
    );
    const tuple = await f.engine.checkpointer.getTuple({
      configurable: { thread_id: first.run_id },
    });
    assert.ok(tuple?.checkpoint);
  } finally {
    await f.close();
  }
});
test("uncertain external effects pause instead of repeating, then reconcile on resume", async () => {
  let attempts = 0,
    reconciled = false;
  const f = fixture({
    id: "test",
    description: "test",
    capabilities: [],
    completion: "done",
    resources: () => [],
    steps: [
      {
        id: "install",
        kind: "effect",
        async execute() {
          attempts++;
          throw new Error("connection lost after install");
        },
        async reconcile() {
          return reconciled ? { installed: true } : undefined;
        },
      },
    ],
  });
  try {
    const run = f.engine.start("test", { parameters: {} });
    assert.equal((await finish(f.engine, run.run_id)).status, "needs_input");
    await assert.rejects(f.engine.resume(run.run_id), {
      code: "RESUME_INPUT_REQUIRED",
    });
    await f.engine.resume(run.run_id, { action: "recheck" });
    assert.equal((await finish(f.engine, run.run_id)).status, "needs_input");
    assert.equal(attempts, 1);
    await assert.rejects(f.engine.cancel(run.run_id), {
      code: "EFFECT_UNCERTAIN",
    });
    assert.equal(f.store.get(run.run_id).status, "needs_input");
    reconciled = true;
    await f.engine.resume(run.run_id, { action: "recheck" });
    assert.equal((await finish(f.engine, run.run_id)).status, "succeeded");
    assert.equal(attempts, 1);
  } finally {
    await f.close();
  }
});
test("cancel waits for the managed operation to stop before final cancelled state", async () => {
  let stopped = false,
    entered = false;
  const f = fixture({
    id: "test",
    description: "test",
    capabilities: [],
    completion: "done",
    resources: () => ["project:test"],
    steps: [
      {
        id: "blocking",
        kind: "read",
        async execute({ signal }) {
          entered = true;
          try {
            await delay(30000, undefined, { signal });
          } finally {
            await delay(50);
            stopped = true;
          }
          return null;
        },
      },
    ],
  });
  try {
    const run = f.engine.start("test", { parameters: {} });
    while (!entered) await delay(5);
    const cancelling = await f.engine.cancel(run.run_id);
    assert.equal(cancelling.status, "cancelling");
    assert.equal(stopped, false);
    assert.equal((await finish(f.engine, run.run_id)).status, "cancelled");
    assert.equal(stopped, true);
    assert.equal(f.store.db.prepare("SELECT * FROM leases").all().length, 0);
  } finally {
    await f.close();
  }
});
test("cancelling an external mutation preserves its uncertain receipt until reconciliation", async () => {
  let entered = false,
    mutations = 0,
    reconciled = false;
  const f = fixture({
    id: "test",
    description: "test",
    capabilities: [],
    completion: "done",
    resources: () => [],
    steps: [
      {
        id: "install",
        kind: "effect",
        async execute({ signal }) {
          entered = true;
          mutations++;
          await delay(30000, undefined, { signal });
          return { installed: true };
        },
        async reconcile() {
          return reconciled ? { installed: true } : undefined;
        },
      },
    ],
  });
  try {
    const run = f.engine.start("test", { parameters: {} });
    while (!entered) await delay(5);
    await f.engine.cancel(run.run_id);
    const stopped = await finish(f.engine, run.run_id);
    assert.equal(stopped.status, "needs_input");
    assert.equal(f.store.uncertainOperations(run.run_id).length, 1);
    await assert.rejects(f.engine.cancel(run.run_id), {
      code: "EFFECT_UNCERTAIN",
    });
    reconciled = true;
    await f.engine.resume(run.run_id, { action: "recheck" });
    assert.equal((await finish(f.engine, run.run_id)).status, "succeeded");
    assert.equal(mutations, 1);
  } finally {
    await f.close();
  }
});
test("read retries are bounded and effect failures are never automatically retried", async () => {
  let reads = 0,
    effects = 0;
  const f = fixture({
    id: "test",
    description: "test",
    capabilities: [],
    completion: "done",
    resources: () => [],
    steps: [
      {
        id: "read",
        kind: "read",
        async execute() {
          reads++;
          if (reads < 3) throw new ToolError("RETRY", "temporary", null, true);
          return null;
        },
      },
      {
        id: "write",
        kind: "effect",
        async execute() {
          effects++;
          throw new ToolError("RETRY", "temporary", null, true);
        },
      },
    ],
  });
  try {
    const run = f.engine.start("test", { parameters: {} });
    assert.equal((await finish(f.engine, run.run_id)).status, "needs_input");
    assert.equal(reads, 3);
    assert.equal(effects, 1);
  } finally {
    await f.close();
  }
});

test("queue telemetry belongs to its workflow and expires with the run", async () => {
  const f = fixture({
    id: "queue",
    description: "queue trace regression",
    capabilities: [],
    completion: "read complete",
    resources: () => ["project:shared", "device:shared"],
    steps: [
      {
        id: "read",
        kind: "read",
        async execute() {
          return true;
        },
      },
    ],
  });
  try {
    const runs = [1, 2].map((index) =>
      f.engine.start("queue", { parameters: { index } }),
    );
    for (const run of runs)
      assert.equal((await finish(f.engine, run.run_id)).status, "succeeded");
    const events = f.store.db
      .prepare("SELECT run_id FROM events WHERE kind='lease_acquired'")
      .all() as { run_id: string | null }[];
    assert.equal(events.length, 4);
    for (const run of runs)
      assert.equal(
        events.filter((event) => event.run_id === run.run_id).length,
        2,
      );
    f.store.db.prepare("UPDATE runs SET updated=0").run();
    f.store.prune();
    assert.equal(f.store.runCount(), 0);
    assert.deepEqual(f.store.db.prepare("SELECT * FROM events").all(), []);
  } finally {
    await f.close();
  }
});
