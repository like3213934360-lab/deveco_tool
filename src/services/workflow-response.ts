import { createHash } from "node:crypto";
import { StateStore, type RunRecord } from "../core/store.js";
import { invariant } from "../core/errors.js";
import { recoveryAdvice } from "../core/recovery.js";
import { buildFailurePreview, nativeFailureExecution } from "./build-failure.js";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const size = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value ?? null));

/** Full payloads remain in SQLite/artifacts. Status reads never allocate another artifact. */
function compact(value: unknown, maximum: number) {
  if (size(value) <= maximum) return { value, truncated: false };
  const shorten = (item: unknown, depth = 0): unknown => {
    if (typeof item === "string")
      return item.length > 320 ? item.slice(0, 320) + "… [truncated]" : item;
    if (item === null || typeof item !== "object") return item;
    if (depth >= 4)
      return {
        truncated: true,
        type: Array.isArray(item) ? "array" : "object",
        count: Object.keys(item).length,
      };
    if (Array.isArray(item))
      return {
        items: item.slice(0, 8).map((v) => shorten(v, depth + 1)),
        total: item.length,
        truncated: item.length > 8,
      };
    const entries = Object.entries(item),
      kept = entries.slice(0, 20);
    return {
      ...Object.fromEntries(
        kept.map(([key, v]) => [key, shorten(v, depth + 1)]),
      ),
      ...(entries.length > kept.length
        ? { omitted_fields: entries.length - kept.length }
        : {}),
    };
  };
  const shortened = shorten(value);
  return {
    value:
      size(shortened) <= maximum
        ? shortened
        : {
            available: true,
            truncated: true,
            top_level_fields: Object.keys(record(value)).slice(0, 30),
          },
    truncated: true,
  };
}

export class WorkflowResponses {
  constructor(
    readonly store: StateStore,
    readonly completion: (workflow: string) => string,
  ) {}
  private artifacts(id: string) {
    return this.store.db
      .prepare(
        "SELECT id AS artifact_id,bytes,mime,created FROM artifacts WHERE run_id=? ORDER BY created,id",
      )
      .all(id) as {
      artifact_id: string;
      bytes: number;
      mime: string;
      created: number;
    }[];
  }
  private reference(
    run: RunRecord,
    section: "result" | "error" | "input" | "artifacts",
  ) {
    return {
      tool: "workflow_run",
      action: "read_result",
      run_id: run.id,
      section,
    };
  }
  present(run: RunRecord, detail: "summary" | "full" = "summary") {
    const rawResult: unknown = run.result ? JSON.parse(run.result) : null,
      rawError: unknown = run.error ? JSON.parse(run.error) : null;
    const result =
      detail === "full"
        ? { value: rawResult, truncated: false }
        : compact(rawResult, 6000);
    const error =
      detail === "full"
        ? { value: rawError, truncated: false }
        : compact(rawError, 2000);
    const phaseEvent = this.store.db
      .prepare(
        "SELECT kind,data FROM events WHERE run_id=? AND kind IN ('node_start','node_finish') ORDER BY id DESC LIMIT 1",
      )
      .get(run.id) as { kind: string; data: string } | undefined;
    const phase = phaseEvent
      ? String(record(JSON.parse(phaseEvent.data)).node ?? run.status)
      : run.status;
    const artifacts = this.artifacts(run.id),
      context = record(JSON.parse(run.input));
    const active = ["queued", "running", "cancelling"].includes(run.status);
    const scope = compact({ project_path: context.project_path, product: context.product,
      module_targets: context.module_targets, target: context.target, app: record(context.parameters).app }, 2000);
    const packages = record(record(rawResult)._evidence).artifacts;
    const deployable = run.workflow === "project_build" && run.status === "succeeded" && Array.isArray(packages) &&
      packages.some(item => String(record(item).path ?? "").endsWith("-signed.hap"));
    let execution: Record<string, unknown> = {};
    try { execution = record(record(record(rawError).details).diagnosis).execution
      ? record(record(record(record(rawError).details).diagnosis).execution)
      : nativeFailureExecution(this.store, record(rawError).details); } catch { /* The original error and full receipt remain readable. */ }
    return {
      run_id: run.id,
      workflow: run.workflow,
      status: run.status,
      phase,
      scope: scope.value,
      scope_truncated: scope.truncated,
      completion: this.completion(run.workflow),
      created_at: new Date(run.created).toISOString(),
      updated_at: new Date(run.updated).toISOString(),
      result: result.value,
      result_truncated: result.truncated,
      result_read: this.reference(run, "result"),
      error:
        rawError === null
          ? null
          : {
              ...record(error.value),
              code: record(rawError).code,
              message: record(rawError).message,
              retryable: record(rawError).retryable,
              diagnosis: buildFailurePreview(record(rawError).details),
              ...Object.fromEntries(Object.entries(execution).filter(([key]) => ["exitCode", "exitSignal", "signal", "truncated", "log"].includes(key))),
              ...Object.fromEntries(
                Object.entries(record(record(rawError).details)).filter(
                  ([key]) =>
                    [
                      "exitCode",
                      "exitSignal",
                      "truncated",
                      "stdout_artifact",
                      "stderr_artifact",
                    ].includes(key),
                ),
              ),
            },
      error_truncated: error.truncated,
      error_read: this.reference(run, "error"),
      artifacts: {
        items: artifacts
          .slice(0, 8)
          .map((item) => ({
            ...item,
            read: {
              tool: "workflow_run",
              action: "read_artifact",
              artifact_id: item.artifact_id,
            },
          })),
        total: artifacts.length,
        truncated: artifacts.length > 8,
        read: this.reference(run, "artifacts"),
      },
      events_read: {
        tool: "workflow_run",
        action: "read_events",
        run_id: run.id,
      },
      ...(["failed", "needs_input", "interrupted", "cancelled"].includes(run.status) &&
          ["app_deploy", "build_run", "build_deploy_verify"].includes(run.workflow) ? {
        optional_crash_diagnosis: { tool: "workflow_run", arguments: { action: "start", workflow: "crash_diagnose", input: { source_run_id: run.id } },
          purpose: "Inspect this task's retained startup logs without replaying deployment or accessing the device." },
      } : {}),
      ...(run.status === "succeeded" && ["app_deploy","build_run","build_deploy_verify"].includes(run.workflow) &&
          typeof record(record(rawResult)._evidence).scope === "object" &&
          typeof record(record(record(rawResult)._evidence).scope).target === "string" ? {
        optional_ui_test: { tool: "ui_test", arguments: { action: "start", deployment_run_id: run.id },
          requires: ["test_plan", "steps"], purpose: "When UI behavior needs checking, reuse this captured deployment scope." },
      } : {}),
      ...(run.status === "succeeded" && ["project_build","app_deploy","build_run","build_deploy_verify"].includes(run.workflow) &&
          Array.isArray(record(record(rawResult)._evidence).requirements) ? {
        optional_acceptance: { tool: "domain_acceptance", arguments: { action: "assess", evidence_run_ids: [run.id] },
          requires: ["requirements"], purpose: "Only for assessment against the originally captured requirements and explicit task mappings." },
      } : {}),
      next: active
        ? {
            tool: "workflow_run",
            action: "status",
            run_id: run.id,
            wait_ms: 1000,
          }
        : deployable ? { tool: "workflow_run", action: "start", workflow: "app_deploy", input: { build_run_id: run.id } } : null,
      ...(["failed", "needs_input", "interrupted"].includes(run.status)
        ? {
            recovery: recoveryAdvice(String(record(rawError).code ?? ""), {
              workflow: run.workflow,
              run_id: run.id,
              status: run.status,
              ...(typeof context.project_path === "string"
                ? { project_path: context.project_path }
                : {}),
            }),
          }
        : {}),
    };
  }
  read(
    id: string,
    section: "result" | "error" | "input" | "artifacts",
    offset = 0,
    limit = 8192,
    expected?: string,
  ) {
    const run = this.store.get(id);
    const content = Buffer.from(
      section === "artifacts"
        ? JSON.stringify(this.artifacts(id))
        : (run[section] ?? "null"),
    );
    const sha256 = createHash("sha256").update(content).digest("hex");
    invariant(
      offset === 0 || expected !== undefined,
      "RESULT_VERSION_REQUIRED",
      "Pass the first page sha256 as expected_sha256 for subsequent pages",
    );
    invariant(
      expected === undefined || expected === sha256,
      "RESULT_CHANGED",
      "Result changed during pagination; read again from offset 0",
    );
    const data = content.subarray(offset, offset + limit),
      next = offset + data.length;
    return {
      run_id: id,
      section,
      mime: "application/json",
      bytes: content.length,
      sha256,
      offset,
      next_offset: next < content.length ? next : null,
      encoding: "base64",
      data: data.toString("base64"),
      next:
        next < content.length
          ? {
              tool: "workflow_run",
              action: "read_result",
              run_id: id,
              section,
              offset: next,
              limit,
              expected_sha256: sha256,
            }
          : null,
    };
  }
  events(id: string, after = 0, limit = 30) {
    this.store.get(id);
    const rows = this.store.db
      .prepare(
        "SELECT id,kind,data,created FROM events WHERE run_id=? AND id>? ORDER BY id LIMIT ?",
      )
      .all(id, after, limit + 1) as {
      id: number;
      kind: string;
      data: string;
      created: number;
    }[];
    const selected: typeof rows = [];
    let bytes = 0;
    for (const row of rows.slice(0, limit)) {
      const nextSize = Buffer.byteLength(row.data) + 256;
      if (selected.length && bytes + nextSize > 49152) break;
      selected.push(row);
      bytes += nextSize;
    }
    const cursor = selected.at(-1)?.id ?? after;
    return {
      run_id: id,
      events: selected.map((row) => ({
        ...row,
        data: JSON.parse(row.data) as unknown,
      })),
      cursor,
      has_more: rows.length > selected.length,
      next: {
        tool: "workflow_run",
        action: "read_events",
        run_id: id,
        offset: cursor,
        limit,
      },
    };
  }
}
