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
  runDevecoCli,
} from "./deveco-cli.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

const READY = /Hot-reload watch session active \(socket persistent\)/;
const MAX_LOG_CHARS = 200000;
let session = null;

function appendLog(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length > MAX_LOG_CHARS ? combined.slice(-MAX_LOG_CHARS) : combined;
}

function snapshot() {
  if (!session) return { active: false };
  return {
    active: session.ready && session.child.exitCode === null,
    starting: !session.ready && session.child.exitCode === null,
    pid: session.child.pid,
    projectPath: session.project,
    device: session.device,
    module: session.module || null,
    startedAt: session.startedAt,
    command: session.command,
    stdout: session.stdout,
    stderr: session.stderr,
  };
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
  if (session?.child?.exitCode === null) {
    const error = new Error(`A hot-reload session is already running for ${session.project}`);
    error.code = "DEVECO_HOT_RELOAD_ALREADY_RUNNING";
    throw error;
  }
  session = null;
  const project = projectRoot(input.project_path);
  const device = await resolveDevice(input.hvd);
  const module = typeof input.module === "string" ? input.module.trim() : "";
  const entry = resolveDevecoCli();
  const args = ["run", "--device", device];
  if (module) args.push("--module", module);
  if (input.product) args.push("--product", String(input.product));
  if (input.build_mode) args.push("--build-mode", String(input.build_mode));
  if (input.ability) args.push("--ability", String(input.ability));
  args.push("--hotreload");
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: project,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const current = {
    child, project, device, module, ready: false, stdout: "", stderr: "",
    startedAt: new Date().toISOString(), command: commandText(entry, args),
  };
  session = current;

  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 900000, 1000), 3600000);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (READY.test(`${current.stdout}\n${current.stderr}`)) {
        current.ready = true;
        finish();
      }
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      const error = new Error(`Hot-reload session did not become ready within ${timeoutMs}ms`);
      error.code = "DEVECO_HOT_RELOAD_START_TIMEOUT";
      finish(error);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { current.stdout = appendLog(current.stdout, chunk); inspect(); });
    child.stderr.on("data", (chunk) => { current.stderr = appendLog(current.stderr, chunk); inspect(); });
    child.once("error", (cause) => finish(cause));
    child.once("close", (exitCode, signal) => {
      if (!settled) {
        const error = new Error(`Hot-reload process exited before becoming ready (code=${exitCode}, signal=${signal ?? "none"})\n${current.stdout}${current.stderr}`);
        error.code = "DEVECO_HOT_RELOAD_START_FAILED";
        finish(error);
      }
    });
  });
  return snapshot();
}

export async function hotReloadApply(input = {}) {
  if (!session?.ready || session.child.exitCode !== null) {
    const error = new Error("No active hot-reload session. Start one first.");
    error.code = "DEVECO_HOT_RELOAD_NOT_RUNNING";
    throw error;
  }
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
    const args = ["run", "--device", session.device];
    if (session.module) args.push("--module", session.module);
    args.push("--hotreload-apply", name);
    const result = await runDevecoCli(args, {
      cwd: session.project,
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
    return { ...snapshot(), appliedFiles: files, applyCommand: result.command, output };
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
  let result;
  try {
    result = await runDevecoCli(["run", "--hotreload", "stop"], {
      cwd: current.project,
      timeoutMs: input.timeoutMs ?? 30000,
    });
  } finally {
    if (current.child.exitCode === null) terminateProcessTree(current.child);
    session = null;
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
  if (current?.child?.exitCode === null) terminateProcessTree(current.child);
}
