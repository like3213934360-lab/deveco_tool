import fs from "node:fs";
import path from "node:path";
import { readModuleEntries, parseJson5 } from "./build-profile.mjs";

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

function walkSourceFiles(directory, results, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return results;
  for (const entry of readDirectory(directory)) {
    if (entry.isDirectory()) {
      if (skippable(entry)) continue;
      walkSourceFiles(path.join(directory, entry.name), results, depth + 1);
    } else if (/\.(?:ets|ts)$/.test(entry.name) && !/\.d\.(?:ets|ts)$/.test(entry.name)) {
      results.push(path.join(directory, entry.name));
    }
  }
  return results;
}

/**
 * Discover every checkable `.ets`/`.ts` file in a HarmonyOS project.
 *
 * The upstream checker only ever looked at `entry/src/main/ets`, so multi-module
 * projects reported zero files and the caller could not tell that apart from a
 * clean result. Source roots come from `build-profile.json5` when present and
 * from a bounded directory walk otherwise.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {{roots: string[], files: string[], moduleDirectories: string[]}}
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
      moduleDirectories.push(moduleDirectory);
      if (isDirectory(candidate)) roots.push(candidate);
    }
  }
  if (!modules) {
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
    for (const file of walkSourceFiles(root, [])) add(file);
  }
  // Module barrels (Index.ets, BuildProfile.ets) live at the module root rather
  // than under src/main/ets, but they are compiled source and can carry errors.
  for (const moduleDirectory of moduleDirectories) {
    for (const entry of readDirectory(moduleDirectory)) {
      if (!entry.isFile()) continue;
      if (entry.name === "hvigorfile.ts") continue; // Host build script, not app source.
      if (!/\.(?:ets|ts)$/.test(entry.name) || /\.d\.(?:ets|ts)$/.test(entry.name)) continue;
      add(path.join(moduleDirectory, entry.name));
    }
  }
  return { roots, files, moduleDirectories };
}

/** Resolve Stage router profiles in the owning module, including custom names. */
export function validateRouterPages(projectRoot, moduleDirectories) {
  const diagnostics = [];
  for (const directory of moduleDirectories) {
    const manifest = path.join(directory, "src", "main", "module.json5");
    if (!fs.existsSync(manifest)) continue; // FA and library layouts may have no Stage pages.
    let profile;
    try {
      const pages = parseJson5(fs.readFileSync(manifest, "utf8"))?.module?.pages;
      if (typeof pages !== "string" || !pages.startsWith("$profile:")) continue;
      profile = path.join(directory, "src", "main", "resources", "base", "profile", `${pages.slice(9)}.json`);
      const config = parseJson5(fs.readFileSync(profile, "utf8"));
      if (!Array.isArray(config.src) || config.src.some((page) => typeof page !== "string")) {
        throw new Error("Router profile src must be an array of page paths");
      }
      for (const page of config.src) {
        const target = path.join(directory, "src", "main", "ets", `${page}.ets`);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) continue;
        diagnostics.push({
          file: path.relative(projectRoot, profile), line: 1, column: 1,
          severity: "error", rule: "page-file-exists",
          message: `Page '${page}.ets' does not exist at ${path.relative(projectRoot, target)}. Registered in ${path.basename(profile)}.`,
        });
      }
    } catch (error) {
      diagnostics.push({
        file: path.relative(projectRoot, profile ?? manifest), line: 1, column: 1,
        severity: "error", rule: "page-profile-invalid", message: error.message,
      });
    }
  }
  return diagnostics;
}
