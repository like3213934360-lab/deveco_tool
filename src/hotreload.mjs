import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  childEnvironment,
  combineOutput,
  commandText,
  devecoCliFailureMessage,
  projectRoot,
  resolveDevecoCli,
  resolveDevice,
  resolveRunnableModule,
  runDevecoCli,
} from "./deveco-cli.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

const READY = /Hot-reload watch session active \(socket persistent\)/;
const MAX_LOG_CHARS = 200000;
const MAX_START_WAIT_MS = 20000;
let session = null;

function appendLog(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length > MAX_LOG_CHARS ? combined.slice(-MAX_LOG_CHARS) : combined;
}

function isRunning(current) {
  return Boolean(current && !current.closed && (!current.child
    || (current.child.exitCode === null && current.child.signalCode === null)));
}

function snapshot(current = session) {
  if (!current) return { active: false };
  const state = {
    active: current.ready && !current.startError && !current.stopping && isRunning(current),
    starting: !current.ready && !current.startError && !current.stopping && isRunning(current),
    pid: current.child?.pid ?? null,
    projectPath: current.project,
    device: current.device ?? null,
    module: current.module || null,
    product: current.product || "default",
    startedAt: current.startedAt,
    command: current.command ?? null,
    stdout: current.stdout,
    stderr: current.stderr,
  };
  if (current.startError) state.error = current.startError;
  if (state.starting) {
    state.nextAction = { tool: "hot_reload", arguments: { action: "status" } };
  }
  return state;
}

function startLifecycle(current, timeoutMs) {
  let onClosed;
  current.exited = new Promise((resolve) => { onClosed = resolve; });
  current.startup = new Promise((resolve) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        current.startError = {
          code: error.code ?? "DEVECO_HOT_RELOAD_START_FAILED",
          message: error.message,
        };
      }
      resolve();
    };
    const inspect = () => {
      if (settled) return;
      if (READY.test(`${current.stdout}\n${current.stderr}`)) {
        current.ready = true;
        finish();
      }
    };
    const timer = setTimeout(() => {
      terminateProcessTree(current.child);
      const error = new Error(`Hot-reload session did not become ready within ${timeoutMs}ms`);
      error.code = "DEVECO_HOT_RELOAD_START_TIMEOUT";
      finish(error);
    }, timeoutMs);
    current.child.stdout.on("data", (chunk) => {
      current.stdout = appendLog(current.stdout, chunk);
      inspect();
    });
    current.child.stderr.on("data", (chunk) => {
      current.stderr = appendLog(current.stderr, chunk);
      inspect();
    });
    current.child.once("error", (cause) => finish(cause));
    current.child.once("close", (exitCode, signal) => {
      current.closed = true;
      const error = new Error(`Hot-reload process exited ${current.ready ? "after" : "before"} becoming ready (code=${exitCode}, signal=${signal ?? "none"})\n${current.stdout}${current.stderr}`);
      error.code = current.ready ? "DEVECO_HOT_RELOAD_EXITED" : "DEVECO_HOT_RELOAD_START_FAILED";
      if (!current.ready) finish(error);
      else if (!current.stopping && !current.startError) current.startError = { code: error.code, message: error.message };
      onClosed();
    });
  });
}

function validateFiles(project, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const error = new Error("files must be a non-empty array of project files");
    error.code = "DEVECO_HOT_RELOAD_FILES_REQUIRED";
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    const absolute = path.resolve(project, String(entry));
    const relative = path.relative(project, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      const error = new Error(`Changed file must be inside the selected project: ${entry}`);
      error.code = "DEVECO_HOT_RELOAD_FILE_OUTSIDE_PROJECT";
      throw error;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      const error = new Error(`Changed file does not exist: ${absolute}`);
      error.code = "DEVECO_HOT_RELOAD_FILE_NOT_FOUND";
      throw error;
    }
    const portable = relative.split(path.sep).join("/");
    if (!result.includes(portable)) result.push(portable);
  }
  return result;
}

export async function hotReloadStart(input = {}) {
  if (isRunning(session) || session?.stopping) {
    const error = new Error(`A hot-reload session is already running for ${session.project}`);
    error.code = "DEVECO_HOT_RELOAD_ALREADY_RUNNING";
    throw error;
  }
  const project = projectRoot(input.project_path);
  const product = typeof input.product === "string" ? input.product.trim() : "";
  // Reserve the session before device/module resolution can yield to another call.
  const current = {
    child: null, project, product, buildMode: input.build_mode, ability: input.ability,
    ready: false, closed: false, stopping: false, stdout: "", stderr: "",
    startedAt: new Date().toISOString(), startError: null,
  };
  session = current;
  try {
    const device = await resolveDevice(input.hvd);
    const module = await resolveRunnableModule({ project, module: input.module });
    if (session !== current) {
      const error = new Error("Hot-reload startup was stopped before the process was launched");
      error.code = "DEVECO_HOT_RELOAD_START_CANCELLED";
      throw error;
    }
    const entry = resolveDevecoCli();
    const args = ["run", "--device", device, "--module", module];
    if (product) args.push("--product", product);
    if (current.buildMode) args.push("--build-mode", String(current.buildMode));
    if (current.ability) args.push("--ability", String(current.ability));
    args.push("--hotreload");
    Object.assign(current, { device, module, command: commandText(entry, args) });
    current.child = spawn(process.execPath, [entry, ...args], {
      cwd: project, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
  } catch (error) {
    if (session === current) session = null;
    throw error;
  }
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 900000, 1000), 3600000);
  startLifecycle(current, timeoutMs);
  const requestedWait = input.wait_ms === undefined ? MAX_START_WAIT_MS : Number(input.wait_ms);
  const waitMs = Math.min(Math.max(Number.isFinite(requestedWait) ? requestedWait : 0, 0), MAX_START_WAIT_MS);
  if (waitMs > 0) {
    let waitTimer;
    try {
      await Promise.race([
        current.startup,
        new Promise((resolve) => { waitTimer = setTimeout(resolve, waitMs); }),
      ]);
    } finally {
      clearTimeout(waitTimer);
    }
  }
  if (current.startError) {
    const error = new Error(current.startError.message);
    error.code = current.startError.code;
    throw error;
  }
  return snapshot(current);
}

export async function hotReloadApply(input = {}) {
  if (!session?.ready || session.startError || session.stopping || !isRunning(session)) {
    const error = new Error("No active hot-reload session. Start one first.");
    error.code = "DEVECO_HOT_RELOAD_NOT_RUNNING";
    throw error;
  }
  const current = session;
  const requestedProject = input.project_path ? projectRoot(input.project_path) : session.project;
  if (requestedProject !== session.project) {
    const error = new Error(`The active hot-reload session belongs to ${session.project}`);
    error.code = "DEVECO_HOT_RELOAD_PROJECT_MISMATCH";
    throw error;
  }
  const files = validateFiles(session.project, input.files);
  const hvigor = path.join(session.project, ".hvigor");
  fs.mkdirSync(hvigor, { recursive: true });
  const name = `deveco-tool-hotreload-${process.pid}-${crypto.randomBytes(6).toString("hex")}.txt`;
  const manifest = path.join(hvigor, name);
  fs.writeFileSync(manifest, `${files.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    const args = ["run", "--device", current.device, "--module", current.module];
    if (current.product) args.push("--product", current.product);
    if (current.buildMode) args.push("--build-mode", String(current.buildMode));
    if (current.ability) args.push("--ability", String(current.ability));
    args.push("--hotreload-apply", name);
    const result = await runDevecoCli(args, {
      cwd: current.project,
      timeoutMs: input.timeoutMs,
    });
    const output = combineOutput(result);
    const failure = devecoCliFailureMessage(result);
    if (failure) {
      const signingRequired = /\[HotReload\]\s*Signing prerequisites not met\./i.test(output);
      const guidance = signingRequired
        ? "\n\nThe patch compiled, but DevEco CLI could not sign the HQF. Log in with deveco_cli_auth, then run app_signature for this project before retrying."
        : "";
      const error = new Error(`> ${result.command}\n\n${output}${guidance}`);
      error.code = signingRequired ? "DEVECO_HOT_RELOAD_SIGNING_REQUIRED" : "DEVECO_HOT_RELOAD_APPLY_FAILED";
      throw error;
    }
    return { ...snapshot(current), appliedFiles: files, applyCommand: result.command, output };
  } finally {
    fs.rmSync(manifest, { force: true });
  }
}

export function hotReloadStatus() {
  return snapshot();
}

export async function hotReloadStop(input = {}) {
  const current = session;
  if (!current) return { active: false, stopped: false };
  if (current.stopPromise) return current.stopPromise;
  current.stopping = true;
  if (!current.child) {
    current.closed = true;
    session = null;
    return { active: false, stopped: true };
  }
  current.stopPromise = stopSession(current, input);
  return current.stopPromise;
}

async function stopSession(current, input) {
  let result;
  try {
    result = await runDevecoCli(["run", "--hotreload", "stop"], {
      cwd: current.project,
      timeoutMs: input.timeoutMs ?? 30000,
    });
  } finally {
    await terminateSession(current);
    if (session === current) session = null;
  }
  const output = combineOutput(result);
  const failure = devecoCliFailureMessage(result);
  if (failure) {
    const error = new Error(`> ${result.command}\n\n${output}`);
    error.code = "DEVECO_HOT_RELOAD_STOP_FAILED";
    throw error;
  }
  return { active: false, stopped: true, command: result.command, output };
}

export async function hotReload(input = {}) {
  const action = input.action;
  if (action === "start") return hotReloadStart(input);
  if (action === "apply") return hotReloadApply(input);
  if (action === "status") return hotReloadStatus();
  if (action === "stop") return hotReloadStop(input);
  const error = new Error("action must be start, apply, status, or stop");
  error.code = "DEVECO_HOT_RELOAD_ACTION_INVALID";
  throw error;
}

export async function closeHotReload() {
  const current = session;
  session = null;
  if (current) await terminateSession(current);
}

async function terminateSession(current) {
  current.stopping = true;
  if (!current.child) { current.closed = true; return; }
  if (isRunning(current)) terminateProcessTree(current.child);
  await current.exited;
}
