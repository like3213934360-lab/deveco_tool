import { z } from "zod";
import type { parseCrash } from "../services/crash.js";
import type { parseUiDump } from "../services/ui-parse.js";

export const cpuTaskSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ui"),
    content: z.string().max(32 * 1024 * 1024),
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
  : ReturnType<typeof parseCrash>;
const rect = z.object({
  x1: z.number().finite(),
  x2: z.number().finite(),
  y1: z.number().finite(),
  y2: z.number().finite(),
});
const nullableText = z.string().nullable(),
  flag = z.boolean().nullable();
const uiResult = z.object({
  nodes: z
    .array(
      z.object({
        parent: z.number().int().nonnegative().nullable(),
        depth: z.number().int().nonnegative(),
        id: nullableText,
        type: z.string(),
        key: nullableText,
        text: z.string(),
        rect: rect.nullable(),
        checked: flag,
        selected: flag,
        enabled: flag,
        clickable: flag,
        visible: flag,
        value: z.union([z.string(), z.number()]).nullable(),
        displayId: nullableText,
        windowId: nullableText,
        bundleName: nullableText,
        abilityName: nullableText,
        focused: flag,
        checkable: flag,
        pagePath: nullableText,
      }),
    )
    .min(1)
    .max(100000),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  structureSignature: z.string().regex(/^[a-f0-9]{64}$/),
});
const crashResult = z.object({
  evidencePresent: z.boolean(),
  status: z.string(),
  kind: z.string(),
  error_message: nullableText,
  source: nullableText,
  bundle: nullableText,
  process: nullableText,
  pid: nullableText,
  frames: z.array(z.string()).max(100),
  excerpt: z.array(z.string()).max(32),
  event_count: z.number().int(),
  matching_event_count: z.number().int(),
  evidence_truncated: z.boolean(),
  selection_complete: z.boolean(),
  unattributed_events: z.boolean(),
  diagnosisComplete: z.boolean(),
  compilationVerified: z.boolean(),
});
export const cpuResultSchemas = { ui: uiResult, crash: crashResult };
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
