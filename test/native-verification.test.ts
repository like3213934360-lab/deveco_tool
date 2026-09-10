import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { crc32 } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Runtime } from "../src/services/runtime.js";
import { StateStore } from "../src/core/store.js";
import { ToolError } from "../src/core/errors.js";
import { tools } from "../src/core/contracts.js";
import {
  artifactImageSchema,
  maximumImageBytes,
} from "../src/core/artifact-image.js";
import { readImageArtifact } from "../src/services/artifact.js";
import { imageDimensions } from "../src/services/screenshot.js";
import { UiReviewService } from "../src/services/ui-review.js";

const png = fs.readFileSync(
  new URL(
    "../../test/fixtures/harmony-app/AppScope/resources/base/media/foreground.png",
    import.meta.url,
  ),
);
const size = imageDimensions(png.subarray(0, 65536), png.subarray(-12), "png"),
  sha256 = createHash("sha256").update(png).digest("hex");
const passed = {
  verified: true,
  snapshot_id: "assertion-sample",
  signature: "tree",
  structureSignature: "structure",
  nodeCount: 1,
  matchCount: 1,
  matches: [],
};
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "deveco-review-"));
async function fixture(
  task: (runtime: Runtime, calls: string[]) => Promise<void>,
) {
  const root = temporary(),
    previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime(),
    calls: string[] = [];
  runtime.devices.target = async () => "fixture";
  runtime.devices.verify = async () => {
    calls.push("assert");
    return passed;
  };
  runtime.devices.screenshot = async (_target, _capture, signal) => {
    signal?.throwIfAborted();
    calls.push("capture");
    assert.equal(
      runtime.store.db
        .prepare("SELECT * FROM leases WHERE resource=?")
        .all("device:fixture").length,
      1,
    );
    const stream = runtime.store.streamArtifact("ui", "image/png");
    stream.reserve(png.length);
    fs.writeFileSync(stream.file, png);
    return {
      target: "fixture",
      display_id: null,
      format: "png",
      mime: "image/png",
      bytes: png.length,
      ...size,
      native_width: size.width,
      native_height: size.height,
      coordinate_scale: { x: 1, y: 1 },
      sha256,
      frame_signature: sha256,
      progress_signature: sha256,
      unchanged: false,
      artifact: stream.finish(),
    };
  };
  try {
    await task(runtime, calls);
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const reportSchema = z
  .object({
    verified: z.boolean(),
    assertion: z.object({
      status: z.enum(["passed", "failed", "not_requested"]),
    }),
    review: z.object({
      status: z.enum(["required", "not_requested"]),
      requirement: z.string().optional(),
    }),
    screenshot: z
      .object({
        artifact: z.object({ artifact_id: z.string() }).passthrough(),
        sha256: z.string(),
      })
      .passthrough()
      .nullable(),
    report_artifact: z.object({ artifact_id: z.string() }),
    sampling: z.string(),
  })
  .passthrough();

test("visual review needs an explicit requirement and image presentation rejects paginated or unrelated requests", () => {
  for (const input of [
    {},
    { capture: {} },
    { review: { requirement: "  " } },
    {
      review: { requirement: "layout" },
      capture: { if_changed_from: "a".repeat(64) },
    },
  ])
    assert.equal(tools.verify_ui.schema.safeParse(input).success, false);
  for (const input of [
    { action: "list", as: "image" },
    { action: "read_artifact", as: "image", offset: 1 },
    { action: "read_artifact", as: "image", limit: 32 },
  ])
    assert.equal(tools.workflow_run.schema.safeParse(input).success, false);
});

test("assertion-only verification stays on the direct fast path without taking or retaining screenshots", async () => {
  await fixture(async (runtime, calls) => {
    assert.deepEqual(
      await runtime.call("verify_ui", {
        assert: { visible: { text: "Done" } },
      }),
      passed,
    );
    assert.deepEqual(calls, ["assert"]);
    assert.equal(
      runtime.store.db.prepare("SELECT * FROM artifacts").all().length,
      0,
    );
  });
});

test("visual review alone does not query the UI tree and its requirement and image remain readable after restart", async () => {
  await fixture(async (runtime, calls) => {
    const requirement = "检查中文按钮没有截断，文字对齐。";
    const report = reportSchema.parse(
      await runtime.call("verify_ui", {
        review: { requirement },
        capture: { format: "png" },
      }),
    );
    assert.equal(report.verified, false);
    assert.equal(report.assertion.status, "not_requested");
    assert.deepEqual(report.review, { status: "required", requirement });
    assert.equal(report.sampling, "screenshot_only");
    assert.deepEqual(calls, ["capture"]);
    const root = runtime.store.root;
    await runtime.close();
    const reopened = new StateStore(root);
    try {
      const stored = JSON.parse(
        Buffer.from(
          reopened.readArtifact(report.report_artifact.artifact_id).data,
          "base64",
        ).toString(),
      );
      const { report_artifact: _reference, ...expected } = report;
      assert.deepEqual(stored, expected);
      assert.equal(
        readImageArtifact(reopened, report.screenshot!.artifact.artifact_id)
          .sha256,
        sha256,
      );
    } finally {
      reopened.close();
    }
  });
});

test("control assertions and visual review have separate outcomes and run sequentially under one device lease", async () => {
  await fixture(async (runtime, calls) => {
    runtime.devices.verify = async () => {
      assert.equal(
        runtime.store.db
          .prepare("SELECT * FROM leases WHERE resource=?")
          .all("device:fixture").length,
        1,
      );
      calls.push("assert");
      return passed;
    };
    const report = reportSchema.parse(
      await runtime.call("verify_ui", {
        assert: { visible: { text: "Done" } },
        review: { requirement: "Check alignment" },
      }),
    );
    assert.equal(report.verified, false);
    assert.equal(report.assertion.status, "passed");
    assert.equal(report.review.status, "required");
    assert.equal(report.sampling, "assertion_then_screenshot");
    assert.deepEqual(calls, ["assert", "capture"]);
    assert.deepEqual(
      runtime.store.db.prepare("SELECT * FROM leases").all(),
      [],
    );
    const controlOnly = reportSchema.parse(
      await runtime.call("verify_ui", {
        assert: { visible: { text: "Done" } },
        capture: {},
      }),
    );
    assert.equal(controlOnly.verified, true);
    assert.equal(controlOnly.review.status, "not_requested");
  });
});

test("visual completion requires the exact presented image and survives restart with immutable host observations", async () => {
  await fixture(async (runtime) => {
    const report = z.object({ review_id: z.string(), screenshot: z.object({ artifact: z.object({ artifact_id: z.string() }), sha256: z.string() }) }).parse(
      await runtime.call("verify_ui", { review: { requirement: "Inspect that the Chinese labels fit inside their buttons" } }),
    );
    const input = { action: "complete", review_id: report.review_id, artifact_id: report.screenshot.artifact.artifact_id,
      sha256: report.screenshot.sha256, read_token: "11111111-1111-4111-8111-111111111111",
      assessment: { outcome: "passed", observations: "Fixture assessment: all labels fit within the visible button boundaries." } };
    await assert.rejects(runtime.call("ui_review", input), { code: "UI_REVIEW_IMAGE_NOT_READ" });
    await runtime.call("workflow_run", { action: "read_artifact", artifact_id: input.artifact_id });
    await assert.rejects(runtime.call("ui_review", input), { code: "UI_REVIEW_IMAGE_NOT_READ" });
    const image = artifactImageSchema.parse(await runtime.call("workflow_run", { action: "read_artifact", artifact_id: input.artifact_id, as: "image" }));
    input.read_token = image.review_reads!.find((read) => read.review_id === report.review_id)!.read_token;
    await assert.rejects(runtime.call("ui_review", { ...input, sha256: "0".repeat(64) }), { code: "UI_REVIEW_IMAGE_NOT_READ" });
    const root = runtime.store.root;
    await runtime.close();
    const store = new StateStore(root), reviews = new UiReviewService(store);
    try {
      const status = reviews.complete(report.review_id, { ...input, assessment: { ...input.assessment, outcome: "passed" } });
      assert.equal(status.verified, true);
      assert.equal(status.assessment_source, "host_visual_assessment");
      assert.equal(status.assessment?.observations, input.assessment.observations);
      assert.deepEqual(reviews.complete(report.review_id, { ...input, assessment: { ...input.assessment, outcome: "passed" } }), status);
      assert.throws(() => reviews.complete(report.review_id, { ...input, assessment: { outcome: "failed", observations: "A different assessment cannot overwrite the original." } }), { code: "UI_REVIEW_ALREADY_SETTLED" });
      assert.equal(JSON.stringify(store.db.prepare("SELECT * FROM ui_reviews").all()).includes(input.assessment.observations), false);
    } finally { reviews.close(); store.close(); }
  });
});

test("visual assessment cannot hide a failed assertion, insufficient evidence or a changed screenshot", async () => {
  await fixture(async (runtime) => {
    runtime.devices.verify = async () => { throw new ToolError("VERIFICATION_FAILED", "Missing expected control"); };
    let failure: unknown;
    try { await runtime.call("verify_ui", { assert: { visible: { text: "Done" } }, review: { requirement: "Check the label's shape" } }); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof ToolError);
    const failed = z.object({ review_id: z.string(), screenshot: z.object({ artifact: z.object({ artifact_id: z.string() }) }) }).parse(failure.details);
    const image = readImageArtifact(runtime.store, failed.screenshot.artifact.artifact_id);
    const result = runtime.reviews.complete(failed.review_id, { artifact_id: image.artifact_id, sha256: image.sha256,
      read_token: image.review_reads![0]!.read_token, assessment: { outcome: "passed", observations: "The visible label shape looks correct in this fixture." } });
    assert.equal(result.verified, false);
    assert.equal(result.assertion_status, "failed");
    const required = runtime.reviews.create({ run_id: "ui", target: "fixture", requirement: "Check clipping", assertion_status: "passed", artifact_id: image.artifact_id, sha256 });
    const second = readImageArtifact(runtime.store, image.artifact_id), token = second.review_reads!.find((read) => read.review_id === required.review_id)!.read_token;
    const changed = Buffer.from(png); changed[50] = changed[50]! ^ 1;
    fs.writeFileSync(path.join(runtime.store.root, "artifacts", image.artifact_id), changed);
    assert.throws(() => runtime.reviews.complete(required.review_id, { artifact_id: image.artifact_id, sha256, read_token: token,
      assessment: { outcome: "passed", observations: "Changed evidence must not validate this observation." } }), { code: "UI_REVIEW_EVIDENCE_CHANGED" });
    fs.writeFileSync(path.join(runtime.store.root, "artifacts", image.artifact_id), png);
    assert.equal(runtime.reviews.complete(required.review_id, { artifact_id: image.artifact_id, sha256, read_token: token,
      assessment: { outcome: "insufficient", observations: "The captured area does not include the requested label." } }).verified, false);
  });
});

test("failed assertions retain screenshot evidence but keep the original failure and cannot turn into success", async () => {
  await fixture(async (runtime) => {
    runtime.devices.verify = async () => {
      throw new ToolError("VERIFICATION_FAILED", "Expected button is missing");
    };
    await assert.rejects(
      runtime.call("verify_ui", {
        assert: { visible: { text: "Done" } },
        capture: {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, "VERIFICATION_FAILED");
        const report = reportSchema.parse(error.details);
        assert.equal(report.verified, false);
        assert.equal(report.assertion.status, "failed");
        assert.ok(report.screenshot?.artifact.artifact_id);
        return true;
      },
    );
  });
});

test("capture errors retain completed assertion evidence and cancellation never starts another capture", async () => {
  await fixture(async (runtime, calls) => {
    runtime.devices.screenshot = async () => {
      calls.push("capture");
      throw new ToolError("SCREENSHOT_INVALID", "Invalid encoded image");
    };
    await assert.rejects(
      runtime.call("verify_ui", {
        assert: { visible: { text: "Done" } },
        capture: {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, "SCREENSHOT_INVALID");
        const report = reportSchema.parse(error.details);
        assert.equal(report.verified, false);
        assert.equal(report.assertion.status, "passed");
        assert.equal(report.screenshot, null);
        return true;
      },
    );
    const controller = new AbortController();
    runtime.devices.verify = async () => {
      controller.abort(new ToolError("CANCELLED", "Cancelled"));
      controller.signal.throwIfAborted();
      return passed;
    };
    calls.length = 0;
    await assert.rejects(
      runtime.call(
        "verify_ui",
        { assert: { visible: { text: "Done" } }, capture: {} },
        controller.signal,
      ),
      { code: "CANCELLED" },
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(
      runtime.store.db.prepare("SELECT * FROM leases").all(),
      [],
    );
  });
});

test("image artifact reads enforce MIME, full-file bounds, framing and persisted length before returning bytes", () => {
  const root = temporary(),
    store = new StateStore(root);
  try {
    const valid = store.artifact("test", png, "image/png"),
      wrong = store.artifact("test", png, "application/octet-stream"),
      malformed = store.artifact("test", "not an image", "image/png"),
      large = store.artifact(
        "test",
        Buffer.alloc(maximumImageBytes + 1),
        "image/png",
      );
    const image = artifactImageSchema.parse(
      readImageArtifact(store, valid.artifact_id),
    );
    assert.deepEqual(Buffer.from(image.image.data, "base64"), png);
    assert.equal(image.sha256, sha256);
    assert.throws(() => readImageArtifact(store, wrong.artifact_id), {
      code: "ARTIFACT_MIME_UNSUPPORTED",
    });
    assert.throws(() => readImageArtifact(store, malformed.artifact_id), {
      code: "SCREENSHOT_INVALID",
    });
    assert.throws(() => readImageArtifact(store, large.artifact_id), {
      code: "ARTIFACT_SIZE_UNSUPPORTED",
    });
    fs.truncateSync(
      path.join(store.root, "artifacts", valid.artifact_id),
      png.length - 1,
    );
    assert.throws(() => readImageArtifact(store, valid.artifact_id), {
      code: "ARTIFACT_CHANGED",
    });
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP serves explicit image content once, preserves default paging and rereads the same artifact after worker restart", async () => {
  // A valid ancillary PNG chunk takes the response beyond the ordinary 64 KiB
  // summary threshold. The small fixture alone did not exercise that boundary.
  const text = Buffer.from(
      "Evidence\0" + "large image transport ".repeat(8000),
    ),
    chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write("tEXt", 4);
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const imageBytes = Buffer.concat([
      png.subarray(0, -12),
      chunk,
      png.subarray(-12),
    ]),
    imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
  const root = temporary(),
    store = new StateStore(root),
    reference = store.artifact("test", imageBytes, "image/png");
  store.close();
  const client = new Client({ name: "image-contract-test", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))],
      stderr: "ignore",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        DEVECO_STATE_DIR: root,
      },
    });
  try {
    await client.connect(transport);
    for (let pass = 0; pass < 2; pass++) {
      const result = await client.callTool({
        name: "workflow_run",
        arguments: {
          action: "read_artifact",
          artifact_id: reference.artifact_id,
          as: "image",
        },
      });
      assert.notEqual(result.isError, true);
      const response = z
        .object({
          content: z.array(
            z.discriminatedUnion("type", [
              z.object({ type: z.literal("text"), text: z.string() }),
              z.object({
                type: z.literal("image"),
                mimeType: z.literal("image/png"),
                data: z.string(),
              }),
            ]),
          ),
          structuredContent: z.object({
            ok: z.literal(true),
            request_id: z.string(),
            data: z
              .object({
                artifact_id: z.literal(reference.artifact_id),
                sha256: z.literal(imageSha256),
              })
              .passthrough(),
          }),
        })
        .parse(result);
      assert.equal(response.content.length, 2);
      const image = response.content.find((item) => item.type === "image")!;
      assert.deepEqual(Buffer.from(image.data, "base64"), imageBytes);
      assert.equal("image" in response.structuredContent.data, false);
      assert.equal("data" in response.structuredContent.data, false);
      assert.equal(
        JSON.stringify(response.structuredContent).includes(
          imageBytes.toString("base64"),
        ),
        false,
      );
      const text = response.content.find((item) => item.type === "text")!;
      assert.deepEqual(JSON.parse(text.text), response.structuredContent);
      if (pass === 0)
        assert.notEqual(
          (await client.callTool({ name: "deveco_restart", arguments: {} }))
            .isError,
          true,
        );
    }
    const paged = await client.callTool({
      name: "workflow_run",
      arguments: {
        action: "read_artifact",
        artifact_id: reference.artifact_id,
        offset: 2,
        limit: 65536,
      },
    });
    const page = z
      .object({
        content: z.array(z.object({ type: z.literal("text") })).length(1),
        structuredContent: z.object({
          data: z.object({
            offset: z.literal(2),
            next_offset: z.literal(65538),
            data: z.string(),
          }),
        }),
      })
      .parse(paged);
    assert.deepEqual(
      Buffer.from(page.structuredContent.data.data, "base64"),
      imageBytes.subarray(2, 65538),
    );
  } finally {
    await transport.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
