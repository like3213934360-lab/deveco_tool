import { z } from "zod";
import type { StateStore } from "../core/store.js";
import { errorResult, invariant } from "../core/errors.js";
import { artifactImageSchema } from "../core/artifact-image.js";
import { readImageArtifact } from "./artifact.js";
import type { UiReviewService } from "./ui-review.js";

/** One pending review per response, from a known native result field. */
export function attachReviewImage(
  data: unknown,
  store: StateStore,
  reviews: UiReviewService,
  signal?: AbortSignal,
) {
  const result = z
    .object({
      review_id: z.string().uuid().optional(),
      next: z
        .object({
          review: z.object({ review_id: z.string().uuid() }).optional(),
        })
        .optional(),
    })
    .passthrough()
    .safeParse(data);
  if (!result.success) return data;
  const id = result.data.next?.review?.review_id ?? result.data.review_id;
  if (!id) return data;
  let review: ReturnType<UiReviewService["status"]>;
  try {
    review = reviews.status(id);
  } catch {
    return data;
  }
  if (review.status !== "required") return data;
  const read = {
    tool: "workflow_run",
    arguments: {
      action: "read_artifact",
      artifact_id: review.artifact_id,
      as: "image",
    },
  };
  try {
    signal?.throwIfAborted();
    const image = artifactImageSchema.parse(
      readImageArtifact(store, review.artifact_id),
    );
    invariant(
      image.sha256 === review.sha256,
      "UI_REVIEW_EVIDENCE_CHANGED",
      "Screenshot bytes differ from this review",
    );
    const receipt = image.review_reads?.find((item) => item.review_id === id);
    invariant(
      receipt,
      "UI_REVIEW_IMAGE_NOT_READ",
      "No matching image read receipt was generated",
    );
    return {
      ...(data as object),
      inline_review: {
        review_id: id,
        requirement: review.requirement,
        assertion_status: review.assertion_status,
        ...image,
        read,
        complete: {
          tool: "ui_review",
          arguments: {
            action: "complete",
            review_id: id,
            artifact_id: image.artifact_id,
            sha256: image.sha256,
            read_token: receipt.read_token,
          },
          requires: ["assessment"],
        },
        verified: false,
        assessment_source: "host_visual_assessment",
      },
    };
  } catch (error) {
    // No token is returned without its image envelope. Historical artifact reads remain available.
    return {
      ...(data as object),
      image_delivery: {
        delivered: false,
        review_id: id,
        read,
        error: errorResult(error),
      },
    };
  }
}
