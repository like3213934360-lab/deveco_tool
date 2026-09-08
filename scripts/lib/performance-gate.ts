import { z } from "zod";
import { digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { requiredPerformance } from "./acceptance-requirements.js";
import { baselineAbsenceSchema } from "./benchmark-comparison.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/), samples = z.array(z.number().finite().nonnegative());
const cold = z.object({ initialize_ms: samples.min(30), directory_ms: samples.min(30), total_ms: samples.min(30) });
const uiVersion = z.object({ input_sha256: sha, nodes: z.number().int().positive(), parse_ms: samples.min(30), parse_cpu_us: samples.min(30), parse_rss_bytes: samples.min(30), queries: z.array(z.object({ input: z.unknown(), result_count: z.number().int().nonnegative(), ms: samples.min(1000), cpu_us: samples.min(1000), rss_bytes: samples.min(1000) })).length(4) });
export const performanceReportSchema = z.object({
  format: z.literal(3), passed: z.literal(true), tested: z.record(z.string(), z.unknown()),
  baseline: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), entry_sha256: sha, lock_sha256: sha }),
  environment: sha, baseline_environment: sha, cold: z.object({ native: cold, baseline: cold }), cold_ms: samples.min(30),
  direct: z.array(z.discriminatedUnion("comparison", [
    z.strictObject({ comparison: z.literal("paired"), capability: z.enum(requiredPerformance), input_sha256: sha, baseline_input_sha256: sha, native_ms: samples.min(1000), baseline_ms: samples.min(1000) }),
    z.strictObject({ comparison: z.literal("new"), capability: z.literal("app_signature.inspect"), input_sha256: sha, native_ms: samples.min(1000), baseline_absence: baselineAbsenceSchema }),
  ])).length(requiredPerformance.length),
  expected_capabilities: z.array(z.enum(requiredPerformance)).length(requiredPerformance.length),
  ui: z.array(z.object({ size: z.enum(["small", "medium", "large"]), native: uiVersion, baseline: uiVersion })).length(3),
  orchestration_ms: samples.min(1000), checkpoint_ms: samples.min(1000), persistent_graph_ms: samples.min(1000),
});
export const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]!;
export function validatePerformance(raw: unknown) {
  const report = performanceReportSchema.parse(raw);
  invariant(report.environment === report.baseline_environment, "RELEASE_PERFORMANCE_ENVIRONMENT", "Versions must be measured on the same machine and environment");
  for (const record of Object.values(report.cold)) invariant(record.initialize_ms.length === record.directory_ms.length && record.directory_ms.length === record.total_ms.length && record.total_ms.every((value, index) => Math.abs(value - record.initialize_ms[index]! - record.directory_ms[index]!) < .001), "RELEASE_COLD_SAMPLES", "Cold phase timings must describe the same samples");
  invariant(digest(report.cold_ms) === digest(report.cold.native.total_ms) && p95(report.cold.native.initialize_ms) <= 1000 && p95(report.cold.native.directory_ms) <= 1000 && p95(report.cold_ms) <= 1000, "RELEASE_COLD_PERFORMANCE", "Cold initialize plus directory P95 must be at most one second");
  const required = digest([...requiredPerformance].sort());
  invariant(digest(report.direct.map((item) => item.capability).sort()) === required && digest([...report.expected_capabilities].sort()) === required, "RELEASE_PERFORMANCE_COVERAGE", "Every direct capability requires exactly one validated comparison");
  for (const item of report.direct) {
    if (item.comparison === "new") {
      invariant(item.baseline_absence.commit === report.baseline.commit, "RELEASE_BASELINE_CONTRACT", "Absent-operation evidence belongs to another baseline");
    } else {
      invariant(item.input_sha256 === item.baseline_input_sha256 && p95(item.baseline_ms) > 0 && p95(item.native_ms) <= p95(item.baseline_ms) * 1.05, "RELEASE_DIRECT_REGRESSION", `Direct capability exceeds 5% P95 budget: ${item.capability}`);
    }
  }
  invariant(new Set(report.ui.map((item) => item.size)).size === 3, "RELEASE_UI_PERFORMANCE", "Three distinct UI size classes are required");
  for (const row of report.ui) {
    const count = { small: 101, medium: 1001, large: 10001 }[row.size];
    invariant(row.native.nodes === count && row.baseline.nodes === count && row.native.input_sha256 === row.baseline.input_sha256, "RELEASE_UI_INPUT_CHANGED", "Native and baseline UI size and input must match");
    for (const version of [row.native, row.baseline]) {
      invariant(version.parse_ms.length === version.parse_cpu_us.length && version.parse_ms.length === version.parse_rss_bytes.length && version.parse_rss_bytes.every((value) => value > 0), "RELEASE_UI_SAMPLE_MISSING", "Every parse sample needs CPU and RSS measurements");
      for (const query of version.queries) invariant(query.ms.length === query.cpu_us.length && query.ms.length === query.rss_bytes.length && query.rss_bytes.every((value) => value > 0), "RELEASE_UI_SAMPLE_MISSING", "Every selector sample needs CPU and RSS measurements");
    }
    invariant(digest(row.native.queries.map(({ input, result_count }) => ({ input, result_count }))) === digest(row.baseline.queries.map(({ input, result_count }) => ({ input, result_count }))), "RELEASE_UI_RESULT_CHANGED", "UI comparisons must check identical selectors and result counts");
  }
  return report;
}
