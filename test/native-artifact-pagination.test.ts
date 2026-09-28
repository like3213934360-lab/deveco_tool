import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { ArtifactReadGuard } from "../src/core/artifact-read-guard.js";
import { readArtifactPage } from "../src/services/artifact.js";

const pageSchema = z.object({ artifact_id: z.string(), bytes: z.number(), offset: z.number(), next_offset: z.number(), eof: z.boolean(), data: z.string() });
const envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: pageSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), retryable: z.literal(false), recovery: z.object({ automatic_retry: z.literal(false), next: z.array(z.unknown()).length(0) }) }) }),
]);
const request = (artifact_id: string, offset = 0, limit = 65536) => ({ action: "read_artifact", as: "page", artifact_id, offset, limit });

test("artifact pages preserve byte identity and numeric cursors with explicit EOF at every boundary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-artifact-pages-")), store = new StateStore(root);
  try {
    for (const bytes of [0, 1, 65536, 65537, 158547]) {
      const data = Buffer.from(Array.from({ length: bytes }, (_, i) => i % 251));
      const { artifact_id } = store.artifact("fixture", data);
      const parts: Buffer[] = [];
      let offset = 0, complete = false;
      for (let count = 0; count < 4; count++) {
        const page = readArtifactPage(store, artifact_id, offset);
        assert.equal(page.offset, offset);
        assert.equal(page.bytes, bytes);
        parts.push(Buffer.from(page.data, "base64"));
        assert.equal(page.next_offset, Math.min(offset + 65536, bytes));
        if (page.eof) { complete = true; break; }
        assert.ok(page.next_offset > offset);
        offset = page.next_offset;
      }
      assert.equal(complete, true);
      assert.deepEqual(Buffer.concat(parts), data);
      if (bytes > 0) assert.throws(() => readArtifactPage(store, artifact_id, bytes), { code: "ARTIFACT_EOF", retryable: false });
      assert.throws(() => readArtifactPage(store, artifact_id, bytes + 1), { code: "ARTIFACT_EOF", retryable: false });
      assert.throws(() => readArtifactPage(store, artifact_id, -1), { code: "INVALID_RANGE" });
    }
    assert.throws(() => readArtifactPage(store, randomUUID()), { code: "ARTIFACT_NOT_FOUND" });
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("repeated-read protection expires after inactivity and yields abortably without blocking other reads", async () => {
  let now = 0;
  const guard = new ArtifactReadGuard(() => now), input = request(randomUUID());
  for (let i = 0; i < 8; i++) await guard.check("workflow_run", input);
  const started = performance.now();
  await assert.rejects(guard.check("workflow_run", { ...input, limit: 1 }), { code: "ARTIFACT_READ_LOOP", retryable: false });
  assert.ok(performance.now() - started >= 200, "Rejected sequential loops must yield before responding");
  const controller = new AbortController();
  const rejected = assert.rejects(guard.check("workflow_run", input, controller.signal), { name: "AbortError" });
  await guard.check("workflow_run", { ...input, offset: 1 });
  await guard.check("workflow_catalog", {});
  await guard.check("workflow_run", { ...input, as: "image" });
  controller.abort();
  await rejected;
  now = 10000;
  await guard.check("workflow_run", input);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(guard.check("workflow_run", input, aborted.signal), { name: "AbortError" });
});

test("repeated-read metadata is bounded, isolated by connection and artifact, and does not throttle advancing cursors", async () => {
  const guard = new ArtifactReadGuard(() => 0), input = request(randomUUID());
  for (let i = 0; i < 8; i++) await guard.check("workflow_run", input);
  await new ArtifactReadGuard(() => 0).check("workflow_run", input);
  await guard.check("workflow_run", request(randomUUID()));
  for (let offset = 1; offset <= 128; offset++) await guard.check("workflow_run", { ...input, offset });
  // The oldest cursor must have been evicted instead of retaining unbounded state.
  await guard.check("workflow_run", input);
});

test("real MCP transport stops the original nullable-cursor loop, empty-page loops and ignored-error floods", { timeout: 30000 }, async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-artifact-mcp-")));
  const state = path.join(root, "state"), store = new StateStore(state);
  const data = Buffer.alloc(158547, 37), artifact = store.artifact("fixture", data);
  const empty = store.artifact("fixture", ""), repeated = store.artifact("fixture", "page"), independent = store.artifact("fixture", "independent");
  const png = fs.readFileSync(new URL("../../test/fixtures/harmony-app/AppScope/resources/base/media/foreground.png", import.meta.url));
  const image = store.artifact("fixture", png, "image/png");
  store.close();
  fs.writeFileSync(path.join(root, "config.json"), "{}\n");
  // Also exercise a sealed installation without changing the test or live state.
  const cli = process.env.DEVECO_PAGINATION_TEST_INSTALLATION
    ? path.join(process.env.DEVECO_PAGINATION_TEST_INSTALLATION, "dist/src/cli.js")
    : fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli], cwd: root, stderr: "ignore", env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]))),
    DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(root, "config.json"),
  } });
  const client = new Client({ name: "artifact-loop-regression", version: "1" });
  try {
    await client.connect(transport);
    assert.match(client.getInstructions()!, /next_offset.*numeric/);
    const call = async (input: ReturnType<typeof request>) => {
      const response = await client.callTool({ name: "workflow_run", arguments: input });
      const result = envelope.parse(response.structuredContent);
      assert.equal(response.isError === true, !result.ok);
      return result;
    };
    for (const [reference, expectedCalls, errorCode] of [[artifact, 4, "ARTIFACT_EOF"], [empty, 9, "ARTIFACT_READ_LOOP"]] as const) {
      const parts: Buffer[] = [];
      let offset: number | null = 0, calls = 0, stopped = false;
      // Recreate the incident's faulty condition, with an independent safety cap.
      while (offset !== null && calls < 16) {
        calls++;
        const result = await call(request(reference.artifact_id, offset));
        if (!result.ok) { assert.equal(result.error.code, errorCode); stopped = true; break; }
        parts.push(Buffer.from(result.data.data, "base64"));
        offset = result.data.next_offset;
      }
      assert.equal(stopped, true);
      assert.equal(calls, expectedCalls);
      assert.deepEqual(Buffer.concat(parts), reference === artifact ? data : Buffer.alloc(0));
    }
    // A different faulty caller ignores both eof and error replies.
    for (let i = 0; i < 8; i++) assert.equal((await call(request(repeated.artifact_id))).ok, true);
    const started = performance.now();
    for (let i = 0; i < 3; i++) {
      const result = await call(request(repeated.artifact_id));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "ARTIFACT_READ_LOOP");
    }
    assert.ok(performance.now() - started >= 600);
    assert.equal((await call(request(independent.artifact_id))).ok, true);
    assert.notEqual((await client.callTool({ name: "workflow_catalog", arguments: {} })).isError, true);
    const visual = await client.callTool({ name: "workflow_run", arguments: { action: "read_artifact", artifact_id: image.artifact_id, as: "image" } });
    assert.notEqual(visual.isError, true);
    assert.ok(Array.isArray(visual.content));
    assert.ok(visual.content.some(item => item.type === "image" && item.data === png.toString("base64")));
  } finally {
    await client.close(); await transport.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
