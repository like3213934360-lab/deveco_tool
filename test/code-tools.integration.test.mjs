import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { officialArktsServerStatus } from "../src/lsp/server-registry.mjs";
import { resolveDevecoToolchain } from "../src/config.mjs";
import { parseJson5 } from "../src/build-profile.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const available = officialArktsServerStatus().installed;
const options = { skip: available ? false : "requires an installed official SDK and LSP backend", timeout: 240000 };
async function fixture(t, name = "中文 工程") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-live-"));
  const project = path.join(temporary, name);
  await fs.cp(path.join(repo, "test/fixtures/harmony-app"), project, { recursive: true });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(repo, "src/server.mjs")], cwd: repo, stderr: "ignore",
    env: { ...process.env, PROJECT_PATH: project, DEVECO_CLI_DISABLE_UPDATE: "off", DEVECO_CLI_DEBUG: "", DEVECO_LSP_IDLE_MS: "180000" } });
  const client = new Client({ name: "code-tools-live-regression", version: "1" });
  t.after(async () => { await transport.close(); await fs.rm(temporary, { recursive: true, force: true }); });
  await client.connect(transport);
  const call = async (name, args, expectedError = false) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    assert.equal(result.isError === true, expectedError, `${name}: ${text}`);
    return text;
  };
  const write = async (file, text) => {
    const target = path.join(project, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
    return target;
  };
  await call("switch_cwd", { project_path: project });
  return { project, call, write };
}

test("live MCP: lint read-only scope, fixes, Git prerequisite and API negative/positive reports", options, async (t) => {
  // Hvigor rejects non-ASCII project roots before compileNative; test the
  // scanner on its supported path set. Other groups exercise Unicode roots.
  const { project, call, write } = await fixture(t, "Harmony project");
  const file = "entry/src/main/ets/model/Lint.ets";
  const original = "export function value(): number {\n  let answer: number = 42;\n  return answer;\n}\n";
  await write(file, original);
  await write("--fix/OnlyThis.ets", "export const valid: number = 1;\n");
  await write("audit-linter.json5", JSON.stringify({ files: ["**/*.ets"], ignore: ["**/oh_modules/**", "**/build/**"], rules: { "prefer-const": "error" } }));
  const lint = { config_path: "audit-linter.json5", format: "json", timeoutMs: 60000 };
  await call("code_lint", { ...lint, path: "--fix", fix: false });
  assert.equal(await fs.readFile(path.join(project, file), "utf8"), original);
  await call("code_lint", { ...lint, path: "--help" }, true);
  await call("code_lint", { ...lint, incremental: true }, true);
  const fixed = await call("code_lint", { ...lint, path: file, fix: true });
  assert.match(fixed, /fix|defects/i);
  assert.match(await fs.readFile(path.join(project, file), "utf8"), /const answer/);
  await write(".gitignore", "oh_modules/\n.hvigor/\n.cache/\n**/build/\n");
  for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Test fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  await write(file, original);
  assert.match(await call("code_lint", { ...lint, path: file, incremental: true }), /prefer-const/);
  const versions = await call("api_compat_check", { action: "versions", format: "json" });
  assert.match(versions, /HarmonyOS_6\.0\.2\(22\)_Release/);
  const empty = { source_version: "HarmonyOS_6.0.1(21)_Release", target_version: "HarmonyOS_6.0.2(22)_Release", files: [file], format: "json", timeoutMs: 120000 };
  assert.match(await call("api_compat_check", empty), /"count": 0/);
  await call("api_compat_check", { ...empty, output_path: "empty.json" });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, "empty.json"), "utf8")), { records: [], count: 0 });
  await call("api_compat_check", { ...empty, source_version: "invalid" }, true);
  const compat = "entry/src/main/ets/pages/Compat.ets";
  await write(compat, '@Component\nexport struct Compat {\n  build() {\n    List() { ListItem() { Text("Audit") } }\n      .backToTop(true)\n  }\n}\n');
  await call("api_compat_check", { ...empty, source_version: "HarmonyOS_5.0.5(17)_Release", target_version: "HarmonyOS_5.1.0(18)_Release", files: [compat], output_path: "positive.json" });
  const positive = JSON.parse(await fs.readFile(path.join(project, "positive.json"), "utf8"));
  assert.equal(positive.count, 1);
  assert.equal(positive.records[0].changeId, "CH2025041542754");
});

test("live MCP: default LSP startup, declaration filtering, dependent edits and all operations", options, async (t) => {
  const { call, write } = await fixture(t);
  const model = "entry/src/main/ets/model/Model.ets";
  const consumer = "entry/src/main/ets/model/Consumer.ets";
  const source = 'export interface Shape { area(): number; }\nexport class Square implements Shape {\n  area(): number { return 4; }\n}\nexport class Model { value: number = 1; }\n';
  await write(model, source);
  await write(consumer, 'import { Model } from "./Model";\nexport const model: Model = new Model();\nexport const result = model.value;\n');
  await write("entry/src/main/ets/model/ShapeUser.ets", 'import { Shape, Square } from "./Model";\nexport const shape: Shape = new Square();\nexport const result: number = shape.area();\n');
  assert.match(await call("get_hover", { file: model, line: 5, column: 23, timeoutMs: 120000 }), /number/);
  assert.match(await call("get_hover", { file: consumer, line: 3, column: 29 }), /number/);
  await write(model, source.replace("value: number = 1", 'value: string = "new"'));
  assert.match(await call("get_hover", { file: consumer, line: 3, column: 29 }), /string/);
  assert.match(await call("go_to_definition", { file: consumer, line: 3, column: 29 }), /Model\.ets/);
  const references = { file: model, line: 5, column: 23 };
  assert.match(await call("find_references", { ...references, includeDeclaration: true }), /Found 2 references/);
  const usages = await call("find_references", { ...references, includeDeclaration: false });
  assert.match(usages, /Found 1 references/);
  assert.doesNotMatch(usages, /Model\.ets/);
  for (const operation of ["hover", "goToDefinition", "findReferences", "goToImplementation"]) {
    const text = await call("lsp", { operation, filePath: model, line: 1, character: 18 });
    assert.ok(text.length > 0);
    if (operation === "goToImplementation") assert.match(text, /"line": 1/);
  }
  const area = { file: model, line: 1, column: 26 };
  assert.match(await call("find_references", { ...area, includeDeclaration: true }), /Found 3 references/);
  const areaUsages = await call("find_references", { ...area, includeDeclaration: false });
  assert.match(areaUsages, /Found 1 references/);
  assert.match(areaUsages, /ShapeUser\.ets/);
});

test("live MCP: resource syntax, TS project scan and renamed module pages", options, async (t) => {
  const { project, call, write } = await fixture(t);
  const file = "entry/src/main/ets/model/Comment.ets";
  await write(file, '// $r("sys.media.missing_comment")\nexport const description: string = "$r(\'sys.media.missing_string\')";\n');
  for (const name of ["arkts_check", "check_ets_files"]) await call(name, { files: [file] });
  await write("entry/src/main/ets/model/Error.ts", 'export const invalid: number = "wrong";\n');
  const invalid = JSON.parse(await call("arkts_check", {}, true));
  assert.ok(invalid.errors.some((error) => /Error\.ts$/.test(error.file)));
  await fs.rm(path.join(project, "entry/src/main/ets/model/Error.ts"));
  await fs.mkdir(path.join(project, "features"));
  await fs.rename(path.join(project, "entry"), path.join(project, "features", "phone"));
  const profilePath = path.join(project, "build-profile.json5");
  await fs.writeFile(profilePath, (await fs.readFile(profilePath, "utf8")).replace('"./entry"', '"./features/phone"'));
  await write("features/phone/src/main/resources/base/profile/main_pages.json", '{"src":["pages/Index","pages/Missing"]}');
  const missing = JSON.parse(await call("arkts_check", {}, true));
  assert.ok(missing.errors.some((error) => error.rule === "page-file-exists" && /Missing/.test(error.message)));
});

test("live MCP: project SDK removes API 12 false positives without suppressing real compatibility warnings", options, async (t) => {
  const { project, call, write } = await fixture(t);
  const file = "entry/src/main/ets/model/SdkApi.ets";
  await write(file, "export function translate(tabs: TabsController): void {\n  tabs.setTabBarTranslate({ x: 0, y: 1 });\n}\n");
  const profile = parseJson5(await fs.readFile(path.join(project, "build-profile.json5"), "utf8"));
  profile.app.products.push({ name: "legacy", compatibleSdkVersion: 12, runtimeOS: "OpenHarmony" });
  profile.app.products[0].compatibleSdkVersion = "6.1.0(23)";
  profile.app.products[0].targetSdkVersion = "6.1.0(23)";
  await write("build-profile.json5", JSON.stringify(profile));
  for (const name of ["arkts_check", "check_ets_files"]) {
    for (const product of ["legacy", "default"]) {
      const result = JSON.parse(await call(name, { files: [file], product }));
      assert.equal(result.sdkConfiguration.compatibleSdkVersion, product === "legacy" ? 12 : 23);
      assert.equal(result.sdkConfiguration.runtimeOS, product === "legacy" ? "OpenHarmony" : "HarmonyOS");
      const warnings = result.errors.filter((error) => /setTabBarTranslate.*supported since SDK version 13/.test(error.message));
      assert.equal(warnings.length, product === "legacy" ? 1 : 0, JSON.stringify(result));
    }
    const bad = JSON.parse(await call(name, { files: [file], product: "missing" }, true));
    assert.equal(bad.code, "ARKTS_SDK_CONFIG_INVALID");
  }
  // Re-read on every call: do not retain a product's previous compatible API in a long-lived MCP.
  profile.app.products[0].compatibleSdkVersion = "5.0.0(12)";
  await write("build-profile.json5", JSON.stringify(profile));
  const changed = JSON.parse(await call("arkts_check", {}));
  assert.equal(changed.sdkConfiguration.compatibleSdkVersion, 12);
  assert.ok(changed.errors.some((error) => /setTabBarTranslate.*current compatible SDK version is 5\.0\.0\(12\)/.test(error.message)));
  profile.app.products[0].compatibleSdkVersion = "26.0.0";
  profile.app.products[0].targetSdkVersion = "26.0.0";
  await write("build-profile.json5", JSON.stringify(profile));
  const msf = JSON.parse(await call("check_ets_files", { files: [file] }));
  assert.equal(msf.sdkConfiguration.compatibleSdkVersion, 260000);
  assert.ok(!msf.errors.some((error) => /setTabBarTranslate.*supported since/.test(error.message)));
});

test("live MCP: C++ diagnostics remain fresh after editing with a prepared compilation database", options, async (t) => {
  const { project, call, write } = await fixture(t);
  const file = await write("entry/src/main/cpp/audit.cpp", "int add(int a, int b) { return a + b; }\n");
  const compiler = path.join(resolveDevecoToolchain().paths.sdk, "openharmony/native/llvm/bin", process.platform === "win32" ? "clang++.exe" : "clang++");
  await write(".idea/.deveco/cxx/compile_commands.json", JSON.stringify([{ directory: path.dirname(file), file, arguments: [compiler, "-c", file] }]));
  const good = await call("check_cpp_files", { files: [file] });
  assert.doesNotMatch(good, /undeclared identifier/);
  await fs.writeFile(file, "int broken() { return missing_name; }\n");
  assert.match(await call("check_cpp_files", { files: [file] }), /missing_name/);
});
