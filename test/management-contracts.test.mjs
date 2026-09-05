import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runRegisteredScript } from "../src/script-registry.mjs";
import { validateScriptInput } from "../src/script-contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));

async function session(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deveco 参数 & schema-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "项目 A");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "build-profile.json5"), "{}");
  const clt = path.join(dir, "Command Line Tools");
  await fs.mkdir(path.join(clt, "sdk/default"), { recursive: true });
  await fs.writeFile(path.join(clt, "sdk/default/sdk-pkg.json"), JSON.stringify({ data: { apiVersion: 22, platformVersion: "6.0.2" } }));
  const env = { ...process.env, PROJECT_PATH: project,
    DEVECO_CLI_STUDIO_PATH: "", DEVECO_HOME: "", DEVECO_PATH: "", DEVECO_SDK_HOME: "", DEVECO_CLI_CLT_PATH: clt };
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.mjs"], cwd: root, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr.on("data", data => { stderr += data; });
  const client = new Client({ name: "management-contracts", version: "1" });
  await client.connect(transport);
  // Close the process before removing its working files.
  t.after(async () => { await transport.close(); assert.equal(stderr, "", "stdio discovery must not emit warnings"); });
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return { error: response.isError === true, value: JSON.parse(response.content[0].text) };
  };
  return { client, call, dir, project, env };
}

test("tool discovery and dispatch agree with the fixed inventory", async t => {
  const { client, call, project } = await session(t);
  const tools = (await client.listTools()).tools;
  const names = tools.map(tool => tool.name).sort();
  const declared = manifest.mcp.toolGroups.flatMap(group => group.tools).sort();
  assert.deepEqual(names, declared);
  assert.equal(names.length, 40);
  assert.equal(new Set(names).size, 40);
  assert.equal(manifest.mcp.toolCount, 40);
  for (const tool of tools) new Ajv({ strict: false, formats: { int32: true } }).compile(tool.inputSchema);
  const switchResult = await call("switch_cwd", { project_path: project });
  assert.equal(switchResult.error, false);
  assert.equal(switchResult.value.projectPath, project);
  for (const [name, args] of [
    ["init_project_path", { project_path: project }],
    ["document_validate", { content: "# Feature", documentType: "spec" }],
  ]) {
    assert.ok(!names.includes(name));
    const removed = await call(name, args);
    assert.equal(removed.error, true);
    assert.equal(removed.value.code, "UNKNOWN_TOOL");
  }
  for (const target of ["arkts", "cpp", "all"]) {
    const result = await call("deveco_restart", { target });
    assert.equal(result.error, false);
    assert.deepEqual(result.value.restarted, target === "all" ? ["arkts", "cpp"] : [target]);
  }
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), names);
});

test("catalog returns compact discovery and per-script schemas usable by the execution entry", async t => {
  const { call, project, dir } = await session(t);
  const catalog = await call("deveco_script_catalog");
  assert.equal(catalog.value.count, 7);
  assert.ok(catalog.value.scripts.every(script => script.argsSchema === undefined));
  for (const summary of catalog.value.scripts) {
    const detail = await call("deveco_script_catalog", { script: summary.id });
    assert.equal(detail.value.count, 1);
    const described = detail.value.scripts[0];
    const validate = new Ajv({ strict: false }).compile(described.argsSchema);
    assert.ok(validate(described.example.args), JSON.stringify(validate.errors));
    assert.deepEqual(validateScriptInput(summary.id, described.example), described.example.args);
  }
  const sdk = await call("deveco_script", { script: "detect_sdk" });
  assert.equal(sdk.error, false, JSON.stringify(sdk));
  assert.equal(sdk.value.parsed.apiLevel, 22);
  const created = await call("deveco_script", { script: "copy_template", args: { projectPath: dir, appName: "SchemaApp" } });
  assert.equal(created.error, false, JSON.stringify(created));
  assert.ok((await fs.stat(path.join(dir, "SchemaApp/AppScope/app.json5"))).isFile());
  const log = "Error name: TypeError\nError message: schema round trip\nStacktrace:\nat run (pages/Index.ets:12:5)";
  await fs.writeFile(path.join(project, "崩溃 & log.txt"), log);
  for (const id of ["parse_jscrash_log", "jscrash_report"]) {
    const named = await call("deveco_script", { script: id, args: { logFile: "崩溃 & log.txt", includeText: true } });
    const raw = await call("deveco_script", { script: id, argv: ["--log-file", "崩溃 & log.txt", "--include-text"] });
    assert.equal(named.error, false, JSON.stringify(named));
    assert.equal(raw.error, false, JSON.stringify(raw));
    assert.equal(named.value.cwd, project);
    assert.equal(named.value.parsed.error_message, "schema round trip");
    assert.deepEqual(raw.value.parsed, named.value.parsed);
  }
});

test("invalid script inputs fail through MCP before files or devices are touched", async t => {
  const { call, dir } = await session(t);
  const inputs = [
    { script: "copy_template", args: { projectPath: dir } },
    { script: "copy_template", args: { projectPath: dir, appName: "Rejected", bundleName: "bad\"id" } },
    { script: "copy_template", argv: ["--project-path", dir, "--app-name", "Rejected", "--typo", "x"] },
    { script: "detect_sdk", args: { appName: "IgnoredBefore" } },
    { script: "detect_sdk", args: {}, argv: [] },
    { script: "collect_hilog", args: {} },
    { script: "collect_hilog", argv: ["--output-dir", dir, "--lines", "NaN"] },
    { script: "fetch_faultlog", args: { faultlogName: "../escape.log", outputDir: dir } },
    { script: "probe_faultlogger", argv: ["--limit", "1.5"] },
    { script: "probe_faultlogger", argv: ["--limit", "1", "--limit", "2"] },
    { script: "jscrash_report", args: { logFile: "missing.log", logText: "other" } },
    { script: "jscrash_report", args: { lines: 199 } },
    { script: "parse_jscrash_log", args: {} },
    { script: "parse_jscrash_log", argv: ["--log-file"] },
    { script: "parse_jscrash_log", args: { logText: "--include-text" } },
    { script: "parse_jscrash_log", args: { logText: "x", typo: "ignored" } },
    { script: "probe_faultlogger", args: { limit: "ten" } },
  ];
  for (const input of inputs) {
    const result = await call("deveco_script", input);
    assert.equal(result.error, true, JSON.stringify(input));
    assert.equal(result.value.code, "SCRIPT_ARGS_INVALID", JSON.stringify(result));
    assert.match(result.value.hint, /deveco_script_catalog/);
  }
  for (const input of [
    { script: "parse_jscrash_log", args: { logText: ["x"] } },
    { script: "probe_faultlogger", args: { limit: {} } },
    { script: "__proto__" },
  ]) assert.equal((await call("deveco_script", input)).value.code, "SCHEMA_VALIDATION_FAILED");
  assert.equal((await call("deveco_script_catalog", { script: "missing" })).error, true);
  await assert.rejects(fs.stat(path.join(dir, "Rejected")), { code: "ENOENT" });
  await assert.rejects(runRegisteredScript("__proto__"), { code: "UNKNOWN_SCRIPT" });
});

test("raw argv validates numeric ranges, flags and optional text consistently on every platform", () => {
  assert.deepEqual(validateScriptInput("probe_faultlogger", { argv: ["--device-id", "--max-age-minutes", "0.5", "--limit", "2"] }),
    { deviceId: "", maxAgeMinutes: 0.5, limit: 2 });
  assert.deepEqual(validateScriptInput("collect_hilog", { argv: ["--output-dir", "C:\\项目 Space\\logs", "--lines", "100"] }),
    { outputDir: "C:\\项目 Space\\logs", lines: 100 });
  for (const argv of [["--max-age-minutes", "-1"], ["--limit", "Infinity"], ["--limit", ""], ["--limit=2"], ["positional"]]) {
    assert.throws(() => validateScriptInput("probe_faultlogger", { argv }), { code: "SCRIPT_ARGS_INVALID" });
  }
});

test("installers render the MCP entry in each host's configuration format", async () => {
  const entry = { command: "node", args: [path.join(root, "src/server.mjs")] };
  const base = await run(process.execPath, ["scripts/install.mjs", "--print-mcp"], { cwd: root });
  assert.deepEqual(JSON.parse(base.stdout), entry);
  const host = await run(process.execPath, ["scripts/install-host.mjs", "--host", "claude", "--print-mcp"], { cwd: root });
  assert.deepEqual(JSON.parse(host.stdout), { mcpServers: { "deveco-tool": entry } });
  const codex = await run(process.execPath, ["scripts/install-host.mjs", "--host", "codex", "--print-mcp"], { cwd: root });
  assert.equal(codex.stdout, `# Append to ~/.codex/config.toml\n[mcp_servers.deveco-tool]\ncommand = "node"\nargs = [${JSON.stringify(entry.args[0])}]\n`);
  for (const command of [
    ["scripts/install.mjs"],
    ["scripts/install-host.mjs", "--host", "claude"],
    ["scripts/install-host.mjs", "--host", "codex"],
  ]) {
    await assert.rejects(run(process.execPath, [...command, "--print-mcp", "--mcp-profile", "sdd"], { cwd: root }),
      error => /Unknown argument: --mcp-profile/.test(error.stderr));
  }
});
