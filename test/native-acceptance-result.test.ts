import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acceptanceResult } from "../scripts/lib/acceptance-result.js";

test("acceptance follows every public JSON artifact page without repeating its original effect", async () => {
  const value = { chunks: [{ content: "中文🙂".repeat(16000) }], next_chunk_offset: null };
  const bytes = Buffer.from(JSON.stringify(value)), id = randomUUID();
  const requests: { offset: number; limit: number }[] = [];
  let readBytes = 0;
  const result = await acceptanceResult({ summary: "Result is available as an artifact", artifact: { artifact_id: id, bytes: bytes.length, mime: "application/json" } }, async input => {
    assert.equal(input.action, "read_artifact"); assert.equal(input.artifact_id, id);
    requests.push(input);
    const chunk = bytes.subarray(input.offset, input.offset + input.limit); readBytes += chunk.length;
    return { bytes: bytes.length, data: chunk.toString("base64"), next_offset: input.offset + chunk.length };
  });
  assert.deepEqual(result, value);
  assert.equal(readBytes, bytes.length);
  assert.equal(requests.length, Math.ceil(bytes.length / 65536));
  assert.deepEqual(requests.map(input => input.offset), requests.map((_, index) => index * 65536));
});

test("acceptance rejects oversized and non-advancing references before claiming a full result", async () => {
  const value = { summary: "Result is available as an artifact", artifact: { artifact_id: randomUUID(), bytes: 100, mime: "application/json" } };
  let reads = 0;
  await assert.rejects(acceptanceResult({ ...value, artifact: { ...value.artifact, bytes: 8 * 1024 * 1024 + 1 } }, async () => { reads++; }), { name: "ZodError" });
  assert.equal(reads, 0);
  await assert.rejects(acceptanceResult(value, async () => ({ bytes: 100, data: "e30=", next_offset: 0 })), { code: "ACCEPTANCE_ARTIFACT_INVALID" });
  const direct = { status: "succeeded" };
  assert.equal(await acceptanceResult(direct, async () => { throw new Error("Unexpected artifact read"); }), direct);
});
