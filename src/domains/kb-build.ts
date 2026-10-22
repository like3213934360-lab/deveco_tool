import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assetRoot, version as mcpVersion } from "../core/config.js";
import { invariant } from "../core/errors.js";
import { run } from "../core/proc.js";
import { catalogs, KB_SCHEMA, UPSTREAM_API_VERSION, validatePack, type Manifest } from "./knowledge.js";

/**
 * Build a knowledge pack from:
 *   - the upstream docs package (@deveco-test/deveco-cli-knowledgebase: docs.zip + index.zip/search.db,
 *     already segmented with jieba), and
 *   - this repository's knowledge/ directory (rules, error cases, runtime patterns, skills).
 * Output: <out>/<version>/{manifest.json,index.db,docs.zip} and <out>/deveco-kb-<version>.tgz (npm-packable).
 */
export async function buildKnowledgePack(options: { upstream: string; out: string; version?: string; npmName?: string; local?: string }) {
  const upstreamDir = fs.existsSync(path.join(options.upstream, "package")) ? path.join(options.upstream, "package") : options.upstream;
  const docsZip = path.join(upstreamDir, "docs.zip");
  const indexZip = path.join(upstreamDir, "index.zip");
  invariant(fs.existsSync(docsZip) && fs.existsSync(indexZip), "INVALID_INPUT", `${upstreamDir} must contain docs.zip and index.zip`);
  const upstreamPkg = JSON.parse(fs.readFileSync(path.join(upstreamDir, "package.json"), "utf8")) as { name: string; version: string; apiVersion?: number };
  invariant(upstreamPkg.apiVersion === UPSTREAM_API_VERSION, "INVALID_INPUT", `Upstream package must support apiVersion ${UPSTREAM_API_VERSION}`);
  const localDocs = localKnowledgeDocuments(options.local);
  const contentSha256 = hashLocalDocuments(localDocs);
  // The npm archive uses hard links; stage on the output filesystem even when TMPDIR
  // is on another volume (for example a Windows C: temp directory and D: checkout).
  fs.mkdirSync(path.resolve(options.out), { recursive: true });
  const work = fs.mkdtempSync(path.join(path.resolve(options.out), ".tmp-"));
  try {
    const { extractZip } = await import("../core/unzip.js");
    await extractZip(indexZip, work);
    const upstreamDb = path.join(work, "search.db");
    invariant(fs.existsSync(upstreamDb), "INVALID_INPUT", "index.zip has no search.db");
    const buildMeta = fs.existsSync(path.join(work, "build-meta.json")) ? JSON.parse(fs.readFileSync(path.join(work, "build-meta.json"), "utf8")) : {};

    const version = options.version ?? `${upstreamPkg.version.replace(/-.*$/, "")}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
    invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version), "INVALID_INPUT", "Knowledge pack version is not a safe directory name");
    const destination = path.join(path.resolve(options.out), version);
    const tarball = path.join(path.resolve(options.out), `deveco-kb-${version}.tgz`);
    invariant(!fs.lstatSync(destination, { throwIfNoEntry: false }) && !fs.lstatSync(tarball, { throwIfNoEntry: false }),
      "CONFLICT", "Knowledge version output already exists; use a new version or output directory", { destination, tarball });
    const target = path.join(work, "built");
    fs.mkdirSync(target, { recursive: true });
    const indexDb = path.join(target, "index.db");
    fs.copyFileSync(upstreamDb, indexDb);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(indexDb);
    let counts: Record<string, number>;
    try {
    // Local knowledge: rules / error cases / runtime patterns / skills, one document per markdown file.
    db.exec("BEGIN");
    const insertDoc = db.prepare("INSERT INTO documents(document_id, catalog_id, doc_title) VALUES(?,?,?)");
    const insertSeg = db.prepare("INSERT INTO segments(doc_id, section_title, lead_text, search_text, excerpt_truncated) VALUES(?,?,?,?,0)");
    for (const doc of localDocs) {
      const { lastInsertRowid } = insertDoc.run(doc.id, doc.catalog, doc.title);
      for (const section of splitSections(doc.text)) {
        insertSeg.run(Number(lastInsertRowid), section.title, section.body.slice(0, 200), segmentText(`${doc.title} ${section.title} ${section.body}`));
      }
    }
    // Vocabulary for runtime query segmentation (forward maximum matching).
    db.exec("DROP TABLE IF EXISTS vocab; CREATE TABLE vocab(term TEXT PRIMARY KEY) WITHOUT ROWID;");
    db.exec("CREATE VIRTUAL TABLE temp.v USING fts5vocab(main, 'segments_fts', 'row')");
    db.exec("INSERT INTO vocab SELECT term FROM temp.v WHERE length(term) BETWEEN 2 AND 12 AND term GLOB '*[^ -~]*' AND doc >= 2");
    db.exec("COMMIT");
    db.exec("INSERT INTO segments_fts(segments_fts) VALUES('optimize')");
    counts = Object.fromEntries((db.prepare("SELECT catalog_id, COUNT(*) AS n FROM documents GROUP BY catalog_id").all() as { catalog_id: number; n: number }[])
      .map((r) => [catalogs[r.catalog_id] ?? String(r.catalog_id), r.n]));
    db.exec("VACUUM");
    } finally { db.close(); }

    // Docs archive: upstream docs + local markdown under the same ids.
    const docsOut = path.join(target, "docs.zip");
    fs.copyFileSync(docsZip, docsOut);
    const staging = path.join(work, "local-docs");
    for (const doc of localDocs) {
      const out = path.join(staging, `${doc.id}.md`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, doc.text);
    }
    if (localDocs.length) {
      // Windows supplies bsdtar, not Info-ZIP. Convert the original archive and add exact
      // local ids in one command; never retry a failed archiver or change the output format.
      const command = process.platform === "win32"
        ? { file: "tar", args: ["--format=zip", "-cf", docsOut, `@${docsZip}`, ...localDocs.map((doc) => `${doc.id}.md`)], cwd: staging }
        : { file: "zip", args: ["-q", "-r", docsOut, "."], cwd: staging };
      await run(command, { timeoutMs: 300000 });
    }

    const apiRange = sdkRange(buildMeta);
    const manifest: Manifest = {
      schema: KB_SCHEMA,
      version,
      ...(apiRange ? { sdk_api_range: apiRange } : {}),
      sources: {
        upstream: { package: upstreamPkg.name, version: upstreamPkg.version, index_version: buildMeta.indexVersion, docs_sha256: buildMeta.docsZipSha256 },
        local: { files: localDocs.length, generator: `deveco-mcp ${mcpVersion}`, content_sha256: contentSha256 },
      },
      created_at: new Date().toISOString(),
      docs_sha256: sha256File(docsOut),
      counts,
    };
    fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const npmName = options.npmName ?? "@deveco-mcp/kb";
    fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({
      name: npmName, version, description: "HarmonyOS knowledge pack for deveco-mcp (docs, ArkTS rules, error cases, runtime patterns)",
      license: "MIT", kbSchema: KB_SCHEMA, files: ["manifest.json", "index.db", "docs.zip"],
    }, null, 2) + "\n");
    await validatePack(target, manifest);
    // npm-style tarball (top-level "package/") so `knowledge update source=<file>` and `npm publish <file>` both work.
    const archive = path.join(work, "archive.tgz");
    const pack = path.join(work, "package");
    fs.mkdirSync(pack);
    for (const name of ["manifest.json", "index.db", "docs.zip", "package.json"]) fs.linkSync(path.join(target, name), path.join(pack, name));
    await run({ file: "tar", args: ["-czf", archive, "-C", work, "package"] }, { timeoutMs: 600000 });
    const bytes = { index: fs.statSync(indexDb).size, docs: fs.statSync(docsOut).size, tarball: fs.statSync(archive).size };
    const current = path.join(path.resolve(options.out), "current"), next = path.join(work, "current");
    invariant(!fs.lstatSync(current, { throwIfNoEntry: false }) || fs.lstatSync(current).isSymbolicLink(), "CONFLICT", "Knowledge current must be a symlink; existing data was preserved");
    fs.symlinkSync(destination, next, process.platform === "win32" ? "junction" : "dir");
    // Version directories stay immutable: existing readers may still have the old index open.
    invariant(!fs.lstatSync(destination, { throwIfNoEntry: false }) && !fs.lstatSync(tarball, { throwIfNoEntry: false }), "CONFLICT", "Knowledge output appeared during build");
    fs.renameSync(target, destination);
    try {
      fs.renameSync(archive, tarball);
      fs.renameSync(next, current);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      if (!fs.existsSync(archive)) fs.rmSync(tarball, { force: true });
      throw error;
    }
    return { version, dir: destination, tarball, counts, bytes };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

type LocalDocument = { id: string; title: string; catalog: number; file: string; text: string; relative: string };

function localKnowledgeDocuments(local = path.join(assetRoot, "knowledge")): LocalDocument[] {
  const localDocs: LocalDocument[] = [];
  const sources: [catalog: (typeof catalogs)[number], dir: string][] = [
    ["rules", "rules"], ["errors", "errors"],
    ["runtime", "skills/hmos-runtime-fix-skill/references"], ["skills", "skills"],
  ];
  for (const [catalogName, dir] of sources) {
    const base = path.join(local, dir);
    if (!fs.existsSync(base)) continue;
    for (const file of walkMd(base)) {
      if (path.basename(file) === "NOTICE.md") continue;
      if (catalogName === "skills" && file.includes(`${path.sep}hmos-runtime-fix-skill${path.sep}references${path.sep}`)) continue; // indexed as runtime
      const rel = path.relative(base, file).replaceAll("\\", "/").replace(/\.md$/, "");
      const text = fs.readFileSync(file, "utf8");
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? rel;
      localDocs.push({ id: `${catalogName}/${rel}`, title, catalog: catalogs.indexOf(catalogName), file, text, relative: path.relative(local, file).replaceAll("\\", "/") });
    }
  }
  return localDocs.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}

function hashLocalDocuments(docs: LocalDocument[]) {
  const hash = crypto.createHash("sha256");
  for (const doc of docs) hash.update(JSON.stringify([doc.relative, doc.text]) + "\n");
  return hash.digest("hex");
}

/** Relative paths and exact bodies of the files the builder indexes (NOTICE and duplicate runtime excluded). */
export function localKnowledgeContentSha256(local = path.join(assetRoot, "knowledge")) {
  return hashLocalDocuments(localKnowledgeDocuments(local));
}

function* walkMd(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMd(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

function splitSections(text: string) {
  const out: { title: string; body: string }[] = [];
  let current = { title: "", body: "" };
  for (const line of text.split("\n")) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      if (current.body.trim()) out.push(current);
      current = { title: heading[1]!.trim(), body: "" };
    } else current.body += line + "\n";
  }
  if (current.body.trim()) out.push(current);
  return out.length ? out : [{ title: "", body: text }];
}

/**
 * Local docs are few and domain-specific; index ASCII words plus CJK bigrams so
 * the runtime FMM tokenizer (which emits vocabulary words or bigrams) matches.
 */
function segmentText(text: string) {
  const tokens: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9_@$.]+|\p{Script=Han}+/gu)) {
    const run = m[0];
    if (/^\p{Script=Han}+$/u.test(run)) {
      const chars = [...run];
      if (chars.length <= 4) tokens.push(run);
      for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i]! + chars[i + 1]!);
    } else {
      tokens.push(run.toLowerCase());
      if (run.includes(".")) tokens.push(...run.split(".").filter(Boolean).map((x) => x.toLowerCase()));
    }
  }
  return tokens.join(" ");
}

function sdkRange(meta: Record<string, unknown>): [number, number] | undefined {
  const value = meta.sdkApiRange;
  return Array.isArray(value) && value.length === 2 ? [Number(value[0]), Number(value[1])] : undefined;
}

function sha256File(file: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
