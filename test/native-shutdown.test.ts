import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { WorkerClient } from "../src/core/worker-client.js";
import { Runtime } from "../src/services/runtime.js";
import { WorkflowEngine } from "../src/core/workflows.js";
import { ToolError } from "../src/core/errors.js";

test(
  "concurrent restart joins one close and waits for the real runtime worker to exit",
  { timeout: 20000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-worker-close-")),
      oldState = process.env.DEVECO_STATE_DIR,
      failures: Error[] = [],
      client = new WorkerClient((error) => failures.push(error));
    process.env.DEVECO_STATE_DIR = root;
    try {
      await client.call("workflow_run", { action: "list" });
      const first = client.close();
      assert.equal(first, client.close());
      await assert.rejects(client.call("workflow_run", { action: "list" }), {
        code: "RUNTIME_STOPPING",
      });
      assert.deepEqual(await first, { closed: true });
      await client.call("workflow_run", { action: "list" });
      assert.deepEqual(await client.close(), { closed: true });
      assert.deepEqual(failures, []);
    } finally {
      await client.close();
      if (oldState === undefined) delete process.env.DEVECO_STATE_DIR;
      else process.env.DEVECO_STATE_DIR = oldState;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "a failed cleanup reply cannot admit new requests or a replacement worker before actual exit",
  { timeout: 10000 },
  async () => {
    const workers: Worker[] = [],
      failures: Error[] = [];
    const client = new WorkerClient(
      (error) => failures.push(error),
      () => {
        const worker = new Worker(
          new URL("fixtures/close-worker.js", import.meta.url),
          {
            stdout: true,
            stderr: true,
            workerData: { fail: workers.length === 0 },
          },
        );
        workers.push(worker);
        return worker;
      },
    );
    try {
      await client.call("deveco_doctor", {});
      const first = client.close();
      await assert.rejects(first, { code: "CANCEL_UNCONFIRMED" });
      assert.equal(first, client.close());
      await assert.rejects(client.call("deveco_doctor", {}), {
        code: "RUNTIME_STOPPING",
      });
      assert.equal(workers.length, 1);
      const exited = once(workers[0]!, "exit");
      workers[0]!.postMessage({ release: true });
      await exited;
      await client.call("deveco_doctor", {});
      assert.equal(workers.length, 2);
      assert.deepEqual(await client.close(), { closed: true });
      assert.deepEqual(failures, []);
    } finally {
      // These protocol fixtures own no SDK children.
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  },
);

test(
  "runtime shutdown continues after engine and document cleanup failures, joins callers and closes owned processes and storage",
  { timeout: 15000 },
  async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "deveco-runtime-close-"),
      ),
      oldState = process.env.DEVECO_STATE_DIR;
    process.env.DEVECO_STATE_DIR = root;
    const runtime = new Runtime();
    try {
      await runtime.call("workflow_run", { action: "list" });
      const engine = t.mock.method(
        WorkflowEngine.prototype,
        "close",
        async () => {
          throw new ToolError(
            "ENGINE_CLOSE_FIXTURE",
            "Injected engine failure",
          );
        },
      );
      const docs = t.mock.method(runtime.knowledge, "close", () => {
        throw new ToolError("DOC_CLOSE_FIXTURE", "Injected document failure");
      });
      const ready = Promise.withResolvers<void>();
      const child = runtime.processes
        .run(
          {
            executable: process.execPath,
            args: [
              "-e",
              "process.stdout.write('ready');setInterval(()=>{},1000)",
            ],
          },
          { onOutput: () => ready.resolve() },
        )
        .then(
          () => undefined,
          () => undefined,
        );
      await ready.promise;
      const first = runtime.close();
      assert.equal(first, runtime.close());
      await assert.rejects(first, (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, "CANCEL_UNCONFIRMED");
        assert.match(JSON.stringify(error.details), /ENGINE_CLOSE_FIXTURE/);
        assert.match(JSON.stringify(error.details), /DOC_CLOSE_FIXTURE/);
        return true;
      });
      await child;
      assert.equal(runtime.processes.size, 0);
      assert.equal(runtime.store.db.open, false);
      assert.equal(engine.mock.callCount(), 1);
      assert.equal(docs.mock.callCount(), 1);
      assert.equal(first, runtime.close());
      await assert.rejects(runtime.call("workflow_run", { action: "list" }), {
        code: "RUNTIME_STOPPING",
      });
    } finally {
      await runtime.close().catch(() => undefined);
      if (oldState === undefined) delete process.env.DEVECO_STATE_DIR;
      else process.env.DEVECO_STATE_DIR = oldState;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
