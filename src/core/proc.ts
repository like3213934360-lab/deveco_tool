import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { ToolError } from "./errors.js";

export interface Command {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}
export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Tail retained in memory per stream; full output goes to logFile when provided. */
  keepBytes?: number;
  logFile?: string;
  input?: string | Buffer;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  allowFailure?: boolean;
}
export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsedMs: number;
}

const live = new Set<ChildProcess>();

/** Kill the whole process tree: POSIX via process group, Windows via taskkill /T. */
export function killTree(child: ChildProcess, sig: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, sig);
  } catch {
    try { child.kill(sig); } catch { /* already gone */ }
  }
}

export function spawnManaged(cmd: Command, stdio: "pipe" | "ignore" = "pipe"): ChildProcess {
  const child = spawn(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    env: cmd.env as NodeJS.ProcessEnv | undefined,
    stdio: [stdio === "pipe" ? "pipe" : "ignore", stdio, stdio],
    detached: process.platform !== "win32", // own process group so the whole tree can be killed
    windowsHide: true,
  });
  track(child);
  return child;
}

// A short-lived parent observes startup, then exits to reparent the program. A detached
// process alone is still a descendant: hosts such as OpenCode kill descendants on exit.
const independentLauncher = `
const {spawn} = require('node:child_process');
const cmd = JSON.parse(process.argv[1]);
const child = spawn(cmd.file, cmd.args, {cwd:cmd.cwd, stdio:'inherit', detached:true, windowsHide:true});
child.once('error', error => { process.send({error:error.message}); process.disconnect(); });
child.once('spawn', () => process.send({pid:child.pid}));
child.once('exit', (code, signal) => { if(process.connected) process.send({code,signal}); });
process.once('disconnect', () => child.unref());
`;

export interface IndependentProcess {
  pid: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  detach(): Promise<void>;
}

/** Observe startup until detach() reparents the program; output never uses the server's pipes. */
export async function spawnIndependent(cmd: Command, logFile?: string): Promise<IndependentProcess> {
  const fd = logFile ? fs.openSync(logFile, "w") : "ignore";
  const child = spawn(process.execPath, ["-e", independentLauncher, JSON.stringify({ file: cmd.file, args: cmd.args, cwd: cmd.cwd })], {
    cwd: cmd.cwd, env: cmd.env as NodeJS.ProcessEnv | undefined,
    stdio: ["ignore", fd, fd, "ipc"], detached: true, windowsHide: true,
  });
  if (typeof fd === "number") fs.closeSync(fd);
  const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
  const state: IndependentProcess = { pid: 0, async detach() {
    if (child.connected) child.disconnect();
    await exited;
  } };
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => { if (!state.pid) reject(new Error("Independent launcher exited before spawn acknowledgement")); });
      child.on("message", (message: { pid?: number; error?: string; code?: number | null; signal?: NodeJS.Signals | null }) => {
        if (message.error) reject(new Error(message.error));
        else if (message.pid) { state.pid = message.pid; resolve(); }
        else { state.exitCode = message.code; state.signalCode = message.signal; }
      });
    });
    return state;
  } catch (error) {
    await state.detach();
    throw new ToolError("PROCESS_FAILED", `Cannot start ${cmd.file}: ${(error as Error).message}`);
  }
}

function track(child: ChildProcess) {
  live.add(child);
  child.once("exit", () => live.delete(child));
  child.once("error", () => live.delete(child));
  return child;
}

export async function run(cmd: Command, options: RunOptions = {}): Promise<RunResult> {
  options.signal?.throwIfAborted();
  const keep = options.keepBytes ?? 256 * 1024;
  const started = performance.now();
  const child = spawnManaged(cmd);
  const log = options.logFile ? fs.createWriteStream(options.logFile, { flags: "a" }) : undefined;
  const out = { stdout: "", stderr: "" };
  let truncated = false;
  const pending = { stdout: "", stderr: "" };
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const collect = (name: "stdout" | "stderr") => (chunk: Buffer) => {
    log?.write(chunk);
    const text = decoders[name].write(chunk);
    out[name] += text;
    if (out[name].length > keep) {
      out[name] = out[name].slice(out[name].length - keep);
      truncated = true;
    }
    if (options.onLine) {
      pending[name] += text;
      let index: number;
      while ((index = pending[name].indexOf("\n")) >= 0) {
        options.onLine(pending[name].slice(0, index).replace(/\r$/, ""), name);
        pending[name] = pending[name].slice(index + 1);
      }
      if (pending[name].length > 65536) pending[name] = pending[name].slice(-8192);
    }
  };
  child.stdout?.on("data", collect("stdout"));
  child.stderr?.on("data", collect("stderr"));
  if (options.input !== undefined) child.stdin?.end(options.input);
  else child.stdin?.end();

  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => { timedOut = true; killTree(child); setTimeout(() => killTree(child, "SIGKILL"), 3000).unref(); }, options.timeoutMs)
    : undefined;
  const onAbort = () => { killTree(child); setTimeout(() => killTree(child, "SIGKILL"), 3000).unref(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [code, sig] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (c, s) => resolve([c, s]));
    }).catch((error: NodeJS.ErrnoException) => {
      throw new ToolError("PROCESS_FAILED", `Cannot start ${cmd.file}: ${error.message}`, { code: error.code });
    });
    for (const name of ["stdout", "stderr"] as const) {
      const rest = decoders[name].end();
      out[name] += rest;
      if (options.onLine && (pending[name] + rest)) options.onLine(pending[name] + rest, name);
    }
    const result: RunResult = { code, signal: sig, ...out, truncated, elapsedMs: Math.round(performance.now() - started) };
    if (options.signal?.aborted) throw new ToolError("CANCELLED", "Cancelled", undefined, undefined, true);
    if (timedOut) throw new ToolError("TIMEOUT", `${cmd.file} timed out after ${options.timeoutMs} ms`, { tail: tail(result) }, undefined, true);
    if (code !== 0 && !options.allowFailure)
      throw new ToolError("PROCESS_FAILED", `${shortName(cmd)} exited with ${code ?? sig}`, { code, tail: tail(result) });
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    await new Promise<void>((resolve) => (log ? log.end(resolve) : resolve()));
  }
}

function shortName(cmd: Command) {
  const script = cmd.args[0]?.endsWith(".js") ? cmd.args[0] : cmd.file;
  return script.split(/[\\/]/).pop();
}
function tail(result: Pick<RunResult, "stdout" | "stderr">) {
  return (result.stderr.trim() || result.stdout.trim()).slice(-2000);
}

/** Terminate every child this process started. Called on shutdown. */
export function killAll() {
  for (const child of live) killTree(child, "SIGKILL");
}
