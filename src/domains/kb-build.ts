import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageRoot, version as mcpVersion } from "../core/config.js";
import { invariant } from "../core/errors.js";
import { run } from "../core/proc.js";
import { catalogs, KB_SCHEMA, type Manifest } from "./knowledge.js";

/**
 * Build a knowledge pack from:
 *   - the upstream docs package (@deveco-test/deveco-cli-knowledgebase: docs.zip + index.zip/search.db,
 *     already segmented with jieba), and
 *   - this repository's knowledge/ directory (rules, error cases, runtime patterns, skills).
 * Output: <out>/<version>/{manifest.json,index.db,docs.zip} and <out>/deveco-kb-<version>.tgz (npm-packable).
 */
export async function buildKnowledgePack(options: { upstream: string; out: string; version?: string; npmName?: string }) {
  const upstreamDir = fs.existsSync(path.join(options.upstream, "package")) ? path.join(options.upstream, "package") : options.upstream;
  const docsZip = path.join(upstreamDir, "docs.zip");
  const indexZip = path.join(upstreamDir, "index.zip");
  invariant(fs.existsSync(docsZip) && fs.existsSync(indexZip), "INVALID_INPUT", `${upstreamDir} must contain docs.zip and index.zip`);
  const upstreamPkg = JSON.parse(fs.readFileSync(path.join(upstreamDir, "package.json"), "utf8")) as { name: string; version: string };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kb-build-"));
  try {
    const { extractZip } = await import("../core/unzip.js");
    await extractZip(indexZip, work);
    const upstreamDb = path.join(work, "search.db");
    invariant(fs.existsSync(upstreamDb), "INVALID_INPUT", "index.zip has no search.db");
    const buildMeta = fs.existsSync(path.join(work, "build-meta.json")) ? JSON.parse(fs.readFileSync(path.join(work, "build-meta.json"), "utf8")) : {};

    const version = options.version ?? `${upstreamPkg.version.replace(/-.*$/, "")}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
    const target = path.join(path.resolve(options.out), version);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    const indexDb = path.join(target, "index.db");
    fs.copyFileSync(upstreamDb, indexDb);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(indexDb);
    // Local knowledge: rules / error cases / runtime patterns / skills, one document per markdown file.
    const local = path.join(packageRoot, "knowledge");
    const localDocs: { id: string; title: string; catalog: number; file: string; text: string }[] = [];
    for (const dir of ["rules", "errors", "runtime", "skills"] as const) {
      const catalogName = dir;
      const base = path.join(local, dir);
      if (!fs.existsSync(base)) continue;
      for (const file of walkMd(base)) {
        const rel = path.relative(base, file).replaceAll("\\", "/").replace(/\.md$/, "");
        const text = fs.readFileSync(file, "utf8");
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? rel;
        localDocs.push({ id: `${catalogName}/${rel}`, title, catalog: catalogs.indexOf(catalogName), file, text });
      }
    }
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
    const counts = Object.fromEntries((db.prepare("SELECT catalog_id, COUNT(*) AS n FROM documents GROUP BY catalog_id").all() as { catalog_id: number; n: number }[])
      .map((r) => [catalogs[r.catalog_id] ?? String(r.catalog_id), r.n]));
    db.exec("VACUUM");
    db.close();

    // Docs archive: upstream docs + local markdown under the same ids.
    const docsOut = path.join(target, "docs.zip");
    fs.copyFileSync(docsZip, docsOut);
    const staging = path.join(work, "local-docs");
    for (const doc of localDocs) {
      const out = path.join(staging, `${doc.id}.md`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, doc.text);
    }
    if (localDocs.length) await run({ file: "zip", args: ["-q", "-r", docsOut, "."], cwd: staging }, { timeoutMs: 300000 });

    const apiRange = sdkRange(buildMeta);
    const manifest: Manifest = {
      schema: KB_SCHEMA,
      version,
      ...(apiRange ? { sdk_api_range: apiRange } : {}),
      sources: {
        upstream: { package: upstreamPkg.name, version: upstreamPkg.version, index_version: buildMeta.indexVersion, docs_sha256: buildMeta.docsZipSha256 },
        local: { files: localDocs.length, generator: `deveco-mcp ${mcpVersion}` },
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
    // Stable pointer for local development (bundledDir falls back to kb-dist/current).
    const current = path.join(path.resolve(options.out), "current");
    fs.rmSync(current, { recursive: true, force: true });
    fs.symlinkSync(target, current, "dir");
    // npm-style tarball (top-level "package/") so `knowledge update source=<file>` and `npm publish <file>` both work.
    const tarball = path.join(path.resolve(options.out), `deveco-kb-${version}.tgz`);
    const pack = path.join(work, "package");
    fs.mkdirSync(pack);
    for (const name of ["manifest.json", "index.db", "docs.zip", "package.json"]) fs.linkSync(path.join(target, name), path.join(pack, name));
    await run({ file: "tar", args: ["-czf", tarball, "-C", work, "package"] }, { timeoutMs: 600000 });
    return { version, dir: target, tarball, counts, bytes: { index: fs.statSync(indexDb).size, docs: fs.statSync(docsOut).size, tarball: fs.statSync(tarball).size } };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
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
