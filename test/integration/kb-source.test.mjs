// Isolated knowledge registry/conversion regression. Run: node --test test/integration/kb-source.test.mjs
// Requires Node >=22.18, esbuild and tar; POSIX also uses zip. No accounts or devices.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { zipFixture } from "../support/zip.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const work = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "deveco-kb-source-"));
const upstreamName = "@deveco-test/deveco-cli-knowledgebase";
const signal = new AbortController().signal;
const fault = globalThis.__devecoKbSource = { pointer: false };
let m, server, url, registry, responseStatus, disconnect, tamper, state, downloads;
let sequence = 0;
const archives = new Map();
const exec = promisify(execFile);
const integrity = (bytes) => `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
function index(file) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE documents(id INTEGER PRIMARY KEY, document_id TEXT UNIQUE, catalog_id INTEGER, doc_title TEXT);
    CREATE TABLE segments(id INTEGER PRIMARY KEY, doc_id INTEGER, section_title TEXT DEFAULT '', lead_text TEXT DEFAULT '', search_text TEXT, excerpt_truncated INTEGER DEFAULT 0);
    CREATE VIRTUAL TABLE segments_fts USING fts5(search_text, content='segments', content_rowid='id');
    CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN INSERT INTO segments_fts(rowid,search_text) VALUES(new.id,new.search_text); END;
    INSERT INTO documents VALUES(1,'doc/one',0,'Router');
    INSERT INTO segments VALUES(1,1,'Usage','router navigation','router navigation',0);`);
  db.close();
}
async function archive(name, version, upstream = true) {
  const dir = path.join(work, `fixture-${++sequence}`, "package");
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, upstream ? "search.db" : "index.db");
  index(dbFile);
  fs.writeFileSync(path.join(dir, "docs.zip"), zipFixture({ "doc/one.md": "# Router\n\n## Usage\nrouter navigation official\n" }));
  if (upstream) {
    fs.writeFileSync(path.join(dir, "index.zip"), zipFixture({ "search.db": fs.readFileSync(dbFile) }));
    fs.rmSync(dbFile);
  } else fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, version, sources: {}, created_at: "2026-01-01", counts: { "harmonyos-guides": 1 } }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, ...(upstream ? { apiVersion: 1 } : { kbSchema: 1 }) }));
  const file = path.join(path.dirname(dir), "fixture.tgz");
  // Keep the local registry and fetch socket timers running while tar prepares fixtures.
  await exec("tar", ["-czf", file, "-C", path.dirname(dir), "package"]);
  const bytes = fs.readFileSync(file);
  const key = `${name}/${version}/${sequence}`;
  archives.set(key, bytes);
  return { version, ...(upstream ? { apiVersion: 1 } : { kbSchema: 1 }), dist: { tarball: `${url}/archive/${encodeURIComponent(key)}`, integrity: integrity(bytes) }, dir, file };
}
async function metadata(name, versions, tags, upstream = true) {
  const entries = [];
  for (const version of versions) {
    const { dir, file, ...entry } = await archive(name, version, upstream);
    entries.push([version, entry]);
  }
  return { "dist-tags": tags, versions: Object.fromEntries(entries) };
}
function configure(value = {}) {
  fs.writeFileSync(process.env.DEVECO_CONFIG, JSON.stringify({ npm_registry: url, ...value }));
  m.resetConfig();
}
async function isolate(value = {}) {
  state = path.join(work, `state-${++sequence}`);
  process.env.DEVECO_STATE_DIR = state;
  process.env.DEVECO_CONFIG = path.join(work, `config-${sequence}.json`);
  configure(value);
  responseStatus = 200; disconnect = false; tamper = false; downloads = 0;
  registry = {
    [upstreamName]: await metadata(upstreamName, ["1.3.5-Test.1", "1.3.5-Test.2"], { latest: "1.3.5-Test.1", daily: "1.3.5-Test.2" }),
    "@private/kb": await metadata("@private/kb", ["1.0.0", "2.0.0"], { latest: "2.0.0" }, false),
  };
}
const pointer = () => fs.readFileSync(path.join(state, "kb/current.json"), "utf8");
const code = (expected) => (e) => e.code === expected;

before(async () => {
  const bundle = path.join(work, "knowledge.mjs");
  await build({ stdin: { contents: 'export * from "./src/domains/knowledge.ts"; export * from "./src/domains/kb-build.ts"; export { config, resetConfig } from "./src/core/config.ts";', resolveDir: root, sourcefile: "kb-test-entry.ts" },
    outfile: bundle, bundle: true, format: "esm", platform: "node", logLevel: "error",
    // Preserve package-root discovery when relocating the temporary bundle outside the repository.
    define: { "import.meta.url": JSON.stringify(pathToFileURL(path.join(root, "src/core/config.ts")).href) },
    banner: { js: `import {createRequire as testRequire} from 'node:module'; const require = testRequire(${JSON.stringify(path.join(root, "package.json"))});` },
    plugins: [{ name: "pointer-fault", setup(b) {
      b.onResolve({ filter: /^node:fs$/ }, (a) => /(?:files|knowledge)\.ts$/.test(a.importer) ? { path: "fs", namespace: "fault" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fault" }, () => ({ contents: "import fs from 'node:fs'; export default {...fs, renameSync:(a,b)=>{if(globalThis.__devecoKbSource.pointer&&b.endsWith('current.json'))throw new Error('injected pointer failure'); return fs.renameSync(a,b)}};" }));
    } }] });
  m = await import(pathToFileURL(bundle).href);
  server = http.createServer((req, res) => {
    if (disconnect) { req.socket.destroy(); return; }
    if (responseStatus !== 200) { res.writeHead(responseStatus); res.end("registry error"); return; }
    if (req.url.startsWith("/archive/")) {
      downloads++;
      const bytes = archives.get(decodeURIComponent(req.url.slice(9)));
      res.end(tamper ? Buffer.from("invalid archive") : bytes);
    } else {
      const meta = registry[decodeURIComponent(req.url.slice(1))];
      res.setHeader("content-type", "application/json");
      if (!meta) { res.writeHead(404); res.end("{}"); } else res.end(JSON.stringify(meta));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  m?.closeKnowledge();
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(work, { recursive: true, force: true });
  delete globalThis.__devecoKbSource;
});

test("default latest upstream converts, searches, reads, fingerprints, no-ops and force rolls back", async () => {
  await isolate();
  // Seed only the isolated state, so an optional bundled pack cannot affect update availability.
  await m.update({ source: (await archive("@private/kb", "1.0.0", false)).file }, signal);
  assert.equal(m.config().kb_source, "upstream");
  const check = await m.status(true);
  assert.equal(check.source, "upstream"); assert.equal(check.tag, "latest");
  assert.equal(check.available_version, "1.3.5-Test.1"); assert.equal(check.update_available, true);
  const installed = await m.update({}, signal);
  assert.equal(installed.updated, true); assert.equal(installed.source, "upstream");
  assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.1");
  assert.equal(m.activePack().manifest.sources.local.content_sha256, m.localKnowledgeContentSha256());
  assert.equal((await m.search("router navigation")).results[0].title, "Router");
  assert.match((await m.read("doc/one")).content, /official/);
  const s = await m.status(true, signal);
  assert.equal(s.installed.version, installed.version); assert.equal(s.upstream.installed_version, "1.3.5-Test.1");
  assert.equal(s.update_available, false); assert.equal(s.local_content.state, "unchanged");
  const before = pointer(), count = downloads;
  assert.equal((await m.update({}, signal)).updated, false);
  assert.equal(pointer(), before); assert.equal(downloads, count);
  await m.update({ force: true }, signal); assert.notEqual(pointer(), before);
  m.rollback(); assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.1");
});

test("private kb_package preserves pack mode, pinned versions and source override checks", async () => {
  await isolate({ kb_package: "@private/kb" });
  assert.equal(m.config().kb_source, "pack");
  assert.equal((await m.status(true)).source, "pack");
  assert.equal((await m.update({ version: "1.0.0" }, signal)).version, "1.0.0");
  assert.equal((await m.update({}, signal)).version, "2.0.0");
  assert.equal((await m.update({}, signal)).updated, false);
  const upstream = await m.status(true, signal, { source: "upstream", version: "1.3.5-Test.2" });
  assert.equal(upstream.source, "upstream"); assert.equal(upstream.available_version, "1.3.5-Test.2");
  await m.update({ source: "upstream", version: "1.3.5-Test.2" }, signal);
  assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.2");
  configure({ kb_package: "@private/kb", kb_source: "upstream" });
  assert.equal((await m.status(true)).source, "upstream");
  assert.equal((await m.status(true)).update_available, false); // latest is older than installed daily; no date-based update.
  assert.equal((await m.status(true, signal, { source: "pack" })).source, "pack");
});

test("daily is opt-in and explicit upstream version is obeyed, including downgrade", async () => {
  await isolate({ kb_upstream_tag: "daily" });
  const s = await m.status(true); assert.equal(s.tag, "daily"); assert.equal(s.available_version, "1.3.5-Test.2");
  await m.update({}, signal); assert.equal(m.activePack().manifest.sources.upstream.version, s.available_version);
  const pinned = await m.status(true, signal, { version: "1.3.5-Test.1" });
  assert.equal(pinned.available_version, "1.3.5-Test.1"); assert.equal(pinned.update_available, true);
  await m.update({ version: "1.3.5-Test.1" }, signal);
  assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.1");
  await assert.rejects(m.update({ version: "9.9.9" }, signal), code("NOT_FOUND"));
  await assert.rejects(m.update({ version: "" }, signal), code("INVALID_INPUT"));
  await assert.rejects(m.status(true, signal, { version: "" }), code("INVALID_INPUT"));
});

test("incompatible latest selects highest compatible history semantically, never newer daily", async () => {
  await isolate();
  registry[upstreamName] = await metadata(upstreamName, ["1.3.5-Test.2", "1.3.5-Test.10", "2.0.0", "3.0.0"], { latest: "2.0.0", daily: "3.0.0" });
  registry[upstreamName].versions["2.0.0"].apiVersion = 2;
  const s = await m.status(true);
  assert.equal(s.latest, "2.0.0"); assert.equal(s.available_version, "1.3.5-Test.10");
  assert.equal(s.compatibility.fallback, true); assert.match(s.compatibility.reason, /highest compatible/);
  const installed = await m.update({}, signal);
  assert.equal(installed.available_version, s.available_version);
  assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.10");
  await assert.rejects(m.status(true, signal, { version: "2.0.0" }), code("INVALID_INPUT"));
  await assert.rejects(m.update({ version: "2.0.0" }, signal), code("INVALID_INPUT"));
});

test("invalid metadata and insufficient compatibility reject both check and update", async (t) => {
  const cases = [
    ["missing tag", (x) => { delete x["dist-tags"].latest; }],
    ["missing version", (x) => { delete x.versions["1.3.5-Test.1"]; }, "NOT_FOUND"],
    ["missing dist", (x) => { delete x.versions["1.3.5-Test.1"].dist; }],
    ["bad integrity", (x) => { x.versions["1.3.5-Test.1"].dist.integrity = "sha1-abc"; }],
    ["missing API", (x) => { delete x.versions["1.3.5-Test.1"].apiVersion; }],
    ["unknown API", (x) => { for (const v of Object.values(x.versions)) v.apiVersion = 2; }],
    ["invalid API", (x) => { x.versions["1.3.5-Test.1"].apiVersion = "1"; }],
    ["array versions", (x) => { x.versions = []; }],
    ["version mismatch", (x) => { x.versions["1.3.5-Test.1"].version = "9.0.0"; }],
  ];
  for (const [name, mutate, expected = "INVALID_INPUT"] of cases) await t.test(name, async () => {
    await isolate(); mutate(registry[upstreamName]);
    await assert.rejects(m.status(true), code(expected));
    await assert.rejects(m.update({}, signal), code(expected));
    assert.equal(fs.existsSync(path.join(state, "kb/current.json")), false);
  });
});

test("check-only rejects file/URL rather than ignoring it; file and URL installs remain supported", async () => {
  await isolate();
  const p = await archive("@private/kb", "1.0.0", false);
  for (const source of [p.file, p.dist.tarball]) {
    await assert.rejects(m.status(true, signal, { source }), /Check-only supports registry/);
    assert.equal((await m.update({ source }, signal)).version, "1.0.0");
    await assert.rejects(m.update({ source, version: "2.0.0" }, signal), code("INVALID_INPUT"));
  }
});

test("registry pin rejects archives of another version even with valid SHA512", async () => {
  await isolate({ kb_package: "@private/kb" });
  await m.update({ version: "1.0.0" }, signal); const before = pointer();
  registry["@private/kb"].versions["2.0.0"].dist = registry["@private/kb"].versions["1.0.0"].dist;
  await assert.rejects(m.update({ version: "2.0.0" }, signal), /Archive version does not match/);
  registry[upstreamName].versions["1.3.5-Test.1"].dist = registry[upstreamName].versions["1.3.5-Test.2"].dist;
  await assert.rejects(m.update({ source: "upstream", version: "1.3.5-Test.1" }, signal), /archive metadata does not match/);
  assert.equal(pointer(), before);
});

test("HTTP401/404 and real disconnected registry surface errors, not no-update", async () => {
  await isolate(); await m.update({}, signal); const before = pointer();
  for (const status of [401, 404, 500]) {
    responseStatus = status;
    await assert.rejects(m.status(true), code("HTTP_ERROR"));
    await assert.rejects(m.update({}, signal), code("HTTP_ERROR"));
  }
  responseStatus = 200; disconnect = true;
  await assert.rejects(m.status(true), /fetch failed/);
  await assert.rejects(m.update({}, signal), /fetch failed/);
  assert.equal(pointer(), before);
});

test("legacy fingerprint is unknown; differing indexed content is local refresh, not official update", async () => {
  await isolate(); await m.update({}, signal);
  const manifestFile = path.join(m.activePack().dir, "manifest.json");
  const legacy = JSON.parse(fs.readFileSync(manifestFile));
  delete legacy.sources.local.content_sha256;
  fs.writeFileSync(manifestFile, JSON.stringify(legacy));
  let s = await m.status(true);
  assert.equal(s.update_available, false); assert.equal(s.local_content.state, "unknown");
  assert.equal(s.local_update_available, null); assert.equal(s.local_refresh_recommended, true);
  assert.equal((await m.update({}, signal)).updated, true);
  assert.equal((await m.status(false)).local_content.state, "unchanged");
  const local = path.join(work, "alternate-knowledge"); fs.mkdirSync(path.join(local, "rules"), { recursive: true });
  fs.writeFileSync(path.join(local, "rules/example.md"), "# Alternate rules\n\nDifferent indexed knowledge.\n");
  const upstream = await archive(upstreamName, "1.3.5-Test.1");
  const built = await m.buildKnowledgePack({ upstream: upstream.dir, out: path.join(work, "alternate-out"), local });
  assert.equal(JSON.parse(fs.readFileSync(path.join(built.dir, "manifest.json"))).sources.local.content_sha256, m.localKnowledgeContentSha256(local));
  await m.update({ source: built.tarball }, signal);
  s = await m.status(true);
  assert.equal(s.update_available, false); assert.equal(s.local_content.state, "changed"); assert.equal(s.local_update_available, true);
  assert.equal((await m.update({}, signal)).updated, true);
  assert.equal((await m.update({}, signal)).updated, false);
});

test("fingerprint includes relative paths/bodies, excludes NOTICE, and indexes runtime exactly once", async () => {
  await isolate();
  const local = path.join(work, "fingerprint"), runtime = path.join(local, "skills/hmos-runtime-fix-skill/references");
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(path.join(local, "rules"));
  fs.writeFileSync(path.join(runtime, "a.md"), "# Runtime\nbody\n");
  fs.writeFileSync(path.join(local, "rules/NOTICE.md"), "notice");
  const first = m.localKnowledgeContentSha256(local);
  fs.writeFileSync(path.join(local, "rules/NOTICE.md"), "changed notice"); assert.equal(m.localKnowledgeContentSha256(local), first);
  fs.renameSync(path.join(runtime, "a.md"), path.join(runtime, "b.md")); assert.notEqual(m.localKnowledgeContentSha256(local), first);
  const renamed = m.localKnowledgeContentSha256(local);
  fs.writeFileSync(path.join(runtime, "b.md"), "# Runtime\nnew body\n"); assert.notEqual(m.localKnowledgeContentSha256(local), renamed);
  const upstream = await archive(upstreamName, "1.3.5-Test.1");
  const built = await m.buildKnowledgePack({ upstream: upstream.dir, out: path.join(work, "fingerprint-out"), local, version: "1.0.0" });
  assert.equal(built.counts.runtime, 1); assert.equal(built.counts.skills, undefined); assert.equal(built.counts.rules, undefined);
  await m.update({ source: built.tarball }, signal);
  assert.match((await m.read("doc/one")).content, /router navigation official/);
  assert.match((await m.read("runtime/b")).content, /new body/);
  const invalidPkg = JSON.parse(fs.readFileSync(path.join(upstream.dir, "package.json"))); invalidPkg.apiVersion = 2;
  fs.writeFileSync(path.join(upstream.dir, "package.json"), JSON.stringify(invalidPkg));
  await assert.rejects(m.buildKnowledgePack({ upstream: upstream.dir, out: path.join(work, "invalid-out") }), code("INVALID_INPUT"));
});

test("integrity and pointer failures preserve active pointer and previous rollback for both sources", async () => {
  await isolate();
  await m.update({ version: "1.3.5-Test.1" }, signal);
  await m.update({ version: "1.3.5-Test.2" }, signal);
  const before = pointer(), active = m.activePack().dir;
  tamper = true;
  await assert.rejects(m.update({ force: true }, signal), code("INTEGRITY_FAILED"));
  await assert.rejects(m.update({ source: "pack", force: true }, signal), code("HTTP_ERROR")); // default unpublished MCP package has no fixture.
  configure({ kb_package: "@private/kb" });
  await assert.rejects(m.update({ force: true }, signal), code("INTEGRITY_FAILED"));
  assert.equal(pointer(), before); assert.equal(m.activePack().dir, active);
  tamper = false; fault.pointer = true;
  try { await assert.rejects(m.update({ source: "upstream", force: true }, signal), /injected pointer failure/); }
  finally { fault.pointer = false; }
  assert.equal(pointer(), before);
  m.rollback(); assert.equal(m.activePack().manifest.sources.upstream.version, "1.3.5-Test.1");
  assert.deepEqual(fs.readdirSync(path.join(state, "kb")).filter((name) => name.startsWith(".")), []);
});
