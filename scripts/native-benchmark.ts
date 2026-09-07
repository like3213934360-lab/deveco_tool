import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { atomicWrite } from "../src/core/files.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity();
const baseline = path.resolve(z.string().min(1).parse(process.argv[2]));
const output = path.resolve(z.string().min(1).parse(process.argv[3]));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-benchmark-"));
const measurements: {
  version: string;
  cold: number[];
  hot: number[];
  node: string;
  cpu: NodeJS.CpuUsage;
  rss: number;
}[] = [];
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
function save() {
  atomicWrite(
    output,
    JSON.stringify(
      {
        tested,
        platform: process.platform,
        arch: process.arch,
        scope:
          "MCP initialize + tools/list cold, tools/list hot. Driver CPU/RSS are not server process measurements; no SDK execution or UI latency claims.",
        measurements,
        summaries: measurements.map((m) => ({
          version: m.version,
          cold_ms: summarize(m.cold),
          hot_ms: summarize(m.hot),
        })),
      },
      null,
      2,
    ),
  );
}
try {
  for (const [version, entry] of [
    ["baseline", path.join(baseline, "src/server.mjs")],
    ["native", fileURLToPath(new URL("../src/cli.js", import.meta.url))],
  ] as const) {
    const cold: number[] = [],
      hot: number[] = [],
      cpu = process.cpuUsage();
    const measurement = {
      version,
      cold,
      hot,
      node: process.version,
      cpu: process.cpuUsage(cpu),
      rss: process.memoryUsage().rss,
    };
    measurements.push(measurement);
    for (let sample = 0; sample < 30; sample++) {
      const client = new Client({ name: "native-benchmark", version: "1" }),
        transport = new StdioClientTransport({
          command: process.execPath,
          args: [entry],
          stderr: "ignore",
          env: {
            ...environment,
            DEVECO_STATE_DIR: path.join(directory, version, String(sample)),
          },
        });
      try {
        const started = performance.now();
        await client.connect(transport);
        await client.listTools();
        cold.push(performance.now() - started);
        if (sample === 29)
          for (let request = 0; request < 1000; request++) {
            const started = performance.now();
            await client.listTools();
            hot.push(performance.now() - started);
          }
      } finally {
        await transport.close();
      }
      measurement.cpu = process.cpuUsage(cpu);
      measurement.rss = process.memoryUsage().rss;
      save();
      if ((sample + 1) % 10 === 0)
        process.stdout.write(`${version}: ${sample + 1}/30 cold starts\n`);
    }
    save();
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
