import fs from "node:fs";
import path from "node:path";

/*
 * Point errors at the project's own source: crash stacks, hilog errors and compiler diagnostics
 * name files in several shapes, e.g.
 *   at onClick (entry/src/main/ets/pages/Index.ets:25:13)
 *   at anonymous (entry|entry|1.0.0|src/main/ets/pages/Index.ts:25:13)        (release bundle path)
 *   at f (@normalized:N&&&entry/src/main/ets/pages/Index&1.0.0:25:13)          (normalized OHM url)
 *   /abs/project/features/Toolbox/src/main/ets/x/Page.ets:12:5                   (compiler)
 * Each is reduced to (module, path inside the module, line, column) and resolved against the
 * project's modules. Stacks of compiled .ets report ".ts": both extensions are tried.
 */

export interface SourceRef { raw: string; module?: string; rel: string; line: number; column?: number }
export interface ResolvedRef { file: string; line: number; column?: number; snippet: string[] }

/** A path-ish token followed by :line[:col]. Tokens stop at whitespace, parentheses, quotes and commas. */
const LOC = /([^\s()"'`,]+?):(\d+)(?::(\d+))?(?=[\s)"'`,]|$)/gm;

/** All source locations mentioned in a text (deduplicated, in order). Pure. */
export function parseSourceRefs(text: string, limit = 20): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LOC)) {
    let p = m[1]!.replaceAll("\\", "/").replace(/^(File|at|in):?/i, "");
    // OHM url: @normalized:N&<bundle>&<module>/src/main/ets/pages/Index&1.0.0  or  @bundle:<bundle>/<module>/ets/...
    // N&<module-or-empty>&<bundle-or-empty>&<path>&<version>: keep only the path.
    p = p.replace(/^.*@normalized:[^&]*&[^&]*&[^&]*&/, "").replace(/^.*@bundle:[^/]+\//, "").replace(/&[\d.]+$/, "");
    if (!/(\.(ets|ts)$)|(\/ets\/)|(^[^|]+\|[^|]*\|[^|]*\|)/.test(p)) continue;
    // Release bundle path: entry|entry|1.0.0|src/main/ets/pages/Index.ts
    let module: string | undefined;
    const bar = /^([^|]+)\|[^|]*\|[^|]*\|(.+)$/.exec(p);
    if (bar) { module = bar[1]; p = `${bar[1]}/${bar[2]}`; }
    if (!/\.(ets|ts)$/.test(p)) p += ".ets";
    if (/(^|\/)(node_modules|oh_modules)\//.test(p) || /^(\/system|@ohos|ohos\.)/.test(p)) continue;
    const line = Number(m[2]), column = m[3] ? Number(m[3]) : undefined;
    if (!line) continue;
    const key = `${p}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: m[0], ...(module ? { module } : {}), rel: p, line, ...(column !== undefined ? { column } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Resolve a reference to a file of the project. Tries, in order: an absolute path inside the project,
 * a path relative to the project root, then "<module>/<rest>" against each module's root (the stack
 * names the module, not its folder: features/Toolbox is module "Toolbox"), and finally a suffix match
 * on "src/main/ets/...". Returns undefined for system/SDK frames.
 */
export function resolveRef(ref: SourceRef, project: { root: string; modules: { name: string; root: string }[] }): string | undefined {
  const exts = (p: string) => (p.endsWith(".ts") ? [p.replace(/\.ts$/, ".ets"), p] : [p, p.replace(/\.ets$/, ".ts")]);
  const exists = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const root = path.resolve(project.root);
  const inside = (p: string) => !path.relative(root, p).startsWith("..") && !path.isAbsolute(path.relative(root, p));
  const candidates: string[] = [];
  if (path.isAbsolute(ref.rel)) candidates.push(...exts(ref.rel));
  candidates.push(...exts(path.join(root, ref.rel)));
  const [first, ...rest] = ref.rel.split("/");
  for (const m of project.modules) {
    if (m.name === (ref.module ?? first)) candidates.push(...exts(path.join(m.root, (ref.module ? ref.rel.slice(ref.module.length + 1) : rest.join("/")))));
  }
  const tail = /src\/main\/ets\/.+$/.exec(ref.rel)?.[0] ?? /(?:^|\/)ets\/(.+)$/.exec(ref.rel)?.[1];
  if (tail) for (const m of project.modules) candidates.push(...exts(path.join(m.root, tail.startsWith("src/") ? tail : `src/main/ets/${tail}`)));
  return candidates.find((c) => inside(c) && exists(c));
}

/** Lines around `line` (1-based), each prefixed with its number; the error line is marked with ">". */
export function snippet(file: string, line: number, context = 3): string[] {
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { return []; }
  const from = Math.max(1, line - context), to = Math.min(lines.length, line + context);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${n === line ? ">" : " "}${String(n).padStart(5)} | ${lines[n - 1]!.slice(0, 200)}`);
  return out;
}

/** Parse + resolve + snippet: the project's own frames only, at most `limit`. Never throws. */
export function locate(text: string, project: { root: string; modules: { name: string; root: string }[] } | undefined, limit = 3): ResolvedRef[] {
  if (!project || !text) return [];
  try {
    const out: ResolvedRef[] = [];
    for (const ref of parseSourceRefs(text, 40)) {
      const file = resolveRef(ref, project);
      if (!file) continue;
      out.push({ file: path.relative(project.root, file).replaceAll("\\", "/"), line: ref.line, ...(ref.column !== undefined ? { column: ref.column } : {}), snippet: snippet(file, ref.line) });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
