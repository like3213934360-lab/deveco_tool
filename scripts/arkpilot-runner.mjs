import fs from "node:fs";
import path from "node:path";
import { closeUiFlows, uiFlow } from "../src/arkpilot/flow-service.mjs";

export function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function runnerOptions(argv, defaults = {}) {
  const args = parseArguments(argv);
  const projectPath = path.resolve(args.project ?? process.cwd());
  const flowId = args.flow;
  if (!flowId) throw new Error("--flow <flow-id> is required");
  let variables = {};
  if (args["variables-file"]) {
    variables = JSON.parse(fs.readFileSync(path.resolve(args["variables-file"]), "utf8"));
  }
  return {
    projectPath,
    flowId,
    deviceId: args.device,
    backend: args.backend ?? "hdc-shell",
    variables,
    iterations: positiveInteger(args.iterations, defaults.iterations ?? 1, "--iterations"),
    warmups: positiveInteger(args.warmups, defaults.warmups ?? 0, "--warmups"),
    timeoutMs: positiveInteger(args.timeout, defaults.timeoutMs ?? 60000, "--timeout"),
  };
}

export async function replay(options) {
  let calls = 1;
  let result = await uiFlow({
    action: "run",
    project_path: options.projectPath,
    id: options.flowId,
    hvd: options.deviceId,
    backend: options.backend,
    variables: options.variables,
    timeoutMs: options.timeoutMs,
    wait_ms: 20000,
  });
  while (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(result.status)) {
    calls += 1;
    result = await uiFlow({ action: "status", job_id: result.jobId, wait_ms: 20000 });
  }
  return { result, mcpCalls: calls };
}

export async function shutdownRunner() {
  await closeUiFlows();
}

export function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}
