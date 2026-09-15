import { z } from "zod";
import { invariant } from "../../src/core/errors.js";

const reference = z.object({
  summary: z.literal("Result is available as an artifact"),
  artifact: z.object({
    artifact_id: z.string().uuid(),
    bytes: z.number().int().positive().max(8 * 1024 * 1024),
    mime: z.literal("application/json"),
  }),
});
type Read = (input: { action: "read_artifact"; artifact_id: string; offset: number; limit: number }) => Promise<unknown>;

/** Follow the public bounded JSON-result reference; each page remains a real
 * MCP request and contributes to worker/driver request and byte telemetry. */
export async function acceptanceResult(value: unknown, read: Read): Promise<unknown> {
  if (!value || typeof value !== "object" || !("summary" in value) ||
      value.summary !== "Result is available as an artifact") return value;
  const ref = reference.parse(value).artifact;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < ref.bytes;) {
    const limit = Math.min(65536, ref.bytes - offset);
    const page = z.object({ bytes: z.number().int().positive(), data: z.string(), next_offset: z.number().int().nonnegative() })
      .parse(await read({ action: "read_artifact", artifact_id: ref.artifact_id, offset, limit }));
    const chunk = Buffer.from(page.data, "base64");
    invariant(page.bytes === ref.bytes && chunk.length > 0 && chunk.length <= limit &&
      page.next_offset === offset + chunk.length && page.next_offset <= ref.bytes,
      "ACCEPTANCE_ARTIFACT_INVALID", "Public result artifact pagination changed");
    chunks.push(chunk);
    offset = page.next_offset;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
