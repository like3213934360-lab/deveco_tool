import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, resolveDevecoHome, resolveDevecoToolchain } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";
// Shared with the DevEco CLI runner; see that module for why the hvigor daemon stays out of reach.
import { terminateProcessTree } from "./process-tree.mjs";


const SCRIPT_DEFINITIONS = {
  copy_template: {
    skill: "deveco-create-project",
    file: "scripts/copy-template.mjs",
    description: "Copy the bundled ArkTS project template and resolve its SDK metadata.",
  },
  detect_sdk: {
    skill: "deveco-create-project",
    file: "scripts/detect-sdk.mjs",
    adapterFile: "src/script-adapters/detect-sdk.mjs",
    description: "Detect the API level and SDK metadata from configured DevEco Studio or Command Line Tools.",
  },
  collect_hilog: {
    skill: "arkts-runtime-fix",
    file: "scripts/collect-hilog.mjs",
    description: "Collect a bounded HILOG snapshot from a connected HarmonyOS device.",
  },
  fetch_faultlog: {
    skill: "arkts-runtime-fix",
    file: "scripts/fetch-faultlog.mjs",
    description: "Fetch a named faultlogger file from a connected HarmonyOS device.",
  },
  jscrash_report: {
    skill: "arkts-runtime-fix",
    file: "scripts/jscrash-report.mjs",
    description: "Collect or analyze a JS crash report and produce structured diagnostics.",
  },
  parse_jscrash_log: {
    skill: "arkts-runtime-fix",
    file: "scripts/parse-jscrash-log.mjs",
    description: "Parse a JS crash log from a file or inline text.",
  },
  probe_faultlogger: {
    skill: "arkts-runtime-fix",
    file: "scripts/probe-faultlogger.mjs",
    description: "Probe recent faultlogger entries on a connected HarmonyOS device.",
  },
};

/**
 * Locate a Python interpreter for `runtime: "python"` scripts.
 * An explicit PYTHON is authoritative: if it is set but unusable, report that rather than silently
 * falling back to a different interpreter, which is how a script ends up running without Pillow.
 * @returns {Promise<string|null>} The interpreter command, or null when none is usable.
 */
function probeCommand(command, args, capture = false) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", capture ? "pipe" : "ignore", capture ? "pipe" : "ignore"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish({ ok: false, stdout, stderr });
    }, 3000);
    child.stdout?.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-16384); });
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16384); });
    child.once("error", () => finish({ ok: false, stdout, stderr }));
    child.once("close", (code) => finish({ ok: code === 0, stdout, stderr }));
  });
}

export async function resolvePython() {
  const explicit = process.env.PYTHON;
  const candidates = explicit ? [explicit] : ["python3", "python"];
  for (const candidate of candidates) {
    if ((await probeCommand(candidate, ["--version"])).ok) return candidate;
  }
  return null;
}

/**
 * Report whether Python and Pillow are available for environment diagnostics.
 * The current official DevEco skills only register Node.js scripts, but the doctor keeps this
 * optional probe for compatibility with hosts that add their own Python-backed script entries.
 * @returns {Promise<{available: boolean, python: string|null, version: string|null, pillow: boolean}>} Status.
 */
export async function pythonStatus() {
  const python = await resolvePython();
  if (!python) return { available: false, python: null, version: null, pillow: false };
  const version = await probeCommand(python, ["--version"], true);
  const pillow = await probeCommand(python, ["-c", "import PIL"]);
  return {
    available: true,
    python,
    version: (version.stdout || version.stderr || "").trim() || null,
    pillow: pillow.ok,
  };
}

/**
 * Give registered Skill scripts the same bundled toolchain visibility as the
 * native DevEco CLI wrappers. GUI-launched MCP hosts commonly provide a very
 * small PATH, while the Python test runners locate `hvigorw` with
 * `shutil.which()`. DEVECO_HOME alone is therefore not sufficient.
 *
 * @param {NodeJS.ProcessEnv} base Parent environment.
 * @param {ReturnType<typeof resolveDevecoToolchain>} toolchain Resolved Studio/CLT layout.
 * @returns {NodeJS.ProcessEnv} Child environment with bundled executables first on PATH.
 */
export function registeredScriptEnvironment(base, toolchain = resolveDevecoToolchain()) {
  const env = { ...base };
  const paths = toolchain.paths;
  if (!paths) return env;

  const pathKey = process.platform === "win32"
    ? Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path"
    : "PATH";
  const bundledDirectories = [paths.hvigor, paths.ohpm, paths.node, paths.hdc, paths.emulator]
    .filter(Boolean)
    .map((entry) => path.dirname(entry));
  const inheritedDirectories = String(env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const seen = new Set();
  env[pathKey] = [...bundledDirectories, ...inheritedDirectories]
    .filter((entry) => {
      const key = process.platform === "win32" ? entry.toLowerCase() : entry;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(path.delimiter);

  if (!env.NODE_HOME && paths.node) {
    env.NODE_HOME = process.platform === "win32"
      ? path.dirname(paths.node)
      : path.dirname(path.dirname(paths.node));
  }
  return env;
}

function scriptPath(definition) {
  return path.join(REPO_ROOT, "skills", definition.skill, definition.file);
}

function executionPath(definition) {
  return definition.adapterFile
    ? path.join(REPO_ROOT, definition.adapterFile)
    : scriptPath(definition);
}

export function listScripts() {
  return Object.entries(SCRIPT_DEFINITIONS).map(([id, definition]) => ({
    id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, scriptPath(definition)),
    runtime: definition.runtime ?? "node",
    description: definition.description,
  }));
}

function kebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/_/g, "-");
}

function objectToArgv(args) {
  const argv = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    const flag = `--${kebabCase(key)}`;
    if (value === true) {
      argv.push(flag);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) argv.push(flag, String(item));
      continue;
    }
    argv.push(flag, String(value));
  }
  return argv;
}

// Skill scripts print a `key: value` block and then free-form narrative: stack
// frames, hilog excerpts, evidence dumps. Treating every `x: y` line as a field
// turned that narrative into fabricated keys ("08-02 14", "at foo (Bar.ets"),
// and a later duplicate could overwrite a real value. Every field the scripts
// actually emit is lowercase snake_case, so that is the accepted key shape.
const SCRIPT_FIELD_KEY = /^[a-z][a-z0-9_]*$/;

// Exported so the key-filtering rules can be unit tested without spawning a script.
export function parseScriptOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const values = {};
    let found = false;
    for (const line of trimmed.split(/\r?\n/)) {
      const equals = line.indexOf("=");
      const colon = line.indexOf(":");
      const separator = equals >= 0 ? equals : colon;
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (!SCRIPT_FIELD_KEY.test(key)) continue;
      if (Object.hasOwn(values, key)) continue;
      values[key] = line.slice(separator + 1).trim();
      found = true;
    }
    return found ? values : null;
  }
}

function inputOption(input, flag, property) {
  if (Array.isArray(input.argv)) {
    const index = input.argv.indexOf(flag);
    if (index >= 0 && index + 1 < input.argv.length) return String(input.argv[index + 1]);
  }
  for (const values of [input.args, input]) {
    if (!values || typeof values !== "object") continue;
    if (values[property] !== undefined) return String(values[property]);
    const entry = Object.entries(values).find(([key]) => `--${kebabCase(key)}` === flag);
    if (entry) return String(entry[1]);
  }
  return "";
}

function crashLogText(input) {
  const inline = inputOption(input, "--log-text", "logText");
  if (inline) return inline;

  const file = inputOption(input, "--log-file", "logFile");
  if (!file) return "";
  try {
    const resolved = path.isAbsolute(file)
      ? file
      : path.resolve(getProjectPath() ?? REPO_ROOT, file);
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || stats.size > 4 * 1024 * 1024) return "";
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return "";
  }
}

// DevEco Code v0.1.11's crash parser sometimes promotes "Error name" (or even the final
// unrelated hilog line) to error_message. Keep the official source byte-for-byte intact and
// normalize only the MCP result contract that existing callers already depend on.
function normalizeParsedResult(id, input, parsed) {
  if (!parsed || !["parse_jscrash_log", "jscrash_report"].includes(id)) return parsed;
  if (parsed.status === "no_crash_signature") {
    return { ...parsed, error_message: "(not found)" };
  }

  const declared = /^\s*Error\s+message\s*[:：]\s*(.+?)\s*$/im.exec(crashLogText(input))?.[1];
  return declared ? { ...parsed, error_message: declared } : parsed;
}

export async function runRegisteredScript(id, input = {}) {
  const definition = SCRIPT_DEFINITIONS[id];
  if (!definition) {
    const error = new Error(`Unknown registered script: ${id}`);
    error.code = "UNKNOWN_SCRIPT";
    throw error;
  }

  const sourceFile = scriptPath(definition);
  const file = executionPath(definition);
  if (!fs.existsSync(sourceFile)) {
    const error = new Error(`Registered script is missing: ${sourceFile}`);
    error.code = "SCRIPT_NOT_FOUND";
    throw error;
  }
  if (!fs.existsSync(file)) {
    const error = new Error(`Registered script adapter is missing: ${file}`);
    error.code = "SCRIPT_NOT_FOUND";
    throw error;
  }

  const rawArgs = input.args ?? Object.fromEntries(
    Object.entries(input).filter(([key]) => !["script", "argv", "timeoutMs"].includes(key)),
  );
  const argv = Array.isArray(input.argv)
    ? input.argv.map(String)
    : objectToArgv(rawArgs);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 120000), 1000), 600000);
  const devecoHome = resolveDevecoHome().path;
  const toolchain = resolveDevecoToolchain();
  const childEnv = registeredScriptEnvironment(process.env, toolchain);
  if (devecoHome) childEnv.DEVECO_HOME = devecoHome;
  if (toolchain.paths?.sdk) childEnv.DEVECO_SDK_HOME = toolchain.paths.sdk;

  const runtime = definition.runtime ?? "node";
  let command = process.execPath;
  if (runtime === "python") {
    const python = await resolvePython();
    if (!python) {
      const error = new Error(`${id} needs a Python interpreter and none was usable.`);
      error.code = "PYTHON_NOT_FOUND";
      error.hint = process.env.PYTHON
        ? `PYTHON is set to "${process.env.PYTHON}" but it did not run. Point it at a working interpreter or unset it.`
        : "安装 Python 3,或把 PYTHON 环境变量指向可用的解释器。";
      throw error;
    }
    command = python;
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, [file, ...argv], {
      cwd: getProjectPath() ?? REPO_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group. Several registered scripts shell out to hvigor, ohpm or hdc, and
      // signalling only the direct child left those grandchildren running: hvigor daemons and
      // Python workers survived every timeout and accumulated across a session.
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      terminateProcessTree(child);
      if (!settled) {
        settled = true;
        const error = new Error(`Script timed out after ${timeoutMs}ms: ${id}`);
        error.code = "SCRIPT_TIMEOUT";
        reject(error);
      }
    }, timeoutMs);

    const rejectLargeOutput = (stream, bytes, limit) => {
      if (settled || bytes <= limit) return false;
      settled = true;
      clearTimeout(timer);
      terminateProcessTree(child);
      const error = new Error(`Script ${id} ${stream} exceeded the ${limit}-byte output limit`);
      error.code = "SCRIPT_OUTPUT_LIMIT";
      reject(error);
      return true;
    };
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (!rejectLargeOutput("stdout", stdoutBytes, 4 * 1024 * 1024)) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (!rejectLargeOutput("stderr", stderrBytes, 1024 * 1024)) stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ exitCode, signal, stdout, stderr });
    });
  });

  // A zero exit with nothing on stdout means the script produced no result at
  // all; say so rather than letting an empty `parsed` read as a clean run.
  const silentSuccess = result.exitCode === 0 && !result.stdout.trim();

  const parsed = normalizeParsedResult(id, input, parseScriptOutput(result.stdout));

  return {
    script: id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, sourceFile),
    ...(definition.adapterFile ? { adapter: path.relative(REPO_ROOT, file) } : {}),
    runtime,
    argv,
    cwd: getProjectPath() ?? REPO_ROOT,
    exitCode: result.exitCode,
    signal: result.signal,
    ok: result.exitCode === 0,
    parsed,
    ...(silentSuccess ? { warning: "Script exited 0 without writing to stdout; it produced no result." } : {}),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
