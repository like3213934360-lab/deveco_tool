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
export interface ResolvedRef { file: string; line: number; column?: number; snippet: string[]; mapped_from?: string; stale?: string }

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

/* ------------------------- compiled -> .ets (source maps) ------------------------- */

/*
 * Runtime stacks name the COMPILED file (".../Index.ts:72:41", verified: an exception thrown on .ets
 * line 61 was reported at Index.ts:72:41). hvigor writes a standard v3 source map per compiled file
 * into <module>/build/<product>/intermediates/loader_out/<target>/ets/sourceMaps.map, keyed exactly
 * like the frame ("phone|phone|1.0.0|src/main/ets/pages/Index.ts"). Decoding it gives the .ets line.
 */

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));
function vlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0, shift = 0;
  for (const ch of segment) {
    const digit = B64[ch];
    if (digit === undefined) return out;
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0; shift = 0;
  }
  return out;
}

/**
 * Original position for a 1-based generated line/column using a v3 `mappings` string. Picks the last
 * segment at or before the column on that line (the standard lookup). Pure.
 */
export function mapPosition(map: { sources: string[]; mappings: string }, line: number, column = 1) {
  // Source index, original line and column are deltas across the whole mapping; the generated column
  // resets on every line.
  let source = 0, origLine = 0, origCol = 0;
  const lines = map.mappings.split(";");
  let best: { source: number; line: number; column: number } | undefined;
  let first: typeof best;
  for (let l = 0; l < lines.length && l < line; l++) {
    let genCol = 0;
    for (const seg of lines[l]!.split(",")) {
      if (!seg) continue;
      const v = vlq(seg);
      genCol += v[0] ?? 0;
      if (v.length < 4) continue;
      source += v[1]!; origLine += v[2]!; origCol += v[3]!;
      if (l !== line - 1) continue;
      const here = { source, line: origLine + 1, column: origCol + 1 };
      first ??= here;
      if (genCol <= column - 1) best = here;
    }
  }
  // No segment at/before the column: the line's first mapped segment is the closest statement.
  const hit = best ?? first;
  return hit && map.sources[hit.source] !== undefined ? { source: map.sources[hit.source]!, line: hit.line, column: hit.column } : undefined;
}

const mapCache = new Map<string, { mtime: number; maps: Record<string, { sources: string[]; mappings: string }> }>();
function loadMaps(file: string) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = mapCache.get(file);
    if (hit && hit.mtime === mtime) return hit.maps;
    const maps = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { sources: string[]; mappings: string }>;
    mapCache.set(file, { mtime, maps });
    if (mapCache.size > 8) mapCache.delete(mapCache.keys().next().value!);
    return maps;
  } catch { return undefined; }
}

/** Every sourceMaps.map of the project's entry/feature modules (newest build output). */
function projectSourceMaps(project: { root: string; modules: { name: string; root: string }[] }) {
  const out: string[] = [];
  for (const m of project.modules) {
    const build = path.join(m.root, "build");
    let products: string[] = [];
    try { products = fs.readdirSync(build); } catch { continue; }
    for (const product of products) {
      const base = path.join(build, product, "intermediates", "loader_out");
      let targets: string[] = [];
      try { targets = fs.readdirSync(base); } catch { continue; }
      for (const t of targets) { const f = path.join(base, t, "ets", "sourceMaps.map"); if (fs.existsSync(f)) out.push(f); }
    }
  }
  return out;
}

/**
 * Map a compiled-file frame back to its .ets source via the build's source maps. Returns undefined
 * when no map has the file (then the frame is used as written). Never throws.
 */
export function mapFrame(ref: SourceRef, project: { root: string; modules: { name: string; root: string }[] }): SourceRef | undefined {
  if (!ref.module || !/\.ts$/.test(ref.rel)) return undefined;
  for (const file of projectSourceMaps(project)) {
    const maps = loadMaps(file);
    if (!maps) continue;
    const inner = ref.rel.slice(ref.module.length + 1);
    const key = Object.keys(maps).find((k) => k.startsWith(`${ref.module}|`) && k.endsWith(`|${inner}`));
    if (!key) continue;
    const pos = mapPosition(maps[key]!, ref.line, ref.column ?? 1);
    if (pos) return { raw: ref.raw, rel: pos.source.replaceAll("\\", "/"), line: pos.line, column: pos.column };
  }
  return undefined;
}

function sourceNewerThanMaps(file: string, project: { root: string; modules: { name: string; root: string }[] }) {
  try {
    const src = fs.statSync(file).mtimeMs;
    return projectSourceMaps(project).every((m) => fs.statSync(m).mtimeMs < src);
  } catch { return false; }
}

/** Parse + resolve + snippet: the project's own frames only, at most `limit`. Never throws. */
export function locate(text: string, project: { root: string; modules: { name: string; root: string }[] } | undefined, limit = 3): ResolvedRef[] {
  if (!project || !text) return [];
  try {
    const out: ResolvedRef[] = [];
    const seen = new Set<string>();
    for (const parsed of parseSourceRefs(text, 40)) {
      // Release-bundle frames point into compiled .ts: translate through the build's source map.
      const mapped = mapFrame(parsed, project);
      const ref = mapped ?? parsed;
      const file = resolveRef(ref, project);
      if (!file) continue;
      const rel = path.relative(project.root, file).replaceAll("\\", "/");
      if (seen.has(`${rel}:${ref.line}`)) continue;
      seen.add(`${rel}:${ref.line}`);
      out.push({ file: rel, line: ref.line, ...(ref.column !== undefined ? { column: ref.column } : {}), snippet: snippet(file, ref.line), ...(mapped ? { mapped_from: `${parsed.rel}:${parsed.line}:${parsed.column ?? 0}` } : {}),
        ...(mapped && sourceNewerThanMaps(file, project) ? { stale: "the source changed after the build that produced this stack: the line may have moved" } : {}) });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
