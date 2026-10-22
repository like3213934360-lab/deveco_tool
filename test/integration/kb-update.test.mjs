import { temporaryDirectory } from "../support/workspace.mjs";
// Knowledge pack update from an npm-compatible registry: integrity check, atomic switch, rollback.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { connect } from "../support/mcp.mjs";
import { zipFixture } from "../support/zip.mjs";

const work = temporaryDirectory("deveco-kbu-");
process.on("exit", () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
let server, client, url;
const it = test;

function makePack(version, title, mutate) {
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
  fs.writeFileSync(path.join(dir, "docs.zip"), zipFixture({ "doc/one.md": `# ${title}\n\n## Usage\nbody ${version}\n` }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, version, sources: {}, created_at: new Date().toISOString(), counts: { "harmonyos-guides": 1 } }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@test/kb", version }));
  mutate?.(dir);
  const tgz = path.join(work, `kb-${version}.tgz`);
  execFileSync("tar", ["-czf", tgz, "-C", path.dirname(dir), "package"]);
  const bytes = fs.readFileSync(tgz);
  return { bytes, integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` };
}

before(async () => {
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
after(async () => { await client.close(); server.close(); });

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
  const kb = path.join(work, "state/kb"), active = JSON.parse(fs.readFileSync(path.join(kb, "current.json"), "utf8"));
  assert.deepEqual(fs.readFileSync(path.join(kb, active.directory, "index.db")), fs.readFileSync(path.join(work, "src-1.0.0/package/index.db")), "FTS integrity validation must not change the pack database");
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

it("multiple generations preserve another process's open pack and reclaim it after that process dies", async () => {
  const kb = path.join(work, "state", "kb"), pointer = () => JSON.parse(fs.readFileSync(path.join(kb, "current.json"), "utf8"));
  const held = path.join(kb, pointer().directory);
  const reader = connect({ DEVECO_STATE_DIR: path.join(work, "state"), DEVECO_CONFIG: path.join(work, "config.json") });
  try {
    await reader.initialize();
    assert.match((await reader.call("knowledge", { action: "read", id: "doc/one" })).data.content, /body 1\.0\.0/);
    for (const [version, title] of [["2.0.0", "Beta"], ["3.0.0", "Gamma"], ["4.0.0", "Delta"]]) {
      if (version !== "2.0.0") makePack(version, title);
      const installed = await call({ action: "update", file: path.join(work, `kb-${version}.tgz`) });
      assert.equal(installed.isError, false, JSON.stringify(installed));
    }
    assert.ok(fs.existsSync(held), "An open SQLite/ZIP pack must survive even beyond the rollback generation");
    const dirs = () => fs.readdirSync(kb, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    assert.equal(dirs().length, 3, "Only current, rollback and the pinned reader remain");
    const ended = once(reader.child, "close"); reader.child.kill("SIGKILL"); await ended;
    assert.equal((await call({ action: "update", file: path.join(work, "kb-4.0.0.tgz"), force: true })).isError, false);
    assert.equal(fs.existsSync(held), false, "A dead reader no longer protects its old pack");
    assert.equal(dirs().length, 2);
    assert.equal((await call({ action: "rollback" })).isError, false);
    assert.equal(dirs().length, 1, `Rollback removes the rejected generation immediately; dirs=${JSON.stringify(dirs())}; stderr=${client.stderr}`);
    assert.match((await call({ action: "read", id: "doc/one" })).data.content, /body 4\.0\.0/);
  } finally { await reader.close(); }
});

test("invalid indexes, archives, document membership and hashes cannot replace the active pack", async () => {
  const pointerFile = path.join(work, "state/kb/current.json"), before = fs.readFileSync(pointerFile, "utf8");
  const mutations = [
    (dir) => fs.writeFileSync(path.join(dir, "index.db"), "not sqlite"),
    (dir) => { const db = new DatabaseSync(path.join(dir, "index.db")); db.exec("DROP TABLE segments_fts"); db.close(); },
    (dir) => { const db = new DatabaseSync(path.join(dir, "index.db")); db.exec("DROP TABLE segments_fts; CREATE TABLE segments_fts(search_text TEXT); INSERT INTO segments_fts(rowid,search_text) VALUES(1,'rejected 路由 跳转')"); db.close(); },
    (dir) => { const db = new DatabaseSync(path.join(dir, "index.db")); db.exec("INSERT INTO segments_fts(segments_fts,rowid,search_text) VALUES('delete',1,'rejected 路由 跳转')"); db.close(); },
    (dir) => fs.rmSync(path.join(dir, "docs.zip")),
    (dir) => fs.writeFileSync(path.join(dir, "docs.zip"), "not a ZIP"),
    (dir) => { const file = path.join(dir, "docs.zip"), bytes = fs.readFileSync(file); bytes[40] ^= 1; fs.writeFileSync(file, bytes); },
    (dir) => fs.writeFileSync(path.join(dir, "docs.zip"), zipFixture({ "other.md": "wrong document" })),
    (dir) => { const file = path.join(dir, "manifest.json"), manifest = JSON.parse(fs.readFileSync(file)); manifest.docs_sha256 = "0".repeat(64); fs.writeFileSync(file, JSON.stringify(manifest)); },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const version = `9.0.${i}`; makePack(version, "Rejected", mutate);
    const r = await call({ action: "update", file: path.join(work, `kb-${version}.tgz`) });
    assert.equal(r.isError, true, JSON.stringify(r));
    assert.equal(fs.readFileSync(pointerFile, "utf8"), before);
    assert.match((await call({ action: "read", id: "doc/one" })).data.content, /body 4.0.0/);
    assert.equal((await call({ action: "search", query: "路由" })).data.results[0].title, "Delta");
  }
});

it("rollback validates the retained pack before changing the active pointer", async () => {
  for (const version of ["10.0.0","10.0.1"]) {makePack(version,"Stable");assert.equal((await call({action:"update",file:path.join(work,`kb-${version}.tgz`)})).isError,false);}
  const pointerFile=path.join(work,"state/kb/current.json"), before=fs.readFileSync(pointerFile,"utf8"), pointer=JSON.parse(before);
  fs.writeFileSync(path.join(work,"state/kb",pointer.previous,"docs.zip"),zipFixture({"other.md":"wrong document"}));
  const rollback=await call({action:"rollback"});assert.equal(rollback.isError,true);
  assert.equal(fs.readFileSync(pointerFile,"utf8"),before);
  assert.match((await call({action:"read",id:"doc/one"})).data.content,/body 10.0.1/);
});

it("rollback refuses a table-shaped full-text index and preserves working search", async () => {
  for (const version of ["11.0.0", "11.0.1"]) {
    makePack(version, "Searchable");
    assert.equal((await call({ action: "update", file: path.join(work, `kb-${version}.tgz`) })).isError, false);
  }
  const pointerFile = path.join(work, "state/kb/current.json"), before = fs.readFileSync(pointerFile, "utf8"), pointer = JSON.parse(before);
  const file = path.join(work, "state/kb", pointer.previous, "index.db"), db = new DatabaseSync(file);
  db.exec("DROP TABLE segments_fts; CREATE TABLE segments_fts(search_text TEXT)"); db.close();
  const rollback = await call({ action: "rollback" });
  assert.equal(rollback.isError, true, JSON.stringify(rollback));
  assert.equal(fs.readFileSync(pointerFile, "utf8"), before);
  const search = await call({ action: "search", query: "searchable" });
  assert.equal(search.isError, false, JSON.stringify(search)); assert.equal(search.data.results[0].title, "Searchable");
});
