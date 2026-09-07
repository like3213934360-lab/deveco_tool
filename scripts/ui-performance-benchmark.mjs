#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { uiFind, uiObserve, cleanupUiTemporaryFiles, removeUiTemporaryFile } from "../src/device-ui.mjs";

const options = { iterations: 12, output: null, hvd: undefined };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, "");
  if (!(key in options) || !process.argv[i + 1]) throw new Error("Use --iterations N --output FILE --hvd DEVICE");
  options[key] = key === "iterations" ? Number(process.argv[i + 1]) : process.argv[i + 1];
}
if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 100) throw new Error("iterations must be 1–100");
const selectors = ["Toggle", "Text", "Button", "Image"].map(type => ({ type, limit: 2 }));
const input = { hvd: options.hvd, timeoutMs: 30000 };
const runs = [], checkpoints = [], retainedPaths = [];
const delay = monitorEventLoopDelay({ resolution: 20 });
const checkpoint = label => { global.gc?.(); checkpoints.push({ label, ...process.memoryUsage() }); };
const capture = report => {
  if (report.dumpPath) retainedPaths.push(report.dumpPath);
  if (report.localPath) removeUiTemporaryFile(report.localPath);
  return { performance: report.performance, nodeCount: report.nodeCount, signature: report.signature,
    method: report.method, bytes: report.bytes, deviceId: report.deviceId };
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
try {
  await uiFind({ ...input, limit: 1 });
  capture(await uiObserve({ ...input, width: 700, limit: 1 }));
  checkpoint("warm"); delay.enable();
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    // Rotate order to reduce systematic warm/cache/order bias. No input or navigation is sent.
    const kinds = ["freshFour", "batchFour", "cachedFour", "observe"];
    for (const kind of [...kinds.slice(iteration % 4), ...kinds.slice(0, iteration % 4)]) {
      const reports = [];
      const start = performance.now();
      if (kind === "freshFour") {
        for (const selector of selectors) reports.push(capture(await uiFind({ ...input, ...selector })));
      } else if (kind === "batchFour") reports.push(capture(await uiFind({ ...input, selectors })));
      else if (kind === "cachedFour") {
        const dumpPath = retainedPaths.at(-1);
        for (const selector of selectors) reports.push(capture(await uiFind({ dumpPath, ...selector })));
      } else reports.push(capture(await uiObserve({ ...input, selectors, width: 700 })));
      runs.push({ iteration, kind, elapsedMs: performance.now() - start, reports });
    }
    checkpoint(`iteration-${iteration + 1}`);
    process.stderr.write(`Read-only UI benchmark ${iteration + 1}/${options.iterations}\n`);
  }
  delay.disable();
  const existingSnapshots = new Set(retainedPaths.filter(file => fs.existsSync(file)));
  const snapshotDirectories = new Set(retainedPaths.map(file => path.dirname(file)));
  const snapshotFiles = [...snapshotDirectories].flatMap(dir => fs.readdirSync(dir).filter(file => /^layout-.*\.json$/.test(file)));
  const summary = Object.fromEntries([...new Set(runs.map(run => run.kind))].map(kind => {
    const values = runs.filter(run => run.kind === kind).map(run => run.elapsedMs);
    return [kind, { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), maxMs: Math.max(...values) }];
  }));
  const report = { createdAt: new Date().toISOString(), platform: process.platform, node: process.version,
    options, gcAvailable: !!global.gc, summary, checkpoints,
    eventLoop: { p95Ms: delay.percentile(95) / 1e6, maxMs: delay.max / 1e6 },
    retention: { referencedExisting: existingSnapshots.size, actualSnapshotFiles: snapshotFiles.length }, runs,
    scope: "One current device screen, read-only library calls. Excludes MCP/client overhead; process counters exclude HDC child and device CPU. Short run cannot prove absence of leaks." };
  if (options.output) fs.writeFileSync(path.resolve(options.output), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ summary, checkpoints, eventLoop: report.eventLoop, retention: report.retention }, null, 2)}\n`);
} finally { delay.disable(); cleanupUiTemporaryFiles(); }
