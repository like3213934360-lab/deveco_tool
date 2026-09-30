// Knowledge pack update from an npm-compatible registry: integrity check, atomic switch, rollback.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { connect } from "../../tools/mcp-client.mjs";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-kbu-"));
process.on("exit", () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
let server, client, url;
// Fixture archives need the zip/tar CLIs; skip where unavailable (e.g. some Windows runners).
const hasTools = ["zip", "tar"].every((tool) => { try { execFileSync(tool, tool === "zip" ? ["-v"] : ["--version"], { stdio: "ignore" }); return true; } catch { return false; } });
const it = (name, fn) => test(name, { skip: !hasTools && "zip/tar not available" }, fn);

function makePack(version, title) {
  const dir = path.join(work, `src-${version}`, "package");
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, "index.db");
  // Minimal schema-compatible index.
  const sql = new DatabaseSync(db);
  sql.exec(`
    CREATE TABLE documents(id INTEGER PRIMARY KEY, document_id TEXT UNIQUE, catalog_id INTEGER, doc_title TEXT);
    CREATE TABLE segments(id INTEGER PRIMARY KEY, doc_id INTEGER, section_title TEXT DEFAULT '', lead_text TEXT DEFAULT '', search_text TEXT, excerpt_truncated INTEGER DEFAULT 0);
    CREATE VIRTUAL TABLE segments_fts USING fts5(search_text, content='segments', content_rowid='id', tokenize='unicode61');
    CREATE TABLE vocab(term TEXT PRIMARY KEY) WITHOUT ROWID;
    INSERT INTO documents VALUES(1,'doc/one',0,'${title}');
    INSERT INTO segments VALUES(1,1,'','lead','${title.toLowerCase()} 路由 跳转',0);
    INSERT INTO segments_fts(rowid,search_text) VALUES(1,'${title.toLowerCase()} 路由 跳转');
    INSERT INTO vocab VALUES('路由'),('跳转');`);
  sql.close();
  const docs = path.join(work, `docs-${version}`);
  fs.mkdirSync(path.join(docs, "doc"), { recursive: true });
  fs.writeFileSync(path.join(docs, "doc/one.md"), `# ${title}\n\n## Usage\nbody ${version}\n`);
  execFileSync("zip", ["-q", "-r", path.join(dir, "docs.zip"), "."], { cwd: docs });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, version, sources: {}, created_at: new Date().toISOString(), counts: { "harmonyos-guides": 1 } }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@test/kb", version }));
  const tgz = path.join(work, `kb-${version}.tgz`);
  execFileSync("tar", ["-czf", tgz, "-C", path.dirname(dir), "package"]);
  const bytes = fs.readFileSync(tgz);
  return { bytes, integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` };
}

before(async () => {
  if (!hasTools) return;
  const packs = { "1.0.0": makePack("1.0.0", "Alpha"), "2.0.0": makePack("2.0.0", "Beta") };
  let tamper = false;
  server = http.createServer((req, res) => {
    if (req.url === "/@test%2Fkb") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ "dist-tags": { latest: "2.0.0" }, versions: Object.fromEntries(Object.entries(packs).map(([v, p]) => [v, { dist: { tarball: `${url}/t/${v}.tgz`, integrity: p.integrity }, kbSchema: 1 }])) }));
    } else if (req.url === "/tamper") { tamper = true; res.end("ok"); }
    else if (req.url?.startsWith("/t/")) {
      const version = req.url.slice(3, -4);
      const bytes = Buffer.from(packs[version].bytes);
      if (tamper) bytes[bytes.length - 20] ^= 0xff;
      res.end(bytes);
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
  const config = path.join(work, "config.json");
  fs.writeFileSync(config, JSON.stringify({ kb_package: "@test/kb", npm_registry: url }));
  client = connect({ DEVECO_STATE_DIR: path.join(work, "state"), DEVECO_CONFIG: config });
  await client.initialize();
});
after(async () => { if (!hasTools) return; await client.close(); server.close(); });

const call = async (args) => {
  const r = await client.call("knowledge", args);
  // update runs as a job: unwrap the finished job result/error.
  if (args.action === "update" && r.data?.job_id) {
    if (r.data.status === "failed") return { isError: true, data: { error: r.data.error } };
    return { isError: false, data: r.data.result };
  }
  return r;
};

it("status reports remote latest", async () => {
  const r = await call({ action: "status" });
  assert.equal(r.data.latest, "2.0.0");
  assert.equal(r.data.update_available, true);
});

it("update installs a pinned version, then latest, and search/read use it", async () => {
  let r = await call({ action: "update", version: "1.0.0" });
  assert.equal(r.data.updated, true, JSON.stringify(r.data));
  r = await call({ action: "search", query: "alpha" });
  assert.equal(r.data.results[0].title, "Alpha");
  r = await call({ action: "update" });
  assert.equal(r.data.version, "2.0.0");
  r = await call({ action: "search", query: "路由跳转" });
  assert.equal(r.data.results[0].title, "Beta");
  r = await call({ action: "read", id: "doc/one", section: "Usage" });
  assert.match(r.data.content, /body 2\.0\.0/);
  r = await call({ action: "update" });
  assert.equal(r.data.updated, false);
});

it("rollback returns to the previous pack", async () => {
  const r = await call({ action: "rollback" });
  assert.match(r.data.rolled_back_to, /1\.0\.0/);
  const s = await call({ action: "search", query: "alpha" });
  assert.equal(s.data.results[0].title, "Alpha");
});

it("tampered download is rejected and the active pack is unchanged", async () => {
  await fetch(`${url}/tamper`);
  const r = await call({ action: "update", force: true });
  assert.equal(r.isError, true);
  assert.equal(r.data.error.code, "INTEGRITY_FAILED");
  const s = await call({ action: "search", query: "alpha" });
  assert.equal(s.data.results[0].title, "Alpha");
});
