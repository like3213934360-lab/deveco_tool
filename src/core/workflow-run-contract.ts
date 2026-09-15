import { z } from "zod";
import { requirementBindingsSchema } from "./acceptance-contracts.js";

const runId = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const detail = z.enum(["summary", "full"]).default("summary");
const offset = z.number().int().nonnegative().default(0);
const limit = z.number().int().min(1).max(65536).optional();
const wait = z
  .number()
  .int()
  .min(0)
  .max(20000)
  .default(1000)
  .describe(
    "Bounded observation only; timeout/observer cancellation leaves the durable run active.",
  );

const startFields = {
  action: z.literal("start"),
  requirements: requirementBindingsSchema.optional(),
  request_key: z.string().min(1).max(256).optional(),
  wait_ms: wait,
  detail,
};
export function workflowStartContract<N extends string, S extends z.ZodType>(
  workflow: N,
  input: S,
) {
  return z.strictObject({
    ...startFields,
    workflow: z.literal(workflow),
    input,
  });
}

const observation = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), offset, limit, detail }),
  z.strictObject({
    action: z.literal("status"),
    run_id: runId,
    wait_ms: wait,
    detail,
  }),
  z.strictObject({
    action: z.literal("resume"),
    run_id: runId,
    wait_ms: wait,
    detail,
    resume_input: z.strictObject({ action: z.literal("recheck") }).optional(),
  }),
  z.strictObject({ action: z.literal("cancel"), run_id: runId, detail }),
  z.strictObject({
    action: z.literal("read_events"),
    run_id: runId,
    offset,
    limit: z.number().int().min(1).max(100).optional(),
  }),
]);
const resultPage = {
  action: z.literal("read_result"),
  run_id: runId,
  section: z.enum(["result", "error", "input", "artifacts"]).default("result"),
  limit,
};
const imageRequest = { action: z.literal("read_artifact"), artifact_id: runId };
export const workflowObservationContract = z.union([
  observation,
  z.strictObject({
    ...resultPage,
    offset: z.literal(0).default(0),
    expected_sha256: sha256.optional(),
  }),
  z.strictObject({
    ...resultPage,
    offset: z.number().int().positive(),
    expected_sha256: sha256,
  }),
  z.strictObject({
    ...imageRequest,
    as: z.literal("page").default("page"),
    offset,
    limit,
  }),
  z.strictObject({
    ...imageRequest,
    as: z.literal("image"),
    offset: z.literal(0).default(0),
    limit: z.never().optional(),
  }),
]);

const runIds = z.array(runId).min(1).max(100);
// Shared by maintenance and the retained workflow_run storage aliases.
export const storageContracts = [
  z.strictObject({
    action: z.literal("capacity"),
    additional_bytes: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  }),
  z.strictObject({ action: z.literal("cleanup_plan"), run_ids: runIds }),
  z.strictObject({
    action: z.literal("cleanup_apply"),
    run_ids: runIds,
    plan_hash: sha256,
  }),
  z.strictObject({
    action: z.literal("export"),
    run_ids: runIds,
    export_directory: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("storage_receipt"),
    receipt_id: z.string().regex(/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/),
  }),
] as const;
export const storageContract = z.discriminatedUnion("action", storageContracts);
