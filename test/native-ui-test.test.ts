import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Worker } from "node:worker_threads";
import { WorkerClient } from "../src/core/worker-client.js";
import { Runtime } from "../src/services/runtime.js";
import { UiIndex } from "../src/services/device.js";
import { parseUiDump } from "../src/services/ui-parse.js";
import { imageDimensions } from "../src/services/screenshot.js";
import { currentTrace } from "../src/core/trace.js";
import { ToolError } from "../src/core/errors.js";
import { assertionSchema, tools } from "../src/core/contracts.js";
import { readImageArtifact } from "../src/services/artifact.js";

const png = fs.readFileSync(
  new URL(
    "../../test/fixtures/harmony-app/AppScope/resources/base/media/foreground.png",
    import.meta.url,
  ),
);
const dimensions = imageDimensions(
    png.subarray(0, 65536),
    png.subarray(-12),
    "png",
  ),
  sha256 = createHash("sha256").update(png).digest("hex");
const app = { bundle_name: "com.test.canary", ability: "EntryAbility" };
const summarySchema = z
  .object({
    test_id: z.string(),
    status: z.string(),
    verified: z.boolean(),
    blocked: z.string().nullable(),
    action_count: z.number(),
    steps: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        check: z
          .object({
            review_id: z.string().optional(),
            assertion_passed: z.boolean(),
          })
          .nullable(),
      }),
    ),
  })
  .passthrough();
const operation = { action: "click", selector: { key: "submit" } };
async function completeReplan(runtime: Runtime, id: string) {
  const reviewId = runtime.tests.status(id).replan_review_id!;
  const review = runtime.reviews.status(reviewId),
    image = readImageArtifact(runtime.store, review.artifact_id);
  await runtime.call("ui_review", {
    action: "complete",
    review_id: reviewId,
    artifact_id: image.artifact_id,
    sha256: image.sha256,
    read_token: image.review_reads!.find((read) => read.review_id === reviewId)!
      .read_token,
    assessment: {
      outcome: "passed",
      observations:
        "Fixture inspection: the app is still waiting on the same page; Back can leave this state without repeating the earlier click.",
    },
  });
}
async function fixture(
  task: (h: {
    runtime: Runtime;
    calls: string[];
    setText: (value: string) => void;
    reopen: () => Promise<Runtime>;
  }) => Promise<void>,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-ui-test-")),
    previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  let runtime = new Runtime(),
    text = "Waiting",
    clockNanos = BigInt(Date.now()) * 1_000_000n;
  const calls: string[] = [];
  const configure = () => {
    runtime.devices.target = async () => "fixture";
    runtime.devices.shell = async (_target, args) => {
      if (args[0] === "date") clockNanos += 1_000_000n;
      const epoch = `${clockNanos / 1_000_000_000n}.${String(clockNanos % 1_000_000_000n).padStart(9, "0")}`;
      return {
        exitCode: 0,
        stdout:
          args[0] === "date"
            ? epoch
            : args[0] === "pidof"
              ? "42"
              : `${epoch} 42 42 I [VCODER_DEBUG] 完成测试\n${epoch} 99 99 I Other app is excluded\n`,
        stderr: "",
        truncated: false,
        elapsedMs: 0,
        signal: null,
        pid: null,
      };
    };
    runtime.devices.snapshot = async () => {
      const parsed = parseUiDump(
        JSON.stringify({
          attributes: {
            type: "WindowScene",
            id: "window",
            bundleName: app.bundle_name,
            displayId: 0,
            bounds: "[0,0][500,1000]",
          },
          children: [
            {
              attributes: {
                type: "Button",
                id: "submit",
                key: "submit",
                text,
                bounds: "[100,100][200,200]",
                enabled: true,
              },
            },
          ],
        }),
      );
      return {
        ...parsed,
        id: randomUUID(),
        device: "fixture",
        created: Date.now(),
        query: new UiIndex(parsed.nodes),
      };
    };
    runtime.devices.screenshot = async (_target, _input, signal) => {
      signal?.throwIfAborted();
      calls.push("capture");
      assert.ok(currentTrace().run_id);
      const stream = runtime.store.streamArtifact(
        currentTrace().run_id!,
        "image/png",
      );
      stream.reserve(png.length);
      fs.writeFileSync(stream.file, png);
      return {
        target: "fixture",
        display_id: 0,
        format: "png",
        mime: "image/png",
        bytes: png.length,
        ...dimensions,
        native_width: dimensions.width,
        native_height: dimensions.height,
        coordinate_scale: { x: 1, y: 1 },
        sha256,
        frame_signature: randomUUID(), // A changing system area must not reset application progress.
        progress_signature: sha256,
        unchanged: false,
        artifact: stream.finish(),
      };
    };
    runtime.devices.control = async (_target, _operation, signal) => {
      signal?.throwIfAborted();
      calls.push("control");
      return { action: "click", commandAccepted: true, outcomeVerified: false };
    };
    runtime.devices.verify = async (_target, input) => {
      calls.push("verify");
      const expected = assertionSchema.parse(input);
      if (expected.visible?.text && expected.visible.text !== text)
        throw new ToolError("VERIFICATION_FAILED", "Expected text is missing");
      return {
        verified: true,
        snapshot_id: randomUUID(),
        signature: "fixture",
        structureSignature: "fixture",
        nodeCount: 2,
        matchCount: 1,
        matches: [],
      };
    };
    runtime.devices.stopApplication = async () => {
      calls.push("stop");
      return { stopped: true };
    };
    runtime.devices.launch = async () => {
      calls.push("launch");
      return {
        started: true,
        bundle_name: app.bundle_name,
        processVerified: true,
        outcomeVerified: false,
        target: "fixture",
      };
    };
  };
  configure();
  const handle = {
    runtime,
    calls,
    setText: (value: string) => {
      text = value;
    },
    reopen: async () => {
      await runtime.close();
      runtime = new Runtime();
      configure();
      handle.runtime = runtime;
      return runtime;
    },
  };
  try {
    await task(handle);
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const start = async (runtime: Runtime, extra: Record<string, unknown> = {}) =>
  summarySchema.parse(
    await runtime.call("ui_test", {
      action: "start",
      test_plan: "Open the result and verify Done fits its button.",
      app,
      steps: [
        {
          id: "result",
          goal: "Show the completed result",
          assert: { visible: { text: "Done" } },
          review: { requirement: "The Done label fits inside the button" },
        },
      ],
      ...extra,
    }),
  );

test("a worker restarted above quota can cancel a paused test and release its device without losing retained evidence", async () => {
  await fixture(async (h) => {
    const initial = await start(h.runtime),
      id = initial.test_id;
    const host = z.object({ run_id: z.string(), revision: z.number() }).parse(
      h.runtime.skillWorkflows.call({
        action: "start",
        kind: "debug",
        project_path: h.runtime.store.root,
        objective: "Cancel safely when storage is full",
      }),
    );
    h.runtime.skillWorkflows.call({
      action: "write",
      run_id: host.run_id,
      expected_revision: host.revision,
      name: "notes.md",
      content: "验证".repeat(20000),
    });
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    h.runtime.store.artifact(id, Buffer.alloc(8 * 1024 * 1024, 3));
    const config = path.join(h.runtime.store.root, "quota-fixture.json");
    fs.writeFileSync(config, JSON.stringify({ max_bytes: 4 * 1024 * 1024 }));
    const client = new WorkerClient(
      () => {},
      () =>
        new Worker(new URL("../src/worker.js", import.meta.url), {
          stdout: true,
          stderr: true,
          env: {
            ...process.env,
            DEVECO_STATE_DIR: h.runtime.store.root,
            DEVECO_CONFIG: config,
          },
        }),
    );
    try {
      const result = z
        .object({ status: z.literal("cancelled"), verified: z.literal(false) })
        .parse(await client.call("ui_test", { action: "cancel", test_id: id }));
      assert.equal(result.status, "cancelled");
      h.runtime.tests.assertTaskTarget("fixture");
      assert.ok(
        (
          h.runtime.store.db
            .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE run_id=?")
            .get(id) as { n: number }
        ).n > 0,
      );
      assert.equal(h.runtime.store.get(id).owner, null);
      const retry = await client.call("workflow_run", {
        action: "cancel",
        run_id: id,
      });
      assert.equal(
        z.object({ status: z.string() }).parse(retry).status,
        "cancelled",
      );
      const hostCancelled = await client.call("workflow_run", {
        action: "cancel",
        run_id: host.run_id,
      });
      assert.equal(
        z.object({ status: z.string() }).parse(hostCancelled).status,
        "cancelled",
      );
      assert.equal(
        h.runtime.skillWorkflows.read(host.run_id).documents["notes.md"]!
          .content.length,
        40000,
      );
      assert.equal(
        z.object({ status: z.string() }).parse(
          await client.call("workflow_run", {
            action: "cancel",
            run_id: host.run_id,
          }),
        ).status,
        "cancelled",
      );
    } finally {
      await client.close();
    }
  });
});

test("natural-language test persists its ordered requirements and only finishes after native and host visual evidence", async () => {
  await fixture(async (h) => {
    const initial = await start(h.runtime, {
        fresh_start: true,
        request_key: "test-one",
      }),
      id = initial.test_id;
    assert.equal(initial.verified, false);
    assert.equal(
      summarySchema.parse(
        await h.runtime.call("ui_test", {
          action: "start",
          test_plan: "Open the result and verify Done fits its button.",
          app,
          fresh_start: true,
          request_key: "test-one",
          steps: [
            {
              id: "result",
              goal: "Show the completed result",
              assert: { visible: { text: "Done" } },
              review: { requirement: "The Done label fits inside the button" },
            },
          ],
        }),
      ).test_id,
      id,
    );
    await assert.rejects(
      h.runtime.call("ui_test", { action: "finish", test_id: id }),
      { code: "UI_TEST_INCOMPLETE" },
    );
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    assert.deepEqual(h.calls.slice(0, 3), ["stop", "launch", "capture"]);
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "plan",
        test_id: id,
        steps: [
          {
            id: "easier",
            goal: "Remove the requirement",
            review: { requirement: "Anything visible" },
          },
        ],
      }),
      { code: "UI_TEST_PLAN_FROZEN" },
    );
    const attempt = randomUUID();
    await h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "result",
      attempt_id: attempt,
      operation,
    });
    await h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "result",
      attempt_id: attempt,
      operation,
    });
    assert.equal(h.calls.filter((call) => call === "control").length, 1);
    await h.runtime.call("ui_test", { action: "check", test_id: id });
    await assert.rejects(
      h.runtime.call("ui_test", { action: "finish", test_id: id }),
      { code: "UI_TEST_INCOMPLETE" },
    );
    h.setText("Done");
    // A new action captures a new sample; the first failed assertion remains retained.
    await h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "result",
      attempt_id: randomUUID(),
      operation,
    });
    const checked = summarySchema.parse(
      await h.runtime.call("ui_test", { action: "check", test_id: id }),
    );
    const reviewId = checked.steps[0]!.check!.review_id!,
      review = h.runtime.reviews.status(reviewId),
      image = readImageArtifact(h.runtime.store, review.artifact_id);
    const token = image.review_reads!.find(
      (item) => item.review_id === reviewId,
    )!.read_token;
    await h.reopen();
    const log = z
      .object({ content: z.string(), complete: z.literal(false) })
      .parse(
        await h.runtime.call("ui_test", {
          action: "logs",
          test_id: id,
          chunk_id: 0,
          search_keywords: ["完成"],
        }),
      );
    assert.match(log.content, /完成测试/);
    assert.doesNotMatch(log.content, /Other app/);
    assert.equal(
      summarySchema.parse(
        await h.runtime.call("workflow_run", { action: "resume", run_id: id }),
      ).verified,
      false,
    );
    assert.equal(h.calls.filter((call) => call === "launch").length, 1);
    await h.runtime.call("ui_review", {
      action: "complete",
      review_id: reviewId,
      artifact_id: image.artifact_id,
      sha256: image.sha256,
      read_token: token,
      assessment: {
        outcome: "passed",
        observations:
          "Fixture image assessment: the Done label is fully inside its button.",
      },
    });
    const finished = summarySchema.parse(
      await h.runtime.call("ui_test", { action: "finish", test_id: id }),
    );
    assert.equal(finished.verified, true);
    assert.equal(finished.status, "succeeded");
    assert.equal(
      finished.next_action,
      "inspect report or export retained evidence",
    );
    assert.equal(finished.steps[0]!.status, "passed");
    assert.equal(h.runtime.storage.plan([id]).run_ids[0], id);
    const report = h.runtime.tests.status(id).report_artifact!;
    const saved = JSON.parse(
      h.runtime.store
        .readBinaryArtifact(report.artifact_id, 4 * 1024 * 1024, [
          "application/json",
        ])
        .data.toString(),
    );
    assert.equal(saved.verified, true);
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.actions.length, 2);
    assert.ok(saved.log_chunks.length);
    await h.reopen();
    assert.equal(
      h.runtime.tests.status(id).next_action,
      "inspect report or export retained evidence",
    );
    assert.equal(h.runtime.tests.status(id).verified, true);
  });
});

test("visual checks can explicitly recapture delayed changes without repeating a device action or weakening the requirement", async () => {
  await fixture(async (h) => {
    const { test_id: id } = await start(h.runtime);
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    const before = summarySchema.parse(
      await h.runtime.call("ui_test", { action: "check", test_id: id }),
    );
    h.setText("Done");
    const unchanged = summarySchema.parse(
      await h.runtime.call("ui_test", { action: "check", test_id: id }),
    );
    assert.equal(
      unchanged.steps[0]!.check!.review_id,
      before.steps[0]!.check!.review_id,
    );
    const fresh = summarySchema.parse(
      await h.runtime.call("ui_test", {
        action: "check",
        test_id: id,
        recapture: true,
      }),
    );
    assert.notEqual(
      fresh.steps[0]!.check!.review_id,
      before.steps[0]!.check!.review_id,
    );
    assert.equal(fresh.steps[0]!.check!.assertion_passed, true);
    assert.equal(
      h.runtime.reviews.status(before.steps[0]!.check!.review_id!).status,
      "cancelled",
    );
    assert.equal(h.calls.includes("control"), false);
    await assert.rejects(
      h.runtime.call("ui_test", { action: "finish", test_id: id }),
      { code: "UI_TEST_INCOMPLETE" },
    );
  });
});

test("captured secondary applications and displays support permission-style steps while rejecting unrelated scopes", async () => {
  await fixture(async (h) => {
    const other = "com.example.permission",
      snapshot = h.runtime.devices.snapshot;
    h.runtime.devices.snapshot = async (...args) => {
      const value = await snapshot(...args),
        nodes = value.nodes.map((node) => ({
          ...node,
          bundleName: other,
          displayId: "1",
        }));
      return { ...value, nodes, query: new UiIndex(nodes) };
    };
    const screenshot = h.runtime.devices.screenshot;
    h.runtime.devices.screenshot = async (target, input, signal) => {
      assert.equal((input as { display_id: number }).display_id, 1);
      return screenshot(target, input, signal);
    };
    const { test_id: id } = await start(h.runtime, {
      allowed_bundles: [other],
      display_id: 1,
      steps: [
        {
          id: "permission",
          goal: "Verify the permission surface",
          assert: {
            visible: { text: "Waiting", bundle_name: other, displayId: 1 },
          },
        },
      ],
    });
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "permission",
        attempt_id: randomUUID(),
        operation: {
          action: "click",
          selector: { text: "Waiting", bundle_name: "com.unrelated.app" },
        },
      }),
      { code: "UI_TEST_SCOPE_MISMATCH" },
    );
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "permission",
        attempt_id: randomUUID(),
        operation: {
          action: "click",
          display_id: 0,
          selector: { text: "Waiting", bundle_name: other },
        },
      }),
      { code: "UI_TEST_SCOPE_MISMATCH" },
    );
    await h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "permission",
      attempt_id: randomUUID(),
      operation: {
        action: "click",
        selector: { text: "Waiting", bundle_name: other },
      },
    });
    await h.runtime.call("ui_test", { action: "check", test_id: id });
    assert.equal(
      summarySchema.parse(
        await h.runtime.call("ui_test", { action: "finish", test_id: id }),
      ).verified,
      true,
    );
  });
});

test("starting a UI test waits for an existing device mutation lease", async () => {
  await fixture(async (h) => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lease = h.runtime.store.lease("device:fixture", async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    let started = false;
    const pending = start(h.runtime).then((result) => {
      started = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(started, false);
    release();
    await lease;
    const result = await pending;
    assert.equal(result.status, "needs_input");
  });
});

test("a paused UI test exports a complete evidence snapshot without completing or deleting its active run", async () => {
  await fixture(async (h) => {
    const { test_id: id } = await start(h.runtime),
      output = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-ui-export-"));
    try {
      await h.runtime.call("ui_test", { action: "resume", test_id: id });
      await h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "result",
        attempt_id: randomUUID(),
        operation,
      });
      const exported = z
        .object({
          status: z.literal("complete"),
          report_artifact: z.object({ artifact_id: z.string() }),
        })
        .parse(
          await h.runtime.call("ui_test", {
            action: "export",
            test_id: id,
            directory: path.join(output, "evidence"),
          }),
        );
      const manifest = JSON.parse(
        fs.readFileSync(path.join(output, "evidence", "manifest.json"), "utf8"),
      );
      assert.equal(manifest.complete, true);
      assert.equal(manifest.runs[0].status, "needs_input");
      assert.ok(
        manifest.artifacts.some(
          (item: { mime: string }) => item.mime === "image/png",
        ),
      );
      assert.ok(
        manifest.artifacts.some(
          (item: { mime: string }) => item.mime === "text/plain",
        ),
      );
      const report = manifest.artifacts.find(
        (item: { id: string }) =>
          item.id === exported.report_artifact.artifact_id,
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(output, "evidence", report.file), "utf8"),
        ).verified,
        false,
      );
      assert.equal(h.runtime.tests.status(id).status, "needs_input");
      assert.throws(() => h.runtime.storage.plan([id]), {
        code: "RUN_PROTECTED",
      });
      await h.runtime.call("ui_test", { action: "cancel", test_id: id });
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });
});

test("unchanged UI actions stop after three captures; replanning cannot replay the same locator against the same state", async () => {
  await fixture(async (h) => {
    const { test_id: id } = await start(h.runtime);
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    for (let i = 0; i < 3; i++)
      await h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "result",
        attempt_id: randomUUID(),
        operation,
      });
    assert.equal(h.runtime.tests.status(id).blocked, "no_progress");
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "result",
        attempt_id: randomUUID(),
        operation,
      }),
      { code: "UI_TEST_REPLAN_REQUIRED" },
    );
    await h.reopen();
    await h.runtime.call("ui_test", {
      action: "replan",
      test_id: id,
      reason: "The three clicks did not change the app.",
      strategy: "Inspect and choose another locator or key action.",
    });
    await completeReplan(h.runtime, id);
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "act",
        test_id: id,
        step_id: "result",
        attempt_id: randomUUID(),
        operation,
      }),
      { code: "UI_TEST_STRATEGY_UNCHANGED" },
    );
    await h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "result",
      attempt_id: randomUUID(),
      operation: { action: "keyEvent", keys: ["Back"] },
    });
    assert.equal(h.calls.filter((call) => call === "control").length, 4);
    assert.throws(() => h.runtime.storage.plan([id]), {
      code: "RUN_PROTECTED",
    });
    assert.throws(() => h.runtime.tests.assertTaskTarget("fixture"), {
      code: "UI_TEST_ACTIVE",
    });
    await h.runtime.call("workflow_run", { action: "cancel", run_id: id });
    assert.equal(h.runtime.tests.status(id).status, "cancelled");
    assert.doesNotThrow(() => h.runtime.tests.assertTaskTarget("fixture"));
    await h.reopen();
    const cancelled = h.runtime.tests.status(id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.verified, false);
    assert.equal(
      cancelled.next_action,
      "inspect report or export retained evidence",
    );
    assert.equal(h.calls.filter((call) => call === "control").length, 4);
  });
});

test("uncertain native action survives restart without replay and cancellation joins an in-flight control", async () => {
  await fixture(async (h) => {
    const { test_id: id } = await start(h.runtime);
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    h.runtime.devices.control = async () => {
      h.calls.push("uncertain");
      throw new ToolError("EFFECT_UNCERTAIN", "Fixture lost acknowledgement");
    };
    const attempt = randomUUID(),
      input = {
        action: "act",
        test_id: id,
        step_id: "result",
        attempt_id: attempt,
        operation,
      };
    await assert.rejects(h.runtime.call("ui_test", input), {
      code: "EFFECT_UNCERTAIN",
    });
    await h.reopen();
    await h.runtime.call("ui_test", { action: "resume", test_id: id });
    await assert.rejects(h.runtime.call("ui_test", input), {
      code: "EFFECT_UNCERTAIN",
    });
    await assert.rejects(
      h.runtime.call("ui_test", {
        action: "replan",
        test_id: id,
        reason: "Inspect whether the previous action happened.",
        strategy: "Choose a new operation only after checking state.",
      }),
      { code: "UI_TEST_UNCERTAIN" },
    );
    await h.runtime.call("ui_test", {
      action: "replan",
      test_id: id,
      reason:
        "The fresh fixture screenshot confirms the pending control state.",
      strategy: "Use Back to leave the current page after this inspection.",
      reconcile_uncertain: true,
    });
    await completeReplan(h.runtime, id);
    let dispatched!: () => void;
    const reached = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    h.runtime.devices.control = async (_target, _operation, signal) => {
      dispatched();
      await new Promise((_, reject) =>
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        }),
      );
      return { commandAccepted: true, outcomeVerified: false };
    };
    const pending = h.runtime.call("ui_test", {
      action: "act",
      test_id: id,
      step_id: "result",
      attempt_id: randomUUID(),
      operation: { action: "keyEvent", keys: ["Back"] },
    });
    const rejected = assert.rejects(pending, { code: "CANCELLED" });
    await reached;
    await h.runtime.call("ui_test", { action: "cancel", test_id: id });
    await rejected;
    assert.equal(h.runtime.tests.status(id).status, "cancelled");
    assert.equal(h.calls.filter((call) => call === "uncertain").length, 1);
    assert.deepEqual(
      h.runtime.store.db.prepare("SELECT * FROM leases").all(),
      [],
    );
  });
});

test("UI test schemas expose separate actions and require a bounded plan with verifiable steps", () => {
  for (const input of [
    {
      action: "start",
      test_plan: "test",
      app,
      steps: [{ id: "one", goal: "click something" }],
    },
    { action: "act", test_id: randomUUID(), operation },
    { action: "status", test_id: randomUUID(), fresh_start: true },
    { action: "plan", test_id: randomUUID(), steps: [] },
  ])
    assert.equal(tools.ui_test.schema.safeParse(input).success, false);
  assert.doesNotThrow(() => z.toJSONSchema(tools.ui_test.schema));
});
