import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";
import { readJson } from "./lib/upstream-adaptation.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { validatePerformance } from "./lib/performance-gate.js";

const files = z.array(z.string().min(1)).length(4).parse(process.argv.slice(2)).map((file) => path.resolve(file));
const output = files[3]!, tested = evidenceIdentity();
invariant(!fs.existsSync(output), "OUTPUT_EXISTS", "Use a new consolidated performance report");
const inputSchema = z.object({ passed: z.literal(true), tested: z.record(z.string(), z.unknown()) }).passthrough();
const parts = files.slice(0, 3).map((file) => ({ file, sha256: fileDigest(file), data: inputSchema.parse(readJson(file)) }));
for (const part of parts) {
  invariant(fileDigest(part.file) === part.sha256, "BENCHMARK_REPORT_CHANGED", "Component report changed during capture");
  for (const key of ["runtime_sha256", "compiled_sha256", "package_lock_sha256", "resource_manifest_sha256", "upstream_lock_sha256"] as const) invariant(part.data.tested[key] === tested[key], "BENCHMARK_REPORT_STALE", "Every component must measure final code and resources");
}
const report = { ...parts[0]!.data, ui: parts[1]!.data.ui, orchestration_ms: parts[2]!.data.orchestration_ms, checkpoint_ms: parts[2]!.data.checkpoint_ms, persistent_graph_ms: parts[2]!.data.persistent_graph_ms, components: parts.map(({ sha256 }) => ({ sha256 })), tested };
validatePerformance(report);
atomicWrite(output, JSON.stringify(report, null, 2) + "\n", false);
