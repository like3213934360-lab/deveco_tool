import { z } from "zod";
import { atomicWrite, digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { processSampleSchema } from "./process-metrics.js";

const count = z.number().int().nonnegative(),
  elapsed = z.number().finite().nonnegative();
export const retainedSchema = z.object({
  tasks: count,
  listeners: count,
  connections: count,
  processes: count,
  cache_entries: count,
  workers: count,
});
const retained = retainedSchema;
const mixedRound = z.object({
  started_ms: elapsed,
  finished_ms: elapsed,
  recording_run_id: z.string().min(1),
  replay_run_id: z.string().min(1),
  recovered_run_id: z.string().min(1),
  expected_failure: z.literal("VERIFICATION_FAILED"),
  failure_status: z.literal("needs_input"),
  failure_code: z.literal("EFFECT_UNCERTAIN"),
  saved_flow_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recovered_operations_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recovered_effects_unchanged: z.literal(true),
});
const logSession = z.object({
  test_id: z.string().min(1),
  started_ms: elapsed,
  finished_ms: elapsed,
  heartbeat_lines: count.min(2),
  status: z.literal("succeeded"),
  chunks: z
    .array(
      z.object({
        id: count,
        source: z.literal("continuous"),
        step_id: z.string(),
        artifact_id: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1),
});
export const soakReportSchema = z.object({
  format: z.union([z.literal(3), z.literal(4)]),
  tested: z.record(z.string(), z.unknown()),
  passed: z.literal(true),
  elapsed_ms: elapsed.min(3600000),
  execution: z.object({
    transport: z.literal("stdio"),
    runtime: z.literal("worker"),
    driver_pid: count.positive(),
    mcp_pid: count.positive(),
    requests_recorded: count.positive(),
    runtime_close_confirmed: z.literal(true),
    transport_closed: z.literal(true),
  }),
  scopes: z
    .array(
      z.enum(["sdk", "lsp", "ui", "watch", "recording", "logs", "recovery"]),
    )
    .min(4)
    .max(7),
  mixed_rounds: z.array(mixedRound).optional(),
  log_sessions: z.array(logSession).optional(),
  samples: z
    .array(
      z.object({
        elapsed_ms: elapsed,
        mcp_pid: count.positive(),
        mcp: processSampleSchema,
        sdk: processSampleSchema,
        retained,
        activity: z.object({
          sdk_builds: count.positive(),
          lsp_requests: count.positive(),
          ui_requests: count.positive(),
          watch_connected: z.literal(true),
        }),
      }),
    )
    .min(60),
  idle_elapsed_ms: elapsed.min(360000),
  idle_samples: z.array(retained.extend({ elapsed_ms: elapsed })).min(12),
  final: retained,
  cancellations: z
    .array(
      z.object({
        scope: z.enum(["sdk_watch", "mcp_runtime"]),
        elapsed_ms: elapsed.max(120000),
        confirmed: z.literal(true),
      }),
    )
    .length(2),
  cancel_ms: z.array(elapsed).length(2),
});
export function validateSoak(
  raw: unknown,
  options: { requireMixed?: boolean } = {},
) {
  const report = soakReportSchema.parse(raw);
  invariant(
    !options.requireMixed || report.format === 4,
    "RELEASE_SOAK_MIXED_REQUIRED",
    "Current releases need a mixed recording, logging and recovery workload, not a historical SDK-only soak",
  );
  invariant(
    report.execution.driver_pid !== report.execution.mcp_pid &&
      report.samples.every(
        (sample) => sample.mcp_pid === report.execution.mcp_pid,
      ),
    "RELEASE_SOAK_MCP_IDENTITY",
    "Measure one actual MCP process separately from its driver for the full soak",
  );
  const scopes =
    report.format === 4
      ? ["sdk", "lsp", "ui", "watch", "recording", "logs", "recovery"]
      : ["sdk", "lsp", "ui", "watch"];
  invariant(
    report.scopes.length === scopes.length &&
      digest([...report.scopes].sort()) === digest(scopes.sort()),
    "RELEASE_SOAK_INCOMPLETE",
    "Every declared workload scope must be exercised exactly once",
  );
  if (report.format === 4) {
    const rounds = z.array(mixedRound).min(6).parse(report.mixed_rounds),
      logs = z.array(logSession).min(30).parse(report.log_sessions);
    const within = (rows: { started_ms: number; finished_ms: number }[]) => {
      rows.forEach((row, index) =>
        invariant(
          row.started_ms < row.finished_ms &&
            row.finished_ms <= report.elapsed_ms &&
            (!index || row.started_ms >= rows[index - 1]!.finished_ms),
          "RELEASE_SOAK_MIXED_TIME",
          "Mixed workload receipts must be ordered, nonoverlapping and inside the active window",
        ),
      );
    };
    within(rounds);
    within(logs);
    const ids = rounds.flatMap((row) => [
      row.recording_run_id,
      row.replay_run_id,
      row.recovered_run_id,
    ]);
    invariant(
      new Set(ids).size === ids.length &&
        new Set(logs.map((row) => row.test_id)).size === logs.length,
      "RELEASE_SOAK_MIXED_REUSED",
      "Each mixed round and log session needs a distinct executed task",
    );
    invariant(
      rounds[0]!.started_ms <= 600000 &&
        rounds.at(-1)!.finished_ms >= report.elapsed_ms - 600000 &&
        rounds
          .slice(1)
          .every(
            (row, index) =>
              row.started_ms - rounds[index]!.finished_ms <= 720000,
          ),
      "RELEASE_SOAK_MIXED_COVERAGE",
      "Recording, replay and recovery must recur throughout the hour",
    );
    invariant(
      logs.reduce(
        (total, row) => total + row.finished_ms - row.started_ms,
        0,
      ) >= 1800000 &&
        logs[0]!.started_ms <= 120000 &&
        logs.at(-1)!.finished_ms >= report.elapsed_ms - 120000,
      "RELEASE_SOAK_LOG_COVERAGE",
      "Continuous log segments must span the workload and cover at least thirty active minutes",
    );
  }
  const continuity = (
    samples: { elapsed_ms: number }[],
    duration: number,
    maximumGap: number,
  ) => {
    invariant(
      samples[0]!.elapsed_ms <= maximumGap &&
        samples.at(-1)!.elapsed_ms >= duration,
      "RELEASE_SOAK_INCOMPLETE",
      "Samples must span the full active or idle window",
    );
    for (let index = 1; index < samples.length; index++)
      invariant(
        samples[index]!.elapsed_ms > samples[index - 1]!.elapsed_ms &&
          samples[index]!.elapsed_ms - samples[index - 1]!.elapsed_ms <=
            maximumGap,
        "RELEASE_SOAK_SAMPLE_GAP",
        "Samples must be ordered without unobserved long gaps",
      );
  };
  continuity(report.samples, 3600000, 120000);
  continuity(report.idle_samples, 360000, 60000);
  for (let index = 0; index < report.samples.length; index++) {
    const sample = report.samples[index]!;
    invariant(
      sample.retained.tasks <= 32 &&
        sample.retained.connections <= 36 &&
        sample.retained.processes <= 32 &&
        sample.retained.cache_entries <= 10 &&
        sample.retained.workers <= 2,
      "RELEASE_SOAK_CAPACITY",
      "Owned runtime capacity exceeds fixed production bounds",
    );
    if (index)
      for (const key of ["sdk_builds", "lsp_requests", "ui_requests"] as const)
        invariant(
          sample.activity[key] >= report.samples[index - 1]!.activity[key],
          "RELEASE_SOAK_ACTIVITY",
          "Activity counters cannot move backwards",
        );
  }
  const last = report.samples.at(-1)!;
  invariant(
    last.activity.sdk_builds >= 30 &&
      last.activity.lsp_requests >= 60 &&
      last.activity.ui_requests >= 60,
    "RELEASE_SOAK_ACTIVITY",
    "A long idle process alone is not a real SDK/LSP/UI/watch soak",
  );
  for (const row of [report.final, report.idle_samples.at(-1)!])
    for (const key of [
      "tasks",
      "listeners",
      "connections",
      "processes",
      "cache_entries",
      "workers",
    ] as const)
      invariant(
        row[key] === 0,
        "RELEASE_RECLAMATION_FAILED",
        `Owned ${key} must fully reclaim; report-defined limits cannot waive this`,
      );
  invariant(
    new Set(report.cancellations.map((item) => item.scope)).size === 2 &&
      digest(report.cancel_ms) ===
        digest(report.cancellations.map((item) => item.elapsed_ms)),
    "RELEASE_CANCELLATION_INCOMPLETE",
    "Both SDK watch and runtime closure need matching confirmed cancellation timings",
  );
  return report;
}

// Validate the same root object that is serialized, before publishing success.
// Failed/running reports stay available when final validation rejects a report.
export function writeSoakReport(file: string, raw: unknown): void {
  const envelope = z
    .object({
      status: z.enum(["running", "idle_reclamation", "passed", "failed"]),
      passed: z.boolean(),
    })
    .parse(raw);
  invariant(
    envelope.passed === (envelope.status === "passed"),
    "SOAK_STATUS_MISMATCH",
    "Soak status and passed flag must agree",
  );
  if (envelope.passed) validateSoak(raw);
  atomicWrite(file, JSON.stringify(raw, null, 2) + "\n");
}
