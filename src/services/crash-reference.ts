import { z } from "zod";
import { createHash } from "node:crypto";
import type { StateStore } from "../core/store.js";
import { digest } from "../core/files.js";
import { invariant, errorResult } from "../core/errors.js";
import { resolveEvidenceResult } from "./evidence-result.js";
import { uiLogChunkSchema } from "./ui-test-log.js";
import { parseCrash } from "./crash.js";
import type { LogService } from "./logs.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const partSchema = z.object({
  artifact_id: z.string().uuid(),
  sha256: z.string(),
  content: z.string(),
  kind: z.enum(["interval", "continuous", "faultlog"]),
  start_ns: z.string().optional(),
  end_ns: z.string().optional(),
  pids: z.array(z.string()).max(10).default([]),
  truncated: z.boolean(),
  faultlog_name: z.string().optional(),
});
const snapshotSchema = z.object({
  format: z.literal(1),
  source_run_id: z.string().uuid(),
  workflow: z.string(),
  source_status: z.string(),
  captured_at: z.number(),
  source_updated_at: z.number(),
  source_input_sha256: z.string(),
  source_result_sha256: z.string(),
  target: z.string().optional(),
  bundle_name: z.string().optional(),
  source_scope: z.record(z.string(), z.unknown()),
  parts: z.array(partSchema).max(133),
  gaps: z.array(z.record(z.string(), z.unknown())).max(256),
  device_window: z
    .object({ start_ms: z.number(), end_ms: z.number() })
    .optional(),
  supplemental_collection: z
    .enum(["not_requested", "unnecessary", "attempted", "unavailable"])
    .default("not_requested"),
});
type Snapshot = z.infer<typeof snapshotSchema>;
export interface CrashReference {
  run_id: string;
  artifact_id: string;
  sha256: string;
}
export interface TestDiagnosticLogs {
  target: string;
  bundle_name: string;
  chunks: unknown[];
  omitted_chunks: number;
  continuous: unknown;
}
const maximumBytes = 4 * 1024 * 1024;
const bytesDigest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

/** Read only named receipts owned by the selected run. Never scan arbitrary artifacts. */
function retainedBytes(
  store: StateStore,
  runId: string,
  id: string,
  maximum = maximumBytes,
) {
  const row = store.db
    .prepare("SELECT run_id,bytes FROM artifacts WHERE id=?")
    .get(id) as { run_id: string; bytes: number } | undefined;
  invariant(
    row && row.run_id === runId,
    "CRASH_ARTIFACT_SCOPE_MISMATCH",
    "The referenced log is missing or belongs to another run",
    { artifact_id: id },
  );
  invariant(
    row.bytes <= maximum,
    "CRASH_REFERENCE_BUDGET",
    "The selected retained evidence exceeds the bounded diagnosis budget",
  );
  const chunks: Buffer[] = [];
  let offset = 0;
  do {
    const part = store.readArtifact(id, offset, 65536);
    invariant(
      part.bytes === row.bytes,
      "CRASH_ARTIFACT_CHANGED",
      "Retained log size changed",
    );
    chunks.push(Buffer.from(part.data, "base64"));
    offset = part.next_offset;
  } while (offset < row.bytes);
  return Buffer.concat(chunks);
}

export function captureCrashReference(
  store: StateStore,
  runId: string,
  testLogs: (id: string) => TestDiagnosticLogs,
): CrashReference {
  const run = store.get(runId);
  invariant(
    ["app_deploy", "build_run", "build_deploy_verify", "ui_test"].includes(
      run.workflow,
    ),
    "CRASH_SOURCE_UNSUPPORTED",
    "Select a deployment, build/run or UI test task",
  );
  const input = record(JSON.parse(run.input)),
    parameters = record(input.parameters);
  const app = record(parameters.app);
  const snapshot: Snapshot = {
    format: 1,
    source_run_id: run.id,
    workflow: run.workflow,
    source_status: run.status,
    captured_at: Date.now(),
    source_updated_at: run.updated,
    source_input_sha256: run.input_hash,
    source_result_sha256: digest({ result: run.result, error: run.error }),
    target: typeof input.target === "string" ? input.target : undefined,
    bundle_name:
      typeof app.bundle_name === "string" ? app.bundle_name : undefined,
    source_scope: {
      project_path: input.project_path ?? null,
      product: input.product ?? null,
      module_targets: input.module_targets ?? null,
      source_hash: input.source_hash ?? null,
      project_hash: input.project_hash ?? null,
      toolchain_hash: input.toolchain_hash ?? null,
    },
    parts: [],
    gaps: [],
    supplemental_collection: "not_requested",
  };
  let bytes = 0;
  const seen = new Set<string>();
  const gap = (code: string, details: Record<string, unknown> = {}) => {
    if (snapshot.gaps.length < 250) snapshot.gaps.push({ code, ...details });
  };
  const addChunk = (raw: unknown) => {
    const chunk = record(raw);
    try {
      const interval = uiLogChunkSchema.safeParse(raw);
      let start: string,
        end: string,
        pids: string[],
        kind: "interval" | "continuous";
      if (chunk.source === "continuous") {
        const parsed = z
          .object({
            source: z.literal("continuous"),
            status: z.literal("captured"),
            artifact_id: z.string().uuid(),
            start_ns: z.string().regex(/^\d{19}$/),
            end_ns: z.string().regex(/^\d{19}$/),
            processes: z.record(z.string().regex(/^\d+$/), z.string()),
            sha256: z.string(),
            received_range_verified: z.literal(true),
          })
          .parse(raw);
        start = parsed.start_ns;
        end = parsed.end_ns;
        pids = Object.keys(parsed.processes);
        kind = "continuous";
      } else {
        invariant(
          interval.success &&
            interval.data.status === "captured" &&
            interval.data.start &&
            interval.data.end,
          "CRASH_LOG_INTERVAL_UNAVAILABLE",
          "The selected run has no captured log for this interval",
        );
        start = interval.data.start.device_epoch_ns;
        end = interval.data.end.device_epoch_ns;
        pids = [
          ...new Set([...interval.data.start.pids, ...interval.data.end.pids]),
        ];
        kind = "interval";
      }
      invariant(
        BigInt(start) <= BigInt(end) && pids.length > 0 && pids.length <= 10,
        "CRASH_LOG_SCOPE_UNAVAILABLE",
        "Log time/PID scope cannot be established",
      );
      const low = Number(BigInt(start) / 1_000_000n),
        high = Number(BigInt(end) / 1_000_000n);
      snapshot.device_window = snapshot.device_window
        ? {
            start_ms: Math.min(snapshot.device_window.start_ms, low),
            end_ms: Math.max(snapshot.device_window.end_ms, high),
          }
        : { start_ms: low, end_ms: high };
      const id = z.string().uuid().parse(chunk.artifact_id);
      if (seen.has(id)) return;
      seen.add(id);
      invariant(
        snapshot.parts.length < 128 && bytes < maximumBytes,
        "CRASH_REFERENCE_BUDGET",
        "Only the bounded selected log snapshot can be analyzed",
      );
      const content = retainedBytes(store, run.id, id, maximumBytes - bytes),
        sha256 = bytesDigest(content);
      invariant(
        chunk.sha256 === undefined || chunk.sha256 === sha256,
        "CRASH_ARTIFACT_CHANGED",
        "Captured log digest changed",
      );
      bytes += content.length;
      if (chunk.sha256 === undefined)
        gap("CRASH_LEGACY_LOG_DIGEST_UNAVAILABLE", {
          artifact_id: id,
          reason:
            "This older interval has no original byte digest; the diagnosis freezes its current retained bytes",
        });
      snapshot.parts.push({
        artifact_id: id,
        sha256,
        content: content.toString("utf8"),
        kind,
        start_ns: start,
        end_ns: end,
        pids,
        truncated: chunk.truncated === true,
      });
      if (chunk.truncated) gap("CRASH_LOG_TRUNCATED", { artifact_id: id });
    } catch (error) {
      gap(errorResult(error).code, {
        artifact_id: chunk.artifact_id ?? null,
        interval_code: chunk.code ?? null,
      });
    }
  };
  if (run.workflow === "ui_test") {
    const logs = testLogs(run.id);
    snapshot.target = logs.target;
    snapshot.bundle_name = logs.bundle_name;
    for (const chunk of logs.chunks) addChunk(chunk);
    if (logs.omitted_chunks)
      gap("CRASH_LOG_CHUNKS_OMITTED", { count: logs.omitted_chunks });
    gap("CRASH_CONTINUOUS_COVERAGE", { continuous: logs.continuous });
  } else {
    const references = new Set<string>();
    const receipt = (raw: unknown) => {
      const value = record(raw),
        details = record(value.details),
        cause = record(details.cause);
      const ids = [
        record(details.evidence).artifact_id,
        record(record(cause.details).evidence).artifact_id,
        record(record(value.startup_check).evidence).artifact_id,
        record(record(record(value.result).startup_check).evidence).artifact_id,
      ];
      for (const id of ids)
        if (typeof id === "string" && z.string().uuid().safeParse(id).success)
          references.add(id);
    };
    if (run.error) receipt(JSON.parse(run.error));
    const operations = store.db
      .prepare(
        "SELECT status,result FROM operations WHERE run_id=? AND node IN ('launch_application','build_or_hot_apply') AND result IS NOT NULL",
      )
      .all(run.id) as { status: string; result: string }[];
    for (const operation of operations)
      try {
        const raw = JSON.parse(operation.result);
        receipt(
          operation.status === "done" ? resolveEvidenceResult(store, raw) : raw,
        );
      } catch (error) {
        gap(errorResult(error).code);
      }
    for (const id of references)
      try {
        const report = z
          .object({
            target: z.string(),
            bundle_name: z.string(),
            diagnostic_log: z.unknown(),
          })
          .parse(
            JSON.parse(
              retainedBytes(store, run.id, id, 1024 * 1024).toString("utf8"),
            ),
          );
        invariant(
          report.target === snapshot.target &&
            report.bundle_name === snapshot.bundle_name,
          "CRASH_REPORT_SCOPE_MISMATCH",
          "Startup report targets a different device/application",
        );
        addChunk(record(report.diagnostic_log).chunk);
      } catch (error) {
        gap(errorResult(error).code, { artifact_id: id });
      }
    if (!references.size) gap("CRASH_STARTUP_LOG_REFERENCE_MISSING");
  }
  if (!snapshot.parts.length) gap("CRASH_RETAINED_LOGS_MISSING");
  // Interval/PID sampling and even continuous capture cannot attest every emitted line.
  gap("CRASH_LOG_COVERAGE_PARTIAL");
  const content = JSON.stringify(snapshotSchema.parse(snapshot));
  invariant(
    Buffer.byteLength(content) <= 8 * 1024 * 1024,
    "CRASH_REFERENCE_BUDGET",
    "Captured diagnosis snapshot exceeds 8 MiB",
  );
  const artifact = store.artifact(
    "workflow-input",
    content,
    "application/json",
  );
  return {
    run_id: run.id,
    artifact_id: artifact.artifact_id,
    sha256: bytesDigest(content),
  };
}

export function readCrashSnapshot(
  store: StateStore,
  owner: string,
  reference: CrashReference,
): Snapshot {
  const bytes = retainedBytes(
    store,
    owner,
    reference.artifact_id,
    8 * 1024 * 1024,
  );
  invariant(
    bytesDigest(bytes) === reference.sha256,
    "CRASH_SNAPSHOT_CHANGED",
    "The captured source-task evidence changed",
  );
  const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString("utf8")));
  invariant(
    snapshot.source_run_id === reference.run_id,
    "CRASH_SOURCE_MISMATCH",
    "The snapshot belongs to another source task",
  );
  return snapshot;
}

export async function supplementCrashSnapshot(
  store: StateStore,
  logs: LogService,
  owner: string,
  snapshot: Snapshot,
  requested: boolean,
  signal: AbortSignal,
): Promise<Snapshot> {
  if (!requested) return snapshot;
  // An attributable error is already usable. Gaps remain visible and are not a reason to re-collect it.
  if (diagnoseCrashSnapshot(snapshot).status === "detected")
    return { ...snapshot, supplemental_collection: "unnecessary" };
  snapshot = {
    ...snapshot,
    parts: [...snapshot.parts],
    gaps: [...snapshot.gaps],
    supplemental_collection: "attempted",
  };
  if (!snapshot.target || !snapshot.bundle_name || !snapshot.device_window) {
    snapshot.supplemental_collection = "unavailable";
    snapshot.gaps.push({
      code: "CRASH_HISTORICAL_WINDOW_UNAVAILABLE",
      reason:
        "No captured device clock interval; current logs cannot establish the historical task window",
    });
    return snapshot;
  }
  try {
    await store.lease(
      `device:${snapshot.target}`,
      async () => {
        const inventory = await logs.probe(
          snapshot.target!,
          {
            bundle_name: snapshot.bundle_name,
            max_age_minutes: 0,
            limit: 5,
            time_window: snapshot.device_window,
          },
          signal,
        );
        snapshot.gaps.push({
          code: "CRASH_SUPPLEMENT_INVENTORY",
          device_time: inventory.device_time,
          complete: inventory.complete,
          has_more: inventory.has_more,
          warnings: inventory.warnings,
          matched: inventory.matching_count,
          unknown_timestamp_count: inventory.unknown_timestamp_count,
        });
        for (const file of inventory.files) {
          signal.throwIfAborted();
          // A filename without subsecond precision represents a whole second; boundary overlaps stay unproven.
          const rawStamp = /-(\d{10,17})(?:\.log)?$/.exec(file.name)?.[1] ?? "";
          if (/^(?:19|20)\d{12}(?:\d{3})?$/.test(rawStamp)) {
            snapshot.gaps.push({
              code: "CRASH_HISTORICAL_TIMEZONE_UNAVAILABLE",
              faultlog_name: file.name,
              reason:
                "The original task did not capture a timezone; today's timezone cannot attest a historical calendar filename",
            });
            continue;
          }
          const precision = rawStamp.length <= 11 ? 1000 : 1;
          if (
            file.timestamp === null ||
            file.timestamp < snapshot.device_window!.start_ms ||
            file.timestamp + precision - 1 > snapshot.device_window!.end_ms
          ) {
            snapshot.gaps.push({
              code: "CRASH_FAULTLOG_TIME_AMBIGUOUS",
              faultlog_name: file.name,
            });
            continue;
          }
          try {
            const fetched = await logs.fetch(
              snapshot.target!,
              file.name,
              signal,
            );
            const content = retainedBytes(
              store,
              owner,
              fetched.artifact.artifact_id,
              1024 * 1024,
            );
            snapshot.parts.push({
              artifact_id: fetched.artifact.artifact_id,
              sha256: bytesDigest(content),
              content: content.toString("utf8"),
              kind: "faultlog",
              pids: [],
              truncated: fetched.truncated,
              faultlog_name: file.name,
            });
          } catch (error) {
            signal.throwIfAborted();
            snapshot.gaps.push({
              code: errorResult(error).code,
              faultlog_name: file.name,
            });
          }
        }
        if (!inventory.files.length)
          snapshot.gaps.push({
            code: "CRASH_HISTORICAL_LOG_UNAVAILABLE",
            reason:
              "No retained matching faultlog in the captured window; it may never have existed or may have expired",
          });
      },
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    snapshot.supplemental_collection = "unavailable";
    snapshot.gaps.push({
      code: errorResult(error).code,
      reason:
        "Supplemental read could not access the selected historical device evidence",
    });
  }
  return snapshot;
}

export function diagnoseCrashSnapshot(snapshot: Snapshot) {
  const findings: {
    artifact_id: string;
    pid?: string;
    diagnosis: ReturnType<typeof parseCrash>;
  }[] = [];
  let excludedLines = 0;
  for (const part of snapshot.parts) {
    if (part.kind === "faultlog") {
      if (part.content.trim())
        findings.push({
          artifact_id: part.artifact_id,
          diagnosis: parseCrash(part.content, {
            bundle_name: snapshot.bundle_name,
            faultlog_name: part.faultlog_name,
            truncated: part.truncated,
            selection_complete: false,
          }),
        });
      continue;
    }
    const streams = new Map<string, string[]>();
    for (const line of part.content.split(/\r?\n/)) {
      if (!line) continue;
      const match =
        /^\s*(\d{10})\.(\d{1,9})\s+(\d+)\s+\d+\s+[VDIWEF]\s+[^:]*:\s?(.*)$/.exec(
          line,
        );
      if (!match) {
        excludedLines++;
        continue;
      }
      const stamp =
        BigInt(match[1]!) * 1_000_000_000n + BigInt(match[2]!.padEnd(9, "0"));
      if (
        !part.pids.includes(match[3]!) ||
        stamp < BigInt(part.start_ns!) ||
        stamp > BigInt(part.end_ns!)
      ) {
        excludedLines++;
        continue;
      }
      if (!streams.has(match[3]!))
        streams.set(match[3]!, [
          `Bundle name: ${snapshot.bundle_name ?? ""}`,
          `Pid: ${match[3]}`,
        ]);
      streams.get(match[3]!)!.push(match[4]!);
    }
    for (const [pid, lines] of streams)
      findings.push({
        artifact_id: part.artifact_id,
        pid,
        diagnosis: parseCrash(lines.join("\n"), {
          bundle_name: snapshot.bundle_name,
          truncated: part.truncated,
          selection_complete: false,
        }),
      });
  }
  const detected = findings.filter(
    (item) => item.diagnosis.status === "detected",
  );
  return {
    status: detected.length ? "detected" : "insufficient_evidence",
    source_run_id: snapshot.source_run_id,
    source_workflow: snapshot.workflow,
    source_status: snapshot.source_status,
    target: snapshot.target ?? null,
    bundle_name: snapshot.bundle_name ?? null,
    source_scope: snapshot.source_scope,
    captured_at: snapshot.captured_at,
    source_updated_at: snapshot.source_updated_at,
    source_age_ms_at_capture: Math.max(
      0,
      snapshot.captured_at - snapshot.source_updated_at,
    ),
    device_window: snapshot.device_window ?? null,
    source_input_sha256: snapshot.source_input_sha256,
    source_result_sha256: snapshot.source_result_sha256,
    historical: true,
    current_source_verified: false,
    selection_complete: false,
    diagnosisComplete: false,
    automatic_replay: false,
    supplemental_collection: snapshot.supplemental_collection,
    gaps: snapshot.gaps,
    excluded_lines: excludedLines,
    examined_parts: snapshot.parts.length,
    detected_count: detected.length,
    findings: detected.slice(0, 20),
    findings_truncated: detected.length > 20,
    retained_evidence: snapshot.parts.map(
      ({ content: _content, pids: _pids, ...part }) => part,
    ),
    next: detected.length
      ? { action: "inspect_original_frames_and_cases" }
      : snapshot.supplemental_collection !== "not_requested"
        ? {
            action: "inspect_evidence_gaps",
            reason:
              "The bounded supplement is finished or unavailable; repeating it cannot establish missing historical scope",
          }
        : {
            tool: "workflow_run",
            arguments: {
              action: "start",
              workflow: "crash_diagnose",
              input: {
                source_run_id: snapshot.source_run_id,
                collect_missing: true,
              },
            },
            reason:
              "Explicit bounded faultlog supplement requires an original device clock window; no fault operation is replayed",
          },
  };
}
