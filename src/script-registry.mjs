import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

const SCRIPT_DEFINITIONS = {
  copy_template: {
    skill: "deveco-create-project",
    file: "scripts/copy-template.mjs",
    description: "Copy the bundled ArkTS project template and resolve its SDK metadata.",
  },
  detect_sdk: {
    skill: "deveco-create-project",
    file: "scripts/detect-sdk.mjs",
    description: "Detect the API level and SDK metadata from the configured DevEco Studio.",
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

function scriptPath(definition) {
  return path.join(REPO_ROOT, "skills", definition.skill, definition.file);
}

export function listScripts() {
  return Object.entries(SCRIPT_DEFINITIONS).map(([id, definition]) => ({
    id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, scriptPath(definition)),
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

function parseScriptOutput(stdout) {
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
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      found = true;
    }
    return found ? values : null;
  }
}

export async function runRegisteredScript(id, input = {}) {
  const definition = SCRIPT_DEFINITIONS[id];
  if (!definition) {
    const error = new Error(`Unknown registered script: ${id}`);
    error.code = "UNKNOWN_SCRIPT";
    throw error;
  }

  const file = scriptPath(definition);
  if (!fs.existsSync(file)) {
    const error = new Error(`Registered script is missing: ${file}`);
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
  const childEnv = { ...process.env };
  if (devecoHome) childEnv.DEVECO_HOME = devecoHome;

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...argv], {
      cwd: getProjectPath() ?? REPO_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        const error = new Error(`Script timed out after ${timeoutMs}ms: ${id}`);
        error.code = "SCRIPT_TIMEOUT";
        reject(error);
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
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

  return {
    script: id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, file),
    argv,
    cwd: getProjectPath() ?? REPO_ROOT,
    exitCode: result.exitCode,
    signal: result.signal,
    ok: result.exitCode === 0,
    parsed: parseScriptOutput(result.stdout),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
