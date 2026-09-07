import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWrite, privateDirectory } from "../src/core/files.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { withTrace } from "../src/core/trace.js";
import { ToolError } from "../src/core/errors.js";
import { BuildDiagnostics } from "../src/core/build-diagnostics.js";

const temporary = () =>
  fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-infrastructure-")),
  );
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < end, "Timed out");
    await delay(20);
  }
}
const code = (expected: string) => (error: unknown) =>
  error instanceof ToolError && error.code === expected;

test("atomic output accepts an aliased parent while private state rejects a symlink", () => {
  const root = temporary();
  try {
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync(
      path.join(root, "real"),
      path.join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    atomicWrite(path.join(root, "alias", "result.json"), "first");
    atomicWrite(path.join(root, "alias", "result.json"), "second");
    assert.equal(
      fs.readFileSync(path.join(root, "real", "result.json"), "utf8"),
      "second",
    );
    assert.throws(
      () => privateDirectory(path.join(root, "alias")),
      code("UNSAFE_STATE_PATH"),
    );
    assert.deepEqual(fs.readdirSync(path.join(root, "real")), ["result.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("full process logs survive response truncation and correlate request/run/node/process", async () => {
  const root = temporary(),
    store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store));
  try {
    const result = await withTrace(
      { request_id: "request", run_id: "run", node: "build" },
      () =>
        processes.run(
          {
            executable: process.execPath,
            args: [
              "-e",
              "process.stdout.write('前面错误🙂\\n'+'z'.repeat(200000))",
            ],
          },
          { limitBytes: 1024 },
        ),
    );
    assert.equal(result.truncated, true);
    assert.doesNotMatch(result.stdout, /前面错误/);
    const reference = result.log as { artifact_id: string; bytes: number };
    assert.equal(reference.bytes, Buffer.byteLength("前面错误🙂\n") + 200000);
    assert.match(
      Buffer.from(
        store.readArtifact(reference.artifact_id).data,
        "base64",
      ).toString(),
      /^前面错误🙂/,
    );
    const events = store.db
      .prepare("SELECT data FROM events WHERE kind='process_finish'")
      .all() as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(
          JSON.parse(events[0]!.data) as Record<string, unknown>,
        ).filter(([key]) => ["request_id", "run_id", "node"].includes(key)),
      ),
      { request_id: "request", run_id: "run", node: "build" },
    );
    assert.equal(
      (
        store.db
          .prepare(
            "SELECT COUNT(*) AS count FROM managed_processes WHERE status<>'exited'",
          )
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sensitive subprocess output stays in memory and does not enter artifacts or telemetry", async () => {
  const root = temporary(),
    store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store));
  try {
    const secret = "want-private-value-1372";
    const result = await processes.run({
      executable: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(secret)})`],
      sensitive: true,
    });
    assert.equal(result.stdout, secret);
    assert.equal(result.log, undefined);
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as {
          count: number;
        }
      ).count,
      0,
    );
    const events = store.db.prepare("SELECT data FROM events").all();
    assert.ok(!JSON.stringify(events).includes(secret));
  } finally {
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("log capacity stops the producer, publishes written bytes and clears reservations", async () => {
  const root = temporary(),
    store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store)),
    previous = process.env.DEVECO_CONFIG;
  try {
    const config = path.join(root, "config.json");
    fs.writeFileSync(config, JSON.stringify({ max_bytes: 2 * 1024 * 1024 }));
    process.env.DEVECO_CONFIG = config;
    await assert.rejects(
      processes.run({
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(8*1024*1024));setInterval(()=>{},1000)",
        ],
      }),
      code("STATE_CAPACITY"),
    );
    assert.equal(processes.size, 0);
    assert.equal(
      (
        store.db
          .prepare("SELECT COUNT(*) AS count FROM artifact_streams")
          .get() as { count: number }
      ).count,
      0,
    );
    const logs = store.db.prepare("SELECT bytes,file FROM artifacts").all() as {
      bytes: number;
      file: string;
    }[];
    assert.equal(logs.length, 1);
    assert.ok(logs[0]!.bytes > 0);
    assert.ok(logs[0]!.bytes < 2 * 1024 * 1024);
    assert.equal(logs[0]!.bytes, fs.statSync(logs[0]!.file).size);
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a crashed log owner publishes incomplete actual bytes on restart", async () => {
  const root = temporary(),
    processes = new ProcessService();
  let store: StateStore | undefined;
  try {
    const child = processes.spawn({
      executable: process.execPath,
      args: [
        fileURLToPath(
          new URL("./fixtures/native-state-peer.js", import.meta.url),
        ),
        root,
        "stream",
      ],
    });
    child.stdout?.resume();
    child.stderr?.resume();
    await until(() => fs.existsSync(path.join(root, "ready")));
    await processes.terminate(child);
    store = new StateStore(root);
    const rows = store.db
      .prepare("SELECT id,bytes,mime FROM artifacts")
      .all() as { id: string; bytes: number; mime: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.bytes, 7);
    assert.match(rows[0]!.mime, /incomplete=true/);
    assert.equal(
      Buffer.from(store.readArtifact(rows[0]!.id).data, "base64").toString(),
      "partial",
    );
    assert.equal(
      store.db.prepare("SELECT * FROM artifact_streams").all().length,
      0,
    );
  } finally {
    await processes.close();
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a surviving native child blocks resource reuse after its MCP owner dies", async () => {
  const root = temporary(),
    processes = new ProcessService();
  let orphan: number | undefined, store: StateStore | undefined;
  try {
    const owner = processes.spawn({
      executable: process.execPath,
      args: [
        fileURLToPath(
          new URL("./fixtures/native-state-peer.js", import.meta.url),
        ),
        root,
        "orphan",
      ],
    });
    owner.stdout?.resume();
    owner.stderr?.resume();
    await until(() => fs.existsSync(path.join(root, "ready")));
    orphan = Number(fs.readFileSync(path.join(root, "orphan"), "utf8"));
    // Model abrupt MCP death on every platform. Managed cancellation would
    // intentionally kill descendants on Windows and exercise a different case.
    const closed = once(owner, "close");
    owner.kill("SIGKILL");
    await closed;
    process.kill(orphan, 0);
    store = new StateStore(root);
    await assert.rejects(
      store.lease("project:shared", async () => null),
      code("RESOURCE_RECOVERY_REQUIRED"),
    );
    process.kill(process.platform === "win32" ? orphan : -orphan, "SIGTERM");
    await until(() => {
      try {
        process.kill(orphan!, 0);
        return false;
      } catch {
        return true;
      }
    });
    orphan = undefined;
    assert.equal(
      await store.lease("project:shared", async () => "acquired"),
      "acquired",
    );
  } finally {
    if (orphan)
      try {
        process.kill(
          process.platform === "win32" ? orphan : -orphan,
          "SIGKILL",
        );
      } catch {}
    await processes.close();
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("build diagnostics preserve UTF-8, early errors and category budgets", () => {
  const tracker = new BuildDiagnostics();
  for (const byte of Buffer.from(
    "\x1b[33mArkTS:WARN File: /项目/Test.ets:7:8\x1b[0m\nThis API is provided since API version 26, compatible SDK version is 23.\n",
  ))
    tracker.push("stdout", Buffer.from([byte]));
  tracker.push("stdout", Buffer.from("deprecated API\n".repeat(2000)));
  tracker.push(
    "stderr",
    Buffer.from(
      "Error Message: Cannot find name 'woc'. At File: /app/Border.ets:456:9\n/app/native.cpp:198:63: error: undeclared name\nsourceMaps.json not found\n[commonjs--resolver] duplicate export\n",
    ),
  );
  tracker.push("stdout", Buffer.from("x".repeat(300000)));
  const result = tracker.finish();
  assert.equal(result.counts.deprecatedApi, 2000);
  assert.equal(result.counts.compilerError, 2);
  assert.equal(result.counts.sdkCompatibility, 1);
  assert.equal(result.examples[0]?.location, "/app/Border.ets:456:9");
  assert.equal(result.examples[1]?.location, "/app/native.cpp:198:63");
  assert.match(
    result.examples.find((item) => item.category === "sdkCompatibility")!
      .location!,
    /项目\/Test.ets:7:8/,
  );
  assert.equal(
    result.examples.filter((item) => item.category === "deprecatedApi").length,
    1,
  );
  assert.ok(result.examples.length <= 10);
});

test("standalone build warnings never inherit an unrelated source location", () => {
  const tracker = new BuildDiagnostics();
  tracker.push(
    "stdout",
    Buffer.from(
      "ArkTS:WARN File: /app/Foo.ets:7:8\nFunction may throw exceptions.\nArkTS:WARN Property 'sourceMapsPath' not found in 'dependency'.\n",
    ),
  );
  assert.equal(tracker.finish().examples[0]?.location, null);
});
