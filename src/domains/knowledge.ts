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

/**
 * Snippet from the document's original text (segments.lead_text), not from the tokenised index
 * text, which repeats case variants and splits words ("[client] [Client] [id] [ID]"). Centred on the
 * first query term found; falls back to the index snippet only when a segment has no lead text.
 */
export function readableSnippet(lead: string | undefined, indexSnippet: string, tokens: string[], max = 300) {
  const text = (lead ?? "").replace(/\s+/g, " ").trim();
  if (!text) return indexSnippet.replace(/\s+/g, " ").slice(0, max);
  const lower = text.toLowerCase();
  const hit = tokens.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - 60, text.length - max));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + max)}${start + max < text.length ? "…" : ""}`;
}

/** Ids of the best-matching official documents for a text (no snippets; used to verify cloud sections). */
async function officialDocIds(text: string, limit = 4) {
  const handle = await db();
  const vocab = vocabulary(handle.db, handle);
  const tokens = tokenize(text, vocab).filter((t) => t.length > 1).slice(0, 8);
  if (!tokens.length) return [];
  const rows = handle.db.prepare(`
    SELECT d.document_id AS id FROM segments_fts JOIN segments s ON s.id = segments_fts.rowid JOIN documents d ON d.id = s.doc_id
    WHERE segments_fts MATCH ? AND d.catalog_id < 6 ORDER BY bm25(segments_fts) LIMIT 40`)
    .all(tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ")) as { id: string }[];
  return [...new Set(rows.map((r) => r.id))].slice(0, limit);
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
           s.lead_text AS lead, snippet(segments_fts, 0, '[', ']', '…', 24) AS snippet, bm25(segments_fts) AS score
    FROM segments_fts JOIN segments s ON s.id = segments_fts.rowid JOIN documents d ON d.id = s.doc_id
    WHERE segments_fts MATCH ? AND (? IS NULL OR d.catalog_id = ?) AND ${kindFilter}
    ORDER BY score LIMIT ?`;
  // AND first for precision; fall back to OR for recall.
  let rows = handle.db.prepare(sql).all(quoted.join(" AND "), catalogId, catalogId, 200) as { id: string; title: string; catalog: number; section: string; lead: string; snippet: string; score: number }[];
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
      id: r.id, title: r.title, catalog: catalogs[r.catalog] ?? r.catalog, origin: r.catalog < 6 ? "official" : "rules", section: r.section || undefined, snippet: readableSnippet(r.lead, r.snippet, tokens),
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
  const labelStart = Date.now();
  const lookup = await officialLookup().catch(() => undefined);
  const labelled = await labelCloudSources(content, lookup);
  const labelMs = Date.now() - labelStart;
  const packed = packCloudSections(labelled.sections, 12000);
  // Nothing is dropped: the complete labelled answer (every section, untruncated) is saved as an
  // artifact, and each source records the line where its section starts, so any section that is
  // shortened or not shown inline can be read in full with job action=read.
  const full = labelled.sections.map((x) => x.text.endsWith("\n") ? x.text : `${x.text}\n`).join("");
  const lines = new Map<number, number>();
  let line = 0;
  for (const x of labelled.sections) { lines.set(x.n, line); line += (x.text.endsWith("\n") ? x.text : `${x.text}\n`).split("\n").length - 1; }
  const { saveArtifact } = await import("../core/artifacts.js");
  const artifact = await saveArtifact(full);
  const incomplete = packed.omitted > 0 || packed.clipped.size > 0;
  return {
    source: "cloud",
    label_ms: labelMs,
    authority: AUTHORITY,
    counts: Object.fromEntries((["official", "official_other_platform", "community", "unverified"] as const).map((o) => [o, labelled.sources.filter((s) => s.origin === o).length])),
    // Every section CodeGenie returned: shown full / excerpt / omitted inline, and where to read it whole.
    sources: labelled.sources.map(({ why: _why, ...s }) => ({ ...s, title: s.title.slice(0, 60), shown: packed.shown.has(s.n) ? (packed.clipped.has(s.n) ? "excerpt" : "full") : "omitted", line: lines.get(s.n) })),
    content: packed.content,
    full_artifact: artifact.artifact_id,
    ...(incomplete ? { hint: `Inline content is prioritised (official first). The complete answer, every section untruncated, is in full_artifact: job action=read artifact_id=${artifact.artifact_id} line=<source.line> limit=80 (or grep=...). Official sections with local_doc can also be read locally with knowledge action=read id=<local_doc>.` } : {}),
  };
}

/**
 * Inline view within `budget` characters: official sections first (in CodeGenie's order, an even
 * share each), then short community excerpts. CodeGenie returns dozens of sections; taking the first
 * N characters used to show mostly blog posts. The full answer is always saved as an artifact.
 */
export function packCloudSections(sections: { n: number; origin: CloudOrigin; text: string; doc?: string }[], budget: number) {
  const shown = new Set<number>(), clipped = new Set<number>();
  const out: string[] = [];
  let used = 0;
  const rank: Record<CloudOrigin, number> = { official: 0, official_other_platform: 1, unverified: 2, community: 3 };
  const ordered = [...sections].sort((a, b) => rank[a.origin] - rank[b.origin]);
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
  + "cloud sections marked official_other_platform are official Huawei docs for Android/Java (HMS Core) or Cangjie: not ArkTS API; "
  + "3) cloud sections marked community or unverified: never use them as the API contract, only as hints to verify.";

/** Official doc titles of the local pack -> document ids. */
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

/**
 * Candidate official documents for a cloud section: docs with the same title (also without a
 * "Kit/服务-" prefix) plus the best full-text hits for two distinctive sentences of the body.
 */
async function officialLookup(): Promise<OfficialLookup> {
  const titles = await officialTitleIndex();
  const handle = await db();
  const cache = new Map<string, Set<string>>();
  // Indexed once per document (the same docs come back for many sections).
  const docText = async (id: string) => {
    if (!cache.has(id)) cache.set(id, windows(normText(await readZipEntry(path.join(handle.pack.dir, "docs.zip"), `${id}.md`).catch(() => ""))));
    return cache.get(id)!;
  };
  return async (title, body) => {
    const out: { id: string; text: Set<string> }[] = [];
    const seen = new Set<string>();
    const sh = shingles(body);
    let settled = false;
    const add = async (id: string) => {
      if (seen.has(id) || seen.size >= 16) return;
      seen.add(id);
      const text = await docText(id);
      out.push({ id, text });
      if (!settled && textOverlap(sh, text) >= 0.5) settled = true;
    };
    for (const c of [title, title.replace(/^[\w\s]*?(Kit|服务|Service)\s*[-－:：]?\s*/i, ""), title.replace(/^.*?[-－]/, "")])
      for (const id of (c && titles.get(normTitle(c))) || []) await add(id);
    // A same-title doc that already contains the section's text settles it; otherwise search by content.
    if (settled) return out;
    const sentences = body.replace(/[#*`>|]/g, " ").split(/[。！？\n]/).map((s) => s.trim()).filter((s) => s.length >= 16).sort((a, b) => b.length - a.length);
    for (const q of [title, ...sentences.slice(0, 2).map((s) => s.slice(0, 60))]) {
      for (const id of await officialDocIds(q).catch(() => [])) await add(id);
      if (settled) break;
    }
    return out;
  };
}

/**
 * official: the section's text is found in an official document of the local pack (verified by text
 *   overlap, not by title), or it is official HarmonyOS content the pack does not carry (Codelab);
 * official_other_platform: official Huawei text for another platform/language (HMS Core Android/Java,
 *   Cangjie) — authoritative for that platform, not for ArkTS;
 * community: articles/Q&A whose text is not in the official docs;
 * unverified: could not be decided (too short, or partial overlap).
 */
export type CloudOrigin = "official" | "official_other_platform" | "community" | "unverified";
export interface CloudSource { n: number; title: string; origin: CloudOrigin; local_doc?: string; overlap?: number; why: string }

/** Distinctive 12-character shingles of a text (markup and whitespace removed). */
export function shingles(text: string, n = 12, step = 6) {
  const t = text.replace(/[#*`>|\-[\]()\s]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i += step) out.add(t.slice(i, i + n));
  return out;
}
const normText = (t: string) => t.replace(/[#*`>|\-[\]()\s]/g, "");
/** Every 12-character window of a normalised text: O(1) membership instead of a substring scan. */
export function windows(normalised: string, n = 12) {
  const out = new Set<string>();
  for (let i = 0; i + n <= normalised.length; i++) out.add(normalised.slice(i, i + n));
  return out;
}
/** Share of `section` shingles that occur in `doc` (0..1). `doc` is raw text or a windows() set. */
export function textOverlap(section: Set<string>, doc: string | Set<string>) {
  if (!section.size) return 0;
  let hit = 0;
  if (typeof doc === "string") { const d = normText(doc); for (const s of section) if (d.includes(s)) hit++; }
  else for (const s of section) if (doc.has(s)) hit++;
  return hit / section.size;
}
const OTHER_PLATFORM = /AbilitySlice|HiLogLabel|\bEMUI\b|HMS Core（APK）|HMS Core\(APK\)|onNewToken|public class \w+ extends|```(java|kotlin)|```cangjie|import kit\.\w+\.\*|仓颉API/;

/** Finds official docs for a section: same-title docs plus docs matching a distinctive sentence (text: raw, or windows()). */
export type OfficialLookup = (title: string, body: string) => Promise<{ id: string; text: string | Set<string> }[]>;

/**
 * CodeGenie returns numbered sections "[n]网页标题：T|||网页时间：|||网页分类：|||网页内容：..." that mix Huawei's
 * official docs with community blog posts, without saying which is which. Titles cannot tell them
 * apart (community posts reuse official titles and republish official text; official pages have
 * generic titles), so each section is judged by its text: shared text with an official document of
 * the local pack (>= 50% of its 12-character shingles) makes it official, and that document becomes
 * local_doc; almost none (<= 10%) makes it community. Codelabs are official content the pack does not
 * carry. Everything else is left unverified rather than guessed. Measured on 679 real sections
 * (test/audit/cloud-labels.mjs).
 */
export async function labelCloudSources(content: string, lookup: OfficialLookup | undefined) {
  const sources: CloudSource[] = [];
  const sections: { n: number; origin: CloudOrigin; text: string; doc?: string }[] = [];
  const header = /^\[(\d+)\]网页标题：(.*?)\|\|\|网页时间：(.*?)\|\|\|网页分类：(.*?)\|\|\|网页内容：/;
  const parts = content.split(/(?=^\[\d+\]网页标题：)/m);
  // Candidate lookups are independent: resolve them up front, a few at a time.
  const bests = new Map<number, { id: string; overlap: number }>();
  if (lookup) {
    const jobs = parts.map((part, i) => ({ i, m: header.exec(part), part })).filter((j) => j.m);
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < jobs.length) {
        const { i, m, part } = jobs[next++]!;
        const body = part.slice(m![0].length);
        const sh = shingles(body);
        if (sh.size < 5) continue;
        for (const cand of await lookup(m![2]!.trim(), body).catch(() => [])) {
          const overlap = textOverlap(sh, cand.text);
          const prev = bests.get(i);
          if (!prev || overlap > prev.overlap) bests.set(i, { id: cand.id, overlap });
        }
      }
    }));
  }
  const out: string[] = [];
  for (const [i, part] of parts.entries()) {
    const m = header.exec(part);
    if (!m) { out.push(part); continue; }
    const [, n, rawTitle] = m;
    const title = rawTitle!.trim();
    const body = part.slice(m[0].length);
    const sh = shingles(body);
    const best = bests.get(i);
    const overlap = best ? Math.round(best.overlap * 100) / 100 : 0;
    const codelab = /Codelab/i.test(body.slice(0, 400));
    const otherPlatform = OTHER_PLATFORM.test(body);
    let origin: CloudOrigin, why: string;
    if (best && best.overlap >= 0.5) { origin = otherPlatform ? "official_other_platform" : "official"; why = `text found in official doc ${best.id} (${Math.round(best.overlap * 100)}% shared)`; }
    else if (otherPlatform && (codelab || /^#\s/m.test(body.slice(0, 200)))) { origin = "official_other_platform"; why = "Huawei doc for another platform/language (Android/Java or Cangjie)"; }
    else if (codelab) { origin = "official"; why = "Huawei Codelab (not in the local pack)"; }
    else if (sh.size >= 5 && lookup && (!best || best.overlap <= 0.1)) { origin = "community"; why = "text not found in the official docs"; }
    else { origin = "unverified"; why = sh.size < 5 ? "too short to verify" : lookup ? `partial overlap with official doc (${Math.round(overlap * 100)}%)` : "local pack unavailable"; }
    const doc = origin === "official" || origin === "official_other_platform" ? (best && best.overlap >= 0.5 ? best.id : undefined) : undefined;
    sources.push({ n: Number(n), title, origin, ...(doc ? { local_doc: doc } : {}), ...(best ? { overlap } : {}), why });
    const label = origin === "official" ? "官方文档/official"
      : origin === "official_other_platform" ? "官方文档·非 ArkTS 平台/official_other_platform — 仅适用于该平台"
      : origin === "community" ? "社区文章/community — 未核实，不能作为 API 依据"
      : "未确认来源/unverified — 按社区内容对待，需自行核实";
    const text = part.replace(header, `[${n}]【${label}】网页标题：${title}|||网页内容：`);
    sections.push({ n: Number(n), origin, text, ...(doc ? { doc } : {}) });
    out.push(text);
  }
  return { sources, sections, content: out.join("") };
}
