import { toolImageResponse } from "./core/tool-image-response.js";
import { release, protocolVersion } from "./core/config.js";
import { requestAction, requestOutcome } from "./core/request-outcome.js";
import { parentPort } from "node:worker_threads";
import { ipcInput } from "./core/ipc.js";
import { errorResult, invariant, ToolError } from "./core/errors.js";
import { Runtime } from "./services/runtime.js";
import { withTrace } from "./core/trace.js";
import { tools } from "./core/contracts.js";
import { RequestLog } from "./core/request-log.js";
import { RuntimeSamples } from "./core/runtime-samples.js";

invariant(
  parentPort,
  "WORKER_PORT_REQUIRED",
  "Runtime must execute in a worker",
);
const port = parentPort,
  runtime = new Runtime();
const createRequestLog = () => new RequestLog(runtime.store, (error) => {
  process.stderr.write(JSON.stringify({ kind: "request_log_failed", error: errorResult(error) }) + "\n");
});
let requestLog: RequestLog | undefined, startupCapacityError: unknown;
try { requestLog = createRequestLog(); }
catch (error) {
  if (errorResult(error).code !== "STATE_CAPACITY") throw error;
  startupCapacityError = error;
}
const requests = new Map<
  string,
  { controller: AbortController; finished: Promise<void> }
>();
const runtimeSamples = new RuntimeSamples(runtime.store, () => {
  const processes = runtime.processes.metrics, lsp = runtime.diagnostics.lsp.metrics, cpu = runtime.cpu.metrics;
  return {
    active_requests: requests.size, owned_processes: processes.processes, owned_listeners: processes.listeners,
    owned_connections: processes.sessions + lsp.connections, parser_active: cpu.active, parser_queued: cpu.queued,
    parser_workers: cpu.workers, lsp_active_requests: lsp.active_requests,
    ui_cache_entries: runtime.devices.cacheMetrics.snapshots,
  };
}, error => {
  process.stderr.write(JSON.stringify({ kind: "runtime_sample_failed", stage: "worker", release,
    protocol: protocolVersion, instance_id: runtime.store.owner, code: errorResult(error).code }) + "\n");
});
let stopping = false;
port.on("message", (raw: unknown) => {
  const input = ipcInput.parse(raw);
  if (input.type === "cancel") {
    requests.get(input.id)?.controller.abort(
      new ToolError("CANCELLED", "Runtime request was cancelled"),
    );
    return;
  }
  if (input.type === "close") {
    stopping = true;
    for (const request of requests.values())
      request.controller.abort(
        new ToolError("CANCELLED", "Runtime is closing"),
      );
    void (async () => {
      try {
        await Promise.allSettled(
          [...requests.values()].map((request) => request.finished),
        );
        runtimeSamples.close();
        // Finish runtime cleanup even when ordinary log persistence failed.
        let logFailure: { error: unknown } | undefined;
        try { requestLog?.close(); } catch (error) { logFailure = { error }; }
        const result = await runtime.close();
        if (logFailure) throw logFailure.error;
        port.postMessage({ id: input.id, ok: true, data: result });
      } catch (error) {
        port.postMessage({
          id: input.id,
          ok: false,
          error: errorResult(error),
        });
      } finally {
        port.close();
      }
    })();
    return;
  }
  const finished = Promise.withResolvers<void>();
  const execution = {
    controller: new AbortController(),
    finished: finished.promise,
  };
  requests.set(input.id, execution);
  void (async () => {
    const started = performance.now();
    try {
      invariant(!stopping, "RUNTIME_STOPPING", "Runtime is closing");
      invariant(
        requests.size <= 64,
        "REQUEST_CAPACITY",
        "At most 64 concurrent runtime requests",
      );
      const storageRecovery = input.name === "maintenance" || (input.name === "workflow_run" &&
        ["capacity", "cleanup_plan", "cleanup_apply", "export", "storage_receipt", "cancel", "read_result", "read_events", "read_artifact", "status"]
          .includes(tools.workflow_run.schema.parse(input.input).action)) ||
        (input.name === "ui_test" && tools.ui_test.schema.parse(input.input).action === "cancel") ||
        (input.name === "ui_review" && tools.ui_review.schema.parse(input.input).action === "cancel") ||
        (input.name === "skill_workflow" && (() => { const value = tools.skill_workflow.schema.parse(input.input); return value.action === "archive" || value.action === "export" || (value.action === "transition" && value.phase === "cancelled"); })());
      const log = (kind: "request_start" | "request_finish", data: unknown) => {
        try {
          if (!requestLog) throw startupCapacityError;
          requestLog.write(kind, data);
        }
        catch (error) {
          if (!storageRecovery || errorResult(error).code !== "STATE_CAPACITY") throw error;
          // Read-only recovery queries and receipt-backed cleanup must remain
          // callable when ordinary request telemetry cannot acquire capacity.
        }
      };
      log("request_start", {
        request_id: input.id,
        tool: input.name,
        instance_id: runtime.store.owner,
        ...requestAction(input.input), stage: "worker", release, protocol: protocolVersion,
      });
      let data = await withTrace({ request_id: input.id }, () =>
        runtime.call(input.name, input.input, execution.controller.signal),
      );
      const outcome = requestOutcome(data);
      const artifactRead =
        (input.name === "workflow_run" &&
        ["read_artifact", "read_result", "read_events"].includes(tools.workflow_run.schema.parse(input.input).action)) ||
        (["skill_manage", "harmony_knowledge", "domain_content"].includes(input.name) &&
          typeof input.input === "object" && input.input !== null &&
          "action" in input.input && input.input.action === "read");
      // Explicit reads are already bounded by their page/image contracts. Wrapping
      // base64 pages again makes large artifacts impossible to retrieve; images
      // must reach the MCP presentation layer without creating another artifact.
      const inlineImage = ["ui_test", "ui_review", "verify_ui"].includes(input.name) &&
        toolImageResponse(input.name, input.input, data).image !== undefined;
      if (!artifactRead && !inlineImage) {
        const serialized = JSON.stringify(data ?? null);
        if (Buffer.byteLength(serialized) > 16384)
          data = {
            summary: "Result is available as an artifact",
            ...(input.name === "ui_test" && data && typeof data === "object" ? Object.fromEntries(
              Object.entries(data).filter(([key]) => ["status", "initialized", "initialization_stage", "initialization_error", "verified", "blocked", "next_action", "next"].includes(key)),
            ) : {}),
            ...Object.fromEntries(Object.entries(outcome).filter(([key]) => ["run_id", "test_id", "review_id"].includes(key))),
            artifact: runtime.store.artifact(
              typeof outcome.run_id === "string" ? outcome.run_id : "request",
              serialized,
              "application/json",
            ),
          };
      }
      if (storageRecovery) {
        try {
          if (!requestLog) requestLog = createRequestLog();
          else requestLog.recoverCapacity();
        }
        catch (error) { if (errorResult(error).code !== "STATE_CAPACITY") throw error; }
      }
      log("request_finish", {
        request_id: input.id,
        tool: input.name,
        instance_id: runtime.store.owner,
        elapsed_ms: performance.now() - started,
        ...requestAction(input.input), ...outcome, stage: "worker", release, protocol: protocolVersion,
      });
      port.postMessage({ id: input.id, ok: true, data: data ?? null });
    } catch (error) {
      try {
        requestLog?.write("request_failed", { request_id: input.id, tool: input.name,
          instance_id: runtime.store.owner, elapsed_ms: performance.now() - started,
          ...requestAction(input.input), outcome: "error", stage: "worker", release, protocol: protocolVersion, code: errorResult(error).code });
      } catch { /* The original failure remains the tool result. Flush errors also surface on close. */ }
      port.postMessage({ id: input.id, ok: false, error: errorResult(error) });
    } finally {
      requests.delete(input.id);
      finished.resolve();
    }
  })();
});
