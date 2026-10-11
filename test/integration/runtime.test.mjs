// Exercise the actual launcher, compiled MCP and npm archive, with isolated checkouts/state.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { buildPackage } from "../../tools/build.mjs";
import { verifyBuild } from "../../bin/runtime.mjs";
import { connect } from "../support/mcp.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const connections = new Map();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-runtime-"));
  for (const name of ["src", "bin", "tools", "knowledge", "templates", "resources", "README.md", "LICENSE", "package.json", "package-lock.json"])
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "junction");
  setVersion(dir, "1.0.0");
  const clients = [];
  connections.set(t, clients);
  t.after(async () => {
    await Promise.all(clients.filter((c) => c.child.exitCode === null && c.child.signalCode === null).map((c) => c.close()));
    fs.rmSync(dir, { recursive: true, force: true });
    connections.delete(t);
  });
  return dir;
}
function setVersion(dir, version) {
  for (const name of ["package.json", "package-lock.json"]) {
    const file = path.join(dir, name), pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    if (pkg.packages) pkg.packages[""].version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  }
}
function client(t, dir, entry = "bin/deveco-mcp.mjs") {
  const c = connect({ DEVECO_STATE_DIR: path.join(dir, "state"), DEVECO_CONFIG: path.join(dir, "none.json") }, path.join(dir, entry));
  connections.get(t).push(c);
  return c;
}
function run(dir, entry = "bin/deveco-mcp.mjs") {
  return spawnSync(process.execPath, [path.join(dir, entry), "--version"], { encoding: "utf8", timeout: 30000 });
}

test("upgrades bind version to code and preserve old processes' lazy chunks, including same-version edits", async (t) => {
  const dir = fixture(t), original = await buildPackage(dir);
  const old = client(t, dir);
  assert.equal((await old.initialize()).result.serverInfo.version, "1.0.0");
  for (const file of Object.keys(original.files)) fs.utimesSync(path.join(dir, "dist", file), 1, 1);
  // Legacy chunks from a pre-generation server must survive the first migration too.
  fs.mkdirSync(path.join(dir, "dist/chunks"));
  fs.writeFileSync(path.join(dir, "dist/chunks/legacy.js"), "// retained for an existing server\n");
  fs.utimesSync(path.join(dir, "dist/chunks/legacy.js"), 1, 1);
  setVersion(dir, "1.0.1");
  const updated = client(t, dir, "dist/cli.js");
  assert.equal((await updated.initialize()).result.serverInfo.version, "1.0.1");
  assert.match(updated.stderr, /rebuilding/);
  assert.ok(fs.existsSync(path.join(dir, "dist/chunks/legacy.js")));
  assert.equal((await old.request("prompts/list")).result.prompts.length, 3);
  assert.equal((await old.initialize()).result.serverInfo.version, "1.0.0");
  const server = path.join(dir, "src/server.ts");
  fs.writeFileSync(server, fs.readFileSync(server, "utf8").replace("HarmonyOS/ArkTS development tools.", "Same-version source edit."));
  const edited = client(t, dir);
  const response = await edited.initialize();
  assert.equal(response.result.serverInfo.version, "1.0.1");
  assert.match(response.result.instructions, /Same-version source edit/);
  assert.match(edited.stderr, /rebuilding/);
  assert.notEqual(verifyBuild(dir).input_hash, original.input_hash);
  await Promise.all([old.close(), updated.close(), edited.close()]);
});

test("a failed compile cannot publish or silently start the last valid build", async (t) => {
  const dir = fixture(t), original = await buildPackage(dir);
  const pointer = fs.readFileSync(path.join(dir, "dist/current.json"), "utf8");
  fs.appendFileSync(path.join(dir, "src/server.ts"), "\nconst = ;\n");
  const failed = run(dir);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /Local build failed/);
  assert.equal(fs.readFileSync(path.join(dir, "dist/current.json"), "utf8"), pointer);
  assert.equal(run(dir, `dist/${original.entry}`).stdout.trim(), "1.0.0");
  assert.ok(fs.readdirSync(path.join(dir, "dist/builds")).every((f) => !f.startsWith(".staging")));
});

test("missing/corrupt output is rebuilt locally and rejected in a source-less installation", async (t) => {
  const dir = fixture(t), first = await buildPackage(dir);
  fs.rmSync(path.join(dir, "dist", first.entry));
  const rebuilt = run(dir);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(rebuilt.stdout.trim(), "1.0.0");
  const manifest = verifyBuild(dir), entry = path.join(dir, "dist", manifest.entry);
  const bytes = fs.readFileSync(entry);
  fs.rmSync(path.join(dir, "src"), { recursive: true });
  fs.rmSync(path.join(dir, "tools"), { recursive: true });
  fs.appendFileSync(entry, "\n// corrupt output\n");
  const corrupt = run(dir);
  assert.equal(corrupt.status, 1);
  assert.equal(corrupt.stdout, "");
  assert.match(corrupt.stderr, /Missing or changed build output/);
  fs.writeFileSync(entry, bytes);
  setVersion(dir, "1.0.2");
  const mislabeled = run(dir);
  assert.equal(mislabeled.status, 1);
  assert.equal(mislabeled.stdout, "");
  assert.match(mislabeled.stderr, /does not match/);
});

test("simultaneous first launches publish complete generations and keep stdout valid JSON-RPC", async (t) => {
  const dir = fixture(t), a = client(t, dir), b = client(t, dir);
  const results = await Promise.all([a.initialize(), b.initialize()]);
  for (const r of results) assert.equal(r.result.serverInfo.version, "1.0.0");
  verifyBuild(dir);
  await Promise.all([a.close(), b.close()]);
});

test("npm pack builds current sources and ships only the selected generation, which starts without build tools", async (t) => {
  const dir = fixture(t), old = await buildPackage(dir);
  setVersion(dir, "1.0.1");
  const npmCli = process.env.npm_execpath ?? path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  const result = execFileSync(process.execPath, [npmCli, "pack", "--json", "--offline", "--pack-destination", dir], {
    cwd: dir, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  const [packed] = JSON.parse(result), manifest = verifyBuild(dir);
  const files = new Set(packed.files.map((f) => f.path));
  assert.equal(manifest.version, "1.0.1");
  assert.ok(!files.has(`dist/${old.entry}`));
  assert.ok(!files.has("tools/build.mjs"));
  assert.ok(!files.has("src/cli.ts"));
  assert.deepEqual([...files].filter((f) => f.startsWith("dist/")).sort(),
    ["dist/cli.js", "dist/current.json", ...Object.keys(manifest.files).map((f) => `dist/${f}`)].sort());
  // Install outside the checkout: ancestor node_modules must not accidentally provide esbuild.
  const installed = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-package-"));
  t.after(() => fs.rmSync(installed, { recursive: true, force: true }));
  execFileSync("tar", ["-xzf", path.join(dir, packed.filename), "-C", installed]);
  const packageDir = path.join(installed, "package");
  const copied = new Set();
  function installProduction(dependencies) {
    for (const name of Object.keys(dependencies ?? {})) {
      if (copied.has(name)) continue;
      copied.add(name);
      const source = path.join(root, "node_modules", name);
      fs.cpSync(source, path.join(packageDir, "node_modules", name), { recursive: true });
      installProduction(JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).dependencies);
    }
  }
  installProduction(JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).dependencies);
  assert.throws(() => createRequire(path.join(packageDir, "package.json")).resolve("esbuild"), { code: "MODULE_NOT_FOUND" });
  const c = client(t, packageDir);
  assert.equal((await c.initialize()).result.serverInfo.version, "1.0.1");
  assert.equal((await c.request("prompts/list")).result.prompts.length, 3);
  assert.doesNotMatch(c.stderr, /rebuilding/);
  await c.close();
});

test("test layout rejects retired runners, broken references and runtime dependencies on tests", async () => {
  const ts = await import("typescript");
  for (const dir of ["audit", "smoke", "media", "archive", "legacy", "deprecated"]) assert.equal(fs.existsSync(path.join(root, "test", dir)), false, dir);
  const folders = ["unit", "integration", "e2e", "model", "support", "fixtures"];
  assert.deepEqual(fs.readdirSync(path.join(root, "test"), { withFileTypes: true }).filter((f) => f.isDirectory()).map((f) => f.name).sort(), folders.sort());
  const files = ["test", "tools", "bin", "src"].flatMap((dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).filter((f) => /\.(mjs|ts)$/.test(f)).map((f) => path.join(root, dir, f)));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    assert.equal(ast.parseDiagnostics.length, 0, file);
    if (file.startsWith(path.join(root, "test")) || file.startsWith(path.join(root, "tools"))) {
      assert.doesNotMatch(source, /(?:test\/(?:audit|smoke|media)\/|tools\/(?:model-|mcp-client|prompt-audit|recording-check)\w*\.mjs)/, file);
    }
    // Upstream extraction fixtures are source snippets, not executable modules.
    if (file.startsWith(path.join(root, "test/fixtures/upstream") + path.sep)) continue;
    for (const item of ast.statements) if (ts.isImportDeclaration(item)) {
      const name = item.moduleSpecifier.text;
      if (!name.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), name);
      assert.ok(fs.existsSync(target) || target.endsWith(".js") && fs.existsSync(target.slice(0, -3) + ".ts"), `${file}: ${name}`);
      if (/^[/\\](src|bin)[/\\]/.test(file.slice(root.length))) assert.ok(!target.startsWith(path.join(root, "test")), `Runtime imported a test: ${file}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const command of Object.values(pkg.scripts)) for (const match of command.matchAll(/(?:node|tsc) (?:-p )?((?:test|tools|bin)\/[\w/.-]+)/g)) assert.ok(fs.existsSync(path.join(root, match[1])), command);
  const program = ts.createProgram(files.filter((f) => f.includes(`${path.sep}e2e${path.sep}`)), {
    allowJs: true, checkJs: true, noEmit: true, types: ["node"], skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  const missing = ts.getPreEmitDiagnostics(program).filter((d) => [2304, 2305, 2307, 2552, 2554].includes(d.code));
  assert.deepEqual(missing.map((d) => `${d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`), []);
});
