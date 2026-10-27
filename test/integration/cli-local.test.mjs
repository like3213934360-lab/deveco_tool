import { temporaryDirectory } from "../support/workspace.mjs";
// Local CLI wiring against the built entrypoint; no SDK, device, account or remote registry.
// Run after the shared build: node --test test/integration/cli-local.test.mjs
// Requires Node >=22.18, tar, and zip on POSIX (the real knowledge-pack builder uses them).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import { zipFixture } from "../support/zip.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const exec = promisify(execFile);
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function localCli(t) {
  const work = temporaryDirectory("deveco-cli-local-");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const home = path.join(work, "home"), state = path.join(work, "state");
  fs.mkdirSync(home);
  const config = path.join(work, "config.json");
  // An accidental registry path must fail locally, not reach a public service.
  fs.writeFileSync(config, JSON.stringify({ npm_registry: "http://127.0.0.1:1" }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData"), DEVECO_STATE_DIR: state, DEVECO_CONFIG: config };
  const run = (args, cwd = work) => exec(process.execPath, [path.join(root, "bin/deveco-mcp.mjs"), ...args], {
    cwd, env, encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024, signal: t.signal,
  });
  return { work, state, config, run, call: async (args) => JSON.parse((await run(args)).stdout) };
}

function failure(message) {
  return (error) => {
    assert.equal(error.code, 1, error.stderr);
    assert.equal(error.signal, null, "the CLI must exit itself, not be killed by the timeout");
    assert.equal(error.stdout, "", "errors belong on stderr, not the JSON result stream");
    assert.match(error.stderr, message);
    return true;
  };
}

for (const mode of ["default", "skills-only", "mcp-only"]) {
  test(`init ${mode} respects project scope and preserves unrelated host configuration`, async (t) => {
    const c = localCli(t), project = path.join(c.work, "project with spaces");
    const hostFile = path.join(project, ".cursor/mcp.json"), skills = path.join(project, ".agents/skills");
    const peer = { command: "existing-peer", args: ["keep"] };
    fs.mkdirSync(path.dirname(hostFile), { recursive: true });
    const original = JSON.stringify({ keep: "user setting", mcpServers: { peer } }, null, 2) + "\n";
    fs.writeFileSync(hostFile, original);
    const args = ["init", "--host", "cursor", "--project", project, ...(mode === "default" ? [] : [`--${mode}`])];
    const result = await c.call(args);
    if (mode === "mcp-only") {
      assert.equal(result.skills, undefined);
      assert.equal(fs.existsSync(skills), false);
    } else {
      assert.equal(result.skills.directory, skills);
      const bundled = path.join(root, "knowledge/skills");
      const names = fs.readdirSync(bundled).filter((name) => fs.existsSync(path.join(bundled, name, "SKILL.md"))).sort();
      assert.ok(names.length > 0);
      assert.deepEqual(result.skills.exported.slice().sort(), names);
      for (const name of names) assert.deepEqual(fs.readFileSync(path.join(skills, name, "SKILL.md")), fs.readFileSync(path.join(bundled, name, "SKILL.md")));
    }
    if (mode === "skills-only") {
      assert.equal(result.mcp, undefined);
      assert.equal(fs.readFileSync(hostFile, "utf8"), original);
    } else {
      assert.equal(result.mcp.file, hostFile);
      assert.equal(result.mcp.written, true);
      const installed = json(hostFile);
      assert.equal(installed.keep, "user setting");
      assert.deepEqual(installed.mcpServers.peer, peer);
      assert.equal(installed.mcpServers.deveco.type, "stdio");
      assert.deepEqual(installed.mcpServers.deveco.args, [path.join(root, "bin/deveco-mcp.mjs"), "mcp"]);
      assert.equal(installed.mcpServers.deveco.env.DEVECO_CONFIG, c.config);
      const before = fs.readFileSync(hostFile, "utf8");
      assert.equal((await c.call(args)).mcp.written, false);
      assert.equal(fs.readFileSync(hostFile, "utf8"), before);
      assert.equal((await c.call([...args, "--force"])).mcp.written, true);
      assert.equal(fs.readFileSync(hostFile, "utf8"), before, "force preserves peer entries and user settings");
    }
  });
}

test("init --path exports only to the requested skills directory; missing host fails", async (t) => {
  const c = localCli(t), project = path.join(c.work, "project"), skills = path.join(c.work, "custom skills");
  fs.mkdirSync(project);
  const result = await c.call(["init", "--host", "cursor", "--project", project, "--skills-only", "--path", skills]);
  assert.equal(result.skills.directory, skills);
  assert.ok(result.skills.exported.length > 0);
  for (const name of result.skills.exported) assert.ok(fs.statSync(path.join(skills, name, "SKILL.md")).isFile());
  assert.deepEqual(fs.readdirSync(project), [], "neither default skills nor MCP config should be written");
  await assert.rejects(c.run(["init"]), failure(/usage: deveco-mcp init --host/));
});

for (const prefix of ["", "docs/"]) test(`kb-build and kb-update connect SQLite, ZIP and tarball components (prefix=${prefix || "none"})`, async (t) => {
  const c = localCli(t), upstream = path.join(c.work, "upstream docs"), out = path.join(c.work, "built packs");
  fs.mkdirSync(upstream);
  const dbFile = path.join(upstream, "search.db"), db = new DatabaseSync(dbFile);
  try {
    db.exec(`CREATE TABLE documents(id INTEGER PRIMARY KEY, document_id TEXT UNIQUE, catalog_id INTEGER, doc_title TEXT);
      CREATE TABLE segments(id INTEGER PRIMARY KEY, doc_id INTEGER, section_title TEXT DEFAULT '', lead_text TEXT DEFAULT '', search_text TEXT, excerpt_truncated INTEGER DEFAULT 0);
      CREATE VIRTUAL TABLE segments_fts USING fts5(search_text, content='segments', content_rowid='id');
      CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN INSERT INTO segments_fts(rowid,search_text) VALUES(new.id,new.search_text); END;
      INSERT INTO documents VALUES(1,'cli/local',0,'CLI local knowledge');
      INSERT INTO segments VALUES(1,1,'Usage','cli local knowledge','cli local knowledge',0);`);
  } finally { db.close(); }
  fs.writeFileSync(path.join(upstream, "package.json"), JSON.stringify({ name: "@test/cli-upstream", version: "1.0.0", apiVersion: 1 }));
  fs.writeFileSync(path.join(upstream, "index.zip"), zipFixture({ "search.db": fs.readFileSync(dbFile) }));
  fs.writeFileSync(path.join(upstream, "docs.zip"), zipFixture({ [`${prefix}cli/local.md`]: "# CLI local knowledge\n\n## Usage\nOnly local files.\n" }));
  const version = "2.3.4-cli", built = await c.call(["kb-build", upstream, out, "--version", version, "--name", "@test/cli-kb"]);
  assert.equal(built.version, version);
  assert.equal(built.dir, path.join(out, version));
  assert.equal(built.tarball, path.join(out, `deveco-kb-${version}.tgz`));
  assert.equal(fs.realpathSync(path.join(out, "current")), fs.realpathSync(built.dir));
  const manifest = json(path.join(built.dir, "manifest.json")), pkg = json(path.join(built.dir, "package.json"));
  assert.equal(pkg.name, "@test/cli-kb"); assert.equal(pkg.version, version); assert.equal(pkg.kbSchema, 1);
  assert.equal(manifest.schema, 1); assert.equal(manifest.version, version);
  assert.equal(manifest.sources.upstream.package, "@test/cli-upstream");
  assert.equal(manifest.sources.upstream.version, "1.0.0");
  assert.ok(manifest.sources.local.files > 0, "bundled local knowledge is merged into the pack");
  assert.equal(manifest.counts["harmonyos-guides"], 1);
  assert.deepEqual(built.counts, manifest.counts);
  assert.equal(manifest.docs_sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(built.dir, "docs.zip"))).digest("hex"));
  for (const [key, file] of [["index", path.join(built.dir, "index.db")], ["docs", path.join(built.dir, "docs.zip")], ["tarball", built.tarball]]) {
    assert.ok(built.bytes[key] > 0); assert.equal(built.bytes[key], fs.statSync(file).size);
  }
  const installed = await c.call(["kb-update", built.tarball]);
  assert.equal(installed.updated, true); assert.equal(installed.version, version); assert.deepEqual(installed.counts, built.counts);
  const pointerFile = path.join(c.state, "kb/current.json"), pointer = json(pointerFile);
  assert.equal(pointer.version, version);
  const active = path.join(c.state, "kb", pointer.directory);
  for (const file of ["manifest.json", "index.db", "docs.zip"]) assert.deepEqual(fs.readFileSync(path.join(active, file)), fs.readFileSync(path.join(built.dir, file)), file);
  const index = new DatabaseSync(path.join(active, "index.db"), { readOnly: true });
  try {
    assert.equal(index.prepare("SELECT doc_title FROM documents WHERE document_id='cli/local'").get().doc_title, "CLI local knowledge");
    assert.ok(index.prepare("SELECT count(*) AS n FROM segments_fts WHERE segments_fts MATCH 'cli'").get().n > 0);
    assert.ok(index.prepare("SELECT count(*) AS n FROM documents WHERE catalog_id=6").get().n > 0, "local rules are indexed too");
  } finally { index.close(); }
  const before = fs.readFileSync(pointerFile, "utf8"), corrupt = path.join(c.work, "corrupt.tgz");
  fs.writeFileSync(corrupt, "not a tarball");
  await assert.rejects(c.run(["kb-update", corrupt, "--force"]), failure(/Not a knowledge pack archive/));
  assert.equal(fs.readFileSync(pointerFile, "utf8"), before, "a failed update must preserve the active generation");
  assert.deepEqual(fs.readFileSync(path.join(active, "index.db")), fs.readFileSync(path.join(built.dir, "index.db")));
  if (prefix) {
    const broken = zipFixture({ [`${prefix}cli/local.md`]: "# CLI local knowledge" });
    const central = broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(central >= 0); broken.writeUInt32LE(0, central + 16);
    fs.writeFileSync(path.join(upstream, "docs.zip"), broken);
    await assert.rejects(c.run(["kb-build", upstream, out, "--version", "2.3.5-corrupt"]), failure(/checksum mismatch/));
    assert.equal(fs.readFileSync(pointerFile, "utf8"), before);
  }
});

test("knowledge CLI missing or invalid local inputs fail rather than selecting a remote source", async (t) => {
  const c = localCli(t), out = path.join(c.work, "output");
  await assert.rejects(c.run(["kb-build"]), failure(/usage: deveco-mcp kb-build/));
  await assert.rejects(c.run(["kb-build", c.work, out]), failure(/must contain docs.zip and index.zip/));
  assert.equal(fs.existsSync(out), false);
  await assert.rejects(c.run(["kb-update", path.join(c.work, "missing.tgz")]), failure(/source must be upstream, pack, an existing local tarball or an HTTP\(S\) URL/));
  assert.equal(fs.existsSync(path.join(c.state, "kb/current.json")), false);
});

test("serve-lsp --auto-detect fails on stderr without a project and never searches upward", async (t) => {
  const c = localCli(t);
  const rejected = failure(/serve-lsp --auto-detect: no HarmonyOS project/);
  await assert.rejects(c.run(["serve-lsp", "--auto-detect"]), rejected);
  fs.mkdirSync(path.join(c.work, "AppScope"));
  fs.writeFileSync(path.join(c.work, "build-profile.json5"), "{}\n");
  const child = path.join(c.work, "nested"); fs.mkdirSync(child);
  await assert.rejects(c.run(["serve-lsp", "--auto-detect"], child), rejected);
  // Actual LSP initialize/shutdown/exit and stdin EOF require the configured SDK; no fake server here.
});
