import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

const CHECKER = path.join(REPO_ROOT, "src", "upstream", "arkts-check.cjs");

function projectRoot(explicit) {
  const candidate = explicit || getProjectPath() || process.env.PROJECT_PATH;
  if (!candidate) {
    const error = new Error("No HarmonyOS project is selected. Call switch_cwd first or pass project_path.");
    error.code = "PROJECT_REQUIRED";
    throw error;
  }
  const absolute = path.resolve(candidate);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    const error = new Error(`Project directory does not exist: ${absolute}`);
    error.code = "PROJECT_PATH_NOT_FOUND";
    throw error;
  }
  return absolute;
}

function runNode(argv, cwd, timeoutMs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        const error = new Error(`ArkTS checker timed out after ${timeoutMs}ms`);
        error.code = "ARKTS_CHECK_TIMEOUT";
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
      resolve({ stdout, stderr, exitCode, signal });
    });
  });
}

export async function runArktsCheck({ files = [], project_path: explicitProject, timeoutMs = 180000 } = {}) {
  if (!fs.existsSync(CHECKER)) {
    const error = new Error(`ArkTS checker is missing: ${CHECKER}`);
    error.code = "ARKTS_CHECKER_NOT_FOUND";
    throw error;
  }
  if (!Array.isArray(files)) {
    const error = new Error("files must be an array of .ets paths");
    error.code = "ARKTS_FILES_INVALID";
    throw error;
  }
  const project = projectRoot(explicitProject);
  const normalizedFiles = files.map((file) => {
    if (typeof file !== "string" || file.trim() === "") {
      const error = new Error("files must contain non-empty .ets or .ts paths");
      error.code = "ARKTS_FILES_INVALID";
      throw error;
    }
    const normalized = file.trim();
    if (![".ets", ".ts"].includes(path.extname(normalized).toLowerCase())) {
      const error = new Error(`Unsupported ArkTS file type: ${normalized}`);
      error.code = "ARKTS_FILE_UNSUPPORTED";
      throw error;
    }
    const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(project, normalized);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      const error = new Error(`ArkTS file does not exist: ${absolute}`);
      error.code = "ARKTS_FILE_NOT_FOUND";
      throw error;
    }
    return normalized;
  });
  const argv = [CHECKER, "--project", project];
  if (normalizedFiles.length) argv.push("--files", ...normalizedFiles);
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 180000, 1000), 600000);
  const home = resolveDevecoHome().path;
  const env = { ...process.env };
  if (home) env.DEVECO_HOME = home;
  const result = await runNode(argv, project, boundedTimeout, env);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    const error = new Error("ArkTS checker returned invalid JSON");
    error.code = "ARKTS_CHECK_INVALID_OUTPUT";
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return {
    ...parsed,
    projectPath: project,
    files: normalizedFiles,
    exitCode: result.exitCode,
    signal: result.signal,
    stderr: result.stderr,
  };
}

export function arktsCheckStatus() {
  return { installed: fs.existsSync(CHECKER), checker: CHECKER };
}
