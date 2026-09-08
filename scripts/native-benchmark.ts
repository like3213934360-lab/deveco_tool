import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { atomicWrite, digest, fileDigest, inside } from "../src/core/files.js";
import { invariant, errorResult } from "../src/core/errors.js";
import { packageRoot } from "../src/core/config.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { benchmarkPlanSchema, executeBenchmarkSteps } from "./lib/benchmark-contracts.js";
import { readJson } from "./lib/upstream-adaptation.js";

const plan = benchmarkPlanSchema.parse(readJson(path.resolve(z.string().min(1).parse(process.argv[2]))));
const output = path.resolve(z.string().min(1).parse(process.argv[3])), tested = evidenceIdentity();
invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new benchmark evidence directory");
invariant(new Set(plan.capabilities.map((item) => item.capability)).size === plan.capabilities.length, "BENCHMARK_COVERAGE", "Benchmark capabilities must be unique");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const baseRoot = fs.realpathSync.native(plan.baseline_root), baselineEntry = inside(baseRoot, plan.baseline_entry), baselineHash = fileDigest(baselineEntry), baselineLock = fileDigest(path.join(baseRoot, "package-lock.json"));
const env = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]))), ...plan.environment };
const environment = digest({ hostname: os.hostname(), platform: process.platform, release: os.release(), arch: process.arch, node: process.version, cpus: os.cpus().map(({ model, speed }) => ({ model, speed })), memory: os.totalmem(), env: plan.environment });
const cold = { native: { initialize_ms: [] as number[], directory_ms: [] as number[], total_ms: [] as number[] }, baseline: { initialize_ms: [] as number[], directory_ms: [] as number[], total_ms: [] as number[] } };
const direct = plan.capabilities.map((item) => ({ capability: item.capability, input_sha256: digest({ input: item.logical_input, files: plan.inputs.map(({ sha256 }) => sha256) }), baseline_input_sha256: digest({ input: item.logical_input, files: plan.inputs.map(({ sha256 }) => sha256) }), native_ms: [] as number[], baseline_ms: [] as number[] }));
let passed = false, failure: unknown;
function verifyInputs() {
  for (const input of plan.inputs) invariant(fileDigest(input.file) === input.sha256, "BENCHMARK_INPUT_CHANGED", "Immutable scenario input changed");
  invariant(fileDigest(baselineEntry) === baselineHash && fileDigest(path.join(baseRoot, "package-lock.json")) === baselineLock, "BENCHMARK_BASELINE_CHANGED", "Baseline entry or dependencies changed");
  const git = (args: string[]) => execFileSync("git", args, { cwd: baseRoot, encoding: "utf8", timeout: 10000 }).trim();
  invariant(git(["rev-parse", "HEAD"]) === plan.baseline_commit && git(["status", "--porcelain", "--untracked-files=no"]) === "", "BENCHMARK_BASELINE_CHANGED", "Baseline must be the specified clean tracked revision");
  const after = evidenceIdentity();
  for (const key of ["runtime_sha256", "compiled_sha256", "package_lock_sha256", "resource_manifest_sha256", "upstream_lock_sha256"] as const) invariant(after[key] === tested[key], "BENCHMARK_RUNTIME_CHANGED", "Measured native bytes changed");
}
function save() {
  atomicWrite(path.join(output, "direct.json"), JSON.stringify({ format: 2, tested, passed, environment, baseline_environment: environment, baseline: { commit: plan.baseline_commit, entry_sha256: baselineHash, lock_sha256: baselineLock }, plan_sha256: digest(plan), cold, cold_ms: cold.native.total_ms, direct, expected_capabilities: direct.map((item) => item.capability), scope: "Full MCP round trips including every declared workflow wait and semantic assertion. Each case uses the same logical input and immutable input-file hashes; version-specific request mappings remain in the private plan. SDK/device mutation scenarios must use dedicated fixtures. CPU and memory are collected by the separate UI and SDK soak reports.", error: failure ? errorResult(failure) : null }, null, 2) + "\n");
}
async function server(version: "native" | "baseline", name: string, run: (client: Client) => Promise<void>, coldSample = false) {
  const state = path.join(output, "sessions", `${version}-${name}`);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const client = new Client({ name: "native-capability-benchmark", version: "2" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [version === "native" ? path.join(packageRoot, "dist/src/cli.js") : baselineEntry], cwd: state, stderr: "ignore", env: { ...env, DEVECO_STATE_DIR: path.join(state, "state"), DEVECO_TOOL_LOG_DIR: path.join(state, "logs") } });
  try {
    const start = performance.now();
    await client.connect(transport);
    const initialized = performance.now();
    const catalog = await client.listTools();
    const listed = performance.now();
    invariant(catalog.tools.length > 0, "BENCHMARK_DIRECTORY_EMPTY", "Tool catalog must be usable");
    if (coldSample) { cold[version].initialize_ms.push(initialized - start); cold[version].directory_ms.push(listed - initialized); cold[version].total_ms.push(listed - start); }
    await run(client);
  } finally { await transport.close(); }
}
try {
  verifyInputs();
  for (let sample = 0; sample < 30; sample++) {
    for (const version of sample % 2 ? ["native", "baseline"] as const : ["baseline", "native"] as const) await server(version, `cold-${sample}`, async () => {}, true);
    save();
    process.stdout.write(`Cold starts ${sample + 1}/30 per version\n`);
  }
  for (let index = 0; index < plan.capabilities.length; index++) {
    const scenario = plan.capabilities[index]!, record = direct[index]!;
    // Alternating 100-call blocks reduces order/thermal bias and retains all raw samples.
    for (let block = 0; block < 10; block++) {
      verifyInputs();
      for (const version of block % 2 ? ["native", "baseline"] as const : ["baseline", "native"] as const) await server(version, `${scenario.capability}-${block}`, async (client) => {
        await executeBenchmarkSteps(client, scenario[version]);
        for (let sample = 0; sample < 100; sample++) {
          const start = performance.now();
          await executeBenchmarkSteps(client, scenario[version]);
          record[version === "native" ? "native_ms" : "baseline_ms"].push(performance.now() - start);
        }
      });
      save();
      process.stdout.write(`${scenario.capability}: ${(block + 1) * 100}/1000 per version\n`);
    }
  }
  verifyInputs(); passed = true;
} catch (error) { failure = error; process.exitCode = 1; }
finally { save(); }
