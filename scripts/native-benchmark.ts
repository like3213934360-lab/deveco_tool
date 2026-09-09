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
import { confirmBaselineAbsence, type baselineAbsenceSchema } from "./lib/benchmark-comparison.js";

const plan = benchmarkPlanSchema.parse(readJson(path.resolve(z.string().min(1).parse(process.argv[2]))));
const output = path.resolve(z.string().min(1).parse(process.argv[3])), tested = evidenceIdentity();
invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new benchmark evidence directory");
invariant(new Set(plan.capabilities.map((item) => item.capability)).size === plan.capabilities.length, "BENCHMARK_COVERAGE", "Benchmark capabilities must be unique");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const baseRoot = fs.realpathSync.native(plan.baseline_root), baselineEntry = inside(baseRoot, plan.baseline_entry), baselineHash = fileDigest(baselineEntry), baselineLock = fileDigest(path.join(baseRoot, "package-lock.json"));
const env = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]))), ...plan.environment };
const environment = digest({ hostname: os.hostname(), platform: process.platform, release: os.release(), arch: process.arch, node: process.version, cpus: os.cpus().map(({ model, speed }) => ({ model, speed })), memory: os.totalmem(), env: plan.environment });
const cold = { native: { initialize_ms: [] as number[], directory_ms: [] as number[], total_ms: [] as number[] }, baseline: { initialize_ms: [] as number[], directory_ms: [] as number[], total_ms: [] as number[] } };
const direct = plan.capabilities.map((item) => {
  const common = { capability: item.capability, input_sha256: digest({ input: item.logical_input, files: plan.inputs.map(({ sha256 }) => sha256) }), native_ms: [] as number[] };
  return item.comparison === "paired"
    ? { ...common, comparison: "paired" as const, baseline_input_sha256: common.input_sha256, baseline_ms: [] as number[] }
    : { ...common, capability: "app_signature.inspect" as const, comparison: "new" as const, baseline_absence: undefined as z.infer<typeof baselineAbsenceSchema> | undefined };
});
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
  atomicWrite(path.join(output, "direct.json"), JSON.stringify({ format: 3, tested, passed, environment, baseline_environment: environment, baseline: { commit: plan.baseline_commit, entry_sha256: baselineHash, lock_sha256: baselineLock }, plan_sha256: digest(plan), cold, cold_ms: cold.native.total_ms, direct, expected_capabilities: direct.map((item) => item.capability), scope: "Full MCP round trips including every declared workflow wait and semantic assertion. Paired cases use the same logical input and immutable file hashes. The new read-only signing inspect operation requires an exact audited baseline contract and 1000 native samples; it reports no fabricated baseline samples or speedup. Version-specific requests remain in the private plan. SDK/device effects require dedicated fixtures. CPU and memory are collected separately.", error: failure ? errorResult(failure) : null }, null, 2) + "\n");
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
    return catalog;
  } finally { await transport.close(); }
}
try {
  verifyInputs();
  if (direct.some((item) => item.comparison === "new")) {
    const catalog = await server("baseline", "contract-audit", async () => {});
    const absence = confirmBaselineAbsence(plan.baseline_commit, catalog.tools);
    atomicWrite(path.join(output, "baseline-contract.private.json"), JSON.stringify(catalog, null, 2) + "\n", false);
    for (const record of direct) if (record.comparison === "new") record.baseline_absence = absence;
  }
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
      const versions = scenario.comparison === "new" ? ["native"] as const : block % 2 ? ["native", "baseline"] as const : ["baseline", "native"] as const;
      for (const version of versions) await server(version, `${scenario.capability}-${block}`, async (client) => {
        const steps = version === "baseline" && scenario.comparison === "paired" ? scenario.baseline : scenario.native;
        await executeBenchmarkSteps(client, steps);
        for (let sample = 0; sample < 100; sample++) {
          const start = performance.now();
          await executeBenchmarkSteps(client, steps);
          const elapsed = performance.now() - start;
          if (version === "native") record.native_ms.push(elapsed);
          else if (record.comparison === "paired") record.baseline_ms.push(elapsed);
        }
      });
      save();
      process.stdout.write(`${scenario.capability}: ${(block + 1) * 100}/1000 ${scenario.comparison === "paired" ? "per version" : "native; absent from audited baseline"}\n`);
    }
  }
  verifyInputs(); passed = true;
} catch (error) { failure = error; process.exitCode = 1; }
finally { save(); }
