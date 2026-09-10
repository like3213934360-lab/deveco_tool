import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";

export const preflightPolicySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("check") }),
  z.strictObject({
    mode: z.literal("manual_override"),
    reason: z.string().trim().min(10).max(1024),
  }),
]);
export type PreflightPolicy = z.infer<typeof preflightPolicySchema>;
const reportSchema = z
  .object({
    success: z.boolean(),
    checked_file_count: z.number().int().nonnegative(),
    summary: z.object({
      errorCount: z.number().int().nonnegative(),
      warnCount: z.number().int().nonnegative(),
    }),
    artifact: z.object({ artifact_id: z.string() }).passthrough(),
  })
  .passthrough();

/** A preflight is run immediately before each build/hot apply, under its
 * project lease. We never reuse a partial file check or an earlier checkpoint
 * as proof that current sources are clear of blocking diagnostics. */
export async function buildPreflight(
  store: StateStore,
  policy: PreflightPolicy,
  check: () => Promise<unknown>,
  identity: () => string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (policy.mode === "manual_override") {
    const result = {
      status: "overridden",
      reason: policy.reason,
      compilationVerified: false,
    };
    store.event(currentTrace().run_id ?? null, "build_preflight", result);
    return result;
  }
  const before = identity(),
    report = reportSchema.parse(await check());
  signal?.throwIfAborted();
  invariant(
    before === identity(),
    "CHECK_EVIDENCE_STALE",
    "Project or source bytes changed during preflight. Check the current files before building.",
  );
  const result = {
    status:
      report.success && report.summary.errorCount === 0 ? "passed" : "blocked",
    checked_file_count: report.checked_file_count,
    summary: report.summary,
    artifact: report.artifact,
    source_identity: before,
    compilationVerified: false,
  };
  store.event(currentTrace().run_id ?? null, "build_preflight", result);
  if (result.status === "blocked")
    throw new ToolError(
      "BUILD_CHECK_BLOCKED",
      "ArkTS preflight found blocking diagnostics. Read the report, fix the sources and start a fresh build; Hvigor was not started. An explicit manual_override with a reason is available for deliberate compiler investigation.",
      result,
    );
  return result;
}
