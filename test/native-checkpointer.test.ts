import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyCheckpoint,
  type SerializerProtocol,
} from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { BoundedSqliteSaver } from "../src/core/checkpointer.js";
import { StateStore } from "../src/core/store.js";
import { ToolError } from "../src/core/errors.js";

const temporary = () =>
    fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-checkpointer-")),
    ),
  config = {
    configurable: {
      thread_id: "thread",
      checkpoint_ns: "",
      checkpoint_id: "parent",
    },
  },
  metadata = { source: "input" as const, step: 0, parents: {} },
  code = (value: string) => (error: unknown) =>
    error instanceof ToolError && error.code === value;
const count = (
  store: StateStore,
  table: "checkpoints" | "writes" | "artifact_streams" | "artifacts",
) =>
  (
    store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;

test("official checkpoint round-trips retain bounded state without reservation files or rows", async () => {
  const root = temporary(),
    store = new StateStore(root),
    saver = new BoundedSqliteSaver(store);
  try {
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = {
      outputs: { sample: "中文" },
      run_id: "thread",
    };
    const next = await saver.put(config, checkpoint, metadata);
    await saver.putWrites(
      next,
      [["sample", { result_artifact: { artifact_id: "id" } }]],
      "task",
    );
    const restored = await saver.getTuple(next);
    assert.deepEqual(
      restored?.checkpoint.channel_values,
      checkpoint.channel_values,
    );
    assert.equal(restored?.pendingWrites?.length, 1);
    assert.equal(count(store, "artifact_streams"), 0);
    assert.equal(count(store, "artifacts"), 0);
    assert.deepEqual(fs.readdirSync(path.join(root, "artifacts")), []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("capacity claimed by a peer during async serialization prevents checkpoint insertion", async () => {
  const root = temporary(),
    previous = process.env.DEVECO_CONFIG;
  const settings = path.join(root, "config.json");
  fs.writeFileSync(settings, JSON.stringify({ max_bytes: 2 * 1024 * 1024 }));
  process.env.DEVECO_CONFIG = settings;
  const store = new StateStore(root),
    peer = new StateStore(root),
    original = new SqliteSaver(store.db).serde,
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let pause = false,
    calls = 0;
  const serializer: SerializerProtocol = {
    async dumpsTyped(value: unknown) {
      if (pause) {
        if (++calls === 2) entered.resolve();
        await release.promise;
      }
      return original.dumpsTyped(value);
    },
    async loadsTyped(
      type: string,
      data: Uint8Array | string,
    ): Promise<unknown> {
      return original.loadsTyped(type, data) as Promise<unknown>;
    },
  };
  const saver = new BoundedSqliteSaver(store, serializer);
  let competitor: ReturnType<StateStore["streamArtifact"]> | undefined;
  try {
    // Initialize the official tables before testing the asynchronous write gap.
    await saver.getTuple(config);
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = { result: "x".repeat(400 * 1024) };
    pause = true;
    const pending = saver.put(config, checkpoint, metadata);
    const rejected = assert.rejects(pending, code("STATE_CAPACITY"));
    await entered.promise;
    competitor = peer.streamArtifact("competing");
    competitor.reserve(1400 * 1024);
    release.resolve();
    await rejected;
    assert.equal(count(store, "checkpoints"), 0);
    assert.equal(count(store, "artifact_streams"), 1);
    competitor.discard();
    assert.equal(count(store, "artifact_streams"), 0);
  } finally {
    release.resolve();
    competitor?.discard();
    peer.close();
    store.close();
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an oversized intermediate value rejects the entire official write batch and releases reservations", async () => {
  const root = temporary(),
    store = new StateStore(root),
    saver = new BoundedSqliteSaver(store);
  try {
    await assert.rejects(
      saver.putWrites(
        config,
        [
          ["first", { small: "x".repeat(65536) }],
          ["second", "x".repeat(600 * 1024)],
        ],
        "task",
      ),
      code("CHECKPOINT_TOO_LARGE"),
    );
    assert.equal(count(store, "writes"), 0);
    assert.equal(count(store, "artifact_streams"), 0);
    assert.deepEqual(fs.readdirSync(path.join(root, "artifacts")), []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed serializer cannot let a late encoding recharge a discarded checkpoint reservation", async () => {
  const root = temporary(), store = new StateStore(root),
    original = new SqliteSaver(store.db).serde,
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    finished = Promise.withResolvers<void>();
  const saver = new BoundedSqliteSaver(store, {
    async dumpsTyped(value: unknown) {
      if (value === "late") {
        entered.resolve();
        await release.promise;
        const encoded = await original.dumpsTyped(value);
        finished.resolve();
        return encoded;
      }
      if (value === "failure") {
        await entered.promise;
        throw new Error("serializer failed before its peer finished");
      }
      return original.dumpsTyped(value);
    },
    async loadsTyped(type, value): Promise<unknown> {
      return original.loadsTyped(type, value) as Promise<unknown>;
    },
  });
  try {
    await assert.rejects(saver.putWrites(config, [["first", "late"], ["second", "failure"]], "failed-task"), /serializer failed/);
    assert.equal(count(store, "artifact_streams"), 0);
    release.resolve();
    await finished.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(count(store, "writes"), 0);
    assert.equal(count(store, "artifact_streams"), 0);
    // A separate successful batch must retain its own accounting and contents.
    await saver.putWrites(config, [["third", "accepted"]], "successful-task");
    assert.equal(count(store, "writes"), 1);
    assert.equal(count(store, "artifact_streams"), 0);
  } finally {
    release.resolve();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
