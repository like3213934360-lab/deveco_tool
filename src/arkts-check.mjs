import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { discoverProjectEtsFiles } from "./arkts-project.mjs";
export { discoverProjectEtsFiles } from "./arkts-project.mjs";
import { REPO_ROOT, resolveDevecoHome, resolveDevecoToolchain } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

const CHECKER = path.join(REPO_ROOT, "src", "upstream", "arkts-check.cjs");
const MAX_CHECKER_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKER_STDERR_BYTES = 256 * 1024;

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
      detached: process.platform !== "win32",
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
        const error = new Error(`ArkTS checker timed out after ${timeoutMs}ms`);
        error.code = "ARKTS_CHECK_TIMEOUT";
        reject(error);
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CHECKER_STDOUT_BYTES) {
        settled = true;
        clearTimeout(timer);
        terminateProcessTree(child);
        const error = new Error(
          `ArkTS checker output exceeded ${MAX_CHECKER_STDOUT_BYTES} bytes; narrow the file set or run the official code_lint/build_project tool.`,
        );
        error.code = "ARKTS_CHECK_OUTPUT_LIMIT";
        reject(error);
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      const text = chunk.toString();
      stderr = stderrBytes > MAX_CHECKER_STDERR_BYTES
        ? `${stderr}${text}`.slice(-MAX_CHECKER_STDERR_BYTES)
        : stderr + text;
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
      resolve({ stdout, stderr, exitCode, signal });
    });
  });
}

export async function runArktsCheck({ files = [], project_path: explicitProject, timeoutMs } = {}) {
  if (!fs.existsSync(CHECKER)) {
    const error = new Error(`ArkTS checker is missing: ${CHECKER}`);
    error.code = "ARKTS_CHECKER_NOT_FOUND";
    throw error;
  }
  if (!Array.isArray(files)) {
    const error = new Error("files must be an array of .ets or .ts paths");
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
  // With no explicit files this is a whole-project scan. Resolve the file list
  // here rather than letting the checker guess: it only knows the single-module
  // `entry/` layout and silently reports success when it finds nothing.
  let scan = null;
  let targets = normalizedFiles;
  if (!targets.length) {
    const discovered = discoverProjectEtsFiles(project);
    if (!discovered.files.length) {
      const error = new Error(
        `No .ets/.ts source files found under ${project} (${discovered.roots.length} module source root(s) resolved). `
        + "Pass explicit files if this project uses a non-standard layout.",
      );
      error.code = "ARKTS_NO_FILES_DISCOVERED";
      throw error;
    }
    scan = {
      mode: "project",
      sourceRoots: discovered.roots.map((root) => path.relative(project, root)),
      fileCount: discovered.files.length,
    };
    targets = discovered.files;
  }

  const argv = [CHECKER, "--project", project, "--files", ...targets];
  const requested = Number(timeoutMs);
  const fallbackTimeout = scan ? 600000 : 180000;
  const boundedTimeout = Math.min(
    Math.max(Number.isFinite(requested) && requested > 0 ? requested : fallbackTimeout, 1000),
    600000,
  );
  const home = resolveDevecoHome().path;
  const toolchain = resolveDevecoToolchain();
  const env = { ...process.env };
  if (home) env.DEVECO_HOME = home;
  if (toolchain.paths?.sdk) env.DEVECO_SDK_HOME = toolchain.paths.sdk;
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
    checkKind: "static-precheck",
    compilationVerified: false,
    verificationHint: "arkts_check is a fast static precheck and can miss SDK/type-resolution errors. Use build_project for authoritative compilation verification.",
    projectPath: project,
    files: normalizedFiles,
    checkedFileCount: targets.length,
    ...(scan ? { scan } : {}),
    exitCode: result.exitCode,
    signal: result.signal,
    stderr: result.stderr,
  };
}

export function arktsCheckStatus() {
  return { installed: fs.existsSync(CHECKER), checker: CHECKER };
}
