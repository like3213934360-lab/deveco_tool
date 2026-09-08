import test from "node:test";
import assert from "node:assert/strict";
import { requiredPerformance } from "../scripts/lib/acceptance-requirements.js";
import { validatePerformance } from "../scripts/lib/performance-gate.js";
import { validateSoak, writeSoakReport } from "../scripts/lib/soak-gate.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirmBaselineAbsence } from "../scripts/lib/benchmark-comparison.js";
import { benchmarkPlanSchema, executeBenchmarkSteps } from "../scripts/lib/benchmark-contracts.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const samples = (count: number, value = 1) => Array<number>(count).fill(value), hash = "a".repeat(64);
function performanceFixture() {
  const cold = { initialize_ms: samples(30, 100), directory_ms: samples(30, 20), total_ms: samples(30, 120) };
  const ui = (nodes: number) => ({ input_sha256: hash, nodes, parse_ms: samples(30), parse_cpu_us: samples(30), parse_rss_bytes: samples(30, 10000), queries: Array.from({ length: 4 }, (_, index) => ({ input: { key: `${index}` }, result_count: 1, ms: samples(1000), cpu_us: samples(1000), rss_bytes: samples(1000, 10000) })) });
  return { format: 3, passed: true, tested: {}, baseline: { commit: "aab1405b51e00e4036bdc8f18ae4229835de77b0", entry_sha256: hash, lock_sha256: hash }, environment: hash, baseline_environment: hash, cold: { native: structuredClone(cold), baseline: structuredClone(cold) }, cold_ms: samples(30, 120), expected_capabilities: [...requiredPerformance], direct: requiredPerformance.map((capability) => ({ comparison: "paired", capability, input_sha256: hash, baseline_input_sha256: hash, native_ms: samples(1000), baseline_ms: samples(1000) })), ui: ([['small', 101], ['medium', 1001], ['large', 10001]] as const).map(([size, nodes]) => ({ size, native: ui(nodes), baseline: ui(nodes) })), orchestration_ms: samples(1000), checkpoint_ms: samples(1000), persistent_graph_ms: samples(1000) };
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

const oldSigningTool = {
  name: "app_signature", inputSchema: {
    type: "object", properties: { force: { type: "boolean" }, team_id: { type: "string" }, product: { type: "string" }, project_path: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 } }, additionalProperties: false,
  },
};
test("new-operation sampling requires the exact frozen public contract and cannot waive existing capabilities", () => {
  const paired = performanceFixture();
  const absence = confirmBaselineAbsence(paired.baseline.commit, [oldSigningTool]);
  assert.throws(() => confirmBaselineAbsence("b".repeat(40), [oldSigningTool]));
  assert.throws(() => confirmBaselineAbsence(paired.baseline.commit, []));
  assert.throws(() => confirmBaselineAbsence(paired.baseline.commit, [oldSigningTool, oldSigningTool]));
  assert.throws(() => confirmBaselineAbsence(paired.baseline.commit, [{ ...oldSigningTool, inputSchema: { ...oldSigningTool.inputSchema, properties: { ...oldSigningTool.inputSchema.properties, action: { enum: ["inspect"] } } } }]));
  const fresh = { comparison: "new", capability: "app_signature.inspect", input_sha256: hash, native_ms: samples(1000), baseline_absence: absence };
  const report = { ...paired, direct: paired.direct.map((item) => item.capability === "app_signature.inspect" ? fresh : item) };
  assert.doesNotThrow(() => validatePerformance(report));
  assert.throws(() => validatePerformance({ ...report, baseline: { ...report.baseline, commit: "b".repeat(40) } }), { code: "RELEASE_BASELINE_CONTRACT" });
  assert.throws(() => validatePerformance({ ...report, direct: report.direct.map((item) => item === fresh ? { ...fresh, native_ms: samples(999) } : item) }));
  assert.throws(() => validatePerformance({ ...report, direct: report.direct.map((item) => item === fresh ? { ...fresh, baseline_ms: samples(1000) } : item) }));
  assert.throws(() => validatePerformance({ ...report, direct: report.direct.map((item) => item.capability === "ui_find" ? { ...fresh, capability: "ui_find" } : item) }));
  assert.throws(() => validatePerformance({ ...report, direct: report.direct.map((item) => item.capability === "ui_find" ? { ...item, native_ms: samples(1000, 1.051) } : item) }), { code: "RELEASE_DIRECT_REGRESSION" });
});

test("benchmark plans reject missing baseline steps and arbitrary unpaired capabilities", () => {
  const step = { tool: "example", arguments: {}, assertions: [{ pointer: "/ok", equals: true }] };
  const plan = { format: 3, baseline_root: "/baseline", baseline_entry: "src/server.mjs", baseline_commit: "a".repeat(40), inputs: [{ file: "/input", sha256: hash }], capabilities: requiredPerformance.map((capability) => ({ capability, comparison: "paired", logical_input: {}, native: [step], baseline: [step] })) };
  assert.equal(benchmarkPlanSchema.safeParse(plan).success, true);
  assert.equal(benchmarkPlanSchema.safeParse({ ...plan, capabilities: plan.capabilities.map((item) => item.capability === "app_signature.inspect" ? { capability: item.capability, comparison: "new", logical_input: {}, native: [step] } : item) }).success, true);
  assert.equal(benchmarkPlanSchema.safeParse({ ...plan, capabilities: plan.capabilities.map((item) => ({ ...item, baseline: [] })) }).success, false);
  assert.equal(benchmarkPlanSchema.safeParse({ ...plan, capabilities: plan.capabilities.map((item) => ({ capability: item.capability, comparison: "new", logical_input: {}, native: [step] })) }).success, false);
});

test("baseline text responses require semantic assertions, preserving every text block and tool failures", async () => {
  const client = (response: unknown) => ({ callTool: async () => response }) as unknown as Client;
  const step = { tool: "code_lint", arguments: {}, assertions: [{ pointer: "/output", contains: "No defects found." }, { pointer: "/output", contains: "Issues: 0" }] };
  for (const content of [
    [{ type: "text", text: "No defects found.\nIssues: 0" }],
    [{ type: "text", text: JSON.stringify("No defects found.\nIssues: 0") }],
    [{ type: "text", text: "No defects found." }, { type: "text", text: "Issues: 0" }],
  ]) await executeBenchmarkSteps(client({ content }), [step]);
  await assert.rejects(executeBenchmarkSteps(client({ content: [{ type: "text", text: "Issues: 2" }] }), [step]), { code: "BENCHMARK_RESULT_MISMATCH" });
  await assert.rejects(executeBenchmarkSteps(client({ content: [{ type: "text", text: "No defects found.\nIssues: 0" }], isError: true }), [step]), { code: "BENCHMARK_TOOL_FAILED" });
  await assert.rejects(executeBenchmarkSteps(client({ content: [] }), [step]), { code: "BENCHMARK_RESULT_MISSING" });
  await executeBenchmarkSteps(client({ structuredContent: { ok: true, data: { reports: [] } } }), [{ tool: "check_cpp_files", arguments: {}, assertions: [{ pointer: "/ok", equals: true }, { pointer: "/data/reports", equals: [] }] }]);
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

test("soak finalization validates the serialized root and never publishes an invalid success", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-soak-publication-")), file = path.join(root, "evidence.json");
  try {
    const running = { status: "running", passed: false, samples: [] };
    writeSoakReport(file, running);
    const original = fs.readFileSync(file);
    const final = { ...soakFixture(), status: "passed" };
    assert.throws(() => writeSoakReport(file, { ...final, elapsed_ms: 3599999 }));
    assert.deepEqual(fs.readFileSync(file), original);
    assert.throws(() => writeSoakReport(file, { ...final, status: "failed" }), { code: "SOAK_STATUS_MISMATCH" });
    assert.deepEqual(fs.readFileSync(file), original);
    writeSoakReport(file, final);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), final);
    assert.doesNotThrow(() => validateSoak(JSON.parse(fs.readFileSync(file, "utf8"))));
    assert.throws(() => writeSoakReport(file, { data: final }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
