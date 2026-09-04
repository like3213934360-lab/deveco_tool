import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { getProjectPath } from "../project-context.mjs";

const PROJECT_MARKERS = [
  "build-profile.json5",
  "oh-package.json5",
  "hvigorfile.ts",
  "hvigorfile.js",
];
const ROOT_CACHE_MAX = 128;
const ROOT_CACHE_TTL_MS = 5000;
const rootCache = new Map();

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isApplicationProjectRoot(directory) {
  try {
    const profile = JSON5.parse(fs.readFileSync(path.join(directory, "build-profile.json5"), "utf8"));
    return Boolean(profile?.app && typeof profile.app === "object");
  } catch {
    return false;
  }
}

function setCachedRoot(start, root) {
  rootCache.delete(start);
  rootCache.set(start, { root, expiresAt: Date.now() + ROOT_CACHE_TTL_MS });
  while (rootCache.size > ROOT_CACHE_MAX) {
    rootCache.delete(rootCache.keys().next().value);
  }
  return root;
}

function nearestProjectRoot(start) {
  const cached = rootCache.get(start);
  if (cached && cached.expiresAt > Date.now()) {
    rootCache.delete(start);
    rootCache.set(start, cached);
    return cached.root;
  }
  if (cached) rootCache.delete(start);

  let current = start;
  let nearestFallback = null;
  while (true) {
    if (isApplicationProjectRoot(current)) return setCachedRoot(start, current);
    if (!nearestFallback
      && PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) {
      nearestFallback = current;
    }
    const parent = path.dirname(current);
    if (parent === current) return setCachedRoot(start, nearestFallback);
    current = parent;
  }
}

function sourcePath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    const error = new Error("filePath is required for every ArkTS LSP operation.");
    error.code = "LSP_FILE_REQUIRED";
    throw error;
  }
  const base = getProjectPath() || process.env.PROJECT_PATH || process.cwd();
  const absolute = path.resolve(base, filePath);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    const error = new Error(`ArkTS source file does not exist: ${absolute}`);
    error.code = "LSP_FILE_NOT_FOUND";
    error.details = { filePath: absolute };
    throw error;
  }
  if (!stat.isFile()) {
    const error = new Error(`ArkTS LSP target is not a file: ${absolute}`);
    error.code = "LSP_FILE_NOT_FOUND";
    error.details = { filePath: absolute };
    throw error;
  }
  if (path.extname(absolute).toLowerCase() !== ".ets") {
    const error = new Error("The official ArkTS ace-server adapter only accepts .ets files.");
    error.code = "LSP_FILE_TYPE_UNSUPPORTED";
    error.details = { filePath: absolute, extension: path.extname(absolute) };
    throw error;
  }
  return fs.realpathSync(absolute);
}

export function resolveLspTarget(filePath) {
  const absolute = sourcePath(filePath);
  const selected = getProjectPath() || process.env.PROJECT_PATH;
  const discovered = nearestProjectRoot(path.dirname(absolute));
  let projectRoot = null;
  if (selected) {
    try {
      const resolvedSelected = fs.realpathSync(path.resolve(selected));
      if (isWithin(resolvedSelected, absolute)) {
        // switch_cwd also accepts module directories because they carry an
        // oh-package.json5.  ace-server can start from such a directory, but
        // then its index is limited to that module.  Promote it to the nearest
        // application-level build profile so cross-module results stay complete.
        projectRoot = discovered && isWithin(discovered, resolvedSelected)
          ? discovered
          : resolvedSelected;
      }
    } catch {
      const error = new Error(`Configured HarmonyOS project does not exist: ${path.resolve(selected)}`);
      error.code = "LSP_PROJECT_NOT_FOUND";
      error.details = { projectPath: path.resolve(selected) };
      throw error;
    }
  }
  projectRoot ??= discovered;
  if (!projectRoot) {
    const error = new Error(`No HarmonyOS project root was found for ${absolute}`);
    error.code = "LSP_PROJECT_NOT_FOUND";
    error.hint = "Call switch_cwd with a HarmonyOS project root before using LSP tools.";
    error.details = { filePath: absolute, markers: PROJECT_MARKERS };
    throw error;
  }
  return { filePath: absolute, projectRoot };
}
