// Measure handshake latency, tools/list, idle CPU and RSS of the MCP server.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./mcp-client.mjs";
import { promptMetrics } from "./prompt-audit.mjs";

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
const init = await client.initialize();
const t = performance.now();
const list = await client.request("tools/list");
const listMs = performance.now() - t;
const prompts = promptMetrics(init.result.instructions, list.result.tools);
// Startup schedules one-shot job recovery (2 s) and retention cleanup (5 s).
// Measure idle after those and their background compilation/GC settle; counting them in the idle
// window measures startup CPU instead. Keep the 10 s observation window.
await new Promise((r) => setTimeout(r, 15000));
const ps = (fields) => execFileSync("ps", ["-o", fields, "-p", String(client.child.pid)]).toString().trim().split("\n").pop().trim();
const cpuBefore = ps("cputime=");
await new Promise((r) => setTimeout(r, 10000));
const cpuAfter = ps("cputime=");
const rssKb = Number(ps("rss="));
await client.close();
fs.rmSync(state, { recursive: true, force: true });
const sorted = samples.sort((a, b) => a - b);
const report = {
  handshake_ms: { median: Math.round(sorted[2]), min: Math.round(sorted[0]), max: Math.round(sorted[4]) },
  ...prompts, tools_list_ms: Math.round(listMs),
  idle_cpu_10s: { before: cpuBefore, after: cpuAfter, changed: cpuBefore !== cpuAfter },
  idle_rss_mb: Math.round(rssKb / 1024),
};
console.log(JSON.stringify(report, null, 2));
// RSS: 70 MB baseline budget + user-authorized 20% growth (2026-10-10) = 84 MB.
// Other budgets stay unchanged: handshake < 150 ms, tools/list <= 36 KB. cputime has 10 ms
// resolution, so allow one tick of drift over 10 s idle.
// Prompt gates additionally bound shared instructions and their per-tool expansion in hosts.
const tick = (s) => { const [m, rest] = s.split(":"); return Number(m) * 60 + Number(rest); };
const budget = [
  [report.handshake_ms.median < 150, `handshake ${report.handshake_ms.median} ms >= 150`],
  [report.idle_rss_mb <= 84, `idle RSS ${report.idle_rss_mb} MB > 84`],
  [prompts.tools_list_bytes <= 36 * 1024, `tools/list ${prompts.tools_list_bytes} bytes > 36 KB`],
  [prompts.instructions_bytes <= 640, `instructions ${prompts.instructions_bytes} bytes > 640`],
  [prompts.repeated_instructions_bytes <= 44 * 1024, `repeated instructions ${prompts.repeated_instructions_bytes} bytes > 44 KB`],
  [tick(cpuAfter) - tick(cpuBefore) <= 0.011, `idle CPU ${cpuBefore} -> ${cpuAfter}`],
].filter(([ok]) => !ok).map(([, msg]) => msg);
if (budget.length) { console.error(`budget exceeded: ${budget.join("; ")}`); process.exitCode = 1; }
