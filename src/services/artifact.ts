import { createHash } from "node:crypto";
import { maximumImageBytes } from "../core/artifact-image.js";
import type { StateStore } from "../core/store.js";
import { imageDimensions } from "./screenshot.js";

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
  return {
    artifact_id: id,
    mime: result.mime,
    bytes: result.bytes,
    ...dimensions,
    sha256: createHash("sha256").update(result.data).digest("hex"),
    image: {
      type: "image" as const,
      mimeType: result.mime,
      data: result.data.toString("base64"),
    },
  };
}
