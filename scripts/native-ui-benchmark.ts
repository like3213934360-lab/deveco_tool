import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { UiIndex, flattenDump } from "../src/services/device.js";
import { selectorSchema } from "../src/core/contracts.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity();
const baseline = path.resolve(z.string().min(1).parse(process.argv[2]));
const output = path.resolve(z.string().min(1).parse(process.argv[3]));
assert.ok(global.gc, "Run with --expose-gc for comparable heap samples");
assert.ok(!fs.existsSync(output), "Use a new evidence file");
const source = path.join(baseline, "src/device-dump.mjs");
const imported: unknown = await import(pathToFileURL(source).href);
const callable = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === "function",
);
const old = z
  .object({
    flattenDump: callable,
    selectNodes: callable,
    readSelector: callable,
  })
  .parse(imported);
const records: unknown[] = [];
function percentile(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    p50_ms: sorted[Math.floor(sorted.length / 2)],
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max_ms: sorted.at(-1),
  };
}
function measure(count: number, task: () => unknown) {
  const values: number[] = [],
    cpu = process.cpuUsage();
  for (let n = 0; n < count; n++) {
    const started = performance.now();
    task();
    values.push(performance.now() - started);
  }
  return { ...percentile(values), cpu: process.cpuUsage(cpu) };
}
for (const count of [100, 1000, 10000]) {
  const fixture = JSON.stringify({
    attributes: {
      type: "WindowScene",
      id: "window",
      bounds: "[0,0][1080,2400]",
    },
    children: Array.from({ length: count }, (_, i) => ({
      attributes: {
        id: `key-${i}`,
        type: i % 3 === 0 ? "Button" : "Text",
        text: `label-${i}`,
        bounds: "[10,10][50,50]",
        visible: true,
        enabled: i % 2 === 0,
      },
    })),
  });
  const inputs = [
    { key: `key-${count - 1}` },
    { text: `LABEL-${count - 1}`, textMode: "exact" },
    { type: "button" },
    { text: `label-${count - 1}`, textMode: "contains" },
  ];
  const expected = [1, 1, Math.ceil(count / 3), 1];
  for (const version of ["baseline", "native"] as const) {
    global.gc?.();
    const memoryBefore = process.memoryUsage();
    const raw: unknown = JSON.parse(fixture);
    const flatten = (value: unknown) =>
      version === "native"
        ? new UiIndex(flattenDump(value))
        : old.flattenDump(value);
    let tree: unknown = flatten(raw);
    const selectors = inputs.map((input) => old.readSelector(input));
    const nativeSelectors = inputs.map((input) => selectorSchema.parse(input));
    const query = (index: number): unknown => {
      if (tree instanceof UiIndex) return tree.select(nativeSelectors[index]!);
      return old.selectNodes(tree, selectors[index]);
    };
    for (let index = 0; index < inputs.length; index++) {
      const result = query(index);
      assert.equal(
        Array.isArray(result)
          ? result.length
          : z.object({ matchCount: z.number() }).parse(result).matchCount,
        expected[index],
        `${version} ${count} selector ${index}`,
      );
      for (let warm = 0; warm < 20; warm++) query(index);
    }
    global.gc?.();
    const memoryWarm = process.memoryUsage();
    const queries = inputs.map((input, i) => ({
      input,
      result_count: expected[i],
      ...measure(1000, () => query(i)),
    }));
    const parse = measure(30, () => {
      JSON.parse(fixture);
    });
    const flattenAndIndex = measure(30, () => {
      flatten(raw);
    });
    global.gc?.();
    records.push({
      version,
      nodes: count + 1,
      input_bytes: Buffer.byteLength(fixture),
      parse,
      flatten_and_index: flattenAndIndex,
      queries,
      memory_before: memoryBefore,
      memory_warm: memoryWarm,
      memory_after: process.memoryUsage(),
    });
    tree = undefined;
  }
}
atomicWrite(
  output,
  JSON.stringify(
    {
      tested,
      baseline_file_sha256: fileDigest(source),
      scope:
        "Synthetic single-window UI trees; JSON parse, flatten/index and cached selector queries. Identical match counts checked. Native lazy query-index construction occurs during warmup. Excludes HDC, signatures, screenshots, validation, MCP serialization and device latency. Query result representations differ, so this is an algorithm comparison, not the direct-capability P95 release gate. RSS includes the benchmark driver and both loaded implementations.",
      records,
    },
    null,
    2,
  ),
  false,
);
process.stdout.write(`UI benchmark completed: ${output}\n`);
