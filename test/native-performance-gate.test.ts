import test from "node:test";
import assert from "node:assert/strict";
import { requiredPerformance } from "../scripts/lib/acceptance-requirements.js";
import { validatePerformance } from "../scripts/lib/performance-gate.js";
import { validateSoak, writeSoakReport } from "../scripts/lib/soak-gate.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirmBaselineAbsence } from "../scripts/lib/benchmark-comparison.js";
import {
  benchmarkPlanSchema,
  executeBenchmarkSteps,
} from "../scripts/lib/benchmark-contracts.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { evidenceIdentity } from "../scripts/lib/evidence.js";
import { validateReleaseMeasurements } from "../scripts/lib/release-measurements.js";
import { releaseScopeSchema } from "../scripts/lib/release-scope.js";
import { release, protocolVersion } from "../src/core/config.js";
import { currentAcceptance } from "../scripts/lib/acceptance-requirements.js";

const samples = (count: number, value = 1) => Array<number>(count).fill(value),
  hash = "a".repeat(64);
function performanceFixture() {
  const cold = {
    initialize_ms: samples(30, 100),
    directory_ms: samples(30, 20),
    total_ms: samples(30, 120),
  };
  const ui = (nodes: number) => ({
    input_sha256: hash,
    nodes,
    parse_ms: samples(30),
    parse_cpu_us: samples(30),
    parse_rss_bytes: samples(30, 10000),
    queries: Array.from({ length: 4 }, (_, index) => ({
      input: { key: `${index}` },
      result_count: 1,
      ms: samples(1000),
      cpu_us: samples(1000),
      rss_bytes: samples(1000, 10000),
    })),
  });
  return {
    format: 3,
    passed: true,
    tested: {},
    baseline: {
      commit: "aab1405b51e00e4036bdc8f18ae4229835de77b0",
      entry_sha256: hash,
      lock_sha256: hash,
    },
    environment: hash,
    baseline_environment: hash,
    cold: { native: structuredClone(cold), baseline: structuredClone(cold) },
    cold_ms: samples(30, 120),
    expected_capabilities: [...requiredPerformance],
    direct: requiredPerformance.map((capability) => ({
      comparison: "paired",
      capability,
      input_sha256: hash,
      baseline_input_sha256: hash,
      native_ms: samples(1000),
      baseline_ms: samples(1000),
    })),
    ui: (
      [
        ["small", 101],
        ["medium", 1001],
        ["large", 10001],
      ] as const
    ).map(([size, nodes]) => ({
      size,
      native: ui(nodes),
      baseline: ui(nodes),
    })),
    orchestration_ms: samples(1000),
    checkpoint_ms: samples(1000),
    persistent_graph_ms: samples(1000),
  };
}
test("performance gate rejects missing capabilities, unequal inputs, invented phases and missing RSS", () => {
  assert.doesNotThrow(() => validatePerformance(performanceFixture()));
  const duplicate = performanceFixture();
  duplicate.direct[1]!.capability = duplicate.direct[0]!.capability;
  assert.throws(() => validatePerformance(duplicate), {
    code: "RELEASE_PERFORMANCE_COVERAGE",
  });
  const inputs = performanceFixture();
  inputs.direct[0]!.baseline_input_sha256 = "b".repeat(64);
  assert.throws(() => validatePerformance(inputs), {
    code: "RELEASE_DIRECT_COMPARISON",
  });
  const cold = performanceFixture();
  cold.cold.native.total_ms[0] = 121;
  assert.throws(() => validatePerformance(cold), {
    code: "RELEASE_COLD_SAMPLES",
  });
  const rss = performanceFixture();
  rss.ui[0]!.native.queries[0]!.rss_bytes[0] = 0;
  assert.throws(() => validatePerformance(rss), {
    code: "RELEASE_UI_SAMPLE_MISSING",
  });
  const zero = performanceFixture();
  zero.direct[0]!.baseline_ms.fill(0);
  assert.throws(() => validatePerformance(zero), {
    code: "RELEASE_DIRECT_COMPARISON",
  });
});

test("relative latency remains visible without an unapproved release threshold", () => {
  for (const nativeMs of [0.5, 1.051, 2.5]) {
    const report = performanceFixture();
    report.direct[0]!.native_ms.fill(nativeMs);
    const observed = validatePerformance({
      ...report,
      observations: [{ ratio: 0 }],
    }).observations[0]!;
    assert.equal(observed.native_p95_ms, nativeMs);
    assert.equal(observed.baseline_p95_ms, 1);
    assert.equal(observed.delta_ms, nativeMs - 1);
    assert.equal(observed.ratio, nativeMs);
  }
});

const oldSigningTool = {
  name: "app_signature",
  inputSchema: {
    type: "object",
    properties: {
      force: { type: "boolean" },
      team_id: { type: "string" },
      product: { type: "string" },
      project_path: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
    },
    additionalProperties: false,
  },
};
test("new-operation sampling requires the exact frozen public contract and cannot waive existing capabilities", () => {
  const paired = performanceFixture();
  const absence = confirmBaselineAbsence(paired.baseline.commit, [
    oldSigningTool,
  ]);
  assert.throws(() => confirmBaselineAbsence("b".repeat(40), [oldSigningTool]));
  assert.throws(() => confirmBaselineAbsence(paired.baseline.commit, []));
  assert.throws(() =>
    confirmBaselineAbsence(paired.baseline.commit, [
      oldSigningTool,
      oldSigningTool,
    ]),
  );
  assert.throws(() =>
    confirmBaselineAbsence(paired.baseline.commit, [
      {
        ...oldSigningTool,
        inputSchema: {
          ...oldSigningTool.inputSchema,
          properties: {
            ...oldSigningTool.inputSchema.properties,
            action: { enum: ["inspect"] },
          },
        },
      },
    ]),
  );
  const fresh = {
    comparison: "new",
    capability: "app_signature.inspect",
    input_sha256: hash,
    native_ms: samples(1000),
    baseline_absence: absence,
  };
  const report = {
    ...paired,
    direct: paired.direct.map((item) =>
      item.capability === "app_signature.inspect" ? fresh : item,
    ),
  };
  assert.doesNotThrow(() => validatePerformance(report));
  assert.throws(
    () =>
      validatePerformance({
        ...report,
        baseline: { ...report.baseline, commit: "b".repeat(40) },
      }),
    { code: "RELEASE_BASELINE_CONTRACT" },
  );
  assert.throws(() =>
    validatePerformance({
      ...report,
      direct: report.direct.map((item) =>
        item === fresh ? { ...fresh, native_ms: samples(999) } : item,
      ),
    }),
  );
  assert.throws(() =>
    validatePerformance({
      ...report,
      direct: report.direct.map((item) =>
        item === fresh ? { ...fresh, baseline_ms: samples(1000) } : item,
      ),
    }),
  );
  assert.throws(() =>
    validatePerformance({
      ...report,
      direct: report.direct.map((item) =>
        item.capability === "ui_find"
          ? { ...fresh, capability: "ui_find" }
          : item,
      ),
    }),
  );
  const observations = validatePerformance({
    ...report,
    direct: report.direct.map((item) =>
      item.capability === "ui_find"
        ? { ...item, native_ms: samples(1000, 1.051) }
        : item,
    ),
  }).observations;
  assert.equal(
    observations.find((item) => item.capability === "ui_find")!.ratio,
    1.051,
  );
  assert.deepEqual(
    observations.find((item) => item.capability === "app_signature.inspect"),
    {
      capability: "app_signature.inspect",
      comparison: "new",
      native_p95_ms: 1,
    },
  );
});

test("benchmark plans reject missing baseline steps and arbitrary unpaired capabilities", () => {
  const step = {
    tool: "example",
    arguments: {},
    assertions: [{ pointer: "/ok", equals: true }],
  };
  const plan = {
    format: 3,
    baseline_root: "/baseline",
    baseline_entry: "src/server.mjs",
    baseline_commit: "a".repeat(40),
    inputs: [{ file: "/input", sha256: hash }],
    capabilities: requiredPerformance.map((capability) => ({
      capability,
      comparison: "paired",
      logical_input: {},
      native: [step],
      baseline: [step],
    })),
  };
  assert.equal(benchmarkPlanSchema.safeParse(plan).success, true);
  assert.equal(
    benchmarkPlanSchema.safeParse({
      ...plan,
      capabilities: plan.capabilities.map((item) =>
        item.capability === "app_signature.inspect"
          ? {
              capability: item.capability,
              comparison: "new",
              logical_input: {},
              native: [step],
            }
          : item,
      ),
    }).success,
    true,
  );
  assert.equal(
    benchmarkPlanSchema.safeParse({
      ...plan,
      capabilities: plan.capabilities.map((item) => ({
        ...item,
        baseline: [],
      })),
    }).success,
    false,
  );
  assert.equal(
    benchmarkPlanSchema.safeParse({
      ...plan,
      capabilities: plan.capabilities.map((item) => ({
        capability: item.capability,
        comparison: "new",
        logical_input: {},
        native: [step],
      })),
    }).success,
    false,
  );
});

test("baseline text responses require semantic assertions, preserving every text block and tool failures", async () => {
  const client = (response: unknown) =>
    ({ callTool: async () => response }) as unknown as Client;
  const step = {
    tool: "code_lint",
    arguments: {},
    assertions: [
      { pointer: "/output", contains: "No defects found." },
      { pointer: "/output", contains: "Issues: 0" },
    ],
  };
  for (const content of [
    [{ type: "text", text: "No defects found.\nIssues: 0" }],
    [{ type: "text", text: JSON.stringify("No defects found.\nIssues: 0") }],
    [
      { type: "text", text: "No defects found." },
      { type: "text", text: "Issues: 0" },
    ],
  ])
    await executeBenchmarkSteps(client({ content }), [step]);
  await assert.rejects(
    executeBenchmarkSteps(
      client({ content: [{ type: "text", text: "Issues: 2" }] }),
      [step],
    ),
    { code: "BENCHMARK_RESULT_MISMATCH" },
  );
  await assert.rejects(
    executeBenchmarkSteps(
      client({
        content: [{ type: "text", text: "No defects found.\nIssues: 0" }],
        isError: true,
      }),
      [step],
    ),
    { code: "BENCHMARK_TOOL_FAILED" },
  );
  await assert.rejects(executeBenchmarkSteps(client({ content: [] }), [step]), {
    code: "BENCHMARK_RESULT_MISSING",
  });
  await executeBenchmarkSteps(
    client({ structuredContent: { ok: true, data: { reports: [] } } }),
    [
      {
        tool: "check_cpp_files",
        arguments: {},
        assertions: [
          { pointer: "/ok", equals: true },
          { pointer: "/data/reports", equals: [] },
        ],
      },
    ],
  );
});

function soakFixture() {
  const retained = {
    tasks: 0,
    listeners: 0,
    connections: 0,
    processes: 0,
    cache_entries: 0,
    workers: 0,
  };
  const metric = { value: 100, source: "fixture" },
    unavailable = { value: null, reason: "unsupported fixture platform" };
  const process = {
    cpu_us: metric,
    rss_bytes: metric,
    written_bytes: unavailable,
    process_starts: metric,
  };
  return {
    format: 3,
    execution: {
      transport: "stdio",
      runtime: "worker",
      driver_pid: 123,
      mcp_pid: 456,
      requests_recorded: 1000,
      runtime_close_confirmed: true,
      transport_closed: true,
    },
    passed: true,
    tested: {},
    scopes: ["sdk", "lsp", "ui", "watch"],
    elapsed_ms: 3600000,
    samples: Array.from({ length: 61 }, (_, index) => ({
      elapsed_ms: index * 60000,
      mcp_pid: 456,
      mcp: process,
      sdk: process,
      retained: { ...retained },
      activity: {
        sdk_builds: 1 + index,
        lsp_requests: 1 + index,
        ui_requests: 1 + index,
        watch_connected: true,
      },
    })),
    idle_elapsed_ms: 360000,
    idle_samples: Array.from({ length: 13 }, (_, index) => ({
      ...retained,
      elapsed_ms: index * 30000,
    })),
    final: { ...retained },
    cancellations: [
      { scope: "sdk_watch", elapsed_ms: 10, confirmed: true },
      { scope: "mcp_runtime", elapsed_ms: 20, confirmed: true },
    ],
    cancel_ms: [10, 20],
  };
}
test("current scoped release rejects stale measurements, empty direct reports and weakened sample gates", () => {
  const tested = evidenceIdentity();
  const reason =
    "Deterministic gate fixture; this is not a real acceptance or release authorization.";
  const scope = releaseScopeSchema.parse({
    format: 2,
    release,
    protocol: protocolVersion,
    decided_at: new Date().toISOString(),
    authorized_by: "repository_owner",
    breaking_api: { change: "compatible", reason },
    device_retest: {
      status: "isolated_retest",
      historical_evidence_accepted: false,
      reason,
    },
    verified_migration_receipts: { identity: "current", reason },
    upstream_historical_checks: [],
    migration_exceptions: [],
    acceptance_exceptions: [],
    acceptance_required: [...currentAcceptance],
    performance_exceptions: [],
    performance_required: [...requiredPerformance],
    soak: { disposition: "required_current", reason },
  });
  const performance = { ...performanceFixture(), tested },
    soak = { ...mixedSoakFixture(), tested };
  const cancelled = releaseScopeSchema.parse({
    ...scope,
    soak: { disposition: "cancelled_by_user", reason },
  });
  assert.equal(validateReleaseMeasurements(performance, undefined, tested, cancelled).soak, null);
  assert.throws(() => validateReleaseMeasurements({ ...performance, direct: [] }, undefined, tested, cancelled));
  assert.throws(() => validateReleaseMeasurements(performance, { ...soak, elapsed_ms: 1 }, tested, cancelled));
  for (const policy of [undefined, scope]) {
    assert.throws(() => validateReleaseMeasurements(performance, undefined, tested, policy), { code: "RELEASE_SOAK_REQUIRED" });
    assert.doesNotThrow(() =>
      validateReleaseMeasurements(performance, soak, tested, policy),
    );
    for (const field of [
      "source_sha256",
      "runtime_sha256",
      "compiled_sha256",
      "package_lock_sha256",
      "resource_manifest_sha256",
      "upstream_lock_sha256",
    ] as const) {
      const stale = { ...tested, [field]: "f".repeat(64) };
      assert.throws(
        () =>
          validateReleaseMeasurements(
            { ...performance, tested: stale },
            soak,
            tested,
            policy,
          ),
        { code: "RELEASE_EVIDENCE_STALE" },
      );
      assert.throws(
        () =>
          validateReleaseMeasurements(
            performance,
            { ...soak, tested: stale },
            tested,
            policy,
          ),
        { code: "RELEASE_EVIDENCE_STALE" },
      );
    }
    assert.throws(() =>
      validateReleaseMeasurements(
        { ...performance, direct: [] },
        soak,
        tested,
        policy,
      ),
    );
    assert.throws(() =>
      validateReleaseMeasurements(
        { ...performance, orchestration_ms: samples(999) },
        soak,
        tested,
        policy,
      ),
    );
    assert.throws(() =>
      validateReleaseMeasurements(
        performance,
        { ...soak, elapsed_ms: 3599999 },
        tested,
        policy,
      ),
    );
    assert.throws(
      () =>
        validateReleaseMeasurements(
          performance,
          { ...soakFixture(), tested },
          tested,
          policy,
        ),
      { code: "RELEASE_SOAK_MIXED_REQUIRED" },
    );
  }
});

function mixedSoakFixture() {
  return {
    ...soakFixture(),
    format: 4,
    scopes: ["sdk", "lsp", "ui", "watch", "recording", "logs", "recovery"],
    mixed_rounds: Array.from({ length: 6 }, (_, i) => ({
      started_ms: i * 600000,
      finished_ms: i * 600000 + 30000,
      recording_run_id: `recording-${i}`,
      replay_run_id: `replay-${i}`,
      recovered_run_id: `recovered-${i}`,
      expected_failure: "VERIFICATION_FAILED",
      failure_status: "needs_input",
      failure_code: "EFFECT_UNCERTAIN",
      saved_flow_sha256: hash,
      recovered_operations_sha256: hash,
      recovered_effects_unchanged: true,
    })),
    log_sessions: Array.from({ length: 30 }, (_, i) => ({
      test_id: `logs-${i}`,
      started_ms: i * 120000 + 10000,
      finished_ms: i * 120000 + 80000,
      heartbeat_lines: 30,
      status: "succeeded",
      chunks: [
        {
          id: 500,
          source: "continuous",
          step_id: "mixed-observation",
          artifact_id: `artifact-${i}`,
          sha256: hash,
        },
      ],
    })),
  };
}
test("mixed soak cannot be satisfied with missing, repeated, front-loaded or overlapping workload receipts", () => {
  assert.doesNotThrow(() =>
    validateSoak(mixedSoakFixture(), { requireMixed: true }),
  );
  const missing = mixedSoakFixture();
  missing.mixed_rounds.pop();
  assert.throws(() => validateSoak(missing));
  const reused = mixedSoakFixture();
  reused.mixed_rounds[1]!.recovered_run_id =
    reused.mixed_rounds[0]!.recovered_run_id;
  assert.throws(() => validateSoak(reused), {
    code: "RELEASE_SOAK_MIXED_REUSED",
  });
  const front = mixedSoakFixture();
  front.mixed_rounds.forEach((row, i) => {
    row.started_ms = i * 40000;
    row.finished_ms = i * 40000 + 30000;
  });
  assert.throws(() => validateSoak(front), {
    code: "RELEASE_SOAK_MIXED_COVERAGE",
  });
  const overlap = mixedSoakFixture();
  overlap.log_sessions[1]!.started_ms = 50000;
  assert.throws(() => validateSoak(overlap), {
    code: "RELEASE_SOAK_MIXED_TIME",
  });
  const tooShort = mixedSoakFixture();
  tooShort.log_sessions.forEach((row) => {
    row.finished_ms = row.started_ms + 1000;
  });
  assert.throws(() => validateSoak(tooShort), {
    code: "RELEASE_SOAK_LOG_COVERAGE",
  });
  const outside = mixedSoakFixture();
  outside.log_sessions.at(-1)!.finished_ms = 3600001;
  assert.throws(() => validateSoak(outside), {
    code: "RELEASE_SOAK_MIXED_TIME",
  });
  assert.throws(() =>
    validateSoak({ ...mixedSoakFixture(), log_sessions: undefined }),
  );
  assert.throws(
    () =>
      validateSoak({
        ...mixedSoakFixture(),
        scopes: ["sdk", "lsp", "ui", "watch"],
      }),
    { code: "RELEASE_SOAK_INCOMPLETE" },
  );
});
test("soak gate requires activity, continuity and zero retained owned resources after idle", () => {
  assert.doesNotThrow(() => validateSoak(soakFixture()));
  const leaked = soakFixture();
  leaked.idle_samples.at(-1)!.connections = 1;
  assert.throws(() => validateSoak(leaked), {
    code: "RELEASE_RECLAMATION_FAILED",
  });
  const inactive = soakFixture();
  for (const sample of inactive.samples) sample.activity.sdk_builds = 1;
  assert.throws(() => validateSoak(inactive), {
    code: "RELEASE_SOAK_ACTIVITY",
  });
  const gap = soakFixture();
  gap.samples[30]!.elapsed_ms += 180000;
  assert.throws(() => validateSoak(gap), { code: "RELEASE_SOAK_SAMPLE_GAP" });
  const capacity = soakFixture();
  capacity.samples[1]!.retained.workers = 3;
  assert.throws(() => validateSoak(capacity), {
    code: "RELEASE_SOAK_CAPACITY",
  });
  const inProcess = soakFixture();
  inProcess.execution.mcp_pid = inProcess.execution.driver_pid;
  assert.throws(() => validateSoak(inProcess), {
    code: "RELEASE_SOAK_MCP_IDENTITY",
  });
  const restarted = soakFixture();
  restarted.samples[2]!.mcp_pid++;
  assert.throws(() => validateSoak(restarted), {
    code: "RELEASE_SOAK_MCP_IDENTITY",
  });
  const logsMissing = soakFixture();
  logsMissing.execution.requests_recorded = 0;
  assert.throws(() => validateSoak(logsMissing));
});

test("soak finalization validates the serialized root and never publishes an invalid success", () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "native-soak-publication-"),
    ),
    file = path.join(root, "evidence.json");
  try {
    const running = { status: "running", passed: false, samples: [] };
    writeSoakReport(file, running);
    const original = fs.readFileSync(file);
    const final = { ...soakFixture(), status: "passed" };
    assert.throws(() =>
      writeSoakReport(file, { ...final, elapsed_ms: 3599999 }),
    );
    assert.deepEqual(fs.readFileSync(file), original);
    assert.throws(() => writeSoakReport(file, { ...final, status: "failed" }), {
      code: "SOAK_STATUS_MISMATCH",
    });
    assert.deepEqual(fs.readFileSync(file), original);
    writeSoakReport(file, final);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), final);
    assert.doesNotThrow(() =>
      validateSoak(JSON.parse(fs.readFileSync(file, "utf8"))),
    );
    assert.throws(() => writeSoakReport(file, { data: final }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
