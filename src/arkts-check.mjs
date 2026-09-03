import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readModuleEntries } from "./build-profile.mjs";
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

const SKIP_DIRECTORIES = new Set(["node_modules", "oh_modules", "build", "hvigor"]);
const MAX_WALK_DEPTH = 12;

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function readDirectory(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function skippable(entry) {
  return entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name);
}

/**
 * Locate module source roots without a build profile: `<module>/src/main/ets`
 * at the project root and one level below it, plus a single-module layout.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {string[]} Existing source-root directories.
 */
function fallbackSourceRoots(projectRoot) {
  const roots = [];
  const single = path.join(projectRoot, "src", "main", "ets");
  if (isDirectory(single)) roots.push(single);
  for (const first of readDirectory(projectRoot)) {
    if (!first.isDirectory() || skippable(first)) continue;
    const firstPath = path.join(projectRoot, first.name);
    const firstRoot = path.join(firstPath, "src", "main", "ets");
    if (isDirectory(firstRoot)) {
      roots.push(firstRoot);
      continue;
    }
    for (const second of readDirectory(firstPath)) {
      if (!second.isDirectory() || skippable(second)) continue;
      const secondRoot = path.join(firstPath, second.name, "src", "main", "ets");
      if (isDirectory(secondRoot)) roots.push(secondRoot);
    }
  }
  return roots;
}

function walkEtsFiles(directory, results, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return results;
  for (const entry of readDirectory(directory)) {
    if (entry.isDirectory()) {
      if (skippable(entry)) continue;
      walkEtsFiles(path.join(directory, entry.name), results, depth + 1);
    } else if (entry.name.endsWith(".ets") && !entry.name.endsWith(".d.ets")) {
      results.push(path.join(directory, entry.name));
    }
  }
  return results;
}

/**
 * Discover every checkable `.ets` file in a HarmonyOS project.
 *
 * The upstream checker only ever looked at `entry/src/main/ets`, so multi-module
 * projects reported zero files and the caller could not tell that apart from a
 * clean result. Source roots come from `build-profile.json5` when present and
 * from a bounded directory walk otherwise.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {{roots: string[], files: string[]}} Source roots and the files under them.
 */
export function discoverProjectEtsFiles(projectRoot) {
  const roots = [];
  const moduleDirectories = [];
  const modules = readModuleEntries(projectRoot);
  if (modules) {
    for (const module of modules) {
      const srcPath = typeof module?.srcPath === "string" ? module.srcPath : null;
      if (!srcPath) continue;
      const moduleDirectory = path.resolve(projectRoot, srcPath);
      const candidate = path.join(moduleDirectory, "src", "main", "ets");
      if (!isDirectory(candidate)) continue;
      roots.push(candidate);
      moduleDirectories.push(moduleDirectory);
    }
  }
  if (!roots.length) {
    for (const root of fallbackSourceRoots(projectRoot)) {
      roots.push(root);
      moduleDirectories.push(path.resolve(root, "..", "..", ".."));
    }
  }

  const seen = new Set();
  const files = [];
  const add = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    files.push(file);
  };
  for (const root of roots) {
    for (const file of walkEtsFiles(root, [])) add(file);
  }
  // Module barrels (Index.ets, BuildProfile.ets) live at the module root rather
  // than under src/main/ets, but they are compiled source and can carry errors.
  for (const moduleDirectory of moduleDirectories) {
    for (const entry of readDirectory(moduleDirectory)) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ets") || entry.name.endsWith(".d.ets")) continue;
      add(path.join(moduleDirectory, entry.name));
    }
  }
  return { roots, files };
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
  // With no explicit files this is a whole-project scan. Resolve the file list
  // here rather than letting the checker guess: it only knows the single-module
  // `entry/` layout and silently reports success when it finds nothing.
  let scan = null;
  let targets = normalizedFiles;
  if (!targets.length) {
    const discovered = discoverProjectEtsFiles(project);
    if (!discovered.files.length) {
      const error = new Error(
        `No .ets source files found under ${project} (${discovered.roots.length} module source root(s) resolved). `
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
