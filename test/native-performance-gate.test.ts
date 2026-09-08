import test from "node:test";
import assert from "node:assert/strict";
import { requiredPerformance } from "../scripts/lib/acceptance-requirements.js";
import { validatePerformance } from "../scripts/lib/performance-gate.js";
import { validateSoak } from "../scripts/lib/soak-gate.js";

const samples = (count: number, value = 1) => Array<number>(count).fill(value), hash = "a".repeat(64);
function performanceFixture() {
  const cold = { initialize_ms: samples(30, 100), directory_ms: samples(30, 20), total_ms: samples(30, 120) };
  const ui = (nodes: number) => ({ input_sha256: hash, nodes, parse_ms: samples(30), parse_cpu_us: samples(30), parse_rss_bytes: samples(30, 10000), queries: Array.from({ length: 4 }, (_, index) => ({ input: { key: `${index}` }, result_count: 1, ms: samples(1000), cpu_us: samples(1000), rss_bytes: samples(1000, 10000) })) });
  return { format: 2, passed: true, tested: {}, environment: hash, baseline_environment: hash, cold: { native: structuredClone(cold), baseline: structuredClone(cold) }, cold_ms: samples(30, 120), expected_capabilities: [...requiredPerformance], direct: requiredPerformance.map((capability) => ({ capability, input_sha256: hash, baseline_input_sha256: hash, native_ms: samples(1000), baseline_ms: samples(1000) })), ui: ([['small', 101], ['medium', 1001], ['large', 10001]] as const).map(([size, nodes]) => ({ size, native: ui(nodes), baseline: ui(nodes) })), orchestration_ms: samples(1000), checkpoint_ms: samples(1000), persistent_graph_ms: samples(1000) };
}
test("performance gate rejects missing capabilities, unequal inputs, invented phases and missing RSS", () => {
  assert.doesNotThrow(() => validatePerformance(performanceFixture()));
  const duplicate = performanceFixture(); duplicate.direct[1]!.capability = duplicate.direct[0]!.capability;
  assert.throws(() => validatePerformance(duplicate), { code: "RELEASE_PERFORMANCE_COVERAGE" });
  const inputs = performanceFixture(); inputs.direct[0]!.baseline_input_sha256 = "b".repeat(64);
  assert.throws(() => validatePerformance(inputs), { code: "RELEASE_DIRECT_REGRESSION" });
  const cold = performanceFixture(); cold.cold.native.total_ms[0] = 121;
  assert.throws(() => validatePerformance(cold), { code: "RELEASE_COLD_SAMPLES" });
  const rss = performanceFixture(); rss.ui[0]!.native.queries[0]!.rss_bytes[0] = 0;
  assert.throws(() => validatePerformance(rss), { code: "RELEASE_UI_SAMPLE_MISSING" });
  const slow = performanceFixture(); slow.direct[0]!.native_ms.fill(1.051);
  assert.throws(() => validatePerformance(slow), { code: "RELEASE_DIRECT_REGRESSION" });
});

function soakFixture() {
  const retained = { tasks: 0, listeners: 0, connections: 0, processes: 0, cache_entries: 0, workers: 0 };
  const metric = { value: 100, source: "fixture" }, unavailable = { value: null, reason: "unsupported fixture platform" };
  const process = { cpu_us: metric, rss_bytes: metric, written_bytes: unavailable, process_starts: metric };
  return { format: 2, passed: true, tested: {}, scopes: ["sdk", "lsp", "ui", "watch"], elapsed_ms: 3600000, samples: Array.from({ length: 61 }, (_, index) => ({ elapsed_ms: index * 60000, mcp: process, sdk: process, retained: { ...retained }, activity: { sdk_builds: 1 + index, lsp_requests: 1 + index, ui_requests: 1 + index, watch_connected: true } })), idle_elapsed_ms: 360000, idle_samples: Array.from({ length: 13 }, (_, index) => ({ ...retained, elapsed_ms: index * 30000 })), final: { ...retained }, cancellations: [{ scope: "sdk_watch", elapsed_ms: 10, confirmed: true }, { scope: "mcp_runtime", elapsed_ms: 20, confirmed: true }], cancel_ms: [10, 20] };
}
test("soak gate requires activity, continuity and zero retained owned resources after idle", () => {
  assert.doesNotThrow(() => validateSoak(soakFixture()));
  const leaked = soakFixture(); leaked.idle_samples.at(-1)!.connections = 1;
  assert.throws(() => validateSoak(leaked), { code: "RELEASE_RECLAMATION_FAILED" });
  const inactive = soakFixture(); for (const sample of inactive.samples) sample.activity.sdk_builds = 1;
  assert.throws(() => validateSoak(inactive), { code: "RELEASE_SOAK_ACTIVITY" });
  const gap = soakFixture(); gap.samples[30]!.elapsed_ms += 180000;
  assert.throws(() => validateSoak(gap), { code: "RELEASE_SOAK_SAMPLE_GAP" });
  const capacity = soakFixture(); capacity.samples[1]!.retained.workers = 3;
  assert.throws(() => validateSoak(capacity), { code: "RELEASE_SOAK_CAPACITY" });
});
