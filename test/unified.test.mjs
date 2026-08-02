import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listScripts, runRegisteredScript } from "../src/script-registry.mjs";
import { arktsCheckStatus, runArktsCheck } from "../src/arkts-check.mjs";
import { hdcFailureMessage, hdcLog, hdcStatus } from "../src/hdc-log.mjs";
import { hdcFailureMessage as skillHdcFailureMessage } from "../skills/arkts-runtime-fix/scripts/shared/hdc.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function makeFakeHdc(body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-hdc-test-"));
  const executable = path.join(directory, "hdc");
  await fs.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { directory, executable };
}

async function withHdcPath(executable, operation) {
  const previous = process.env.HDC_PATH;
  process.env.HDC_PATH = executable;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.HDC_PATH;
    else process.env.HDC_PATH = previous;
  }
}

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
    cwd: REPO_ROOT,
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
  assert.equal(result.tools.length, 26);
  assert.equal(result.tools.filter((tool) => tool.name === "check_ets_files").length, 1);

  const catalog = await client.callTool({ name: "deveco_script_catalog", arguments: {} });
  const parsed = JSON.parse(catalog.content[0].text);
  assert.equal(parsed.count, 7);
});

test("ArkTS checker and check_ets_files accept the bundled HarmonyOS template", async () => {
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

    const compatibleResult = await client.callTool({ name: "check_ets_files", arguments: { files: [file] } });
    assert.equal(compatibleResult.isError, false);
    const compatiblePayload = JSON.parse(compatibleResult.content[0].text);
    assert.equal(compatiblePayload.success, true);
    assert.equal(compatiblePayload.summary.errorCount, 0);

    const missingResult = await client.callTool({
      name: "check_ets_files",
      arguments: { files: [path.join(projectPath, "Missing.ets")] },
    });
    assert.equal(missingResult.isError, true);
    const missingPayload = JSON.parse(missingResult.content[0].text);
    assert.equal(missingPayload.code, "ARKTS_FILE_NOT_FOUND");
  } finally {
    await transport.close();
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("ArkTS checker returns structured diagnostics for invalid source", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-invalid-"));
  await fs.cp(path.resolve("skills/deveco-create-project/application"), projectPath, { recursive: true });
  const brokenFile = path.join(projectPath, "entry/src/main/ets/pages/Broken.ets");
  await fs.writeFile(
    brokenFile,
    "@Entry\n@Component\nstruct Broken {\n  build() {\n    Image($r('sys.media.__deveco_tool_missing_resource__'))\n  }\n}\n",
  );
  try {
    const payload = await runArktsCheck({
      files: [brokenFile],
      project_path: projectPath,
      timeoutMs: 180000,
    });
    assert.equal(payload.success, false);
    assert.ok(payload.summary.errorCount > 0);
    assert.ok(payload.errors.some((diagnostic) => diagnostic.file.endsWith("Broken.ets")));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("HDC failure markers are errors even when the process exits zero", () => {
  const result = {
    stdout: "[Fail]Not match target founded, check connect-key please\n",
    stderr: "",
    exitCode: 0,
  };
  assert.match(hdcFailureMessage(result), /Not match target/);
  assert.match(skillHdcFailureMessage(result), /Not match target/);
  assert.equal(hdcFailureMessage({ stdout: "device-1\n", stderr: "", exitCode: 0 }), "");
});

test("runtime Skill scripts reject HDC failure text with a zero exit code", async () => {
  const devecoHome = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-skill-hdc-"));
  const nodeMarker = path.join(devecoHome, "tools/node/bin/node");
  const hdc = path.join(devecoHome, "sdk/default/openharmony/toolchains/hdc");
  const outputDirectory = path.join(devecoHome, "output");
  await fs.mkdir(path.dirname(nodeMarker), { recursive: true });
  await fs.mkdir(path.dirname(hdc), { recursive: true });
  await fs.writeFile(nodeMarker, "", { mode: 0o755 });
  await fs.writeFile(hdc, "#!/bin/sh\nprintf '[Fail]Not match target founded, check connect-key please\\n'\nexit 0\n", { mode: 0o755 });

  try {
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        path.join(REPO_ROOT, "skills/arkts-runtime-fix/scripts/collect-hilog.mjs"),
        "--output-dir",
        outputDirectory,
      ], {
        cwd: REPO_ROOT,
        env: { ...process.env, DEVECO_HOME: devecoHome },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.stdout, /status:\s*collect_failed/);
    assert.match(outcome.stdout, /Not match target/);
  } finally {
    await fs.rm(devecoHome, { recursive: true, force: true });
  }
});

test("hdc_log rejects missing, unknown, and ambiguous devices", async () => {
  const empty = await makeFakeHdc("printf '[Empty]\\n'");
  try {
    await withHdcPath(empty.executable, async () => {
      await assert.rejects(() => hdcLog({ action: "collect" }), (error) => error.code === "HDC_NO_DEVICE");
    });
  } finally {
    await fs.rm(empty.directory, { recursive: true, force: true });
  }

  const multiple = await makeFakeHdc("printf 'device-a\\ndevice-b\\n'");
  try {
    await withHdcPath(multiple.executable, async () => {
      await assert.rejects(() => hdcLog({ action: "collect" }), (error) => error.code === "HDC_DEVICE_REQUIRED");
      await assert.rejects(
        () => hdcLog({ action: "clear", device_id: "missing" }),
        (error) => error.code === "HDC_DEVICE_NOT_FOUND",
      );
    });
  } finally {
    await fs.rm(multiple.directory, { recursive: true, force: true });
  }
});

test("hdc_log rejects zero-exit command failures after device validation", async () => {
  const fake = await makeFakeHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
else
  printf '[Fail]Not match target founded, check connect-key please\\n'
fi`);
  try {
    await withHdcPath(fake.executable, async () => {
      await assert.rejects(
        () => hdcLog({ action: "clear", device_id: "device-a" }),
        (error) => error.code === "HDC_COMMAND_FAILED",
      );
    });
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("stdio EOF shuts down the MCP server within six seconds", { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let stdout = "";
  const initialized = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP initialize response timed out")), 7000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (/"id"\s*:\s*1/.test(stdout)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "deveco-eof-test", version: "0.1.0" },
    },
  })}\n`);

  try {
    await initialized;
    const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    const startedAt = Date.now();
    child.stdin.end();
    const outcome = await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("MCP server did not exit after stdin EOF")), 6000)),
    ]);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.signal, null);
    assert.ok(Date.now() - startedAt < 6000);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
