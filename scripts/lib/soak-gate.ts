import { z } from "zod";
import { atomicWrite, digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { processSampleSchema } from "./process-metrics.js";

const count = z.number().int().nonnegative(), elapsed = z.number().finite().nonnegative();
const retained = z.object({ tasks: count, listeners: count, connections: count, processes: count, cache_entries: count, workers: count });
export const soakReportSchema = z.object({
  format: z.literal(2), tested: z.record(z.string(), z.unknown()), passed: z.literal(true), elapsed_ms: elapsed.min(3600000),
  scopes: z.array(z.enum(["sdk", "lsp", "ui", "watch"])).length(4),
  samples: z.array(z.object({ elapsed_ms: elapsed, mcp: processSampleSchema, sdk: processSampleSchema, retained, activity: z.object({ sdk_builds: count.positive(), lsp_requests: count.positive(), ui_requests: count.positive(), watch_connected: z.literal(true) }) })).min(60),
  idle_elapsed_ms: elapsed.min(360000), idle_samples: z.array(retained.extend({ elapsed_ms: elapsed })).min(12),
  final: retained,
  cancellations: z.array(z.object({ scope: z.enum(["sdk_watch", "mcp_runtime"]), elapsed_ms: elapsed.max(120000), confirmed: z.literal(true) })).length(2),
  cancel_ms: z.array(elapsed).length(2),
});
export function validateSoak(raw: unknown) {
  const report = soakReportSchema.parse(raw);
  invariant(new Set(report.scopes).size === 4, "RELEASE_SOAK_INCOMPLETE", "SDK, LSP, UI and watch must all be exercised");
  const continuity = (samples: { elapsed_ms: number }[], duration: number, maximumGap: number) => {
    invariant(samples[0]!.elapsed_ms <= maximumGap && samples.at(-1)!.elapsed_ms >= duration, "RELEASE_SOAK_INCOMPLETE", "Samples must span the full active or idle window");
    for (let index = 1; index < samples.length; index++) invariant(samples[index]!.elapsed_ms > samples[index - 1]!.elapsed_ms && samples[index]!.elapsed_ms - samples[index - 1]!.elapsed_ms <= maximumGap, "RELEASE_SOAK_SAMPLE_GAP", "Samples must be ordered without unobserved long gaps");
  };
  continuity(report.samples, 3600000, 120000); continuity(report.idle_samples, 360000, 60000);
  for (let index = 0; index < report.samples.length; index++) {
    const sample = report.samples[index]!;
    invariant(sample.retained.tasks <= 32 && sample.retained.connections <= 36 && sample.retained.processes <= 32 && sample.retained.cache_entries <= 10 && sample.retained.workers <= 2, "RELEASE_SOAK_CAPACITY", "Owned runtime capacity exceeds fixed production bounds");
    if (index) for (const key of ["sdk_builds", "lsp_requests", "ui_requests"] as const) invariant(sample.activity[key] >= report.samples[index - 1]!.activity[key], "RELEASE_SOAK_ACTIVITY", "Activity counters cannot move backwards");
  }
  const last = report.samples.at(-1)!;
  invariant(last.activity.sdk_builds >= 30 && last.activity.lsp_requests >= 60 && last.activity.ui_requests >= 60, "RELEASE_SOAK_ACTIVITY", "A long idle process alone is not a real SDK/LSP/UI/watch soak");
  for (const row of [report.final, report.idle_samples.at(-1)!]) for (const key of ["tasks", "listeners", "connections", "processes", "cache_entries", "workers"] as const) invariant(row[key] === 0, "RELEASE_RECLAMATION_FAILED", `Owned ${key} must fully reclaim; report-defined limits cannot waive this`);
  invariant(new Set(report.cancellations.map((item) => item.scope)).size === 2 && digest(report.cancel_ms) === digest(report.cancellations.map((item) => item.elapsed_ms)), "RELEASE_CANCELLATION_INCOMPLETE", "Both SDK watch and runtime closure need matching confirmed cancellation timings");
  return report;
}

// Validate the same root object that is serialized, before publishing success.
// Failed/running reports stay available when final validation rejects a report.
export function writeSoakReport(file: string, raw: unknown): void {
  const envelope = z.object({ status: z.enum(["running", "idle_reclamation", "passed", "failed"]), passed: z.boolean() }).parse(raw);
  invariant(envelope.passed === (envelope.status === "passed"), "SOAK_STATUS_MISMATCH", "Soak status and passed flag must agree");
  if (envelope.passed) validateSoak(raw);
  atomicWrite(file, JSON.stringify(raw, null, 2) + "\n");
}
