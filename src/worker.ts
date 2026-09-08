import { parentPort } from "node:worker_threads";
import { ipcInput } from "./core/ipc.js";
import { errorResult, invariant } from "./core/errors.js";
import { Runtime } from "./services/runtime.js";
import { withTrace } from "./core/trace.js";
import { tools } from "./core/contracts.js";

invariant(
  parentPort,
  "WORKER_PORT_REQUIRED",
  "Runtime must execute in a worker",
);
const port = parentPort,
  runtime = new Runtime();
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
        const result = await runtime.close();
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
      runtime.store.event(null, "request_start", {
        request_id: input.id,
        tool: input.name,
      });
      let data = await withTrace({ request_id: input.id }, () =>
        runtime.call(input.name, input.input, execution.controller.signal),
      );
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
            artifact: runtime.store.artifact(
              "request",
              serialized,
              "application/json",
            ),
          };
      }
      runtime.store.event(null, "request_finish", {
        request_id: input.id,
        tool: input.name,
        elapsed_ms: performance.now() - started,
      });
      port.postMessage({ id: input.id, ok: true, data: data ?? null });
    } catch (error) {
      port.postMessage({ id: input.id, ok: false, error: errorResult(error) });
    } finally {
      requests.delete(input.id);
      finished.resolve();
    }
  })();
});
