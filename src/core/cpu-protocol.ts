import { z } from "zod";
import type { parseCrash } from "../services/crash.js";
import type { parseUiDump } from "../services/ui-parse.js";
import type { parseLintReport } from "../services/lint-report.js";
import {
  checkerPreviewSchema,
  type parseCheckerReport,
} from "../services/checker-report.js";
import { uiNodesSchema } from "../services/ui-node-schema.js";

export const cpuTaskSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("checker"),
    content: z.string().max(16 * 1024 * 1024),
  }),
  z.strictObject({
    kind: z.literal("lint"),
    content: z.string().max(16 * 1024 * 1024),
    limit: z.number().int().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("ui"),
    content: z.string().max(32 * 1024 * 1024),
    format: z.enum(["uitest", "nodes"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("crash"),
    content: z.string().max(8 * 1024 * 1024),
    options: z
      .strictObject({
        bundle_name: z.string().max(256).optional(),
        process_hint: z.string().max(256).optional(),
        truncated: z.boolean().optional(),
        selection_complete: z.boolean().optional(),
        faultlog_name: z.string().max(512).optional(),
      })
      .optional(),
  }),
]);
export type CpuTask = z.infer<typeof cpuTaskSchema>;
export type CpuResult<K extends CpuTask["kind"]> = K extends "ui"
  ? ReturnType<typeof parseUiDump>
  : K extends "lint"
    ? ReturnType<typeof parseLintReport>
    : K extends "checker"
      ? ReturnType<typeof parseCheckerReport>
      : ReturnType<typeof parseCrash>;
const nullableText = z.string().nullable();
const uiResult = z.object({
  nodes: uiNodesSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  structureSignature: z.string().regex(/^[a-f0-9]{64}$/),
});
const crashLocation = z.object({
  raw: z.string().max(2048),
  stack_index: z.number().int().min(0).max(99),
  file: z.string().max(2048),
  line: z.number().int().min(1).max(2147483647),
  column: z.number().int().min(1).max(2147483647).nullable(),
  frame_bundle: z.string().max(256).nullable(),
  module: z.string().max(256).nullable(),
  version: z.string().max(128).nullable(),
  score: z.number(),
  classification: z.enum([
    "dependency",
    "application_candidate",
    "unclassified",
  ]),
  reasons: z.array(z.string()).max(5),
  file_verified: z.literal(false),
});
const crashResult = z.object({
  evidencePresent: z.boolean(),
  status: z.string(),
  kind: z.string().max(256),
  error_message: z.string().max(2048).nullable(),
  error_code: z.string().max(64).nullable(),
  source_map_status: z.enum(["unavailable", "unspecified"]),
  source: nullableText,
  bundle: nullableText,
  process: nullableText,
  pid: nullableText,
  frames: z.array(z.string()).max(100),
  ranked_frames: z.array(crashLocation).max(100),
  suspected_location: crashLocation.nullable(),
  suspected_file: z.string().max(2048).nullable(),
  next_action: z.enum([
    "collect_attributed_crash_evidence",
    "inspect_candidate_source_and_compare_pattern_evidence",
    "inspect_stack_or_collect_symbolized_evidence",
  ]),
  excerpt: z.array(z.string()).max(32),
  event_count: z.number().int(),
  matching_event_count: z.number().int(),
  evidence_truncated: z.boolean(),
  selection_complete: z.boolean(),
  unattributed_events: z.boolean(),
  diagnosisComplete: z.boolean(),
  compilationVerified: z.boolean(),
}) satisfies z.ZodType<ReturnType<typeof parseCrash>>;
const lintResult = z.object({
  summary: z.object({
    files_reported: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    suggestions: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }),
  report: z
    .array(
      z.object({
        file: z.string().max(1024),
        line: z.number().int().nonnegative(),
        column: z.number().int().nonnegative(),
        severity: z.string().max(64),
        message: z.string().max(2048),
        rule: z.string().max(256),
        truncated: z.boolean(),
      }),
    )
    .max(200),
  truncated: z.boolean(),
});
export const cpuResultSchemas = {
  ui: uiResult,
  crash: crashResult,
  lint: lintResult,
  checker: checkerPreviewSchema,
};
export const cpuReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    id: z.number().int(),
    ok: z.literal(true),
    data: z.unknown(),
    elapsed_ms: z.number().nonnegative(),
  }),
  z.strictObject({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      retryable: z.boolean(),
    }),
  }),
]);
export const cpuRequestSchema = z.strictObject({
  id: z.number().int(),
  task: cpuTaskSchema,
});
