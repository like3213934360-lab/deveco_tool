import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { config, packageRoot, stateDir } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import { run } from "../core/proc.js";

/*
 * Knowledge pack layout (directory):
 *   manifest.json  { schema: 1, version, sdk_api_range, sources, created_at, docs_sha256 }
 *   index.db       FTS5: documents / segments / segments_fts (+ kind column), vocab table
 *   docs.zip       original markdown documents
 *
 * Resolution order: <state>/kb/current.json -> bundled package (optionalDependency) -> none.
 * Updates download a tarball, verify sha512 integrity, extract to a temp dir,
 * validate the manifest schema and switch current.json atomically.
 */

export const KB_SCHEMA = 1;
export interface Manifest {
  schema: number;
  version: string;
  sdk_api_range?: [number, number];
  sources: Record<string, unknown>;
  created_at: string;
  docs_sha256?: string;
  counts?: Record<string, number>;
}

export const catalogs = ["harmonyos-guides", "harmonyos-references", "best-practices", "harmonyos-faqs", "harmonyos-releases", "harmonyos-roadmap", "rules", "errors", "runtime", "skills"] as const;
export type Catalog = (typeof catalogs)[number];

let swept = false;
function kbRoot() {
  const dir = path.join(stateDir(), "kb");
  fs.mkdirSync(dir, { recursive: true });
  if (!swept) {
    // Remove leftovers of interrupted downloads/extractions (older than 1 hour).
    swept = true;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (Date.now() - fs.statSync(full).mtimeMs > 3600000) fs.rmSync(full, { recursive: true, force: true });
    }
  }
  return dir;
}

function readManifest(dir: string): Manifest | undefined {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    return manifest.schema === KB_SCHEMA && fs.existsSync(path.join(dir, "index.db")) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function bundledDir(): string | undefined {
  const name = config().kb_package;
  try {
    const require = createRequire(path.join(packageRoot, "package.json"));
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    const local = path.join(packageRoot, "kb-dist", "current");
    return fs.existsSync(local) ? local : undefined;
  }
}

export function activePack(): { dir: string; manifest: Manifest; origin: "updated" | "bundled" } | undefined {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(kbRoot(), "current.json"), "utf8")) as { version: string };
    const dir = path.join(kbRoot(), current.version);
    const manifest = readManifest(dir);
    if (manifest) return { dir, manifest, origin: "updated" };
  } catch { /* fall through */ }
  const bundled = bundledDir();
  const manifest = bundled ? readManifest(bundled) : undefined;
  return bundled && manifest ? { dir: bundled, manifest, origin: "bundled" } : undefined;
}

/* --------------------------------- search --------------------------------- */

let opened: { dir: string; db: DatabaseSync; vocab?: Set<string> } | undefined;

async function db() {
  const pack = activePack();
  invariant(pack, "KB_MISSING", "No knowledge pack is installed", undefined, "Run knowledge action=update to download one");
  if (opened?.dir === pack.dir) return { ...opened, pack };
  opened?.db.close();
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path.join(pack.dir, "index.db"), { readOnly: true });
  opened = { dir: pack.dir, db: database };
  return { ...opened, pack };
}
export function closeKnowledge() {
  opened?.db.close();
  opened = undefined;
  void zipIndex?.index.then((z) => z.zip.close()).catch(() => {});
  zipIndex = undefined;
}

/**
 * Query tokenization without a runtime segmenter: the index was built with jieba,
 * so Chinese runs are split by forward maximum matching against the index vocabulary.
 */
function vocabulary(database: DatabaseSync, holder: { vocab?: Set<string> }) {
  if (holder.vocab) return holder.vocab;
  const rows = database.prepare("SELECT term FROM vocab").all() as { term: string }[];
  holder.vocab = new Set(rows.map((r) => r.term));
  return holder.vocab;
}

/** Question words and particles that carry no search signal (upstream uses a similar stopword list). */
const stopwords = new Set(["如何", "怎么", "怎样", "什么", "为什么", "哪些", "是否", "可以", "能否", "和", "与", "及", "或", "的", "了", "吗", "呢", "在", "中", "使用", "进行", "实现", "区别", "问题", "方法", "一个", "请问", "有没有",
  "how", "to", "the", "a", "an", "of", "in", "and", "or", "is", "what", "why", "use", "using", "with"]);

export function tokenize(query: string, vocab: Set<string>): string[] {
  return tokenizeRaw(query, vocab).filter((t) => !stopwords.has(t));
}

function tokenizeRaw(query: string, vocab: Set<string>): string[] {
  const tokens: string[] = [];
  for (const part of query.split(/[\s,，。；;:：、()（）"“”'‘’!?！？]+/).filter(Boolean)) {
    if (/^[\x00-\x7f]+$/.test(part)) {
      for (const t of part.split(/[^A-Za-z0-9_@$.]+/).filter(Boolean)) {
        tokens.push(t.toLowerCase());
        // "router.pushUrl" also matches "pushurl"
        if (t.includes(".")) tokens.push(...t.split(".").filter((x) => x.length > 1).map((x) => x.toLowerCase()));
      }
      continue;
    }
    // Mixed / CJK: forward maximum matching (max 8 chars), fall back to bigrams.
    let i = 0;
    const chars = [...part];
    while (i < chars.length) {
      if (/[A-Za-z0-9_@]/.test(chars[i]!)) {
        let j = i;
        while (j < chars.length && /[A-Za-z0-9_@.]/.test(chars[j]!)) j++;
        tokens.push(chars.slice(i, j).join("").toLowerCase());
        i = j;
        continue;
      }
      let matched = 0;
      for (let len = Math.min(8, chars.length - i); len >= 2; len--) {
        const word = chars.slice(i, i + len).join("");
        if (vocab.has(word)) { tokens.push(word); matched = len; break; }
      }
      if (!matched) {
        if (i + 1 < chars.length && /\p{Script=Han}/u.test(chars[i + 1]!)) tokens.push(chars.slice(i, i + 2).join(""));
        else tokens.push(chars[i]!);
        matched = 1;
      }
      i += matched;
    }
  }
  return [...new Set(tokens.filter((t) => t.length > 0))].slice(0, 16);
}

export async function search(query: string, options: { catalog?: Catalog | "all"; kind?: "docs" | "rules" | "all"; limit?: number; offset?: number } = {}) {
  const trimmed = query.trim();
  invariant(trimmed, "INVALID_INPUT", "query must not be empty");
  const handle = await db();
  const vocab = vocabulary(handle.db, handle);
  let tokens = tokenize(trimmed, vocab);
  if (!tokens.length) tokens = tokenizeRaw(trimmed, vocab);
  invariant(tokens.length, "INVALID_INPUT", "query has no searchable terms");
  const limit = Math.min(options.limit ?? 8, 30);
  const offset = options.offset ?? 0;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
  const catalogId = options.catalog && options.catalog !== "all" ? catalogs.indexOf(options.catalog) : null;
  const kindFilter = options.kind === "docs" ? "d.catalog_id < 6" : options.kind === "rules" ? "d.catalog_id >= 6" : "1";
  const sql = `
    SELECT d.document_id AS id, d.doc_title AS title, d.catalog_id AS catalog, s.section_title AS section,
           snippet(segments_fts, 0, '[', ']', '…', 24) AS snippet, bm25(segments_fts) AS score
    FROM segments_fts JOIN segments s ON s.id = segments_fts.rowid JOIN documents d ON d.id = s.doc_id
    WHERE segments_fts MATCH ? AND (? IS NULL OR d.catalog_id = ?) AND ${kindFilter}
    ORDER BY score LIMIT ?`;
  // AND first for precision; fall back to OR for recall.
  let rows = handle.db.prepare(sql).all(quoted.join(" AND "), catalogId, catalogId, 200) as { id: string; title: string; catalog: number; section: string; snippet: string; score: number }[];
  let mode = "all_terms";
  if (rows.length < 3 && quoted.length > 1) {
    rows = handle.db.prepare(sql).all(quoted.join(" OR "), catalogId, catalogId, 200) as typeof rows;
    mode = "any_term";
  }
  // Collapse segments to documents, boosting title hits (the upstream reranker's main signal).
  const q = trimmed.toLowerCase();
  const best = new Map<string, (typeof rows)[number] & { rank: number }>();
  for (const row of rows) {
    const title = row.title.toLowerCase();
    const boost = title.includes(q) ? 4 : tokens.every((t) => title.includes(t)) ? 1.8 : tokens.some((t) => t.length > 2 && title.includes(t)) ? 1.25 : 1;
    const rank = row.score * boost; // bm25 is negative: larger magnitude is better
    const prev = best.get(row.id);
    if (!prev || rank < prev.rank) best.set(row.id, { ...row, rank });
  }
  const ranked = [...best.values()].sort((a, b) => a.rank - b.rank);
  return {
    query: trimmed, tokens, match: mode, pack: handle.pack.manifest.version, total: ranked.length,
    results: ranked.slice(offset, offset + limit).map((r) => ({
      id: r.id, title: r.title, catalog: catalogs[r.catalog] ?? r.catalog, origin: r.catalog < 6 ? "official" : "rules", section: r.section || undefined, snippet: r.snippet.replace(/\s+/g, " ").slice(0, 300),
    })),
    next: ranked.length > offset + limit ? { offset: offset + limit } : null,
    pack_built: handle.pack.manifest.created_at,
    hint: ranked.length ? "Read a result with knowledge action=read id=<id>. For exact signatures and @since levels, the project SDK (code action=lsp op=hover) is authoritative." : "No match: try fewer or English API terms, or source=cloud",
  };
}

/* ---------------------------------- read ---------------------------------- */

export async function read(id: string, options: { offset?: number; limit?: number; section?: string } = {}) {
  const handle = await db();
  const doc = handle.db.prepare("SELECT id, document_id, doc_title, catalog_id FROM documents WHERE document_id = ?").get(id) as
    | { id: number; document_id: string; doc_title: string; catalog_id: number } | undefined;
  invariant(doc, "NOT_FOUND", `Document ${id} not found`, undefined, "Use an id returned by knowledge search");
  const text = await readZipEntry(path.join(handle.pack.dir, "docs.zip"), `${doc.document_id}.md`);
  let content = text;
  if (options.section) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(options.section!.toLowerCase()));
    if (start >= 0) {
      const level = /^(#+)/.exec(lines[start]!)![1]!.length;
      const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
      content = lines.slice(start, end < 0 ? undefined : end).join("\n");
    }
  }
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? 12000, 40000);
  const chunk = content.slice(offset, offset + limit);
  const headings = offset === 0 && content.length > limit ? text.split("\n").filter((l) => /^#{1,3}\s/.test(l)).map((l) => l.trim()).slice(0, 60) : undefined;
  return {
    id: doc.document_id, title: doc.doc_title, catalog: catalogs[doc.catalog_id] ?? doc.catalog_id,
    content: chunk, total_chars: content.length,
    next: offset + limit < content.length ? { offset: offset + limit } : null,
    ...(headings ? { outline: headings, hint: "Long document: pass section=<heading> to read one part" } : {}),
  };
}

/*
 * Docs archive access: the central directory is indexed once (name -> entry), the
 * zip file handle stays open, and each read inflates a single entry. Upstream
 * archives store UTF-8 names without the UTF-8 flag, so names are decoded manually.
 */
type ZipIndex = { zip: import("yauzl").ZipFile; entries: Map<string, import("yauzl").Entry> };
let zipIndex: { file: string; index: Promise<ZipIndex> } | undefined;

function openZipIndex(zipFile: string): Promise<ZipIndex> {
  return import("yauzl").then(({ default: yauzl }) => new Promise<ZipIndex>((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, autoClose: false, decodeStrings: false }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries = new Map<string, import("yauzl").Entry>();
      zip.on("entry", (entry: import("yauzl").Entry) => {
        const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as unknown as Buffer).toString("utf8") : String(entry.fileName);
        if (!name.endsWith("/")) entries.set(name, entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve({ zip, entries }));
      zip.on("error", reject);
      zip.readEntry();
    });
  }));
}

async function readZipEntry(zipFile: string, name: string): Promise<string> {
  if (zipIndex?.file !== zipFile) {
    void zipIndex?.index.then((z) => z.zip.close()).catch(() => {});
    zipIndex = { file: zipFile, index: openZipIndex(zipFile) };
  }
  const { zip, entries } = await zipIndex.index;
  const entry = entries.get(name);
  invariant(entry, "NOT_FOUND", `${name} missing from docs archive`);
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err);
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    });
  });
}

export async function catalog() {
  const handle = await db();
  const counts = handle.db.prepare("SELECT catalog_id, COUNT(*) AS n FROM documents GROUP BY catalog_id").all() as { catalog_id: number; n: number }[];
  return {
    pack: { version: handle.pack.manifest.version, origin: handle.pack.origin, sdk_api_range: handle.pack.manifest.sdk_api_range },
    catalogs: counts.map((c) => ({ name: catalogs[c.catalog_id] ?? String(c.catalog_id), documents: c.n })),
  };
}

/* --------------------------------- update --------------------------------- */

async function registryMeta(name: string) {
  const url = `${config().npm_registry.replace(/\/$/, "")}/${name.replace("/", "%2F")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: "application/vnd.npm.install-v1+json" } });
  invariant(response.ok, "HTTP_ERROR", `Registry returned ${response.status} for ${name}`, undefined, "Check network access or set npm_registry in the config");
  return (await response.json()) as { "dist-tags": Record<string, string>; versions: Record<string, { dist: { tarball: string; integrity: string }; kbSchema?: number }> };
}

export async function status(checkRemote = false) {
  const pack = activePack();
  const local = pack ? { version: pack.manifest.version, origin: pack.origin, created_at: pack.manifest.created_at, sdk_api_range: pack.manifest.sdk_api_range, counts: pack.manifest.counts } : null;
  if (!checkRemote) return { installed: local };
  try {
    const meta = await registryMeta(config().kb_package);
    const latest = meta["dist-tags"].latest;
    return { installed: local, latest, update_available: !!latest && latest !== local?.version };
  } catch (error) {
    return { installed: local, latest: null, remote_error: (error as Error).message };
  }
}

/**
 * Download a pack from npm (or a URL/local tarball), verify integrity, extract and
 * switch atomically. Keeps the previous version for rollback.
 */
export async function update(options: { version?: string; source?: string; force?: boolean }, signal: AbortSignal) {
  const root = kbRoot();
  let tarball: string;
  let integrity: string | undefined;
  let version = options.version;
  if (options.source && fs.existsSync(options.source)) {
    tarball = path.resolve(options.source);
  } else if (options.source === "upstream") {
    // Build a pack locally from Huawei's docs package (useful before our pack is published, or to get newer docs first).
    const meta = await registryMeta(config().kb_upstream_package);
    const latest = meta["dist-tags"].latest!;
    const entry = meta.versions[latest]!;
    const dir = path.join(root, `.upstream-${crypto.randomBytes(4).toString("hex")}`);
    fs.mkdirSync(dir);
    try {
      const file = path.join(dir, "upstream.tgz");
      const response = await fetch(entry.dist.tarball, { signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]) });
      invariant(response.ok && response.body, "HTTP_ERROR", `Upstream download failed with HTTP ${response.status}`);
      const out = fs.createWriteStream(file);
      const hash = crypto.createHash("sha512");
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { hash.update(chunk); out.write(chunk); }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
      invariant(`sha512-${hash.digest("base64")}` === entry.dist.integrity, "INTEGRITY_FAILED", "Upstream docs package failed integrity verification");
      await run({ file: "tar", args: ["-xzf", file, "-C", dir] }, { signal, timeoutMs: 600000 });
      const { buildKnowledgePack } = await import("./kb-build.js");
      const built = await buildKnowledgePack({ upstream: path.join(dir, "package"), out: path.join(dir, "out") });
      return await update({ source: built.tarball }, signal);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else {
    let url = options.source;
    if (!url) {
      const meta = await registryMeta(config().kb_package);
      version ??= meta["dist-tags"].latest;
      const entry = version ? meta.versions[version] : undefined;
      invariant(entry, "NOT_FOUND", `Knowledge pack version ${version} not found`, { available: Object.keys(meta.versions).slice(-10) });
      invariant((entry.kbSchema ?? KB_SCHEMA) === KB_SCHEMA, "INVALID_INPUT", `Pack ${version} needs schema ${entry.kbSchema}; update deveco-mcp`);
      url = entry.dist.tarball;
      integrity = entry.dist.integrity;
      const current = activePack();
      if (!options.force && current?.manifest.version === version) return { updated: false, version, reason: "already installed" };
    }
    tarball = path.join(root, `.download-${crypto.randomBytes(4).toString("hex")}.tgz`);
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]) });
    invariant(response.ok && response.body, "HTTP_ERROR", `Download failed with HTTP ${response.status}`);
    const out = fs.createWriteStream(tarball);
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) out.write(chunk);
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  }
  try {
    if (integrity) {
      const [algo, expected] = [integrity.slice(0, integrity.indexOf("-")), integrity.slice(integrity.indexOf("-") + 1)];
      const hash = crypto.createHash(algo);
      for await (const chunk of fs.createReadStream(tarball)) hash.update(chunk as Buffer);
      invariant(hash.digest("base64") === expected, "INTEGRITY_FAILED", "Downloaded knowledge pack failed integrity verification");
    }
    const temp = path.join(root, `.tmp-${crypto.randomBytes(4).toString("hex")}`);
    fs.mkdirSync(temp);
    try {
      const extracted0 = await run({ file: "tar", args: ["-xzf", tarball, "-C", temp] }, { signal, timeoutMs: 600000, allowFailure: true });
      invariant(extracted0.code === 0, "INVALID_INPUT", "Not a knowledge pack archive (.tgz expected)", { tail: extracted0.stderr.slice(-300) });
      const extracted = fs.existsSync(path.join(temp, "package")) ? path.join(temp, "package") : temp;
      const manifest = readManifest(extracted);
      invariant(manifest, "INVALID_INPUT", `Archive is not a schema ${KB_SCHEMA} knowledge pack (manifest.json + index.db required)`);
      const destination = path.join(root, manifest.version);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(extracted, destination);
      const previous = activePack();
      const pointer = path.join(root, "current.json");
      fs.writeFileSync(`${pointer}.tmp`, JSON.stringify({ version: manifest.version, previous: previous?.origin === "updated" ? previous.manifest.version : null, at: new Date().toISOString() }));
      fs.renameSync(`${pointer}.tmp`, pointer);
      closeKnowledge();
      prune(root, [manifest.version, previous?.origin === "updated" ? previous.manifest.version : ""]);
      return { updated: true, version: manifest.version, previous: previous ? `${previous.manifest.version} (${previous.origin})` : null, counts: manifest.counts };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } finally {
    if (tarball.includes(".download-")) fs.rmSync(tarball, { force: true });
  }
}

export function rollback() {
  const root = kbRoot();
  const pointer = path.join(root, "current.json");
  invariant(fs.existsSync(pointer), "NOT_FOUND", "No updated pack to roll back from");
  const current = JSON.parse(fs.readFileSync(pointer, "utf8")) as { version: string; previous: string | null };
  if (current.previous && readManifest(path.join(root, current.previous))) {
    fs.writeFileSync(pointer, JSON.stringify({ version: current.previous, previous: null, at: new Date().toISOString() }));
  } else fs.rmSync(pointer);
  closeKnowledge();
  const active = activePack();
  return { rolled_back_to: active ? `${active.manifest.version} (${active.origin})` : "none" };
}

function prune(root: string, keep: string[]) {
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith(".") || entry === "current.json" || keep.includes(entry)) continue;
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

/* ---------------------------------- cloud ---------------------------------- */

export async function cloudSearch(query: string, signal: AbortSignal) {
  const { credentials } = await import("./auth.js");
  let data: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await credentials("codegenie", attempt > 0, signal);
    const response = await fetch("https://cn.devecostudio.huawei.com/codeGenie/bigSearch", {
      method: "POST", headers: { Authorization: auth.access, "Content-Type": "application/json" },
      body: JSON.stringify({ question: query }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    invariant(response.ok, "HTTP_ERROR", `Cloud knowledge returned HTTP ${response.status}`);
    data = await response.json();
    if (data?.error_code !== 4016) break;
  }
  const prompt: string | undefined = data?.body?.answer?.prompt;
  invariant(data?.code === 200 && typeof prompt === "string", "HTTP_ERROR", "Cloud knowledge returned no answer");
  const marker = "【检索信息】：";
  const content = prompt.includes(marker) ? prompt.slice(prompt.indexOf(marker) + marker.length) : prompt;
  const localTitles = await officialTitleIndex().catch(() => undefined);
  const labelled = labelCloudSources(content, localTitles, query);
  const packed = packCloudSections(labelled.sections, 16000);
  return {
    source: "cloud",
    authority: AUTHORITY,
    // Official sections first; community sections are shortened. Every section is still listed here.
    counts: { official: labelled.sources.filter((s) => s.origin === "official").length, community: labelled.sources.filter((s) => s.origin === "community").length },
    sources: labelled.sources.slice(0, 40).map(({ why: _why, ...s }) => ({ ...s, title: s.title.slice(0, 80), shown: packed.shown.has(s.n) ? (packed.clipped.has(s.n) ? "excerpt" : "full") : "omitted" })),
    content: packed.content,
    truncated: packed.omitted > 0 || packed.clipped.size > 0,
    ...(packed.omitted ? { hint: `${packed.omitted} lower-priority section(s) omitted; official ones with local_doc can be read in full with knowledge action=read id=<local_doc>` } : {}),
  };
}

/**
 * Fit labelled sections into `budget` characters: official sections first (in CodeGenie's order,
 * each up to 4000 chars), then community sections (up to 800 chars each). CodeGenie returns
 * dozens of sections; taking the first N characters used to show mostly blog posts.
 */
export function packCloudSections(sections: { n: number; origin: "official" | "community"; text: string; doc?: string }[], budget: number) {
  const shown = new Set<number>(), clipped = new Set<number>();
  const out: string[] = [];
  let used = 0;
  const ordered = [...sections.filter((s) => s.origin === "official"), ...sections.filter((s) => s.origin === "community")];
  const seenDocs = new Set<string>();
  // Room for a short excerpt of every official page before any gets its full share, and a few
  // community excerpts (flagged, as leads only) after them.
  const officialCount = ordered.filter((s) => s.origin === "official").length;
  const officialCap = Math.max(1200, Math.min(3000, Math.floor((budget * 0.85) / Math.max(1, officialCount))));
  for (const s of ordered) {
    // CodeGenie often returns the same official page several times; show it once.
    if (s.doc) { if (seenDocs.has(s.doc)) continue; seenDocs.add(s.doc); }
    const cap = s.origin === "official" ? officialCap : 600;
    const room = budget - used;
    if (room < 300) break;
    const max = Math.min(cap, room);
    const text = s.text.length > max ? `${s.text.slice(0, max)}…\n` : s.text;
    if (s.text.length > max) clipped.add(s.n);
    shown.add(s.n);
    out.push(text);
    used += text.length;
  }
  return { content: out.join(""), shown, clipped, omitted: sections.length - shown.size };
}

/* ------------------------------ source authority ------------------------------ */

/** Precedence when sources disagree (shown to agents with cloud answers and in tool docs). */
export const AUTHORITY = "When sources disagree: 1) the project's SDK declarations (code action=lsp op=hover/definition) and a successful build win; "
  + "2) official docs: local pack results and cloud sections marked official (prefer the one matching the project's API level; read the local copy via local_doc); "
  + "3) cloud sections marked community are blog posts: never use them as the API contract, only as hints to verify.";

/** Official doc titles of the local pack -> document ids (for recognising official cloud sections). */
async function officialTitleIndex() {
  const handle = await db();
  const rows = handle.db.prepare("SELECT document_id, doc_title FROM documents WHERE catalog_id < 6").all() as { document_id: string; doc_title: string }[];
  const index = new Map<string, string[]>();
  for (const r of rows) {
    const key = normTitle(r.doc_title);
    const list = index.get(key);
    if (list) list.push(r.document_id); else index.set(key, [r.document_id]);
  }
  return index;
}
const normTitle = (t: string) => t.replace(/\s+/g, "").toLowerCase();

export interface CloudSource { n: number; title: string; origin: "official" | "community"; local_doc?: string; why: string }

/**
 * CodeGenie returns numbered sections "[n]网页标题：T|||网页时间：|||网页分类：|||网页内容：..." that mix Huawei's
 * official docs with community blog posts, without saying which is which. Label each one:
 * - official: the title is an official doc title in the local pack (also after dropping a "Kit/服务-" prefix),
 *   or the text is an official doc page (starts with "# <title>") or a Huawei Codelab;
 * - community: everything else (articles, tutorials, notes).
 * Each section header in the text gets the label so the agent sees it inline.
 */
export function labelCloudSources(content: string, titles: Map<string, string[]> | undefined, query = "") {
  const sources: CloudSource[] = [];
  const sections: { n: number; origin: CloudSource["origin"]; text: string; doc?: string }[] = [];
  const header = /^\[(\d+)\]网页标题：(.*?)\|\|\|网页时间：(.*?)\|\|\|网页分类：(.*?)\|\|\|网页内容：/;
  const parts = content.split(/(?=^\[\d+\]网页标题：)/m);
  const out = parts.map((part) => {
    const m = header.exec(part);
    if (!m) return part;
    const [, n, rawTitle] = m;
    const title = rawTitle!.trim();
    const body = part.slice(m[0].length);
    const candidates = [title, title.replace(/^[\w\s]*?(Kit|服务|Service)\s*[-－:：]?\s*/i, ""), title.replace(/^.*?[-－]/, "")];
    let local: string[] | undefined;
    for (const c of candidates) if (!local && c && titles?.has(normTitle(c))) local = titles.get(normTitle(c));
    const page = new RegExp(`^\\s*#\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(body.slice(0, 200));
    const codelab = /Codelab/i.test(body.slice(0, 400));
    const origin: CloudSource["origin"] = local || page || codelab ? "official" : "community";
    const why = local ? "title matches an official doc in the local pack" : page ? "official doc page format" : codelab ? "Huawei Codelab" : "not an official doc title (article/tutorial)";
    // Several official docs can share a title ("使用入门", "基于服务账号生成鉴权令牌"): pick the one whose
    // path shares the most words with the query and the section title (e.g. "Push" -> Push_Kit_推送服务).
    const terms = `${query} ${title}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const score = (id: string) => terms.reduce((n, t) => n + (id.toLowerCase().includes(t) ? 1 : 0), 0);
    const doc = local && (local.length === 1 ? local[0] : [...local].sort((x, y) => score(y) - score(x))[0]);
    sources.push({ n: Number(n), title, origin, ...(doc ? { local_doc: doc } : {}), why });
    const label = origin === "official" ? "官方文档/official" : "社区文章/community — 未核实，不能作为 API 依据";
    const text = part.replace(header, `[${n}]【${label}】网页标题：${title}|||网页内容：`);
    sections.push({ n: Number(n), origin, text, ...(doc ? { doc } : {}) });
    return text;
  });
  return { sources, sections, content: out.join("") };
}
