// Measure handshake latency, tools/list, idle CPU and RSS of the MCP server.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./mcp-client.mjs";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-bench-"));
const env = { DEVECO_STATE_DIR: state, ...(process.env.DEVECO_CONFIG ? { DEVECO_CONFIG: process.env.DEVECO_CONFIG } : {}) };
const samples = [];
for (let i = 0; i < 5; i++) {
  const client = connect(env);
  await client.initialize();
  samples.push(performance.now() - client.started);
  await client.close();
}
const client = connect(env);
await client.initialize();
const t = performance.now();
const list = await client.request("tools/list");
const listMs = performance.now() - t;
const listBytes = JSON.stringify(list.result).length;
await new Promise((r) => setTimeout(r, 1500));
const ps = (fields) => execFileSync("ps", ["-o", fields, "-p", String(client.child.pid)]).toString().trim().split("\n").pop().trim();
const cpuBefore = ps("cputime=");
await new Promise((r) => setTimeout(r, 10000));
const cpuAfter = ps("cputime=");
const rssKb = Number(ps("rss="));
await client.close();
fs.rmSync(state, { recursive: true, force: true });
const sorted = samples.sort((a, b) => a - b);
console.log(JSON.stringify({
  handshake_ms: { median: Math.round(sorted[2]), min: Math.round(sorted[0]), max: Math.round(sorted[4]) },
  tools: list.result.tools.length, tools_list_ms: Math.round(listMs), tools_list_bytes: listBytes,
  idle_cpu_10s: { before: cpuBefore, after: cpuAfter, changed: cpuBefore !== cpuAfter },
  idle_rss_mb: Math.round(rssKb / 1024),
}, null, 2));
