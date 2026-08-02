import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listScripts, parseScriptOutput, runRegisteredScript } from "../src/script-registry.mjs";
import { arktsCheckStatus, runArktsCheck } from "../src/arkts-check.mjs";
import { buildArgs, buildProject, devecoCliFailureMessage } from "../src/deveco-cli.mjs";
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

test("the script registry exposes the allowlisted Skill scripts", () => {
  const scripts = listScripts();
  assert.equal(scripts.length, 20);
  assert.deepEqual(scripts.map((script) => script.id), [
    "copy_template",
    "detect_sdk",
    "collect_hilog",
    "fetch_faultlog",
    "jscrash_report",
    "parse_jscrash_log",
    "probe_faultlogger",
    "search_practices",
    "d2c_pixso_arkts",
    "ui_score",
    "apifault_collect_hilog",
    "apifault_analyze_media",
    "appfreeze_analyze",
    "appfreeze_sample_stack",
    "arkts_docs_search",
    "arkui_docs_search",
    "arkui_docs_rebuild_index",
    "instrument_test_run",
    "local_test_run",
    "memleak_analyze",
  ]);
  assert.ok(scripts.every((script) => script.file.startsWith("skills/")));
  // Every registered script must exist on disk; a typo in a path would otherwise only surface
  // when someone actually calls that script.
  for (const script of scripts) {
    assert.ok(fsSync.existsSync(path.resolve(script.file)), `${script.id} points at a missing file`);
  }
  assert.ok(scripts.every((script) => ["node", "python"].includes(script.runtime)));
  assert.equal(scripts.filter((script) => script.runtime === "python").length, 11);
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
    "document_validate",
  ]) assert.ok(names.has(name), `missing tool ${name}`);
  assert.equal(result.tools.length, 24);
  assert.equal(result.tools.filter((tool) => tool.name === "check_ets_files").length, 1);
  for (const disabled of ["verify_ui", "save_ui_screenshot", "get_ui_verification_log"]) {
    assert.ok(!names.has(disabled), `disabled tool ${disabled} is still advertised`);
    const call = await client.callTool({ name: disabled, arguments: {} });
    assert.equal(call.isError, true);
    assert.equal(JSON.parse(call.content[0].text).code, "TOOL_DISABLED");
  }

  const catalog = await client.callTool({ name: "deveco_script_catalog", arguments: {} });
  const parsed = JSON.parse(catalog.content[0].text);
  assert.equal(parsed.count, 20);
});

test("ArkTS checker and check_ets_files accept a stock HarmonyOS project", async () => {
  const templatePath = path.resolve("test/fixtures/harmony-app");
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
  await fs.cp(path.resolve("test/fixtures/harmony-app"), projectPath, { recursive: true });
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

test("a project-wide scan finds errors in a multi-module project", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-multimodule-"));
  await fs.cp(path.resolve("test/fixtures/harmony-app"), projectPath, { recursive: true });
  // Reshape the single-module template into a multi-module layout. `entry/` at
  // the project root is the only place the upstream checker ever looked, so a
  // project without it used to report a clean result no matter what it held.
  await fs.mkdir(path.join(projectPath, "commons"), { recursive: true });
  await fs.rename(path.join(projectPath, "entry"), path.join(projectPath, "commons", "core"));
  const profile = path.join(projectPath, "build-profile.json5");
  await fs.writeFile(profile, (await fs.readFile(profile, "utf8")).replace('"./entry"', '"./commons/core"'));
  await fs.writeFile(
    path.join(projectPath, "commons/core/src/main/ets/pages/Broken.ets"),
    "export class Broken {\n  static run(): void {\n    let loose: any = 1;\n    console.log(loose);\n  }\n}\n",
  );

  try {
    const payload = await runArktsCheck({ project_path: projectPath, timeoutMs: 600000 });
    assert.equal(payload.scan.mode, "project");
    assert.deepEqual(payload.scan.sourceRoots, [path.join("commons", "core", "src", "main", "ets")]);
    assert.ok(payload.checkedFileCount > 0, "the scan must resolve files to check");
    assert.equal(payload.internalError, undefined);
    assert.equal(payload.success, false);
    assert.ok(payload.errors.some((diagnostic) => diagnostic.file.endsWith("Broken.ets")
      && diagnostic.rule === "arkts-no-any-unknown"));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("a project-wide scan refuses to report success when it resolves no sources", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-nosources-"));
  try {
    await assert.rejects(
      () => runArktsCheck({ project_path: projectPath }),
      (error) => error.code === "ARKTS_NO_FILES_DISCOVERED",
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("the args object form maps camelCase onto the kebab flags d2c_pixso_arkts expects", async () => {
  // Unlike search_practices, this script has no positional arguments, so the object form works.
  // The engine is not exercised here: the DSL paths do not exist, so it exits non-zero after
  // parsing. What is asserted is the flag mapping.
  const result = await runRegisteredScript("d2c_pixso_arkts", {
    args: {
      occurrence: "/nonexistent/design.occurrence.json",
      full: "/nonexistent/design.full.json",
      out: path.join(os.tmpdir(), "deveco-d2c-argv-test.ets"),
      structName: "DemoPage",
      rawOut: path.join(os.tmpdir(), "deveco-d2c-argv-test.raw.json"),
    },
  });
  assert.equal(result.runtime, "node");
  assert.deepEqual(result.argv.filter((token) => token.startsWith("--")), [
    "--occurrence", "--full", "--out", "--struct-name", "--raw-out",
  ]);
  assert.equal(result.ok, false, "missing input files must not read as a clean run");
});

test("a python script reports a missing interpreter instead of failing obscurely", async () => {
  const saved = process.env.PYTHON;
  process.env.PYTHON = path.join(os.tmpdir(), "deveco-no-such-python");
  try {
    await assert.rejects(
      () => runRegisteredScript("ui_score", { argv: ["--help"] }),
      (error) => error.code === "PYTHON_NOT_FOUND",
    );
  } finally {
    if (saved === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = saved;
  }
});

test("script output parsing ignores narrative lines that look like fields", () => {
  const parsed = parseScriptOutput([
    "status: detected",
    "error_message: Cannot read property 'cardList' of undefined",
    "",
    "Top stack:",
    "    at buildCardList (entry/src/main/ets/pages/CardCatalog.ets:142:19)",
    "08-02 14:34:32.838  2047 59682 I C02D13/hdcd/HDC_LOG: FetchCommand channelId:2454900664",
    "Module name:com.example.app",
    "next_action: inspect the anchor",
  ].join("\n"));

  assert.deepEqual(Object.keys(parsed), ["status", "error_message", "next_action"]);
  assert.equal(parsed.error_message, "Cannot read property 'cardList' of undefined");
});

test("detect_sdk runs as a script instead of exiting silently", async () => {
  const result = await runRegisteredScript("detect_sdk", {});
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined, "the script must write its result to stdout");
  assert.ok(Number.isInteger(result.parsed?.apiLevel));
  assert.ok(result.parsed.sdkVersion);
});

test("crash parsing reports the declared message, not the nearest crash-ish line", async () => {
  const crashLog = [
    "Module name:com.example.app",
    "Pid:23145",
    "Reason:TypeError",
    "Error name:TypeError",
    "Error message:Cannot read property 'cardList' of undefined",
    "Stacktrace:",
    "    at buildCardList (entry/src/main/ets/pages/CardCatalog.ets:142:19)",
  ].join("\n");

  const detected = await runRegisteredScript("parse_jscrash_log", { argv: ["--log-text", crashLog] });
  assert.equal(detected.parsed.status, "detected");
  assert.equal(detected.parsed.error_message, "Cannot read property 'cardList' of undefined");
  assert.equal(detected.parsed.suspected_file, "entry/src/main/ets/pages/CardCatalog.ets:142:19");

  // A snapshot with no crash must not promote an unrelated trailing log line.
  const clean = await runRegisteredScript("parse_jscrash_log", {
    argv: ["--log-text", "08-02 14:29:47 I wifi: AIWifiInfo:txRate:24747\n08-02 14:29:48 I powermgr: lux=17.9"],
  });
  assert.equal(clean.parsed.status, "no_crash_signature");
  assert.equal(clean.parsed.error_message, "(not found)");
});

test("search_practices returns entries from the ArkUI practice library", async () => {
  const result = await runRegisteredScript("search_practices", {
    argv: ["Swiper", "--limit=3", "--json"],
  });
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.parsed?.results));
  assert.ok(result.parsed.results.length > 0, "a common component must match at least one practice");
});

test("build_project keeps the parameter contract the CodeGenie tool had", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-stub-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  // Echo the arguments so the orchestration can be asserted without a real build.
  await fs.writeFile(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  await fs.writeFile(path.join(project, "build-profile.json5"), '{"modules": []}\n');

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const logPath = path.join(project, "build.log");
  const report = await buildProject({
    project_path: project,
    module: "entry@default",
    build_mode: "debug",
    clean: true,
    log_path: logPath,
    enable_inspector_source_jump: true,
  });

  // clean means clean *and then* build, unlike upstream's clean-only.
  assert.ok(report.includes('["build","clean"]'), "clean must run first");
  assert.ok(
    report.includes('["build","--modules","entry@default","--build-mode","debug"]'),
    "the build must still run after the clean",
  );
  // Capability gaps are announced rather than silently dropped.
  assert.ok(report.includes("enable_inspector_source_jump has no DevEco CLI equivalent"));
  assert.ok((await fs.readFile(logPath, "utf8")).includes("build"), "log_path must receive the transcript");

  // The single-value `module` and the `modules` array are equivalent.
  assert.deepEqual(
    buildArgs({ modules: ["entry@default"], build_mode: "debug" }),
    ["build", "--modules", "entry@default", "--build-mode", "debug"],
  );
});

test("DevEco CLI failures are errors even when the process exits zero", () => {
  assert.equal(devecoCliFailureMessage({ exitCode: 0, stdout: "Build completed successfully", stderr: "" }), "");
  assert.ok(devecoCliFailureMessage({
    exitCode: 0,
    stdout: "Launching com.example/EntryAbility...\nerror: failed to start ability.",
    stderr: "",
  }));
  assert.ok(devecoCliFailureMessage({ exitCode: 1, stdout: "", stderr: "boom" }));
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

test("initialize is answered without waiting on the CodeGenie child", async () => {
  // The gateway used to await the CodeGenie handshake before connecting its own
  // transport. That handshake intermittently never completes, so roughly one
  // start in six produced a server that never answered initialize at all and
  // took every local tool down with it.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const child = spawn(process.execPath, ["src/server.mjs"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "deveco-initialize-test", version: "0.1.0" },
        },
      })}\n`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`initialize timed out on attempt ${attempt}`)), 5000);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          if (/"id"\s*:\s*1/.test(stdout)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    } finally {
      child.kill("SIGKILL");
    }
  }
});

test("a CodeGenie child that never answers degrades to the local tools", { timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-codegenie-stall-"));
  const entry = path.join(directory, "never-answers.mjs");
  // Reads nothing, writes nothing, stays alive: the observed failure mode.
  await fs.writeFile(entry, "setInterval(() => {}, 1000);\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    env: { ...process.env, DEVECO_CODEGENIE_ENTRY: entry },
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-stall-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  await client.connect(transport);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(names.length, 21, "the 21 local tools must still be advertised");
  assert.ok(names.includes("arkts_check"));
  // build_project and start_app run through the bundled DevEco CLI, so a stalled
  // CodeGenie child no longer costs the ability to build and launch.
  assert.ok(names.includes("build_project"), "building must survive a stalled CodeGenie child");
  assert.ok(names.includes("start_app"), "launching must survive a stalled CodeGenie child");
  assert.ok(!names.includes("check_cpp_files"), "genuinely proxied tools are unavailable while the child is stalled");

  // Local tools must keep working rather than inheriting the child's stall.
  const status = await client.callTool({ name: "deveco_status", arguments: {} });
  assert.equal(status.isError, false);
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
