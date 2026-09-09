import fs from "node:fs";
import path from "node:path";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import Database from "better-sqlite3";
import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";

type InventoryReader = (file: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding) => string;
export function readProcessInventory(platform: NodeJS.Platform = process.platform, execute: InventoryReader = execFileSync) {
  const attempts: { elapsed_ms: number; code: string; status: number | null; signal: string | null }[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = performance.now();
    try {
      if (platform === "win32") {
        const raw = execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CommandLine -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,CommandLine); ConvertTo-Json -InputObject $rows -Compress"], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
        return z.array(z.object({ ProcessId: z.number().int().nonnegative(), ParentProcessId: z.number().int().nonnegative(), CommandLine: z.string().nullable() })).parse(JSON.parse(raw)).map((row) => ({ pid: row.ProcessId, parent: row.ParentProcessId, command: row.CommandLine ?? "" }));
      }
      const raw = execute("ps", ["-ww", "-axo", "pid=,ppid=,command="], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
      return raw.trim().split("\n").map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        invariant(match, "UPGRADE_PROCESS_SCAN_FAILED", "Unsupported process inventory format");
        return { pid: Number(match[1]), parent: Number(match[2]), command: match[3]! };
      });
    } catch (error) {
      // Only a timed-out read is retried. Keep diagnostics free of process
      // command lines, stdout and stderr: they may contain credentials.
      const failure = z.object({ code: z.string().optional(), status: z.number().nullable().optional(), signal: z.string().nullable().optional() }).safeParse(error);
      const code = failure.success ? failure.data.code ?? "INVENTORY_INVALID" : "INVENTORY_INVALID";
      attempts.push({ elapsed_ms: performance.now() - started, code, status: failure.success ? failure.data.status ?? null : null, signal: failure.success ? failure.data.signal ?? null : null });
      if (code === "ETIMEDOUT" && attempt < 3) continue;
      throw new ToolError("UPGRADE_PROCESS_SCAN_FAILED", "Cannot verify host process quiescence; no configuration was changed", { platform, attempts });
    }
  }
  throw new ToolError("UPGRADE_PROCESS_SCAN_FAILED", "Process inventory attempt limit reached");
}

/** Read only. Never terminate an unknown host or SDK session during a switch. */
export function assertQuiescent(installations: readonly string[], stateDirectories: readonly string[]) {
  const rows = readProcessInventory();
  // The maintenance command and its shell ancestors are not the MCP being switched.
  const ancestors = new Set([process.pid]);
  let parent = process.ppid;
  while (parent > 0 && !ancestors.has(parent)) { ancestors.add(parent); parent = rows.find((row) => row.pid === parent)?.parent ?? 0; }
  const roots = [...installations, ...stateDirectories].map((root) => path.resolve(root).replaceAll("\\", "/").toLowerCase() + "/");
  const active = rows.filter((row) => !ancestors.has(row.pid) && roots.some((root) => row.command.replaceAll("\\", "/").toLowerCase().includes(root)));
  if (active.length) throw new ToolError("UPGRADE_SESSIONS_ACTIVE", "An installation or state directory is still referenced by a live process", { pids: active.map((row) => row.pid) });
  for (const directory of stateDirectories) {
    const file = path.join(directory, "state.sqlite");
    if (!fs.existsSync(file)) continue;
    invariant(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile(), "UPGRADE_STATE_INVALID", "State database must be a regular file");
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
      invariant(tables.has("managed_processes") && tables.has("external_sessions") && tables.has("runs"), "UPGRADE_STATE_UNSUPPORTED", "Cannot prove quiescence from an unknown state schema; resolve legacy sessions before switching");
      invariant(!db.prepare("SELECT id FROM managed_processes WHERE status<>'exited' LIMIT 1").get() && !db.prepare("SELECT id FROM external_sessions WHERE status<>'closed' LIMIT 1").get() && !db.prepare("SELECT id FROM runs WHERE status NOT IN ('succeeded','failed','cancelled') LIMIT 1").get(), "UPGRADE_SESSIONS_ACTIVE", "Durable state still records active or unresolved tasks/sessions");
    } finally { db.close(); }
  }
  return { process_scan: "quiescent", checked_state_directories: stateDirectories.length, scope: "No live process references to selected installations/state and no unresolved supported durable sessions. Legacy detached SDK effects without durable identity cannot be reconstructed." };
}
