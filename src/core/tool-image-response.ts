import { z } from "zod";
import { artifactImageSchema } from "./artifact-image.js";

/** Only native image envelopes from these explicit routes become MCP image content. */
export function toolImageResponse(name: string, input: unknown, data: unknown) {
  const read = z
    .object({ action: z.literal("read_artifact"), as: z.literal("image") })
    .safeParse(input);
  if (name === "workflow_run" && read.success) {
    const { image, ...metadata } = artifactImageSchema.parse(data);
    return { data: metadata, image };
  }
  if (["ui_test", "ui_review", "verify_ui"].includes(name)) {
    const result = z
      .object({ inline_review: artifactImageSchema.loose().optional() })
      .loose()
      .safeParse(data);
    if (result.success && result.data.inline_review) {
      const { image, ...metadata } = result.data.inline_review;
      return { data: { ...result.data, inline_review: metadata }, image };
    }
  }
  return { data, image: undefined };
}
