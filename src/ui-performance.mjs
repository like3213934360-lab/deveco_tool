import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import { persistUiPerformance } from "./performance-log.mjs";

const operations = new AsyncLocalStorage();
const round = value => Math.round(value * 1000) / 1000;

export function recordUiStage(name, elapsedMs, outputBytes = 0, failed = false) {
  const operation = operations.getStore();
  if (!operation || operation.closed) return;
  const stage = operation.stages[name] ??= { calls: 0, elapsedMs: 0, outputBytes: 0, failures: 0 };
  stage.calls++;
  stage.elapsedMs += elapsedMs;
  stage.outputBytes += outputBytes;
  stage.failures += Number(failed);
}

export async function measureUiStage(name, task) {
  if (!operations.getStore()) return task();
  const started = performance.now();
  try {
    const result = await task();
    recordUiStage(name, performance.now() - started,
      Buffer.byteLength(result?.stdout ?? "") + Buffer.byteLength(result?.stderr ?? ""));
    return result;
  } catch (error) {
    recordUiStage(name, performance.now() - started, 0, true);
    throw error;
  }
}

/** Process counters overlap concurrent work; stage durations are scoped to this async call. */
export async function measureUiOperation(name, task) {
  if (operations.getStore()) return task();
  const operation = { id: crypto.randomUUID(), stages: {}, closed: false };
  return operations.run(operation, async () => {
    const started = performance.now();
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    const finish = () => {
      operation.closed = true;
      const cpuDelta = process.cpuUsage(cpu);
      const after = process.memoryUsage();
      return {
        operationId: operation.id, operation: name, elapsedMs: round(performance.now() - started),
        stages: Object.fromEntries(Object.entries(operation.stages).map(([key, value]) =>
          [key, { ...value, elapsedMs: round(value.elapsedMs) }])),
        process: { cpuMs: round((cpuDelta.user + cpuDelta.system) / 1000),
          rssBytes: after.rss, rssDeltaBytes: after.rss - memory.rss,
          heapUsedBytes: after.heapUsed, heapDeltaBytes: after.heapUsed - memory.heapUsed },
        counterScope: "CPU and memory cover this host process during the call, including concurrent work; exclude child/device CPU. Overlapping stage times are not additive.",
      };
    };
    let result;
    try { result = await task(); }
    catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      error.performance = finish();
      error.performance.log = await persistUiPerformance(error.performance, error);
      throw error;
    }
    const metrics = finish();
    metrics.log = await persistUiPerformance(metrics);
    return { ...result, performance: metrics };
  });
}
