import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
export const requirementBindingSchema = z.strictObject({ id, revision: z.number().int().min(1), text: z.string().trim().min(1).max(16384) });
export const requirementBindingsSchema = z.array(requirementBindingSchema).min(1).max(100).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Requirement IDs must be unique");
export const domainAcceptanceSchema = z.strictObject({
  action: z.literal("assess"), project_path: z.string().min(1).optional(), product: z.string().optional(), module_targets: z.record(z.string(),z.string()).optional(),
  previous_assessment_id: z.string().uuid().optional(),
  evidence_run_ids: z.array(z.string().uuid()).max(100).default([]).describe("Resolve captured requirement/task/assertion/review links from selected runs and their verified build/deployment references. Ambiguous task mappings remain explicit."),
  requirements: z.array(requirementBindingSchema.extend({
    original_text: z.string().trim().min(1).max(16384),
    history: z.array(z.strictObject({ revision: z.number().int().min(1), text: z.string().trim().min(1).max(16384), reason: z.string().trim().min(1).max(4096) })).max(100).default([]),
    task_ids: z.array(id).min(1).max(100), mode: z.enum(["build-only","run","ui","host-review"]),
  })).min(1).max(100).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Requirement IDs must be unique"),
  evidence: z.array(z.strictObject({ requirement_id: id, requirement_revision: z.number().int().min(1), task_id: id, run_id: z.string().uuid(), assertion_id: id.optional(), review_id: z.string().uuid().optional() })).max(400).default([]),
  host_reviews: z.array(z.strictObject({ requirement_id: id, requirement_revision: z.number().int().min(1), task_id: id,
    assessment: z.enum(["satisfied","not_satisfied","inconclusive"]), observations: z.string().trim().min(10).max(16384), evidence_artifact_ids: z.array(z.string().uuid()).max(32).default([]) })).max(100).default([]),
});
