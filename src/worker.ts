import { release, protocolVersion } from "./core/config.js";
import { requestAction, requestOutcome } from "./core/request-outcome.js";
import { parentPort } from "node:worker_threads";
import { ipcInput } from "./core/ipc.js";
import { errorResult, invariant } from "./core/errors.js";
import { Runtime } from "./services/runtime.js";
import { withTrace } from "./core/trace.js";
import { tools } from "./core/contracts.js";
import { RequestLog } from "./core/request-log.js";

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
let stopping = false;
port.on("message", (raw: unknown) => {
  const input = ipcInput.parse(raw);
  if (input.type === "cancel") {
    requests.get(input.id)?.controller.abort();
    return;
  }
  if (input.type === "close") {
    stopping = true;
    for (const request of requests.values()) request.controller.abort();
    void (async () => {
      try {
        await Promise.allSettled(
          [...requests.values()].map((request) => request.finished),
        );
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
    try {
      invariant(!stopping, "RUNTIME_STOPPING", "Runtime is closing");
      invariant(
        requests.size <= 64,
        "REQUEST_CAPACITY",
        "At most 64 concurrent runtime requests",
      );
      const started = performance.now();
      const storageRecovery = (input.name === "workflow_run" &&
        ["capacity", "cleanup_plan", "cleanup_apply", "export", "storage_receipt", "cancel"]
          .includes(tools.workflow_run.schema.parse(input.input).action)) ||
        (input.name === "ui_test" && tools.ui_test.schema.parse(input.input).action === "cancel") ||
        (input.name === "ui_review" && tools.ui_review.schema.parse(input.input).action === "cancel") ||
        (input.name === "skill_workflow" && (() => { const value = tools.skill_workflow.schema.parse(input.input); return value.action === "transition" && value.phase === "cancelled"; })());
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
        ...requestAction(input.input), stage: "worker", release, protocol: protocolVersion,
      });
      let data = await withTrace({ request_id: input.id }, () =>
        runtime.call(input.name, input.input, execution.controller.signal),
      );
      const outcome = requestOutcome(data);
      const artifactRead =
        input.name === "workflow_run" &&
        tools.workflow_run.schema.parse(input.input).action === "read_artifact";
      // Explicit reads are already bounded by their page/image contracts. Wrapping
      // base64 pages again makes large artifacts impossible to retrieve; images
      // must reach the MCP presentation layer without creating another artifact.
      if (!artifactRead) {
        const serialized = JSON.stringify(data ?? null);
        if (Buffer.byteLength(serialized) > 65536)
          data = {
            summary: "Result is available as an artifact",
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
        elapsed_ms: performance.now() - started,
        ...requestAction(input.input), ...outcome, stage: "worker", release, protocol: protocolVersion,
      });
      port.postMessage({ id: input.id, ok: true, data: data ?? null });
    } catch (error) {
      try {
        requestLog?.write("request_failed", { request_id: input.id, tool: input.name, ...requestAction(input.input), outcome: "error", stage: "worker", release, protocol: protocolVersion, code: errorResult(error).code });
      } catch { /* The original failure remains the tool result. Flush errors also surface on close. */ }
      port.postMessage({ id: input.id, ok: false, error: errorResult(error) });
    } finally {
      requests.delete(input.id);
      finished.resolve();
    }
  })();
});
