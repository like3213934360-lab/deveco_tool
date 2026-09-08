import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ProcessService } from "../../src/core/process.js";

export const metricSchema = z.union([
  z.strictObject({ value: z.number().finite().nonnegative(), source: z.string().min(1) }),
  z.strictObject({ value: z.null(), reason: z.string().min(1) }),
]);
export type Metric = z.infer<typeof metricSchema>;
const unavailable = (reason: string): Metric => ({ value: null, reason });
const measured = (value: number, source: string): Metric => ({ value, source });
const exec = promisify(execFile);
export const processSampleSchema = z.strictObject({
  cpu_us: metricSchema, rss_bytes: metricSchema, written_bytes: metricSchema,
  process_starts: metricSchema,
});
function written(pid: number): Metric {
  if (process.platform !== "linux") return unavailable("Per-process disk write bytes are not available through the portable Node/ps sampler on this OS; fsWrite counts operations, not bytes.");
  try {
    const value = /^write_bytes:\s*(\d+)$/m.exec(fs.readFileSync(`/proc/${pid}/io`, "utf8"));
    return value ? measured(Number(value[1]), "Linux /proc/PID/io write_bytes") : unavailable("Kernel did not expose write_bytes");
  } catch { return unavailable("Process exited or /proc/PID/io is inaccessible"); }
}
function sum(values: Metric[], source: string): Metric {
  if (values.some((item) => item.value === null)) return unavailable("At least one tracked process metric is unavailable; a partial total is not reported as complete.");
  return measured(values.reduce((total, item) => total + (item.value ?? 0), 0), source);
}
function cpuTime(text: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (!match) throw new Error("Unsupported ps CPU time format");
  return ((Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)) * 3600 + Number(match[3]) * 60 + Number(match[4])) * 1000000;
}
/** CPU totals describe the live owned launcher processes at sample time, not
 * lifetime SDK work. Short-lived commands are counted by ProcessService; their
 * exited CPU cannot be reconstructed from ps and is never silently added as zero. */
export async function processMetrics(service: ProcessService, externalPids: number[] = []) {
  const cpu = process.cpuUsage(), pids = [...new Set([...service.metrics.pids, ...externalPids])];
  let sampledPids = pids;
  const mcp = { cpu_us: measured(cpu.user + cpu.system, "process.cpuUsage, cumulative self including benchmark driver"), rss_bytes: measured(process.memoryUsage().rss, "process.memoryUsage RSS"), written_bytes: written(process.pid), process_starts: measured(1, "this measured runtime process") };
  let cpuMetric: Metric, rssMetric: Metric;
  if (!pids.length) {
    cpuMetric = measured(0, "No live owned SDK launcher processes"); rssMetric = measured(0, "No live owned SDK launcher processes");
  } else try {
    let rows: { pid: number; parent: number; cpu: number; rss: number }[];
    if (process.platform === "win32") {
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize) | ConvertTo-Json -Compress"], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      const parsed = z.array(z.object({ ProcessId: z.number(), ParentProcessId: z.number(), KernelModeTime: z.coerce.number(), UserModeTime: z.coerce.number(), WorkingSetSize: z.coerce.number() })).parse(JSON.parse(stdout));
      rows = parsed.map((item) => ({ pid: item.ProcessId, parent: item.ParentProcessId, cpu: (item.KernelModeTime + item.UserModeTime) / 10, rss: item.WorkingSetSize }));
    } else {
      const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,time=,rss="], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
      rows = stdout.trim().split("\n").map((line) => {
        const row = line.trim().split(/\s+/);
        if (row.length !== 4) throw new Error("Unsupported process sample");
        return { pid: Number(row[0]), parent: Number(row[1]), cpu: cpuTime(row[2]!), rss: Number(row[3]) * 1024 };
      });
    }
    if (pids.some((pid) => !rows.some((row) => row.pid === pid))) throw new Error("Tracked process exited during capture");
    const selected = new Set(pids);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) if (selected.has(row.parent) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; }
    }
    sampledPids = [...selected];
    rows = rows.filter((row) => selected.has(row.pid));
    cpuMetric = measured(rows.reduce((sum, row) => sum + row.cpu, 0), "OS cumulative CPU of live owned launchers, known session PIDs and their current descendants");
    rssMetric = measured(rows.reduce((sum, row) => sum + row.rss, 0), "OS RSS sum of live owned process trees; shared pages may be counted more than once");
  } catch { cpuMetric = unavailable("OS process sampler failed or an owned launcher exited during capture"); rssMetric = unavailable("OS process sampler failed or an owned launcher exited during capture"); }
  const sdk = { cpu_us: cpuMetric, rss_bytes: rssMetric, written_bytes: sum(sampledPids.map(written), "Live owned SDK process-tree write_bytes"), process_starts: measured(service.metrics.process_starts, "Successful ProcessService spawn events; SDK-internal descendants excluded") };
  return { mcp, sdk, scope: "SDK CPU/RSS/write samples cover currently live owned process trees and explicitly supplied session PIDs. Exited CPU and reparented unknown descendants are unavailable, not inferred. process_starts counts exact owned launch events, excluding SDK-internal launches." };
}
