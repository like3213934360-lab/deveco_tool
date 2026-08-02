import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listScripts, runRegisteredScript } from "../src/script-registry.mjs";
import { arktsCheckStatus } from "../src/arkts-check.mjs";
import { hdcStatus } from "../src/hdc-log.mjs";

test("the script registry exposes the seven allowlisted Skill scripts", () => {
  const scripts = listScripts();
  assert.equal(scripts.length, 7);
  assert.deepEqual(scripts.map((script) => script.id), [
    "copy_template",
    "detect_sdk",
    "collect_hilog",
    "fetch_faultlog",
    "jscrash_report",
    "parse_jscrash_log",
    "probe_faultlogger",
  ]);
  assert.ok(scripts.every((script) => script.file.startsWith("skills/")));
});

test("registered scripts return parsed key/value output", async () => {
  const result = await runRegisteredScript("parse_jscrash_log", {
    args: {
      logText: "Error: TypeError: Cannot read property 'x' of undefined",
      source: "text",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.parsed.status, "detected");
  assert.equal(result.parsed.source, "text");
});

test("local diagnostics dependencies are discoverable", () => {
  assert.equal(arktsCheckStatus().installed, true);
  assert.equal(hdcStatus().installed, true);
});

test("unified MCP advertises scripts, diagnostics, LSP, and CodeGenie tools", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-tool-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
  });
  await client.connect(transport);
  const result = await client.listTools();
  const names = new Set(result.tools.map((tool) => tool.name));
  for (const name of [
    "deveco_script_catalog", "deveco_script", "switch_cwd", "deveco_doctor",
    "arkts_check", "hdc_log", "find_references", "go_to_definition",
    "get_hover", "list_symbols", "find_call_hierarchy", "lsp", "build_project",
  ]) assert.ok(names.has(name), `missing tool ${name}`);

  const catalog = await client.callTool({ name: "deveco_script_catalog", arguments: {} });
  const parsed = JSON.parse(catalog.content[0].text);
  assert.equal(parsed.count, 7);
});

test("ArkTS checker accepts the bundled HarmonyOS template", async () => {
  const templatePath = path.resolve("skills/deveco-create-project/application");
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-test-"));
  await fs.cp(templatePath, projectPath, { recursive: true });
  const file = path.join(projectPath, "entry/src/main/ets/pages/Index.ets");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: path.resolve("."),
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-tool-check-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    await client.callTool({ name: "switch_cwd", arguments: { project_path: projectPath } });
    const result = await client.callTool({ name: "arkts_check", arguments: { files: [file] } });
    assert.equal(result.isError, false);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, true);
    assert.equal(payload.summary.errorCount, 0);
  } finally {
    await transport.close();
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
