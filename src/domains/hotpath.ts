import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "../core/files.js";
import { diffSources, snapshotSources, trackedSource, type SourceSnapshot } from "./preflight.js";
import { pinStorage, storageGuard } from "../core/storage.js";

/*
 * run build_run mode=auto: patch the running app (HQF quick fix, ~5 s) instead of build + install +
 * launch (25-90 s) when that is provably equivalent. Measured facts that shape the rules:
 *   - the cold-reload compiler resolves changed files under the hot-reload module's own ets directory,
 *     so only that module's .ets/.ts files are patchable (an edit in a HAR yields no patch);
 *   - resources, module.json5, oh-package.json5, build-profile.json5 and new/deleted files need a
 *     real build (hot_reload tool documentation; HQF cannot add or remove code units);
 *   - the patch is only valid against the exact install the baseline was recorded for
 *     (bm dump installTime/updateTime).
 * Every rule that cannot be proven falls back to the full path; the reason is reported.
 */

export interface HotState {
  product: string;
  moduleTarget: string;
  modules: { name: string; target: string }[];
  module: string;
  moduleRoot: string;
  target: string;
  install: string;
  sources: SourceSnapshot;
  inputs: SourceSnapshot;
  /** time of the last full deploy (the baseline compile is paid only from the second deploy on) */
  last_full?: number;
}

/**
 * Everything except .ets/.ts that changes what the app is: resources, manifests, dependencies, native
 * code. Content-based like the source snapshot (an edit that is reverted is no change); hashes are
 * reused while mtime, ctime and size match, so only touched files are read.
 */
export function inputsSnapshot(root: string, previous: SourceSnapshot = {}): SourceSnapshot {
  const skip = new Set(["node_modules", "oh_modules", "build", ".hvigor", ".git", ".idea", ".preview", ".arkpilot", ".local", ".scratch", ".agents", ".codex"]);
  const base = path.resolve(root);
  const out: SourceSnapshot = {};
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      const rel = path.relative(base, full).replaceAll("\\", "/");
      // Only the source snapshot's patchable files and SDK-generated profiles are excluded.
      if (trackedSource(rel) && /\/src\/main\/ets\//.test(rel) || e.name === "BuildProfile.ets") continue;
      if (!e.isFile()) throw new Error(`Cannot prove build inputs for non-regular file: ${full}`);
      {
        const st = fs.statSync(full);
        const s = `${st.mtimeMs},${st.ctimeMs}:${st.size}`;
        const prev = previous[rel];
        if (prev?.startsWith(`${s}:`)) out[rel] = prev;
        else {
          const hash = crypto.createHash("sha1"), buffer = Buffer.allocUnsafe(64 * 1024), fd = fs.openSync(full, "r");
          try { for (let n; (n = fs.readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, n)); }
          finally { fs.closeSync(fd); }
          out[rel] = `${s}:${hash.digest("hex").slice(0, 16)}`;
        }
      }
    }
  }
  return out;
}

/** Inputs whose content changed, appeared or disappeared. Pure. */
export function changedInputs(previous: SourceSnapshot, current: SourceSnapshot) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys].filter((k) => previous[k]?.split(":")[2] !== current[k]?.split(":")[2]).sort();
}

export type HotDecision = { hot: true; files: string[] } | { hot: false; reason: string; unchanged?: boolean };

/** Decide whether a quick fix is equivalent to a redeploy. Pure (given the snapshots). */
export function decideHot(state: HotState | undefined, now: { product: string; module: string; moduleTarget: string; modules: HotState["modules"]; target: string; install?: string; running: boolean; sources: SourceSnapshot; inputs: SourceSnapshot; moduleRel: string }): HotDecision {
  if (!state || !state.install || typeof state.inputs !== "object" || !Array.isArray(state.modules) || !state.modules.length)
    return { hot: false, reason: "no quick-fix baseline yet (recorded from the second deploy on)" };
  if (state.product !== now.product || state.module !== now.module || state.moduleTarget !== now.moduleTarget)
    return { hot: false, reason: "build product, module or module target changed" };
  const selection = (modules: HotState["modules"]) => JSON.stringify(modules.map((m) => [m.name, m.target] as const).sort(([a, at], [b, bt]) => a.localeCompare(b) || at.localeCompare(bt)));
  if (selection(state.modules) !== selection(now.modules)) return { hot: false, reason: "build module selection or module target changed" };
  const inputs = changedInputs(state.inputs, now.inputs);
  // Nothing changed and the same copy is running: relaunching it is all a deploy would achieve.
  if (state.target === now.target && now.install === state.install && !inputs.length && !diffSources(state.sources, now.sources).length
    && Object.keys(state.sources).length === Object.keys(now.sources).length) return { hot: false, reason: "unchanged", unchanged: true };
  if (state.target !== now.target) return { hot: false, reason: "baseline belongs to another device" };
  if (!now.install || state.install !== now.install) return { hot: false, reason: "the app was reinstalled since the baseline" };
  if (!now.running) return { hot: false, reason: "the app is not running" };
  if (inputs.length) return { hot: false, reason: `resources, manifests or dependencies changed (${inputs.slice(0, 2).join(", ")})` };
  const added = Object.keys(now.sources).filter((f) => !state.sources[f]);
  const removed = Object.keys(state.sources).filter((f) => !now.sources[f]);
  if (added.length || removed.length) return { hot: false, reason: `files were ${added.length ? "added" : "deleted"}: ${[...added, ...removed].slice(0, 3).join(", ")}` };
  const changed = diffSources(state.sources, now.sources);
  if (!changed.length) return { hot: false, reason: "no source changes since the baseline" };
  const prefix = `${now.moduleRel.replace(/\/$/, "")}/src/main/ets/`;
  const outside = changed.filter((f) => !f.startsWith(prefix));
  if (outside.length) return { hot: false, reason: `changes outside module ${state.module} (e.g. ${outside[0]}) cannot be quick-fixed` };
  return { hot: true, files: changed };
}

export function stateFile(stateDir: string, project: string, target: string) {
  const id = crypto.createHash("sha256").update(`${path.resolve(project)}|${target}`).digest("hex").slice(0, 16);
  return path.join(stateDir, "hotpath", `${id}.json`);
}
export function readState(file: string): HotState | undefined {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as HotState; } catch { return undefined; }
}
export async function writeState(file: string, state: HotState) {
  await storageGuard((db) => {
    const release = pinStorage(db, file);
    try { atomicWrite(file, JSON.stringify(state)); } finally { release(); }
  });
}
export function currentSources(root: string, previous?: SourceSnapshot) {
  return snapshotSources(root, previous);
}
