// Explicit free-model experiments, not a provider fallback policy. Every attempt stays on disk.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actionScenarios } from "./model-eval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), options = {};
assert.equal(args.length % 2, 0, "Usage: model-matrix.mjs --out <new directory> --rounds <n> [--cases all|file] [--suite discovery|live] [--models provider/id,...]");
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--out", "--rounds", "--cases", "--suite", "--models", "--batch-size", "--capture-provider"].includes(args[i]));
  options[args[i].slice(2)] = args[i + 1];
}
const rounds = Number(options.rounds), out = path.resolve(options.out);
assert.ok(!options["capture-provider"] || options["capture-provider"] === "true");
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10);
assert.ok(!fs.existsSync(out), "Never overwrite previous trials");
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const catalog = execFileSync("opencode", ["models", "opencode", "--verbose"], { encoding: "utf8" });
fs.writeFileSync(path.join(out, "catalog.txt"), catalog);
const models = [...catalog.matchAll(/^(opencode\/[^\n]+)\n(\{[\s\S]*?^\})/gm)].map((m) => ({ ...JSON.parse(m[2]), id: m[1] }));
const selected = options.models?.split(",") ?? models.map((m) => m.id);
assert.ok(selected.length && new Set(selected).size === selected.length);
for (const id of selected) {
  const model = models.find((m) => m.id === id);
  assert.ok(model?.capabilities.toolcall && model.cost.input === 0 && model.cost.output === 0
    && Object.values(model.cost.cache).every((v) => v === 0), `${id}: must currently support tools with zero cost`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/current.json"), "utf8"));
const entry = path.join(root, "dist", manifest.entry);
const cases = !options.cases || options.cases === "all" ? actionScenarios : JSON.parse(fs.readFileSync(options.cases, "utf8"));
if (options.suite === "live") for (const id of selected) for (const modality of new Set(cases.flatMap((c) => c.requires ?? [])))
  assert.ok(models.find((m) => m.id === id).capabilities.input[modality], `${id}: ${modality} input required by this suite; use applicable cases, never claim visual acceptance for a text-only model`);
const size = options["batch-size"] ? Number(options["batch-size"]) : cases.length;
assert.ok(Number.isInteger(size) && size >= 1 && size <= cases.length);
assert.ok(options.suite !== "live" || size === cases.length, "Dependent live steps must not be split across sessions");
const batches = [];
for (let i = 0; i < cases.length; i += size) {
  const file = path.join(out, `cases-${batches.length + 1}.json`);
  fs.writeFileSync(file, JSON.stringify(cases.slice(i, i + size), null, 2) + "\n");
  batches.push(file);
}
fs.writeFileSync(path.join(out, "matrix.json"), JSON.stringify({ selected, rounds, entry, build_id: manifest.input_hash,
  capabilities: selected.map((id) => ({ id, input: models.find((m) => m.id === id).capabilities.input })),
  suite: options.suite ?? "discovery", cases: options.cases ?? "all", batch_size: size }, null, 2) + "\n");
const queue = Array.from({ length: rounds }, (_, i) => selected.flatMap((model) => batches.map((file, batch) => ({ model, round: i + 1, file, batch: batch + 1 })))).flat();
const reports = [];
async function worker() {
  while (queue.length) {
    const { model, round, file, batch } = queue.shift();
    const directory = path.join(out, `${model.split("/")[1]}-${round}${batches.length > 1 ? `-${batch}` : ""}`);
    const child = spawn(process.execPath, [path.join(root, "tools/model-eval.mjs"), "--host", "opencode", "--model", model,
      "--entry", entry, "--suite", options.suite ?? "discovery", "--cases", file, "--out", directory,
      ...(options["capture-provider"] ? ["--capture-provider", "true"] : [])], { cwd: root, stdio: "inherit" });
    const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
    const reportFile = path.join(directory, "report.json");
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : { error: "trial produced no report", passed: false };
    reports.push({ model, round, batch, exit, passed: report.passed, correct: report.cases?.filter((c) => c.passed).length,
      total: report.cases?.length, calls: report.calls?.length, error: report.error });
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(reports, null, 2) + "\n");
  }
}
// Two read-only discovery sessions can run independently. Device/mutating suites stay serial.
await Promise.all(Array.from({ length: options.suite === "live" ? 1 : 2 }, worker));
if (reports.some((r) => r.passed !== true)) process.exitCode = 1;
