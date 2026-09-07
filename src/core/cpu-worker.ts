import { parentPort } from "node:worker_threads";
import { cpuRequestSchema } from "./cpu-protocol.js";
import { errorResult, invariant } from "./errors.js";
import { parseUiDump } from "../services/ui-parse.js";
import { parseCrash } from "../services/crash.js";
import { parseLintReport } from "../services/lint-report.js";

invariant(
  parentPort,
  "CPU_WORKER_PORT_REQUIRED",
  "Parser requires a parent port",
);
const port = parentPort;
port.on("message", (raw: unknown) => {
  const { id, task } = cpuRequestSchema.parse(raw);
  try {
    const start = performance.now();
    const data =
      task.kind === "ui"
        ? parseUiDump(task.content, task.format)
        : task.kind === "lint"
          ? parseLintReport(task.content, task.limit)
          : parseCrash(task.content, task.options);
    port.postMessage({
      id,
      ok: true,
      data,
      elapsed_ms: performance.now() - start,
    });
  } catch (error) {
    port.postMessage({ id, ok: false, error: errorResult(error) });
  }
});
