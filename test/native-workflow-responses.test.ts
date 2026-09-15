import { z } from "zod";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../src/core/store.js";
import { WorkflowEngine } from "../src/core/workflows.js";
import { Runtime } from "../src/services/runtime.js";
import { tools } from "../src/core/contracts.js";
import { WorkflowResponses } from "../src/services/workflow-response.js";
import { recoveryAdvice, recoverySchema } from "../src/core/recovery.js";

test("wait observes completion through queued/running transitions and leaves timed-out work running", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-wait-"));
  const store = new StateStore(root),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let effects = 0;
  const engine = new WorkflowEngine(
    store,
    [
      {
        id: "wait",
        description: "test",
        capabilities: [],
        completion: "executed once",
        resources: () => [],
        steps: [
          {
            id: "execute",
            kind: "effect",
            async execute() {
              effects++;
              entered.resolve();
              await release.promise;
              return { done: true };
            },
          },
        ],
      },
    ],
    async () => {},
  );
  try {
    const run = engine.start("wait", { parameters: {} }, "same-intent");
    const waiting = engine.status(run.run_id, 2000);
    await entered.promise;
    const timed = await engine.status(run.run_id, 10);
    assert.equal(timed.status, "running");
    assert.equal(
      engine.start("wait", { parameters: {} }, "same-intent").run_id,
      run.run_id,
    );
    release.resolve();
    assert.equal((await waiting).status, "succeeded");
    assert.equal(effects, 1);
  } finally {
    release.resolve();
    await engine.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("summary stays bounded and preserves full multi-module results through versioned pages without new artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-summary-")),
    store = new StateStore(root);
  try {
    const run = store.create("project_build", {
      parameters: { project_path: "/fixture" },
    }).run;
    const value = {
      build: {
        modules: Array.from({ length: 40 }, (_, i) => ({
          name: `module${i}`,
          package: `/out/${i}.hap`,
          log: "日志".repeat(3000),
        })),
      },
    };
    store.update(run.id, "succeeded", value);
    for (let i = 0; i < 12; i++)
      store.artifact(run.id, `module-${i}`, "application/octet-stream");
    store.event(run.id, "node_finish", { node: "verify_artifacts" });
    const presenter = new WorkflowResponses(
      store,
      () => "Compilation and package verification completed.",
    );
    const summary = presenter.present(store.get(run.id));
    assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 12000);
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.phase, "verify_artifacts");
    assert.equal(summary.result_truncated, true);
    assert.equal(summary.artifacts.total, 12);
    assert.equal(summary.artifacts.truncated, true);
    const chunks: Buffer[] = [];
    let offset = 0,
      hash: string | undefined;
    do {
      const page = presenter.read(run.id, "result", offset, 4001, hash);
      chunks.push(Buffer.from(page.data, "base64"));
      hash = page.sha256;
      if (page.next_offset === null) break;
      offset = page.next_offset;
    } while (true);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), value);
    assert.deepEqual(
      presenter.present(store.get(run.id), "full").result,
      value,
    );
    assert.throws(() => presenter.read(run.id, "result", 1), {
      code: "RESULT_VERSION_REQUIRED",
    });
    // A running result can advance between pages; simulate that persisted update.
    store.db
      .prepare("UPDATE runs SET result=? WHERE id=?")
      .run(JSON.stringify({ changed: true }), run.id);
    assert.throws(() => presenter.read(run.id, "result", 4001, 4001, hash), {
      code: "RESULT_CHANGED",
    });
    const artifacts = presenter.read(run.id, "artifacts");
    assert.equal(
      JSON.parse(Buffer.from(artifacts.data, "base64").toString()).length,
      12,
    );
    assert.equal(
      (
        store.db.prepare("SELECT count(*) AS count FROM artifacts").get() as {
          count: number;
        }
      ).count,
      12,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failure summaries retain native exit information and events paginate without skips", () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-failure-summary-"),
    ),
    store = new StateStore(root);
  try {
    const run = store.create("project_build", { parameters: {} }).run;
    store.update(run.id, "failed", undefined, {
      code: "PROCESS_FAILED",
      message: "Tool exited with 23",
      retryable: false,
      details: {
        exitCode: 23,
        exitSignal: null,
        truncated: true,
        stdout: "long".repeat(10000),
        stderr_artifact: store.artifact(run.id, "real stderr"),
      },
    });
    const presenter = new WorkflowResponses(
      store,
      () => "Build completed only if compilation succeeds.",
    );
    const summary = presenter.present(store.get(run.id));
    assert.equal(summary.error?.code, "PROCESS_FAILED");
    assert.equal((summary.error as Record<string, unknown>).exitCode, 23);
    assert.equal(summary.recovery?.automatic_retry, false);
    assert.equal(summary.recovery?.new_run_required, true);
    for (let i = 0; i < 11; i++)
      store.event(run.id, "sample", { index: i, text: "日志".repeat(1900) });
    let offset = 0;
    const indices: number[] = [];
    do {
      const page = presenter.events(run.id, offset, 100);
      indices.push(
        ...page.events
          .filter((event) => event.kind === "sample")
          .map((event) => (event.data as { index: number }).index),
      );
      offset = page.cursor;
      if (!page.has_more) break;
    } while (true);
    assert.deepEqual(
      indices,
      Array.from({ length: 11 }, (_, i) => i),
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery calls use valid schemas and uncertain effects only recheck their original run", () => {
  const run_id = "aa2856e5-452d-411d-9634-baa4e28bdf7d";
  for (const [code, status] of [
    ["EFFECT_UNCERTAIN", "needs_input"],
    ["RUNTIME_STOPPING", "interrupted"],
    ["BUILD_CHECK_BLOCKED", "failed"],
    ["DEVICE_AMBIGUOUS", undefined],
    ["SDK_VERSION_UNAVAILABLE", undefined],
    ["INVALID_ARGUMENT", undefined],
  ]) {
    const advice = recoverySchema.parse(
      recoveryAdvice(code!, { workflow: "project_build", run_id, status }),
    );
    for (const next of advice.next) {
      const { tool, ...input } = next;
      assert.equal(
        tools[tool as keyof typeof tools].schema.safeParse(input).success,
        true,
        JSON.stringify(next),
      );
    }
    if (status === "needs_input") {
      assert.equal(advice.new_run_required, undefined);
      assert.ok(
        advice.next.some(
          (next) => next.run_id === run_id && next.action === "resume",
        ),
      );
    }
  }
  for (const input of [
    { action: "read_result", run_id, offset: 1 },
    { action: "read_events", run_id, limit: 101 },
    { action: "status", run_id, section: "input" },
  ])
    assert.equal(tools.workflow_run.schema.safeParse(input).success, false);
});

test("aborting an observer detaches it; explicit cancellation still stops the durable execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-wait-cancel-")),
    store = new StateStore(root);
  const entered = Promise.withResolvers<void>();
  let stopped = false;
  const engine = new WorkflowEngine(
    store,
    [
      {
        id: "cancel",
        description: "test",
        capabilities: [],
        completion: "cancelled",
        resources: () => [],
        steps: [
          {
            id: "read",
            kind: "read",
            async execute({ signal }) {
              entered.resolve();
              try {
                await delay(30000, undefined, { signal });
              } finally {
                stopped = true;
              }
              return {};
            },
          },
        ],
      },
    ],
    async () => {},
  );
  try {
    const run = engine.start("cancel", { parameters: {} });
    await entered.promise;
    const controller = new AbortController(),
      waiting = engine.status(run.run_id, 2000, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: "AbortError" });
    assert.equal(stopped, false);
    assert.equal((await engine.status(run.run_id)).status, "running");
    await engine.cancel(run.run_id);
    assert.equal((await engine.status(run.run_id, 2000)).status, "cancelled");
    assert.equal(stopped, true);
  } finally {
    await engine.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public start returns a completed offline diagnosis and a retry returns the same completed run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-start-wait-")),
    prior = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime();
  try {
    const request = {
      action: "start",
      workflow: "crash_diagnose",
      request_key: "diagnosis",
      wait_ms: 2000,
      input: {
        log_text:
          "Process name: com.example.test\nTypeError: object is not callable\n    at Index (entry/src/main/ets/pages/Index.ets:12:3)\n",
      },
    };
    const first = (await runtime.call("workflow_run", request)) as {
      run_id: string;
      status: string;
      result: unknown;
      deduplicated: boolean;
    };
    assert.equal(first.status, "succeeded", JSON.stringify(first));
    assert.ok(first.result);
    assert.equal(first.deduplicated, false);
    const second = (await runtime.call(
      "workflow_run",
      request,
    )) as typeof first;
    assert.equal(second.run_id, first.run_id);
    assert.equal(second.status, "succeeded");
    assert.equal(second.deduplicated, true);
    assert.equal(runtime.store.runCount(), 1);
    assert.equal(
      z.object({ wait_ms: z.number() }).parse(tools.workflow_run.schema.parse({
        action: "status",
        run_id: first.run_id,
      })).wait_ms,
      1000,
    );
    await assert.rejects(
      runtime.call("workflow_run", {
        ...request,
        input: { log_text: "changed" },
      }),
      { code: "REQUEST_KEY_CONFLICT" },
    );
  } finally {
    await runtime.close();
    if (prior === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
