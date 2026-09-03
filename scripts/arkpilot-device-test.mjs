#!/usr/bin/env node
import { replay, runnerOptions, shutdownRunner } from "./arkpilot-runner.mjs";

let exitCode = 0;
try {
  const options = runnerOptions(process.argv.slice(2), { iterations: 30, timeoutMs: 60000 });
  const runs = [];
  for (let index = 0; index < options.iterations; index += 1) {
    const execution = await replay(options);
    runs.push({
      iteration: index + 1,
      status: execution.result.status,
      elapsedMs: execution.result.elapsedMs,
      mcpCalls: execution.mcpCalls,
      metrics: execution.result.metrics,
      error: execution.result.error,
    });
    if (execution.result.status !== "SUCCEEDED") break;
  }
  const passed = runs.length === options.iterations && runs.every((run) => run.status === "SUCCEEDED");
  process.stdout.write(`${JSON.stringify({
    passed,
    flowId: options.flowId,
    deviceId: options.deviceId ?? null,
    requestedIterations: options.iterations,
    completedIterations: runs.length,
    runs,
  }, null, 2)}\n`);
  if (!passed) exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  exitCode = 1;
} finally {
  await shutdownRunner();
}
process.exitCode = exitCode;
