#!/usr/bin/env node
import {
  percentile, replay, runnerOptions, shutdownRunner,
} from "./arkpilot-runner.mjs";

let exitCode = 0;
try {
  const options = runnerOptions(process.argv.slice(2), { iterations: 50, warmups: 3, timeoutMs: 60000 });
  for (let index = 0; index < options.warmups; index += 1) {
    const warmup = await replay(options);
    if (warmup.result.status !== "SUCCEEDED") {
      throw new Error(`Warm-up ${index + 1} failed: ${warmup.result.error?.code ?? warmup.result.status}`);
    }
  }

  const runs = [];
  for (let index = 0; index < options.iterations; index += 1) runs.push(await replay(options));
  const succeeded = runs.filter((run) => run.result.status === "SUCCEEDED");
  const elapsed = runs.map((run) => run.result.elapsedMs);
  const stepElapsed = runs.flatMap((run) => run.result.steps.map((step) => step.elapsedMs));
  const totals = (field) => runs.reduce((sum, run) => sum + (run.result.metrics?.[field] ?? 0), 0);
  const report = {
    flowId: options.flowId,
    deviceId: options.deviceId ?? null,
    backend: options.backend,
    warmups: options.warmups,
    iterations: options.iterations,
    successRate: succeeded.length / runs.length,
    mcpCalls: runs.reduce((sum, run) => sum + run.mcpCalls, 0),
    flowElapsedMs: {
      p50: percentile(elapsed, 0.5), p95: percentile(elapsed, 0.95), max: Math.max(...elapsed),
    },
    stepElapsedMs: {
      p50: percentile(stepElapsed, 0.5), p95: percentile(stepElapsed, 0.95),
      max: stepElapsed.length ? Math.max(...stepElapsed) : null,
    },
    uiDumps: totals("uiDumps"),
    hdcCommands: totals("hdcCommands"),
    screenshots: totals("screenshots"),
    actions: totals("actions"),
    memory: process.memoryUsage(),
    failures: runs.filter((run) => run.result.status !== "SUCCEEDED").map((run) => ({
      status: run.result.status, error: run.result.error,
    })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (succeeded.length !== runs.length) exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  exitCode = 1;
} finally {
  await shutdownRunner();
}
process.exitCode = exitCode;
