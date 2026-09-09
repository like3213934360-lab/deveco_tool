import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Evidence directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const identity = evidenceIdentity(),
  env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    DEVECO_STATE_DIR: path.join(root, "state"),
  };
const observations: {
  name: string;
  passed: boolean;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
const connect = async () => {
  const client = new Client({
      name: "native-visual-review-acceptance",
      version: "1",
    }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))],
      env,
      stderr: "ignore",
    });
  await client.connect(transport);
  return { client, transport };
};
let connection: Awaited<ReturnType<typeof connect>> | undefined,
  device: unknown,
  target: string | undefined,
  failure: unknown;
const save = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        identity,
        scope:
          "Real MCP PNG/JPEG image delivery, review evidence and assertion result separation, Worker and full MCP restart persistence. Read-only current-device sampling; no installation, launch, input, or application outcome certification.",
        device,
        failure,
        passed:
          failure === undefined &&
          observations.length > 0 &&
          observations.every((item) => item.passed),
        observations,
      },
      null,
      2,
    ) + "\n",
  );
async function observe<T>(name: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      passed: true,
      elapsed_ms: performance.now() - started,
      result,
    });
    return result;
  } catch (error) {
    observations.push({
      name,
      passed: false,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    throw error;
  } finally {
    save();
    console.log(
      `${name}: ${observations.at(-1)!.passed ? "passed" : "failed"}`,
    );
  }
}
async function call(name: string, args: Record<string, unknown>) {
  assert.ok(connection);
  return connection.client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
}
async function data(name: string, args: Record<string, unknown>) {
  const result = await call(name, args);
  if (result.isError) {
    const error = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.unknown().optional(),
        }),
      })
      .parse(result.structuredContent).error;
    throw new ToolError(error.code, error.message, error.details);
  }
  return z.object({ data: z.unknown() }).parse(result.structuredContent).data;
}
const reportSchema = z
  .object({
    verified: z.boolean(),
    assertion: z.object({ status: z.string() }).passthrough(),
    review: z.object({
      status: z.string(),
      requirement: z.string().optional(),
    }),
    screenshot: z
      .object({
        artifact: z.object({ artifact_id: z.string() }).passthrough(),
        sha256: z.string(),
        format: z.enum(["png", "jpeg"]),
        width: z.number(),
      })
      .passthrough(),
    report_artifact: z.object({ artifact_id: z.string() }),
  })
  .passthrough();
async function readImage(
  reference: string,
  expected: string,
  format: "png" | "jpeg",
  file: string,
) {
  const response = await call("workflow_run", {
    action: "read_artifact",
    artifact_id: reference,
    as: "image",
  });
  if (response.isError) {
    const error = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.unknown().optional(),
        }),
      })
      .parse(response.structuredContent).error;
    throw new ToolError(error.code, error.message, error.details);
  }
  const parsed = z
    .object({
      content: z.array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("image"),
            data: z.string(),
            mimeType: z.string(),
          }),
        ]),
      ),
      structuredContent: z
        .object({
          data: z
            .object({
              artifact_id: z.literal(reference),
              sha256: z.literal(expected),
              bytes: z.number(),
              width: z.number(),
              height: z.number(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .parse(response);
  assert.equal(parsed.content.length, 2);
  const image = parsed.content.find((item) => item.type === "image")!;
  assert.equal(image.mimeType, `image/${format}`);
  const bytes = Buffer.from(image.data, "base64");
  assert.equal(bytes.length, parsed.structuredContent.data.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  assert.equal(
    JSON.stringify(parsed.structuredContent).includes(image.data),
    false,
  );
  atomicWrite(path.join(root, file), bytes);
  return parsed.structuredContent.data;
}
async function readReport(reference: string) {
  const page = z
    .object({ data: z.string(), bytes: z.number(), next_offset: z.number() })
    .parse(
      await data("workflow_run", {
        action: "read_artifact",
        artifact_id: reference,
      }),
    );
  assert.equal(page.next_offset, page.bytes);
  return JSON.parse(Buffer.from(page.data, "base64").toString()) as unknown;
}
try {
  connection = await connect();
  await observe("pin_device_and_nonempty_ui_tree", async () => {
    device = await data(
      "device_info",
      process.argv[3] ? { target: process.argv[3] } : {},
    );
    target = z.object({ target: z.string() }).parse(device).target;
    const tree = z
      .object({ node_count: z.number().positive() })
      .parse(await data("ui_snapshot", { target, mode: "tree" }));
    return { node_count: tree.node_count };
  });
  const requirement =
    "请审阅当前截图的文字可读性。此记录不自动证明应用业务功能通过。";
  const review = await observe(
    "review_only_retains_requirement_and_jpeg",
    async () => {
      const result = reportSchema.parse(
        await data("verify_ui", {
          target,
          review: { requirement },
          capture: { width: 640 },
        }),
      );
      assert.equal(result.verified, false);
      assert.equal(result.assertion.status, "not_requested");
      assert.deepEqual(result.review, { status: "required", requirement });
      assert.equal(result.screenshot.width, 640);
      return result;
    },
  );
  await observe("read_jpeg_as_mcp_image", () =>
    readImage(
      review.screenshot.artifact.artifact_id,
      review.screenshot.sha256,
      "jpeg",
      "review.jpeg",
    ),
  );
  await observe("worker_restart_retains_review_and_image", async () => {
    await data("deveco_restart", {});
    const { report_artifact: _reference, ...expected } = review;
    // Parse both sides identically without dropping any persisted report fields.
    assert.equal(
      digest(await readReport(review.report_artifact.artifact_id)),
      digest(expected),
    );
    return readImage(
      review.screenshot.artifact.artifact_id,
      review.screenshot.sha256,
      "jpeg",
      "worker-restarted.jpeg",
    );
  });
  await observe("full_mcp_restart_retains_review_and_image", async () => {
    await connection!.transport.close();
    connection = await connect();
    const saved = z
      .object({
        review: z.object({
          status: z.literal("required"),
          requirement: z.literal(requirement),
        }),
      })
      .parse(await readReport(review.report_artifact.artifact_id));
    await readImage(
      review.screenshot.artifact.artifact_id,
      review.screenshot.sha256,
      "jpeg",
      "mcp-restarted.jpeg",
    );
    return saved;
  });
  await observe("control_pass_keeps_visual_review_required", async () => {
    const result = reportSchema.parse(
      await data("verify_ui", {
        target,
        assert: {
          hidden: { key: `native-absent-${randomUUID()}` },
          timeoutMs: 2000,
        },
        review: { requirement },
        capture: { width: 640 },
      }),
    );
    assert.equal(result.assertion.status, "passed");
    assert.equal(result.verified, false);
    return result;
  });
  await observe(
    "failed_assertion_preserves_png_evidence_and_error",
    async () => {
      const response = await call("verify_ui", {
        target,
        assert: {
          visible: { key: `native-absent-${randomUUID()}` },
          timeoutMs: 500,
        },
        capture: { format: "png", width: 640 },
      });
      assert.equal(response.isError, true);
      const error = z
        .object({
          error: z.object({
            code: z.literal("VERIFICATION_FAILED"),
            details: reportSchema,
          }),
        })
        .parse(response.structuredContent).error;
      assert.equal(error.details.verified, false);
      assert.equal(error.details.assertion.status, "failed");
      await readImage(
        error.details.screenshot.artifact.artifact_id,
        error.details.screenshot.sha256,
        "png",
        "failed-assertion.png",
      );
      return error;
    },
  );
  await observe("tested_bytes_remain_unchanged", async () => {
    const after = evidenceIdentity();
    for (const key of [
      "runtime_sha256",
      "compiled_sha256",
      "package_lock_sha256",
      "resource_manifest_sha256",
      "upstream_lock_sha256",
    ] as const)
      assert.equal(identity[key], after[key]);
    return { runtime_sha256: after.runtime_sha256 };
  });
} catch (error) {
  failure = errorResult(error);
  process.exitCode = 1;
} finally {
  if (connection) await connection.transport.close();
  save();
}
