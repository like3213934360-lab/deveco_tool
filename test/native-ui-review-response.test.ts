import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StateStore } from "../src/core/store.js";
import { UiReviewService } from "../src/services/ui-review.js";
import { maximumImageBytes } from "../src/core/artifact-image.js";
import { attachReviewImage } from "../src/services/ui-review-response.js";

const png = fs.readFileSync(
  new URL(
    "../../test/fixtures/harmony-app/AppScope/resources/base/media/foreground.png",
    import.meta.url,
  ),
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("inline review failure never returns an image read token for undelivered bytes", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-review-delivery-"),
  );
  const store = new StateStore(root),
    reviews = new UiReviewService(store);
  try {
    for (const [bytes, expected, abort] of [
      [Buffer.alloc(maximumImageBytes + 1), undefined, false],
      [Buffer.from("invalid"), undefined, false],
      [png, "a".repeat(64), false],
      [png, undefined, true],
    ] as const) {
      const artifact = store.artifact("review-test", bytes, "image/png");
      const created = reviews.create({
        run_id: "review-test",
        target: "fixture",
        artifact_id: artifact.artifact_id,
        sha256: expected ?? hash(bytes),
        assertion_status: "passed",
        requirement: "Inspect the requested button layout",
      });
      const result = z
        .object({ image_delivery: z.object({ delivered: z.literal(false) }) })
        .passthrough()
        .parse(
          attachReviewImage(
            { review_id: created.review_id },
            store,
            reviews,
            abort ? AbortSignal.abort() : undefined,
          ),
        );
      assert.equal("inline_review" in result, false);
      assert.equal(JSON.stringify(result).includes("read_token"), false);
      assert.deepEqual(
        store.db
          .prepare("SELECT read_token,read_at FROM ui_reviews WHERE id=?")
          .get(created.review_id),
        { read_token: null, read_at: null },
      );
    }
  } finally {
    reviews.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "MCP ui_review status delivers one exact image and completion receipt without duplicating base64 in text",
  { timeout: 30000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-review-mcp-"));
    const store = new StateStore(root),
      reviews = new UiReviewService(store);
    const artifact = store.artifact("review-test", png, "image/png");
    const review = reviews.create({
      run_id: "review-test",
      target: "fixture",
      artifact_id: artifact.artifact_id,
      sha256: hash(png),
      assertion_status: "passed",
      requirement: "Inspect the requested button layout",
    });
    reviews.close();
    store.close();
    const client = new Client({ name: "review-delivery-test", version: "1" });
    const transport = new StdioClientTransport({
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
      const response = await client.callTool({
        name: "ui_review",
        arguments: { action: "status", review_id: review.review_id },
      });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      const content = z.array(z.object({ type: z.string() }).passthrough()).parse(response.content);
      const images = content.filter((item) => item.type === "image");
      assert.equal(images.length, 1);
      assert.deepEqual(
        Buffer.from(
          z.object({ data: z.string() }).parse(images[0]).data,
          "base64",
        ),
        png,
      );
      assert.equal(
        JSON.stringify(response.structuredContent).includes(
          png.toString("base64"),
        ),
        false,
      );
      assert.equal(
        JSON.stringify(
          content.filter((item) => item.type === "text"),
        ).includes(png.toString("base64")),
        false,
      );
      const result = z
        .object({
          data: z.object({
            verified: z.literal(false),
            inline_review: z.object({
              artifact_id: z.literal(artifact.artifact_id),
              sha256: z.literal(hash(png)),
              complete: z.object({
                arguments: z.record(z.string(), z.unknown()),
              }),
            }),
          }),
        })
        .parse(response.structuredContent);
      const completion = await client.callTool({
        name: "ui_review",
        arguments: {
          ...result.data.inline_review.complete.arguments,
          assessment: {
            outcome: "passed",
            observations:
              "Fixture host assessment: the button label fits the expected bounds.",
          },
        },
      });
      assert.notEqual(completion.isError, true);
      assert.equal(
        z
          .object({ data: z.object({ verified: z.boolean() }) })
          .parse(completion.structuredContent).data.verified,
        true,
      );
    } finally {
      await client.close();
      await transport.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
