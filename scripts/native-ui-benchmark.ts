import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const baseline = path.resolve(z.string().min(1).parse(process.argv[2])), output = path.resolve(z.string().min(1).parse(process.argv[3])), tested = evidenceIdentity();
invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new UI evidence file");
const source = path.join(baseline, "src/device-dump.mjs"), baselineHash = fileDigest(source), ui: unknown[] = [];
const values = z.array(z.number().nonnegative());
const resultSchema = z.object({ input_sha256: z.string(), nodes: z.number(), input_bytes: z.number(), parse_ms: values.length(30), parse_cpu_us: values.length(30), parse_rss_bytes: values.length(30), queries: z.array(z.object({ input: z.unknown(), result_count: z.number(), ms: values.length(1000), cpu_us: values.length(1000), rss_bytes: values.length(1000) })).length(4) });
for (const [size, count] of [["small", 100], ["medium", 1000], ["large", 10000]] as const) {
  const results: Partial<Record<"native" | "baseline", z.infer<typeof resultSchema>>> = {};
  for (const version of ["baseline", "native"] as const) {
    const { stdout } = await promisify(execFile)(process.execPath, ["--expose-gc", fileURLToPath(new URL("./native-ui-benchmark-worker.js", import.meta.url)), version, baseline, String(count)], { timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
    results[version] = resultSchema.parse(JSON.parse(stdout));
  }
  const current = results.native!, previous = results.baseline!;
  invariant(current.input_sha256 === previous.input_sha256, "BENCHMARK_INPUT_CHANGED", "UI versions must use the same tree and selectors");
  ui.push({ size, nodes: current.nodes, input_sha256: current.input_sha256, parse_ms: current.parse_ms, query_ms: current.queries.flatMap((item) => item.ms), cpu_us: current.queries.flatMap((item) => item.cpu_us), rss_bytes: current.queries.flatMap((item) => item.rss_bytes), native: current, baseline: previous });
  process.stdout.write(`UI ${size}: isolated native and baseline parse/query samples captured\n`);
}
invariant(fileDigest(source) === baselineHash && evidenceIdentity().compiled_sha256 === tested.compiled_sha256, "BENCHMARK_RUNTIME_CHANGED", "Measured implementation changed");
atomicWrite(output, JSON.stringify({ tested, passed: true, baseline_file_sha256: baselineHash, scope: "Fresh isolated process per implementation/tree size. Parse includes JSON, flatten/index and one validated key query. Four selectors each have 1000 raw latency, self CPU and process RSS samples; assertions are included for both versions. Excludes SDK/HDC and full MCP serialization, which have separate reports.", ui }, null, 2) + "\n", false);
