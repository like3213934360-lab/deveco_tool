import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { PayloadCipher } from "../core/crypto.js";
import { invariant } from "../core/errors.js";
import { digest } from "../core/files.js";
import type { StateStore } from "../core/store.js";
import { maximumImageBytes } from "../core/artifact-image.js";

export const visualAssessmentSchema = z.strictObject({
  outcome: z.enum(["passed", "failed", "insufficient"]),
  observations: z.string().trim().min(10).max(8192),
});
const payloadSchema = z.strictObject({
  target: z.string(),
  requirement: z.string().min(1).max(4096),
  assertion_status: z.enum(["passed", "failed", "not_requested"]),
  assessment: visualAssessmentSchema.optional(),
  completion_hash: z.string().optional(),
});
interface Row {
  id: string;
  run_id: string;
  artifact_id: string;
  sha256: string;
  status: "required" | "passed" | "failed" | "insufficient" | "cancelled";
  payload: string;
  read_token: string | null;
  read_at: number | null;
  created: number;
  updated: number;
}

/** The native service binds evidence; the host explicitly supplies its visual assessment. */
export class UiReviewService {
  private readonly cipher: PayloadCipher;
  constructor(readonly store: StateStore) {
    this.cipher = new PayloadCipher(path.join(store.root, "ui-review.key"));
  }
  private row(id: string): Row {
    const row = this.store.db
      .prepare("SELECT * FROM ui_reviews WHERE id=?")
      .get(id) as Row | undefined;
    invariant(
      row,
      "UI_REVIEW_NOT_FOUND",
      "Review is unknown or its retained screenshot has expired",
    );
    return row;
  }
  private payload(row: Row) {
    return payloadSchema.parse(
      JSON.parse(this.cipher.open(row.id, row.payload)),
    );
  }
  create(input: {
    run_id: string;
    target: string;
    requirement: string;
    assertion_status: "passed" | "failed" | "not_requested";
    artifact_id: string;
    sha256: string;
  }) {
    return this.store.db
      .transaction(() => {
        invariant(
          (
            this.store.db
              .prepare(
                "SELECT COUNT(*) AS count FROM ui_reviews WHERE status='required'",
              )
              .get() as { count: number }
          ).count < 256,
          "UI_REVIEW_CAPACITY",
          "Complete or cancel existing visual reviews; at most 256 pending reviews",
        );
        const artifact = this.store.db
          .prepare("SELECT run_id,mime FROM artifacts WHERE id=?")
          .get(input.artifact_id) as
          { run_id: string; mime: string } | undefined;
        invariant(
          artifact && ["image/png", "image/jpeg"].includes(artifact.mime),
          "UI_REVIEW_EVIDENCE_MISSING",
          "A retained screenshot is required",
        );
        invariant(
          artifact.run_id === input.run_id,
          "UI_REVIEW_EVIDENCE_OWNER",
          "Review and screenshot must belong to the same captured run",
        );
        // The owning artifact is authoritative even for callers outside a workflow.
        const id = randomUUID(),
          now = Date.now(),
          payload = JSON.stringify(
            payloadSchema.parse({
              target: input.target,
              requirement: input.requirement,
              assertion_status: input.assertion_status,
            }),
          );
        this.store.capacity(Buffer.byteLength(payload) * 2 + 4096);
        this.store.db
          .prepare("INSERT INTO ui_reviews VALUES (?,?,?,?,?,?,NULL,NULL,?,?)")
          .run(
            id,
            artifact.run_id,
            input.artifact_id,
            input.sha256,
            "required",
            this.cipher.seal(id, payload),
            now,
            now,
          );
        return {
          review_id: id,
          read_with: "workflow_run read_artifact as=image",
          complete_with: "ui_review complete",
        };
      })
      .immediate();
  }
  status(id: string) {
    const row = this.row(id),
      value = this.payload(row);
    return {
      review_id: row.id,
      run_id: row.run_id,
      target: value.target,
      status: row.status,
      requirement: value.requirement,
      assertion_status: value.assertion_status,
      verified: row.status === "passed" && value.assertion_status !== "failed",
      artifact_id: row.artifact_id,
      sha256: row.sha256,
      image_read_at: row.read_at,
      assessment: value.assessment ?? null,
      assessment_source: "host_visual_assessment" as const,
      created_at: row.created,
      updated_at: row.updated,
    };
  }
  list(offset = 0, limit = 50) {
    return this.store.db
      .prepare(
        "SELECT id AS review_id,run_id,artifact_id,status,created,updated FROM ui_reviews ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset);
  }
  complete(
    id: string,
    input: {
      artifact_id: string;
      sha256: string;
      read_token: string;
      assessment: z.infer<typeof visualAssessmentSchema>;
    },
  ) {
    return this.store.db
      .transaction(() => {
        const row = this.row(id),
          value = this.payload(row),
          assessment = visualAssessmentSchema.parse(input.assessment),
          completion = digest({
            artifact_id: input.artifact_id,
            sha256: input.sha256,
            read_token: input.read_token,
            assessment,
          });
        invariant(
          !this.store.db
            .prepare("SELECT 1 FROM run_pins WHERE run_id=?")
            .get(row.run_id),
          "RUN_PINNED",
          "Evidence is being exported; complete the review after its snapshot finishes",
        );
        if (row.status !== "required") {
          invariant(
            value.completion_hash === completion,
            "UI_REVIEW_ALREADY_SETTLED",
            "This review has an immutable completion; capture a new review for a new assessment",
          );
          return this.status(id);
        }
        invariant(
          row.artifact_id === input.artifact_id &&
            row.sha256 === input.sha256 &&
            row.read_token === input.read_token &&
            row.read_at !== null,
          "UI_REVIEW_IMAGE_NOT_READ",
          "Read this exact screenshot as an image and supply its matching review read_token and sha256",
        );
        const image = this.store.readBinaryArtifact(
          row.artifact_id,
          maximumImageBytes,
          ["image/png", "image/jpeg"],
        );
        invariant(
          createHash("sha256").update(image.data).digest("hex") === row.sha256,
          "UI_REVIEW_EVIDENCE_CHANGED",
          "Screenshot bytes no longer match this review",
        );
        const json = JSON.stringify({
          ...value,
          assessment,
          completion_hash: completion,
        });
        this.store.capacity(Buffer.byteLength(json) * 2 + 4096);
        this.store.db
          .prepare(
            "UPDATE ui_reviews SET status=?,payload=?,updated=? WHERE id=? AND status='required'",
          )
          .run(assessment.outcome, this.cipher.seal(id, json), Date.now(), id);
        this.store.event(row.run_id, "ui_review_completed", {
          review_id: id,
          artifact_id: row.artifact_id,
          sha256: row.sha256,
          outcome: assessment.outcome,
          assertion_status: value.assertion_status,
          source: "host_visual_assessment",
        });
        return this.status(id);
      })
      .immediate();
  }
  cancel(id: string) {
    return this.store.db
      .transaction(() => {
        const row = this.row(id);
        invariant(
          !this.store.db
            .prepare("SELECT 1 FROM run_pins WHERE run_id=?")
            .get(row.run_id),
          "RUN_PINNED",
          "Evidence is being exported; cancel the review after its snapshot finishes",
        );
        this.store.db
          .prepare(
            "UPDATE ui_reviews SET status='cancelled',updated=? WHERE id=? AND status='required'",
          )
          .run(Date.now(), id);
        return this.status(id);
      })
      .immediate();
  }
  close() {
    this.cipher.close();
  }
}
