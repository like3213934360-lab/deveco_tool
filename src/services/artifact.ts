import { createHash, randomUUID } from "node:crypto";
import { maximumImageBytes } from "../core/artifact-image.js";
import type { StateStore } from "../core/store.js";
import { ToolError } from "../core/errors.js";
import { imageDimensions } from "./screenshot.js";

/** Public pages must not report a successful, stationary cursor forever.
 * Keep the numeric cursor for existing byte-count based readers. */
export function readArtifactPage(store: StateStore, id: string, offset = 0, limit = 65536) {
  const page = store.readArtifact(id, offset, limit);
  // An empty artifact still has one valid, empty first page.
  if (offset >= page.bytes && (page.bytes > 0 || offset > 0))
    throw new ToolError("ARTIFACT_EOF", "Artifact is fully read. Stop pagination; do not retry this offset.", {
      artifact_id: id, offset, bytes: page.bytes, eof: true,
    });
  return page;
}

export function readImageArtifact(store: StateStore, id: string) {
  const result = store.readBinaryArtifact(id, maximumImageBytes, [
      "image/png",
      "image/jpeg",
    ]),
    dimensions = imageDimensions(
      result.data.subarray(0, 65536),
      result.data.subarray(-12),
      result.mime === "image/png" ? "png" : "jpeg",
    );
  const sha256 = createHash("sha256").update(result.data).digest("hex");
  const reviewReads = store.db.transaction(() => {
    const reviews = store.db.prepare("SELECT id,read_token FROM ui_reviews WHERE artifact_id=? AND sha256=? AND status='required' LIMIT 257")
      .all(id, sha256) as { id: string; read_token: string | null }[];
    if (reviews.length) store.capacity(4096);
    return reviews.map((review) => {
      const token = review.read_token ?? randomUUID();
      store.db.prepare("UPDATE ui_reviews SET read_token=?,read_at=? WHERE id=?").run(token, Date.now(), review.id);
      return { review_id: review.id, read_token: token };
    });
  }).immediate();
  return {
    artifact_id: id,
    mime: result.mime,
    bytes: result.bytes,
    ...dimensions,
    sha256,
    ...(reviewReads.length ? { review_reads: reviewReads } : {}),
    image: {
      type: "image" as const,
      mimeType: result.mime,
      data: result.data.toString("base64"),
    },
  };
}
