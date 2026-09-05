import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { codeLint } from "../src/deveco-official.mjs";
import { apiCompatibilityCheck } from "../src/deveco-cli.mjs";
import { compatScanResult } from "../src/api-compat-result.mjs";
import { discoverProjectEtsFiles, validateRouterPages } from "../src/arkts-project.mjs";
import { resolveDevecoHome } from "../src/config.mjs";
import { lspOperation, findReferences, setOfficialLspServerForTests } from "../src/lsp.mjs";
import { resolveOfficialArktsServer } from "../src/lsp/server-registry.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-code-中文 空格-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
function env(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
async function write(directory, relative, content) {
  const file = path.join(directory, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}

test("lint treats option-like paths as literal paths and rejects unexecuted incremental checks", async (t) => {
  const directory = await temp(t);
  const entry = await write(directory, "cli.mjs", `
    const args = process.argv.slice(2);
    if (args.includes('--incremental')) { console.error('[Increase Check] Your project is not under git. Please commit and push (Git) it first.'); console.log('No defects found'); }
    else console.log(JSON.stringify(args));
  `);
  env(t, { DEVECO_CLI_ENTRY: entry });
  for (const name of ["--fix", "--help", "中文 空格"]) {
    const text = await codeLint({ project_path: directory, path: name, fix: false });
    const args = JSON.parse(text.split("\n\n")[1]);
    assert.equal(args[2], path.join(directory, name));
    assert.ok(!args.includes("--fix") && !args.includes("--help"));
  }
  await assert.rejects(codeLint({ project_path: directory, incremental: true }),
    (error) => error.code === "DEVECO_CODE_LINT_FAILED" && /no files were checked/.test(error.message));
});

const emptyScanner = {
  exitCode: 1, signal: null, detectedFailure: "Error: Scanner output format unexpected: missing report path.",
  stdout: "[DEBUG] preparation\n[compat:check] === scan stdout ===\nNo API changes found between specified versions.\nAPI change scan completed, took: 0.001 s\n[compat:check] === end stdout ===\n",
  stderr: "Error: Scanner output format unexpected: missing report path.\n",
};
test("compat accepts only a completed empty scan and preserves real scanner failures", async (t) => {
  const directory = await temp(t);
  const result = compatScanResult(emptyScanner, {}, directory, "json");
  assert.equal(result.exitCode, 0);
  assert.equal(result.detectedFailure, "");
  assert.deepEqual(JSON.parse(result.stdout), { records: [], count: 0 });
  for (const overrides of [
    { stdout: "" }, { signal: "SIGTERM" }, { outputTruncated: true },
    { detectedFailure: "Error: failed to build" },
    { stdout: emptyScanner.stdout.replace("=== scan stdout ===", "=== scan stdout (on error) ===") },
    { stdout: emptyScanner.stdout.replace("API change scan completed, took: 0.001 s", "scanner crashed") },
  ]) {
    const failed = { ...emptyScanner, ...overrides };
    assert.equal(compatScanResult(failed, {}, directory, "json"), failed);
  }
  for (const [format, name] of [["json", "报告.json"], ["csv", "report.csv"], ["default", "csv-dir"], ["json", "json-dir"]]) {
    const target = path.join(directory, name);
    if (!path.extname(name)) await fs.mkdir(target);
    const report = compatScanResult(emptyScanner, { output_path: name }, directory, format);
    const saved = /Report: (.+)/.exec(report.stdout)[1];
    const text = await fs.readFile(saved, "utf8");
    if (format === "json") assert.deepEqual(JSON.parse(text), { records: [], count: 0 });
    else assert.match(text, /^\ufeffApi Definition,Language,ChangeId,/);
  }
  assert.throws(() => compatScanResult(emptyScanner, { output_path: "报告.json" }, directory, "json"), { code: "EEXIST" });
  const positive = compatScanResult({ exitCode: 0, stdout: '[DEBUG] preparation\n{"records":[{"changeId":"change"}],"count":1}\n', stderr: "" }, {}, directory, "json");
  assert.equal(JSON.parse(positive.stdout).count, 1);
});

test("compat captures scanner evidence inside its child without changing parent settings", async (t) => {
  const directory = await temp(t);
  const entry = await write(directory, "cli.mjs", `
    if (process.env.DEVECO_CLI_DEBUG !== '1') throw new Error('scanner evidence unavailable');
    console.log(${JSON.stringify(emptyScanner.stdout)});
    console.error(${JSON.stringify(emptyScanner.stderr)});
    process.exitCode = 1;
  `);
  env(t, { DEVECO_CLI_ENTRY: entry, DEVECO_CLI_DEBUG: "" });
  const result = await apiCompatibilityCheck({ project_path: directory, files: ["--help"], source_version: "21", target_version: "22" });
  assert.match(result, /"count": 0/);
  assert.equal(process.env.DEVECO_CLI_DEBUG, "");
});

test("project discovery includes TS sources, barrels, and custom module router profiles", async (t) => {
  const directory = await temp(t);
  await write(directory, "build-profile.json5", "{ modules: [{ name: 'phone', srcPath: './features/手机' }, { name: 'lib', srcPath: './library' }] }");
  const base = "features/手机/src/main/";
  await write(directory, base + "module.json5", "{module:{type:'entry',pages:'$profile:routes'}}");
  await write(directory, base + "resources/base/profile/routes.json", '{"src":["pages/Home","pages/Missing"]}');
  const page = await write(directory, base + "ets/pages/Home.ets", "@Entry @Component struct Home { build() { Text('home') } }");
  const ts = await write(directory, base + "ets/Only.ts", "export const n: number = 1;");
  const barrel = await write(directory, "library/Index.ts", "export const value: number = 1;");
  await write(directory, "library/hvigorfile.ts", "build script, not app source");
  await write(directory, base + "ets/Excluded.d.ts", "declare const n: number;");
  await write(directory, base + "ets/oh_modules/excluded.ets", "invalid");
  const found = discoverProjectEtsFiles(directory);
  assert.deepEqual(new Set(found.files), new Set([page, ts, barrel]));
  const errors = validateRouterPages(directory, found.moduleDirectories);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rule, "page-file-exists");
  assert.match(errors[0].file, /routes.json$/);
  assert.match(errors[0].message, /Missing.ets/);
  await fs.rm(path.join(directory, base, "resources/base/profile/routes.json"));
  assert.equal(validateRouterPages(directory, found.moduleDirectories)[0].rule, "page-profile-invalid");
});

test("single-module layouts resolve pages relative to the module itself", async (t) => {
  const directory = await temp(t);
  await write(directory, "src/main/module.json5", "{module:{pages:'$profile:custom'}}");
  await write(directory, "src/main/resources/base/profile/custom.json", '{"src":["pages/Home"]}');
  await write(directory, "src/main/ets/pages/Home.ets", "@Entry @Component struct Home { build() { Text('home') } }");
  const found = discoverProjectEtsFiles(directory);
  assert.deepEqual(validateRouterPages(directory, found.moduleDirectories), []);
});

test("check_ets_files rejects an empty list at the MCP boundary", async (t) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(repo, "src/server.mjs")], cwd: repo, stderr: "ignore" });
  const client = new Client({ name: "code-regression", version: "1" });
  t.after(() => transport.close());
  await client.connect(transport);
  const result = await client.callTool({ name: "check_ets_files", arguments: { files: [] } });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).code, "SCHEMA_VALIDATION_FAILED");
});

test("official LSP launch disables stdout notices without changing global environment", async (t) => {
  const directory = await temp(t);
  await write(directory, "version.txt", "# Version: 26.0.0\n");
  await write(directory, "arkts-lsp/lib/out/standardIndex/index.js", "");
  env(t, { DEVECO_HOME: directory, DEVECO_CLI_CLT_PATH: directory, DEVECO_CLI_DISABLE_UPDATE: "off", DEVECO_CLI_DEBUG: "1" });
  const spec = resolveOfficialArktsServer(directory);
  assert.equal(spec.env.DEVECO_CLI_DISABLE_UPDATE, "check");
  assert.equal(spec.env.DEVECO_CLI_DEBUG, "");
  assert.equal(process.env.DEVECO_CLI_DEBUG, "1");
  assert.equal(process.env.DEVECO_CLI_DISABLE_UPDATE, "off");
});

for (const locationLink of ["0", "1"]) test(`LSP synchronizes dependencies and filters declarations (LocationLink=${locationLink})`, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-code-中文 空格-"));
  t.after(async () => {
    // Windows locks a running child's cwd. Close it before removing its project.
    await setOfficialLspServerForTests(null);
    await fs.rm(directory, { recursive: true, force: true });
  });
  await write(directory, "build-profile.json5", "{app:{},modules:[]}");
  const model = await write(directory, "Model.ets", "export class Model { value: number = 1; }");
  await write(directory, "Implementation.ets", "export class Implementation extends Model {}");
  const consumer = await write(directory, "Consumer.ets", 'import { Model } from "./Model";\nconst model: Model = new Model();');
  await setOfficialLspServerForTests({ command: process.execPath, args: [path.join(repo, "test/fixtures/code-tools-lsp.mjs")], env: { LOCATION_LINK: locationLink } });
  const hover = (filePath) => lspOperation({ operation: "hover", filePath, line: 1, character: 14 });
  await hover(model);
  await hover(consumer);
  await fs.writeFile(model, "export class Model { value: string = 'changed'; }");
  const updated = JSON.parse((await hover(consumer)).contents);
  assert.ok(updated.some((doc) => doc.text.includes("value: string") && doc.version === 2));
  assert.match(await findReferences({ file: model, line: 1, column: 14, includeDeclaration: true }), /Found 3 references/);
  const filtered = await findReferences({ file: model, line: 1, column: 14, includeDeclaration: false });
  assert.match(filtered, /Found 1 references/);
  assert.doesNotMatch(filtered, /Model\.ets/);
  assert.match(filtered, /Consumer\.ets/);
  await fs.rm(model);
  assert.equal(JSON.parse((await hover(consumer)).contents).length, 1);
});

const sdk = resolveDevecoHome().path;
const tsPath = sdk && ["sdk/default/openharmony", "sdk/openharmony"].map((root) => path.join(sdk, root, "ets/build-tools/ets-loader/node_modules/typescript/lib/typescript.js")).find((file) => fsSync.existsSync(file));
test("resource validation uses the SDK AST: comments and strings are data; actual calls are checked", { skip: tsPath ? false : "requires the SDK ArkTS parser" }, async (t) => {
  const directory = await temp(t);
  await write(directory, "sdk/default/openharmony/previewer/common/resources/entry/resources.txt", "id:1, 'media' 'valid_icon'\n");
  const file = await write(directory, "Main.ets", [
    '// $r("sys.media.comment")',
    '/* $r("sys.media.block") */',
    'const text: string = "$r(\'sys.media.text\')";',
    'const template: string = `$r("sys.media.template")`;',
    '$r("sys.media.valid_icon");',
    '$r(\n "sys.media.real_missing"\n);',
    'const dynamic: string = `${$r("sys.symbol.expression")}`;',
  ].join("\n"));
  const { validateSystemResources } = require("../src/upstream/arkts-check.cjs");
  const errors = validateSystemResources([file], directory, directory, require(tsPath));
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((error) => error.line), [6, 9]);
  assert.match(errors[0].message, /real_missing/);
  assert.match(errors[1].message, /expression/);
});
