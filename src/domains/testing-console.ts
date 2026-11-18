import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { artifactPath, saveArtifact } from "../core/artifacts.js";
import { invariant, ToolError } from "../core/errors.js";
import { fileSnapshot } from "../core/files.js";
import { run, type RunOptions } from "../core/proc.js";
import { testingRuntime } from "./testing-runtime.js";

const services = ["场景化性能测试", "性能基础质量测试", "稳定性基础质量测试", "内存泄漏测试", "应用上架预检（本地）"] as const;
const receipt = z.object({ taskId: z.string().uuid(), state: z.string().nullable(), taskPath: z.string().optional() });
const terminal = new Set(["finish", "failed", "stop", "timeout"]);

async function serviceCommand(runtime: NonNullable<ReturnType<typeof testingRuntime>>, operation: "list" | "install" | "update", service: string | undefined, signal?: AbortSignal) {
  const args: string[] = [operation];
  if (service !== undefined) args.push("--service", service);
  const bin = path.dirname(runtime.java), cwd = path.dirname(runtime.script);
  const env = { ...process.env, JAVA_HOME: path.dirname(bin), PATH: bin + path.delimiter + (process.env.PATH ?? "") };
  // The batch filename and switches are constants. Only a validated catalog key reaches cmd.
  const command = process.platform === "win32"
    ? { file: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), args: ["/d", "/v:off", "/c", ".\\DevEcoTestingCli.bat", ...args] }
    : { file: runtime.script, args };
  let vendorError: string | undefined;
  const result = await run({ ...command, cwd, env }, { signal, timeoutMs: operation === "list" ? 30000 : 600000, keepBytes: 131072, allowFailure: true,
    onLine(line) {
      const error = /\[ERRORCODE\]\s*(DT\.\d+)|"error_code"\s*:\s*"(DT\.\d+)"/.exec(line);
      if (error) vendorError = error[1] ?? error[2];
      else if (!vendorError && /\[ERROR\]/.test(line)) vendorError = "ERROR";
    } });
  invariant(!vendorError && result.code === 0, vendorError === "DT.100901" ? "AUTH_REQUIRED" : "TEST_EXECUTION_FAILED",
    "Testing service command failed", { operation, service, vendor_code: vendorError, exit: result.code });
  invariant(operation !== "list" || !result.truncated, "EVIDENCE_MISSING", "Testing service catalog exceeds the output limit");
  return result.stdout;
}

async function serviceCatalog(runtime: NonNullable<ReturnType<typeof testingRuntime>>, signal?: AbortSignal) {
  const text = await serviceCommand(runtime, "list", undefined, signal);
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => /^\s*Service\s*\|\s*ServiceKey\s*\|\s*Version\s*\|\s*Latest\s*\|\s*Status\s*\|/i.test(line));
  invariant(header >= 0, "EVIDENCE_MISSING", "Testing did not return the service catalog header");
  const rows = lines.slice(header + 1).filter((line) => line.includes("|")).map((line) => {
    const [name, key, version, latest, status] = line.split("|").map((part) => part.trim());
    invariant(name && key && version && latest && status, "EVIDENCE_MISSING", "Incomplete Testing service catalog row");
    return { name, key, version: version === "-" ? null : version, latest: latest === "-" ? null : latest, status };
  });
  invariant(new Set(rows.map((row) => row.key)).size === rows.length, "EVIDENCE_MISSING", "Duplicate Testing service catalog key");
  return rows;
}

export async function maintainTestingService(operation: "install" | "update", key: string, signal: AbortSignal) {
  invariant(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key), "INVALID_INPUT", "Select a Testing service key");
  const runtime = testingRuntime(undefined, true);
  invariant(runtime && runtime.commands?.includes("list") && runtime.commands.includes(operation), "CAPABILITY_UNAVAILABLE",
    "The selected Testing CLI must declare list and the requested service operation", { operation });
  const before = (await serviceCatalog(runtime, signal)).find((row) => row.key === key);
  invariant(before, "NOT_FOUND", "Testing service key is absent from the vendor catalog", { key });
  invariant(before.version ? /^(Installed|Outdated)$/i.test(before.status) : /^not installed$/i.test(before.status),
    "EVIDENCE_MISSING", "Testing reported an unknown or inconsistent service state", { key, before });
  if (before.version && (operation === "install" || before.version === before.latest && /^installed$/i.test(before.status)))
    return { operation, service: key, changed: false, before, after: before };
  invariant(operation === "install" || before.version, "INVALID_INPUT", "Install the service before updating it", { key });
  invariant(operation === "install" || before.latest, "EVIDENCE_MISSING", "Testing did not provide the latest service version", { key });
  await serviceCommand(runtime, operation, key, signal);
  const after = (await serviceCatalog(runtime, signal)).find((row) => row.key === key);
  invariant(after?.version && /^(Installed|Outdated)$/i.test(after.status) &&
    (operation === "install" || after.version === after.latest && /^installed$/i.test(after.status)),
    "EFFECT_UNCERTAIN", "The vendor catalog did not confirm the requested service state", { key, before, after });
  return { operation, service: key, changed: before.version !== after.version, before, after };
}

export async function testingServices(signal?: AbortSignal) {
  const runtime = testingRuntime();
  const root = path.join(os.homedir(), "Library/Application Support/DevEco Testing/common/services");
  const installed: { id: string; name: string; version: string }[] = [];
  if (runtime && process.platform === "darwin" && fs.existsSync(root)) {
    for (const product of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const base = path.join(root, product.name);
      for (const entry of fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
        const config = fileSnapshot(path.join(base, entry.name, "config.json"), 1024 * 1024);
        if (!config) continue;
        const data = JSON.parse(config.bytes.toString("utf8"));
        if (data.type !== "Service") continue;
        invariant(data.id === entry.name && typeof data.name === "string" && typeof data.version === "string",
          "EVIDENCE_MISSING", "Invalid installed Testing service manifest", { service: entry.name });
        installed.push({ id: entry.name, name: data.name, version: data.version });
      }
    }
  }
  const cli = testingRuntime(undefined, true);
  return { documented_console_services: services, installed_services: runtime && process.platform === "darwin" ? installed : null, advertised_commands: cli?.commands ?? runtime?.commands ?? null,
    ...(cli?.commands?.includes("list") && { service_catalog: await serviceCatalog(cli, signal) }),
    launcher: runtime?.script ?? null, note: "Console downloads a missing service at start. update_service updates the selected service on start." };
}

export function testingPlan(file: string, target: string) {
  invariant(path.isAbsolute(file), "INVALID_INPUT", "Testing plan must be an absolute JSON path");
  const snapshot = fileSnapshot(file, 256 * 1024);
  invariant(snapshot, "NOT_FOUND", "Testing plan does not exist");
  let raw: unknown;
  try { raw = JSON.parse(snapshot.bytes.toString("utf8")); } catch { throw new ToolError("INVALID_INPUT", "Invalid UTF-8 JSON Testing plan"); }
  const { taskParams } = z.object({ taskParams: z.object({
    sn: z.tuple([z.literal(target)]), solutionName: z.enum(services), taskName: z.string().trim().min(1).max(128)
  }).passthrough() }).strict().parse(raw);
  return taskParams;
}

function launcher() {
  const runtime = testingRuntime();
  invariant(runtime && path.basename(runtime.script) === "DevEcoTestingConsole.sh" && process.platform !== "win32", "CAPABILITY_UNAVAILABLE",
    "These task operations require the supported DevEcoTestingConsole.sh launcher");
  return { file: runtime.script, cwd: path.dirname(runtime.script) };
}

async function invoke(args: string[], options: RunOptions) {
  const result = await run({ ...launcher(), args }, { allowFailure: true, keepBytes: 32768, ...options });
  const text = result.stdout + "\n" + result.stderr;
  const error = /"error_code"\s*:\s*"(DT\.\d+)"/.exec(text);
  invariant(!error && result.code === 0, error?.[1] === "DT.100901" ? "AUTH_REQUIRED" : "TEST_EXECUTION_FAILED",
    "DevEco Testing rejected the command", { vendor_code: error?.[1], exit: result.code, message: /"error_msg"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? text.trim().slice(-600) });
  return text;
}

async function query(id: string, signal?: AbortSignal) {
  const text = await invoke(["-taskIds", id], { signal, timeoutMs: 12000 });
  const match = /task state and path:\s*(\[[^\r\n]+\])/.exec(text);
  invariant(match, "EVIDENCE_MISSING", "Testing did not return a status receipt", { task_id: id });
  let rows;
  try { rows = z.array(receipt).parse(JSON.parse(match[1]!)); }
  catch { throw new ToolError("EVIDENCE_MISSING", "Invalid Testing status receipt", { task_id: id }); }
  invariant(rows.length === 1 && rows[0]!.taskId === id, "EVIDENCE_MISSING", "Testing returned another task");
  const row = rows[0]!;
  invariant(row.state, "NOT_FOUND", "DevEco Testing does not know this task", { task_id: id });
  return { task_id: id, state: row.state, task_path: row.taskPath };
}

export async function testingTask(op: "status" | "stop" | "report", id: string, signal?: AbortSignal) {
  z.string().uuid().parse(id);
  let status = await query(id, signal);
  if (op === "status") return status;
  if (op === "stop") {
    if (terminal.has(status.state)) return { ...status, stop_requested: false };
    await invoke(["-stopTask", id], { signal, timeoutMs: 12000 });
    for (let i = 0; i < 12; i++) {
      status = await query(id, signal);
      if (terminal.has(status.state)) break;
      await delay(500, undefined, { signal });
    }
    return { ...status, stop_requested: true };
  }
  const directory = status.task_path?.startsWith("file:///") ? fileURLToPath(status.task_path) : status.task_path;
  invariant(terminal.has(status.state) && directory && path.isAbsolute(directory) && path.basename(directory) === id, "TEST_REPORT_MISSING", "Testing has not reported a terminal task directory", status);
  const exported = path.join(directory, "export");
  const file = fileSnapshot(path.join(exported, "2d_report_data.json"), 16 * 1024 * 1024);
  invariant(file, "TEST_REPORT_MISSING", "No exported Testing JSON report", status);
  let data;
  try { data = JSON.parse(file.bytes.toString("utf8")); } catch { throw new ToolError("TEST_REPORT_INVALID", "Invalid Testing JSON report"); }
  invariant(data?.generalData?.taskInfo?.taskId === id && typeof data.isTaskPass === "boolean", "TEST_REPORT_INVALID", "Report identity or isTaskPass missing", status);
  return { ...status, vendor_passed: data.isTaskPass, verdict: status.state !== "finish" ? "inconclusive" : data.isTaskPass ? "passed" : "failed",
    report: await saveArtifact(file.bytes, "application/json"), html: fs.readdirSync(exported, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html")).map((entry) => path.join(exported, entry.name)) };
}

export async function runTesting(params: Record<string, unknown>, update: boolean, ctx: { signal: AbortSignal; log: (message: string) => void }) {
  launcher();
  ctx.signal.throwIfAborted();
  const { file } = artifactPath("application/json");
  fs.writeFileSync(file, JSON.stringify({ taskParams: params }), { mode: 0o600, flag: "wx" });
  let id: string | undefined;
  try {
    await invoke(["-params", file, "-update", String(update)], { signal: ctx.signal, onLine(line) {
      const match = /\[command task status\] Create task successfully! taskId:\s*([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\s*$/i.exec(line);
      if (!id && match) { id = match[1]; ctx.log("DevEco Testing task_id: " + id); }
    } });
    invariant(id, "EFFECT_UNCERTAIN", "Console exited without a task ID. Inspect the Testing client before retrying.");
    const result = await query(id, ctx.signal);
    invariant(terminal.has(result.state), "EFFECT_UNCERTAIN", "Console exited before terminal task status", result);
    invariant(result.state === "finish", "TEST_EXECUTION_FAILED", "Testing task did not finish normally", result);
    return result;
  } catch (error) {
    if (ctx.signal.aborted) {
      invariant(id, "EFFECT_UNCERTAIN", "No vendor task ID received before interruption. Check the Testing client before retrying.");
      try {
        const stopped = await testingTask("stop", id);
        invariant(terminal.has(stopped.state), "EFFECT_UNCERTAIN", "Stop is still pending");
      } catch { throw new ToolError("EFFECT_UNCERTAIN", "Vendor task termination was not confirmed", { task_id: id }); }
    }
    throw error;
  } finally { fs.rmSync(file, { force: true }); }
}
