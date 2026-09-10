import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inside, readObject, walk } from "../core/files.js";
import { invariant } from "../core/errors.js";
import type { Project } from "./project.js";
import type { CheckDiagnostic } from "./checker.js";

type Scope = Pick<Project, "root" | "modules">;
const sourceExtension = (file: string) => /\.(?:ets|ts)$/.test(file);
const appSource = (file: string) =>
  sourceExtension(file) && !/\.d\.(?:ets|ts)$/.test(file);
export function checkerSources(
  project: Scope,
  requested?: string[],
  allowEmptyDeclarations = false,
) {
  const roots = project.modules
    .map((module) => path.join(module.root, "src/main/ets"))
    .filter((root) => fs.existsSync(root) && fs.statSync(root).isDirectory());
  const candidates =
    requested === undefined
      ? [
          ...roots.flatMap((root) =>
            walk(root, new Set([".ets", ".ts"])).filter(appSource),
          ),
          ...project.modules.flatMap((module) =>
            fs
              .readdirSync(module.root, { withFileTypes: true })
              .filter(
                (entry) =>
                  entry.isFile() &&
                  entry.name !== "hvigorfile.ts" &&
                  appSource(entry.name),
              )
              .map((entry) => path.join(module.root, entry.name)),
          ),
        ]
      : requested.map((file) => {
          invariant(
            file.trim().length > 0 && appSource(file),
            "CHECK_SOURCE_INVALID",
            "Select .ets or .ts application sources, not .d.ets or .d.ts declarations",
          );
          return path.resolve(project.root, file);
        });
  invariant(
    candidates.length <= 100000,
    "CHECK_SOURCE_LIMIT",
    "Static preflight supports at most 100000 source files",
  );
  const files: string[] = [],
    seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of candidates) {
    invariant(
      fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      "CHECK_SOURCE_INVALID",
      `Source is not a readable regular file: ${candidate}`,
    );
    const file = fs.realpathSync.native(candidate);
    const relative = path.relative(fs.realpathSync.native(project.root), file);
    invariant(
      appSource(file) &&
        !path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`),
      "CHECK_SOURCE_INVALID",
      "Source files must resolve to application sources inside the selected project",
    );
    if (seen.has(file)) continue;
    const bytes = fs.statSync(file).size;
    totalBytes += bytes;
    invariant(
      bytes <= 8 * 1024 * 1024 && totalBytes <= 64 * 1024 * 1024,
      "CHECK_SOURCE_LIMIT",
      "Static preflight source budget is 8 MiB per file and 64 MiB total; narrow the file selection",
    );
    seen.add(file);
    files.push(file);
  }
  invariant(
    files.length > 0 || (allowEmptyDeclarations && requested === undefined),
    "NO_FILES_CHECKED",
    "No source files were selected",
  );
  return {
    files,
    roots,
    bytes: totalBytes,
    mode: requested === undefined ? ("project" as const) : ("files" as const),
  };
}

function profileObject(file: string) {
  const stat = fs.statSync(file);
  invariant(
    stat.isFile() && stat.size <= 1024 * 1024,
    "ROUTER_PROFILE_INVALID",
    "Router metadata must be a regular file at most 1 MiB",
  );
  return readObject(file);
}
/** Invalid or missing declared profiles are project diagnostics, never skipped checks. */
export function checkerRouterPages(
  project: Scope,
  checkPage?: (file: string) => CheckDiagnostic[],
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];
  for (const module of project.modules) {
    const manifest = path.join(module.root, "src/main/module.json5");
    if (!fs.existsSync(manifest)) continue; // Native libraries can have no Stage pages.
    let file = manifest;
    try {
      const config = z
        .object({ module: z.object({ pages: z.string().optional() }) })
        .parse(profileObject(manifest));
      const pages = config.module.pages;
      if (pages === undefined) continue;
      invariant(
        pages.startsWith("$profile:"),
        "ROUTER_PROFILE_INVALID",
        "module.pages must reference a profile",
      );
      const name = pages.slice(9);
      invariant(
        name.length > 0 &&
          ![".", ".."].includes(name) &&
          !/[\\/:\x00-\x1f\x7f]/.test(name),
        "ROUTER_PROFILE_INVALID",
        "Invalid router profile resource name",
      );
      file = path.join(
        module.root,
        "src/main/resources/base/profile",
        name + ".json",
      );
      const profile = z
        .object({ src: z.array(z.string().min(1)) })
        .parse(profileObject(file));
      for (const page of profile.src) {
        invariant(
          !path.isAbsolute(page) && !/[\\:\x00-\x1f\x7f]/.test(page),
          "ROUTER_PROFILE_INVALID",
          "Page paths must be relative to the module's ets directory",
        );
        const base = inside(path.join(module.root, "src/main/ets"), page);
        const extension = [".ets", ".ts"].find(
          (extension) =>
            fs.existsSync(base + extension) &&
            fs.statSync(base + extension).isFile(),
        );
        if (!extension)
          diagnostics.push({
            file: path.relative(project.root, file),
            line: 1,
            column: 1,
            severity: "error",
            rule: "page-file-exists",
            message: `Router page not found: ${page}`,
          });
        else if (checkPage) diagnostics.push(...checkPage(base + extension));
      }
    } catch (error) {
      diagnostics.push({
        file: path.relative(project.root, file),
        line: 1,
        column: 1,
        severity: "error",
        rule: "page-profile-invalid",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return diagnostics;
}

/** Resolve HMS separately; inspecting '/' in an absolute path breaks on Windows. */
export function checkerSdkEnvironment(sdk: string) {
  const hms = path.join(sdk, "default/hms/ets"),
    etsRoots = [path.join(sdk, "default/openharmony/ets"), hms].filter(
      (root) => fs.existsSync(root) && fs.statSync(root).isDirectory(),
    ),
    externalApiPaths = etsRoots.includes(hms) ? hms : "";
  return { etsRoots, externalApiPaths };
}
