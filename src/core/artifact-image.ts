import { z } from "zod";

export const maximumImageBytes = 8 * 1024 * 1024;
// The Worker validates the encoded file before this bounded transport envelope.
export const artifactImageSchema = z.strictObject({
  artifact_id: z.string().uuid(),
  mime: z.enum(["image/png", "image/jpeg"]),
  bytes: z.number().int().positive().max(maximumImageBytes),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  review_reads: z.array(z.strictObject({ review_id: z.string().uuid(), read_token: z.string().uuid() })).max(256).optional(),
  image: z.strictObject({
    type: z.literal("image"),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    data: z
      .string()
      .min(4)
      .max(4 * Math.ceil(maximumImageBytes / 3)),
  }),
});
