import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { CpuPool } from "../src/core/cpu-pool.js";
import { digest } from "../src/core/files.js";
import { parseUiDump } from "../src/services/ui-parse.js";
import { parseCrash } from "../src/services/crash.js";

function tree(count = 1000) {
  return JSON.stringify({
    attributes: {
      type: "WindowScene",
      id: "window",
      bundleName: "com.test",
      displayId: 2,
      bounds: "[0,0][1080,2400]",
    },
    children: Array.from({ length: count }, (_, i) => ({
      $ID: i,
      attributes: {
        type: i % 2 ? "Button" : "Text",
        key: `key-${i}`,
        text: `测试🙂-${i}`,
        bounds: "[10,20][30,40]",
        checked: i % 2 === 0,
        selected: true,
        value: i,
      },
    })),
  });
}
const log =
  "ordinary log line\n".repeat(16000) +
  "\nBundle name: com.test\nError name: TypeError\nError message: fixture\nat main (entry.ets:12:3)\n";

test("UI streaming signatures preserve canonical values and structural exclusions", () => {
  const parsed = parseUiDump(tree()),
    stable = parsed.nodes.map(({ id: _id, ...node }) => node);
  assert.equal(parsed.signature, digest(stable));
  assert.equal(
    parsed.structureSignature,
    digest(
      stable.map(
        ({
          text: _text,
          value: _value,
          checked: _checked,
          selected: _selected,
          ...node
        }) => node,
      ),
    ),
  );
  const changed = parseUiDump(
    tree().replaceAll("测试🙂", "changed").replaceAll('"value":', '"ignored":'),
  );
  assert.notEqual(parsed.signature, changed.signature);
  assert.equal(parsed.structureSignature, changed.structureSignature);
});

test("bounded parser workers match local results, reuse threads and preserve task observation context", async () => {
  const context = new AsyncLocalStorage<string>(),
    observed: (string | undefined)[] = [];
  const pool = new CpuPool({ workers: 1, idleMs: 100 }, () =>
    observed.push(context.getStore()),
  );
  try {
    assert.equal(
      pool.metrics.workers,
      0,
      "Construction must not load a parser thread",
    );
    const content = tree();
    const value = await context.run("request-ui", () =>
      pool.run({ kind: "ui", content }),
    );
    assert.deepEqual(value, parseUiDump(content));
    const options = { bundle_name: "com.test" };
    assert.deepEqual(
      await context.run("request-crash", () =>
        pool.run({ kind: "crash", content: log, options }),
      ),
      parseCrash(log, options),
    );
    await assert.rejects(pool.run({ kind: "ui", content: "{" }), /JSON/);
    assert.equal((await pool.run({ kind: "ui", content })).nodes.length, 1001);
    assert.equal(
      pool.metrics.spawned,
      1,
      "Bad input must not poison a healthy worker",
    );
    assert.deepEqual(observed.slice(0, 2), ["request-ui", "request-crash"]);
    for (let i = 0; i < 100 && pool.metrics.workers; i++) await delay(20);
    assert.equal(pool.metrics.workers, 0, "Idle worker must actually exit");
    assert.equal(pool.metrics.input_bytes, 0);
    assert.equal(pool.metrics.queued, 0);
  } finally {
    await pool.close();
  }
});

test("parser queue and input budgets reject overload without allocating extra workers", async () => {
  const pool = new CpuPool({ workers: 1, queue: 1 });
  try {
    const active = pool.run({ kind: "ui", content: tree(15000) });
    const queued = pool.run({ kind: "crash", content: log });
    const rejected = assert.rejects(pool.run({ kind: "ui", content: "{}" }), {
      code: "CPU_QUEUE_CAPACITY",
    });
    assert.equal(pool.metrics.workers, 1);
    assert.equal(pool.metrics.queued, 1);
    await Promise.all([active, queued, rejected]);
    assert.equal(pool.metrics.active, 0);
    assert.equal(pool.metrics.input_bytes, 0);
  } finally {
    await pool.close();
  }
  const limited = new CpuPool({ bytes: 8192 });
  try {
    await assert.rejects(
      limited.run({ kind: "crash", content: "测".repeat(3000) }),
      { code: "CPU_MEMORY_CAPACITY" },
    );
    assert.equal(limited.metrics.workers, 0);
  } finally {
    await limited.close();
  }
});

test("cancelling queued parsing preserves active work; active cancellation confirms exit before rejecting", async () => {
  const pool = new CpuPool({ workers: 1 }),
    queuedAbort = new AbortController(),
    activeAbort = new AbortController();
  try {
    const active = pool.run({ kind: "ui", content: tree(15000) });
    const queued = pool.run(
      { kind: "crash", content: log },
      queuedAbort.signal,
    );
    const rejected = assert.rejects(queued, { name: "AbortError" });
    queuedAbort.abort();
    await rejected;
    assert.equal(pool.metrics.queued, 0);
    await active;
    const busy = pool.run(
      { kind: "ui", content: tree(30000) },
      activeAbort.signal,
    );
    const cancelled = assert.rejects(busy, { name: "AbortError" });
    await delay(0);
    activeAbort.abort();
    await cancelled;
    assert.equal(pool.metrics.workers, 0);
    assert.equal(pool.metrics.active, 0);
    assert.equal(pool.metrics.input_bytes, 0);
    assert.equal(
      (await pool.run({ kind: "ui", content: "{}" })).nodes.length,
      1,
    );
    assert.equal(pool.metrics.spawned, 2);
  } finally {
    await pool.close();
  }
});

test("parser shutdown and deadlines join every thread and release queued inputs", async () => {
  const pool = new CpuPool({ workers: 1 });
  const active = assert.rejects(
    pool.run({ kind: "ui", content: tree(10000) }),
    { code: "RUNTIME_STOPPING" },
  );
  const queued = assert.rejects(pool.run({ kind: "crash", content: log }), {
    code: "RUNTIME_STOPPING",
  });
  await Promise.all([pool.close(), active, queued]);
  await pool.close();
  assert.equal(pool.metrics.workers, 0);
  assert.equal(pool.metrics.queued, 0);
  assert.equal(pool.metrics.input_bytes, 0);
  await assert.rejects(pool.run({ kind: "ui", content: "{}" }), {
    code: "RUNTIME_STOPPING",
  });
  const timed = new CpuPool({ timeoutMs: 1 });
  try {
    await assert.rejects(timed.run({ kind: "ui", content: tree(10000) }), {
      code: "CPU_TIMEOUT",
    });
    assert.equal(timed.metrics.workers, 0);
    assert.equal(timed.metrics.input_bytes, 0);
  } finally {
    await timed.close();
  }
});

test("large parser work leaves the runtime event loop responsive", async () => {
  const pool = new CpuPool({ workers: 1 });
  try {
    await pool.run({ kind: "ui", content: "{}" });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 2);
    try {
      const result = await pool.run({ kind: "ui", content: tree(30000) });
      assert.equal(result.nodes.length, 30001);
      assert.ok(
        ticks > 0,
        "Status/cancellation callbacks must run during heavy parsing",
      );
    } finally {
      clearInterval(timer);
    }
  } finally {
    await pool.close();
  }
});

test("device snapshots use the parser pool for large trees and release bounded caches on invalidation/close", async (t) => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const { DeviceService } = await import("../src/services/device.js"),
    { StateStore } = await import("../src/core/store.js"),
    { ProcessService } = await import("../src/core/process.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-cpu-device-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    pool = new CpuPool(),
    device = new DeviceService(processes, store, pool);
  const receipt = {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    truncated: false,
    elapsedMs: 0,
    pid: null,
  };
  let content = tree(1500);
  t.mock.method(device, "shell", async () => receipt);
  t.mock.method(device, "command", async (args: string[]) => {
    fs.writeFileSync(args.at(-1)!, content);
    return receipt;
  });
  try {
    const first = await device.snapshot("test");
    assert.deepEqual(first.nodes, parseUiDump(content).nodes);
    assert.equal(pool.metrics.completed, 1);
    assert.equal(device.cacheMetrics.snapshots, 1);
    const found = await device.find("test", { key: "key-4" }, first.id);
    assert.equal(found.matchCount, 1);
    device.invalidate("test");
    assert.equal(device.cacheMetrics.estimated_bytes, 0);
    await assert.rejects(device.find("test", { key: "key-4" }, first.id), {
      code: "SNAPSHOT_EXPIRED",
    });
    content = "{}";
    for (let i = 0; i < 10; i++) await device.snapshot("test");
    assert.equal(device.cacheMetrics.snapshots, 8);
    assert.equal(
      pool.metrics.completed,
      1,
      "Small snapshots bypass worker overhead",
    );
    device.close();
    assert.equal(device.cacheMetrics.snapshots, 0);
    assert.equal(device.cacheMetrics.estimated_bytes, 0);
  } finally {
    device.close();
    await pool.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
