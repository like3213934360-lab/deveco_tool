import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { digest } from "../src/core/files.js";

const version = z.enum(["native", "baseline"]).parse(process.argv[2]), baseline = z.string().parse(process.argv[3]), count = z.coerce.number().int().positive().parse(process.argv[4]);
assert.ok(global.gc, "Use --expose-gc for UI measurements");
const fixture = JSON.stringify({ attributes: { type: "WindowScene", id: "window", bounds: "[0,0][1080,2400]" }, children: Array.from({ length: count }, (_, index) => ({ attributes: { id: `key-${index}`, type: index % 3 === 0 ? "Button" : "Text", text: `label-${index}`, bounds: "[10,10][50,50]", visible: true, enabled: index % 2 === 0 } })) });
const inputs = [{ key: `key-${count - 1}` }, { text: `LABEL-${count - 1}`, textMode: "exact" }, { type: "button" }, { text: `label-${count - 1}`, textMode: "contains" }], expected = [1, 1, Math.ceil(count / 3), 1];
let parse: () => unknown, query: (tree: unknown, index: number) => unknown;
if (version === "native") {
  const { UiIndex, flattenDump } = await import("../src/services/device.js"), { selectorSchema } = await import("../src/core/contracts.js"), selectors = inputs.map((item) => selectorSchema.parse(item));
  parse = () => new UiIndex(flattenDump(JSON.parse(fixture)));
  query = (tree, index) => { assert.ok(tree instanceof UiIndex); return tree.select(selectors[index]!); };
} else {
  const callable = z.custom<(...args: unknown[]) => unknown>((value) => typeof value === "function");
  const old = z.object({ flattenDump: callable, selectNodes: callable, readSelector: callable }).parse(await import(pathToFileURL(path.join(baseline, "src/device-dump.mjs")).href));
  const selectors = inputs.map((input) => old.readSelector(input));
  parse = () => old.flattenDump(JSON.parse(fixture)); query = (tree, index) => old.selectNodes(tree, selectors[index]);
}
function check(result: unknown, index: number) { assert.equal(Array.isArray(result) ? result.length : z.object({ matchCount: z.number() }).parse(result).matchCount, expected[index]); }
function measure(rounds: number, operation: (index: number) => void) {
  const ms: number[] = [], cpu_us: number[] = [], rss_bytes: number[] = [];
  for (let index = 0; index < rounds; index++) {
    const cpu = process.cpuUsage(), start = performance.now();
    operation(index);
    ms.push(performance.now() - start);
    const used = process.cpuUsage(cpu); cpu_us.push(used.user + used.system); rss_bytes.push(process.memoryUsage().rss);
  }
  return { ms, cpu_us, rss_bytes };
}
global.gc();
const parseSamples = measure(30, () => { const tree = parse(); check(query(tree, 0), 0); });
const tree = parse();
for (let index = 0; index < 4; index++) for (let warm = 0; warm < 20; warm++) check(query(tree, index), index);
global.gc();
const queries = inputs.map((input, index) => ({ input, result_count: expected[index], ...measure(1000, () => check(query(tree, index), index)) }));
process.stdout.write(JSON.stringify({ version, nodes: count + 1, input_bytes: Buffer.byteLength(fixture), input_sha256: digest({ fixture, inputs }), parse_ms: parseSamples.ms, parse_cpu_us: parseSamples.cpu_us, parse_rss_bytes: parseSamples.rss_bytes, queries }) + "\n");
