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
import { resolveDevecoHome } from "../src/config.mjs";
import { buildArgs, buildProject, devecoCliFailureMessage } from "../src/deveco-cli.mjs";
import { uiFind, uiSnapshot, uiTap } from "../src/device-ui.mjs";
import { hdcFailureMessage, hdcLog, hdcStatus } from "../src/hdc-log.mjs";
import { hdcFailureMessage as skillHdcFailureMessage } from "../skills/arkts-runtime-fix/scripts/shared/hdc.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// A few tests need a real DevEco Studio SDK on this machine: the ArkTS linter resolves its rule
// set out of it, hdc ships inside its toolchain, and detect_sdk reads its sdk-pkg.json. CI runners
// and contributors without DevEco installed must not see those as failures, so they announce
// themselves as skipped instead. Everything else -- including the HDC tests, which drive a fake
// hdc through HDC_PATH -- runs anywhere.
//
// Five tests need it. An earlier pass claimed four, measured by pointing DEVECO_HOME at an empty
// directory on macOS. That proxy was not faithful -- the linter still succeeded there while it
// fails on Linux -- so the stock-project test slipped through and turned CI red on Node 20 and 22.
// The count now comes from the real CI run rather than from a local simulation, and the probe
// below reads the SDK itself: sdk-pkg.json is what detect_sdk loads, the linter resolves its rule
// set beside it, and hdc ships under the same tree. Probing one tool inside the SDK is exactly how
// the stock-project test came to look runnable on a machine where it was not.
const DEVECO_SDK = (() => {
  const home = resolveDevecoHome().path;
  return Boolean(home) && fsSync.existsSync(path.join(home, "sdk", "default", "sdk-pkg.json"));
})();
const NEEDS_DEVECO_SDK = DEVECO_SDK ? false : "requires a local DevEco Studio SDK";

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
  assert.equal(scripts.length, 19);
  assert.deepEqual(scripts.map((script) => script.id), [
    "copy_template",
    "detect_sdk",
    "collect_hilog",
    "fetch_faultlog",
    "jscrash_report",
    "parse_jscrash_log",
    "probe_faultlogger",
    "search_practices",
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

test("local diagnostics dependencies are discoverable", { skip: NEEDS_DEVECO_SDK }, () => {
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
    "document_validate", "ui_snapshot", "ui_find", "ui_tap",
  ]) assert.ok(names.has(name), `missing tool ${name}`);
  assert.equal(result.tools.length, 28);
  assert.equal(result.tools.filter((tool) => tool.name === "check_ets_files").length, 1);
  for (const disabled of ["verify_ui", "save_ui_screenshot", "get_ui_verification_log"]) {
    assert.ok(!names.has(disabled), `disabled tool ${disabled} is still advertised`);
    const call = await client.callTool({ name: disabled, arguments: {} });
    assert.equal(call.isError, true);
    assert.equal(JSON.parse(call.content[0].text).code, "TOOL_DISABLED");
  }

  const catalog = await client.callTool({ name: "deveco_script_catalog", arguments: {} });
  const parsed = JSON.parse(catalog.content[0].text);
  assert.equal(parsed.count, 19);
});

test("a timed-out script takes its grandchildren with it", async () => {
  // Registered scripts shell out to hvigor, ohpm, hdc and Python workers. The timeout used to send
  // one SIGTERM to the direct child and return immediately, so those grandchildren survived every
  // timeout and piled up across a session. Verified against a real tree rather than a mock,
  // because what is being tested is process-group semantics, not our own bookkeeping.
  const { terminateProcessTree } = await import("../src/process-tree.mjs");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tree-"));
  // Parent ignores SIGTERM so the escalation to SIGKILL is what actually ends it.
  const parentScript = path.join(directory, "parent.mjs");
  const childScript = path.join(directory, "grandchild.mjs");
  await fs.writeFile(childScript, "setInterval(() => {}, 1000);\nconsole.log(process.pid);\n");
  await fs.writeFile(parentScript, [
    'import { spawn } from "node:child_process";',
    'process.on("SIGTERM", () => {});',
    `const kid = spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: "ignore" });`,
    "console.log(JSON.stringify({ parent: process.pid, grandchild: kid.pid }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const child = spawn(process.execPath, [parentScript], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  try {
    const pids = await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(() => reject(new Error("the fixture never reported its pids")), 10000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        const line = stdout.split("\n").find((entry) => entry.trim().startsWith("{"));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
      });
    });

    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(alive(pids.grandchild), "the fixture grandchild should be running before we start");

    terminateProcessTree(child, 300);
    await new Promise((resolve) => { setTimeout(resolve, 2000); });

    assert.equal(alive(pids.parent), false, "the direct child must be gone");
    assert.equal(alive(pids.grandchild), false, "the grandchild must go too, or hvigor daemons leak");
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already reaped */ }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a timed-out DevEco CLI run does not leave its children behind", async () => {
  // build_project and start_app go through runDevecoCli, not the script registry, so fixing the
  // registry left this path still sending a single SIGTERM to the direct child. Upstream has no
  // timeout here at all -- runBundledDevecoCli is Bun.spawn plus await proc.exited -- so the
  // deadline, and the cleanup it makes necessary, are both this pack's own.
  const { runDevecoCli } = await import("../src/deveco-cli.mjs");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-tree-"));
  const marker = path.join(directory, "child.pid");
  const fakeCli = path.join(directory, "cli.mjs");
  // Ignores SIGTERM and starts a child, mirroring a CLI whose hvigor front-end outlives a polite
  // signal. Writes the child's pid so the test can check the whole group actually went away.
  await fs.writeFile(fakeCli, [
    'import { spawn } from "node:child_process";',
    'import fs from "node:fs";',
    'process.on("SIGTERM", () => {});',
    'const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    `fs.writeFileSync(${JSON.stringify(marker)}, String(kid.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = fakeCli;
  try {
    await assert.rejects(
      () => runDevecoCli([], { cwd: directory, timeoutMs: 1000 }),
      (error) => error.code === "DEVECO_CLI_TIMEOUT",
    );

    // Give the SIGTERM -> SIGKILL escalation time to land.
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    const childPid = Number(await fs.readFile(marker, "utf8"));
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.equal(alive(childPid), false, "the CLI's child must not survive the timeout");
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the CLI and the MCP report the same doctor findings", async (t) => {
  // PACK.md told people to run `npm run doctor` to check DevEco Studio, HDC, the ArkTS checker
  // and login state, but the CLI only ever reported the environment and the script registry --
  // those checks existed solely in the MCP tool. Both now render one report; assert they agree.
  const cli = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.mjs", "doctor"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.once("error", reject);
    child.once("close", () => resolve(JSON.parse(stdout)));
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-doctor-test", version: "0.1.0" });
  t.after(async () => { await transport.close(); });
  await client.connect(transport);
  const mcp = JSON.parse((await client.callTool({ name: "deveco_doctor", arguments: {} })).content[0].text);

  assert.deepEqual(Object.keys(cli).sort(), Object.keys(mcp).sort());
  for (const key of ["python", "arktsChecker", "devecoCli", "lsp", "hdc", "auth"]) {
    assert.ok(key in cli, `the CLI must report ${key}; PACK.md promises it`);
  }
  // Only the CodeGenie section may differ: the CLI does not start the child unless asked.
  assert.equal(cli.codegenie.available, "not probed");
  assert.deepEqual(cli.codegenie.advertised, mcp.codegenie.advertised);
});

test("the static proxy table still matches what the CodeGenie child advertises", async () => {
  // tools/list is answered from a hand-copied table so a stalled child cannot delay discovery.
  // That table is only safe while it agrees with the child; if CodeGenie changes a schema, hosts
  // would otherwise keep calling the old shape. Fail here rather than in a host.
  const { PROXIED_CODEGENIE_TOOLS } = await import("../src/codegenie-tools.mjs");
  const { getCodeGenieTools, closeCodeGenie } = await import("../src/codegenie-client.mjs");

  let live;
  try {
    live = await getCodeGenieTools();
  } catch (error) {
    // The child is optional; a machine without it must not fail the suite on drift it cannot see.
    assert.equal(error.code, "CODEGENIE_UNAVAILABLE");
    return;
  } finally {
    await closeCodeGenie().catch(() => {});
  }

  for (const expected of PROXIED_CODEGENIE_TOOLS) {
    const actual = live.find((tool) => tool.name === expected.name);
    assert.ok(actual, `CodeGenie no longer advertises ${expected.name}`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      JSON.parse(JSON.stringify(expected)),
      `${expected.name} drifted from src/codegenie-tools.mjs`,
    );
  }
});

test("ArkTS checker and check_ets_files accept a stock HarmonyOS project", { skip: NEEDS_DEVECO_SDK }, async () => {
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

test("ArkTS checker returns structured diagnostics for invalid source", { skip: NEEDS_DEVECO_SDK }, async () => {
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

test("a project-wide scan finds errors in a multi-module project", { skip: NEEDS_DEVECO_SDK }, async () => {
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

test("detect_sdk runs as a script instead of exiting silently", { skip: NEEDS_DEVECO_SDK }, async () => {
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

test("a CodeGenie child that never answers cannot delay tool discovery", { timeout: 60000 }, async (t) => {
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

  // The whole point of the static proxy table: discovery must not wait on the child at all.
  // This used to take ~14s (2 handshake attempts x 2 five-second timeouts), which is past the
  // point where hosts abandon tool discovery and show the server as connected but toolless.
  const startedAt = Date.now();
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1000, `tools/list must not wait on the child; took ${elapsed}ms`);

  assert.equal(names.length, 28, "all 28 tools must be advertised even while the child is stalled");
  assert.ok(names.includes("arkts_check"));
  // The capture/find/tap loop runs over hdc in-process, so a stalled child must not reach it.
  for (const local of ["ui_snapshot", "ui_find", "ui_tap"]) {
    assert.ok(names.includes(local), `${local} must survive a stalled CodeGenie child`);
  }
  // build_project and start_app run through the bundled DevEco CLI, so a stalled
  // CodeGenie child no longer costs the ability to build and launch.
  assert.ok(names.includes("build_project"), "building must survive a stalled CodeGenie child");
  assert.ok(names.includes("start_app"), "launching must survive a stalled CodeGenie child");

  // Proxied tools stay advertised and fail loudly on call. A tool that silently vanishes from
  // the list looks to a host exactly like a tool that never existed, which is not actionable.
  assert.ok(names.includes("check_cpp_files"), "proxied tools stay advertised from the static table");
  const proxied = await client.callTool({ name: "check_cpp_files", arguments: { files: ["/tmp/none.cpp"] } });
  assert.equal(proxied.isError, true);
  assert.match(proxied.content[0].text, /CODEGENIE_UNAVAILABLE/);

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

// --- device-UI fast path (src/device-ui.mjs) ----------------------------------------------------
//
// All of these drive a fake hdc through HDC_PATH, so they run on CI with no device and no DevEco.
// The fake writes to the LAST argv element because `file recv` puts the destination there and the
// `-t <device>` prefix shifts every positional index, and it appends every invocation to a log so
// tests can assert which commands actually ran rather than only what came back.

const SNAPSHOT_OK = "printf 'process: display 0, file type: jpeg, width: 1276, height: 2848\\n';"
  + " printf 'success: snapshot display 0 , write to /d/x.jpeg as jpeg, width: 1276, height: 2848\\n'";

// device-ui.mjs caches "this device has no snapshot_display" for the life of the process, keyed by
// device id. Sharing one device name across tests therefore leaks that verdict forward and silently
// routes later captures down the screenCap fallback, so every fake gets its own device by default.
let fakeDeviceCounter = 0;

async function makeUiHdc({ devices, snapshot = SNAPSHOT_OK, recv = 'write_jpeg "$last"' } = {}) {
  const device = `device-${(fakeDeviceCounter += 1)}`;
  const advertised = devices ?? device;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-ui-test-"));
  const log = path.join(directory, "argv.log");
  const marks = path.join(directory, "marks.log");
  const body = [
    `LOG="${log}"`,
    `MARKS="${marks}"`,
    'printf \'%s\\n\' "$*" >> "$LOG"',
    'for a in "$@"; do last="$a"; done',
    'pad() { i=0; while [ $i -lt 60 ]; do printf \'0123456789\' >> "$1"; i=$((i+1)); done; }',
    'write_jpeg() { printf \'\\377\\330\\377\\341\' > "$1"; pad "$1"; }',
    'write_png() { printf \'\\211PNG\\015\\012\\032\\012\' > "$1"; pad "$1"; }',
    'case "$*" in',
    `  *"list targets"*) printf '${advertised}\\n' ;;`,
    `  *snapshot_display*) ${snapshot} ;;`,
    "  *screenCap*) printf 'ScreenCap saved to /d/x.png\\n' ;;",
    "  *dumpLayout*) printf 'DumpLayout saved to:/d/x.json\\n' ;;",
    "  *uiInput*) printf 'No Error\\n' ;;",
    `  *"file recv"*) ${recv} ;;`,
    "esac",
  ].join("\n");
  const executable = path.join(directory, "hdc");
  await fs.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return {
    device,
    directory,
    executable,
    async argv() {
      return (await fs.readFile(log, "utf8")).split("\n").filter(Boolean);
    },
    async marks() {
      return (await fs.readFile(marks, "utf8")).split("\n").filter(Boolean);
    },
  };
}

function uiTempTarget(name) {
  return path.join(os.tmpdir(), `deveco-ui-target-${process.pid}-${name}`);
}

test("ui_snapshot reads the native size from one line and the written size from the other", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("native.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  assert.equal(report.method, "snapshot_display");
  assert.equal(report.deviceId, fake.device);
  assert.equal(report.localPath, target);
  assert.equal(report.nativeWidth, 1276);
  assert.equal(report.nativeHeight, 2848);
  // Native capture is the default precisely so this stays 1: a caller that reads a pixel off the
  // returned frame must never need to scale it to get a device coordinate.
  assert.equal(report.coordinateScale, 1);
  assert.equal(report.mimeType, "image/jpeg");
  assert.ok(report.bytes >= 512);

  const argv = await fake.argv();
  const capture = argv.find((line) => line.includes("snapshot_display"));
  // Defaulting -i to 0 breaks unfolded foldables, 2-in-1 and external displays, so it is only ever
  // sent when the caller named a display.
  assert.ok(!capture.includes(" -i "), `-i must be omitted when displayId is unset: ${capture}`);
  assert.ok(!capture.includes(" -w "), `no rescale without an explicit width: ${capture}`);
});

test("ui_snapshot passes -i only when displayId is given", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("display.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, displayId: 2 }));
  const capture = (await fake.argv()).find((line) => line.includes("snapshot_display"));
  assert.match(capture, /-i 2/);
});

test("ui_snapshot falls back to screenCap when snapshot_display fails at exit 0", async (t) => {
  // The exact hole this module exists around: `hdc shell` returns 0 whatever the remote command
  // did, and a bare "error:" line matches none of hdc-log's transport failure patterns. Success has
  // to be a positive marker, never the absence of a negative one.
  const fake = await makeUiHdc({
    snapshot: "printf 'error: something went wrong\\n'",
    recv: 'write_png "$last"',
  });
  const target = uiTempTarget("fallback.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(target.replace(/\.jpeg$/, ".png"), { force: true });
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  assert.equal(report.method, "uitest-screenCap");
  assert.equal(report.mimeType, "image/png");
  // screenCap writes PNG bytes. Leaving them at the requested .jpeg path would be a lie the caller
  // has no way to detect, so the destination moves and both paths come back.
  assert.ok(report.localPath.endsWith(".png"), report.localPath);
  assert.equal(report.requestedPath, target);
  assert.match(report.fallbackReason, /error/i);
});

test("a device without snapshot_display is probed once, not on every call", async (t) => {
  const fake = await makeUiHdc({
    snapshot: "printf 'inaccessible or not found\\n'",
    recv: 'write_png "$last"',
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await uiSnapshot({ localPath: uiTempTarget("probe1.jpeg") });
    await uiSnapshot({ localPath: uiTempTarget("probe2.jpeg") });
  });

  const attempts = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  // Falling back costs the failed attempt plus the slower path, which is worse than the tool being
  // replaced. A device that has no snapshot_display will never grow one, so that verdict sticks.
  assert.equal(attempts.length, 1, "a permanently missing snapshot_display must not be re-probed");
});

test("format png keeps the lossless full-resolution path available", async (t) => {
  // snapshot_display only writes jpeg, so png has to route to screenCap. This is the guarantee that
  // adding the fast path took nothing away: a caller that wants a lossless native frame still gets
  // one. It also covers the same skip branch as the cached-unavailable path.
  const fake = await makeUiHdc({ recv: 'write_png "$last"' });
  const target = uiTempTarget("lossless.png");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, format: "png" }));
  assert.equal(report.method, "uitest-screenCap");
  assert.equal(report.mimeType, "image/png");
  assert.equal(report.localPath, target);
  assert.equal(report.requestedPath, undefined, "png was asked for, so nothing was substituted");
  assert.equal(report.fallbackReason, undefined, "an explicit png request is a choice, not a fallback");
  const argv = await fake.argv();
  assert.equal(argv.filter((line) => line.includes("snapshot_display")).length, 0);
  assert.ok(argv.some((line) => line.includes("screenCap")));
});

test("ui_snapshot does not fall back after a timeout", async (t) => {
  const fake = await makeUiHdc({ snapshot: "sleep 3" });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("timeout.jpeg"), timeoutMs: 1000 }),
      (error) => error.code === "HDC_TIMEOUT",
    );
  });
  // A wedged device would time out on screenCap too, so retrying there only doubles the wait.
  assert.equal((await fake.argv()).filter((line) => line.includes("screenCap")).length, 0);
});

test("ui_snapshot rejects an empty transfer instead of reporting success", async (t) => {
  const fake = await makeUiHdc({ recv: ": " });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("empty.jpeg") }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
});

test("ui_snapshot rejects a transfer that is not an image", async (t) => {
  // uitest and snapshot_display write plain-text failures into the -f/-p target and recv pulls them
  // back faithfully; without a magic-byte check they would arrive as a successful screenshot.
  const fake = await makeUiHdc({ recv: 'printf \'dump failed: no permission................................................\' > "$last"' });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("text.jpeg") }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
});

test("a failed ui_snapshot never leaves the previous frame in place as if it were new", async (t) => {
  // Device paths are reused, so without staging a failed recv would leave the earlier call's file
  // at the destination, pass every size and format check, and hand back a stale screenshot -- worse
  // than an error, because nothing about it looks wrong.
  const fake = await makeUiHdc({ recv: ": " });
  const target = uiTempTarget("stale.jpeg");
  const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(600, 0x41)]);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, original);
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: target }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
  assert.deepEqual(await fs.readFile(target), original, "the earlier frame must be left untouched");
  assert.equal(fsSync.existsSync(`${target}.part`), false, "staging file must not survive a failure");
});

test("ui_snapshot resolves devices the same way hdc_log does", async (t) => {
  const empty = await makeUiHdc({ devices: "[Empty]" });
  const two = await makeUiHdc({ devices: "device-a\\ndevice-b" });
  t.after(async () => {
    await fs.rm(empty.directory, { recursive: true, force: true });
    await fs.rm(two.directory, { recursive: true, force: true });
  });

  await withHdcPath(empty.executable, async () => {
    await assert.rejects(() => uiSnapshot({}), (error) => error.code === "HDC_NO_DEVICE");
  });
  await withHdcPath(two.executable, async () => {
    await assert.rejects(() => uiSnapshot({}), (error) => error.code === "HDC_DEVICE_REQUIRED");
    await assert.rejects(
      () => uiSnapshot({ hvd: "device-z" }),
      (error) => error.code === "HDC_DEVICE_NOT_FOUND",
    );
  });
});

test("concurrent ui_snapshot calls on one device do not overlap", async (t) => {
  // uitest is a singleton daemon on the device: two concurrent captures genuinely fail, and the
  // fixed per-process device path would collide even if they did not.
  const fake = await makeUiHdc({
    snapshot: `printf 'BEGIN\\n' >> "$MARKS"; sleep 0.4; printf 'END\\n' >> "$MARKS"; ${SNAPSHOT_OK}`,
  });
  const first = uiTempTarget("serial1.jpeg");
  const second = uiTempTarget("serial2.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(first, { force: true });
    await fs.rm(second, { force: true });
  });

  const reports = await withHdcPath(fake.executable, () => Promise.all([
    uiSnapshot({ localPath: first }),
    uiSnapshot({ localPath: second }),
  ]));
  assert.deepEqual(await fake.marks(), ["BEGIN", "END", "BEGIN", "END"]);
  assert.deepEqual(reports.map((report) => report.localPath), [first, second]);
});

// A layout dump shaped like a real one: the wrapper around `content`, inconsistent spacing inside
// $rect, an off-screen node and a zero-area node.
const SAMPLE_DUMP = {
  ProcessID: 46711,
  VsyncID: 587458,
  WindowID: 82,
  content: {
    $ID: 1,
    $type: "root",
    $rect: "[0.00, 0.00],[1276.00,2848.00]",
    $attrs: {},
    $children: [
      {
        $ID: 5,
        $type: "Text",
        $rect: "[604.00, 2689.00],[675.00,2730.00]",
        $attrs: { content: "工具", key: "tab_tools" },
        $children: [],
      },
      { $ID: 6, $type: "Text", $rect: "[357.00,2689.00],[428.00, 2730.00]", $attrs: { content: "首页" } },
      { $ID: 7, $type: "Button", $rect: "[10.00,9000.00],[100.00,9100.00]", $attrs: { content: "屏幕外" } },
      { $ID: 8, $type: "Text", $rect: "[5.00,5.00],[5.00,5.00]", $attrs: { content: "零面积" } },
    ],
  },
};

async function writeDump(t, value) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-ui-dump-"));
  const dumpPath = path.join(directory, "layout.json");
  await fs.writeFile(dumpPath, typeof value === "string" ? value : JSON.stringify(value));
  t.after(async () => await fs.rm(directory, { recursive: true, force: true }));
  return dumpPath;
}

test("ui_find turns a layout dump into tap coordinates without touching a device", async (t) => {
  // This is the arithmetic that decides where every tap lands, so it is checked against the value
  // measured on a real device: the 工具 tab centres on (640, 2710). An estimate read off a
  // screenshot put it at (640, 2670) -- 40px out, which a smaller target would have missed.
  const dumpPath = await writeDump(t, SAMPLE_DUMP);

  const byText = await uiFind({ dumpPath, text: "工具" });
  assert.equal(byText.matchCount, 1);
  assert.deepEqual(byText.matches[0].center, { x: 640, y: 2710 });
  assert.equal(byText.matches[0].key, "tab_tools");
  assert.equal(byText.matches[0].type, "Text");
  assert.equal(byText.deviceId, null);
  assert.deepEqual(byText.screen, [0, 0, 1276, 2848]);

  // key is the only selector that survives a copy change or a locale switch.
  assert.equal((await uiFind({ dumpPath, key: "tab_tools" })).matches[0].id, 5);
  assert.equal((await uiFind({ dumpPath, key: "nope" })).matchCount, 0);

  assert.equal((await uiFind({ dumpPath, type: "Button", onScreenOnly: false })).matchCount, 1);
  assert.equal((await uiFind({ dumpPath, text: "工" })).matchCount, 1, "substring match");

  // Off-screen and zero-area nodes are in the dump but tapping their centres does nothing, and the
  // caller cannot tell that apart from a broken tap.
  const onScreen = await uiFind({ dumpPath });
  assert.deepEqual(onScreen.matches.map((match) => match.text), ["工具", "首页"]);
  const everything = await uiFind({ dumpPath, onScreenOnly: false });
  assert.deepEqual(everything.matches.map((match) => match.text), ["工具", "首页", "屏幕外", "零面积"]);

  const limited = await uiFind({ dumpPath, onScreenOnly: false, limit: 1 });
  assert.equal(limited.matches.length, 1);
  assert.equal(limited.matchCount, 4);
  assert.equal(limited.truncated, true);
});

test("ui_find reads the accessibility dump shape that uitest actually emits", async (t) => {
  // The fixture above is CodeGenie's get_app_ui_tree shape. `uitest dumpLayout` -- which is what
  // ui_find itself runs -- emits this one instead: children/attributes, bounds as [x1,y1][x2,y2]
  // with no comma between the pairs, and type/key/clickable all inside attributes. Captured from a
  // real device, where the first pass returned every type as "" because it only looked at $type.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]", text: "" },
    children: [
      {
        attributes: {
          type: "Stack", bounds: "[372,389][905,1452]", text: "8月10日, 星期一",
          key: "sl_clock", id: "sl_clock", clickable: "true", enabled: "true", visible: "true",
        },
        children: [],
      },
      {
        attributes: {
          type: "Text", bounds: "[100,100][200,140]", text: "只是标签",
          key: "", id: "", clickable: "false", enabled: "true", visible: "true",
        },
      },
      {
        attributes: {
          type: "Text", bounds: "[100,200][200,240]", text: "隐藏的",
          clickable: "true", enabled: "true", visible: "false",
        },
      },
    ],
  });

  const clock = await uiFind({ dumpPath, text: "8月10日" });
  assert.equal(clock.matchCount, 1);
  assert.equal(clock.matches[0].type, "Stack", "type lives in attributes in this shape");
  assert.equal(clock.matches[0].key, "sl_clock");
  assert.equal(clock.matches[0].clickable, true, "string flags must be read as booleans");
  assert.deepEqual(clock.matches[0].center, { x: 639, y: 921 });

  // The visible text is frequently a label nested inside whatever handles the tap.
  const tappable = await uiFind({ dumpPath, clickableOnly: true });
  assert.deepEqual(tappable.matches.map((match) => match.text), ["8月10日, 星期一"]);

  // An explicit visible:false beats the geometry, which would have called this one on-screen.
  assert.deepEqual((await uiFind({ dumpPath })).matches.map((match) => match.text),
    ["8月10日, 星期一", "只是标签"]);
  assert.equal((await uiFind({ dumpPath, onScreenOnly: false })).matchCount, 3);
});

test("clickableOnly is a selector, not only a filter", async (t) => {
  // A real launcher screen carried 35 clickable nodes and not one of them had text of its own: the
  // node that takes the tap is a Stack / Flex / FormComponent wrapping the label you can see. While
  // clickableOnly merely filtered the has-text default, "show me what I can tap" answered 0 there.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [
      {
        attributes: { type: "FormComponent", bounds: "[72,278][1205,803]", clickable: "true", enabled: "true" },
        children: [
          { attributes: { type: "Text", bounds: "[518,815][758,865]", text: "灵动小组件", clickable: "false" } },
        ],
      },
      { attributes: { type: "Text", bounds: "[100,100][200,140]", text: "只是标签", clickable: "false" } },
    ],
  });

  const tappable = await uiFind({ dumpPath, clickableOnly: true });
  assert.equal(tappable.matchCount, 1);
  assert.equal(tappable.matches[0].type, "FormComponent");
  assert.deepEqual(tappable.matches[0].center, { x: 639, y: 541 });
  assert.equal(tappable.matches[0].text, "", "the tappable node has no text of its own");

  // Combining it with another selector still narrows rather than widens.
  assert.equal((await uiFind({ dumpPath, clickableOnly: true, type: "Text" })).matchCount, 0);
  // And without it the has-text default is unchanged.
  assert.deepEqual((await uiFind({ dumpPath })).matches.map((match) => match.text),
    ["灵动小组件", "只是标签"]);
});

test("ui_find matches the accessibility label uitest actually writes", async (t) => {
  // uitest dumpLayout puts it in `description`; `accessibilityText` exists in neither dump shape.
  // An icon-only control carries no text at all, so this is the only way to address one by name.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [
      { attributes: { type: "Image", bounds: "[40,120][120,200]", description: "返回", clickable: "true" } },
      { attributes: { type: "Text", bounds: "[200,120][400,200]", text: "标题", description: "标题的无障碍文本" } },
    ],
  });

  const back = await uiFind({ dumpPath, text: "返回" });
  assert.equal(back.matchCount, 1);
  assert.deepEqual(back.matches[0].center, { x: 80, y: 160 });
  // Where a node has both, the visible text wins -- description is the last fallback, not an override.
  assert.equal((await uiFind({ dumpPath, text: "标题" })).matches[0].text, "标题");
});

test("ui_find reports an unparseable dump with the file head as the hint", async (t) => {
  // uitest writes plain-text failures into the -p target, so the head of the file is the diagnosis.
  const dumpPath = await writeDump(t, "dump layout failed: no permission");
  await assert.rejects(
    () => uiFind({ dumpPath }),
    (error) => error.code === "UI_DUMP_PARSE_FAILED" && /no permission/.test(error.hint),
  );
  const emptyPath = await writeDump(t, "   ");
  await assert.rejects(() => uiFind({ dumpPath: emptyPath }), (error) => error.code === "UI_DUMP_EMPTY");
});

test("ui_find survives dumps that do not match the one device it was written against", async (t) => {
  const arrayRoot = await writeDump(t, [
    { $type: "Text", $rect: "[0,0],[10,10]", attributes: { content: "alpha" }, children: [] },
    { $type: "Text", $rect: "bad rect", $attrs: { content: "beta" } },
    { $type: "Text", $attrs: { content: "no rect" } },
    { $type: "Text", $rect: "[30.00,30.00],[20.00,20.00]", $attrs: { content: "inverted" } },
  ]);
  const found = await uiFind({ dumpPath: arrayRoot, onScreenOnly: false });
  assert.deepEqual(found.matches.map((match) => match.text), ["alpha", "inverted"]);
  // Corners arrive swapped on some nodes; a swapped pair still describes a real box.
  assert.deepEqual(found.matches[1].rect, [20, 20, 30, 30]);
  assert.deepEqual(found.matches[1].center, { x: 25, y: 25 });
});

test("ui_find dumps and pulls when no dumpPath is given", async (t) => {
  const fake = await makeUiHdc({ recv: `printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last"` });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const found = await withHdcPath(fake.executable, () => uiFind({ text: "首页" }));
  assert.equal(found.deviceId, fake.device);
  assert.deepEqual(found.matches[0].center, { x: 393, y: 2710 });

  const argv = await fake.argv();
  assert.ok(argv.some((line) => line.includes("uitest dumpLayout -p")), "must dump on the device");
  assert.ok(argv.some((line) => line.includes("file recv")), "must pull the dump back");
});

test("stale device-side scratch files are swept once per device, and only when old", async (t) => {
  // The scratch paths are keyed by pid, so they are bounded per process but not over time: a
  // development device had 14 of them, 6.9MB, including a 5.2MB PNG from the screenCap fallback.
  // Both entry points run here, so the pull has to answer with a frame or a dump depending on which
  // one asked. `$last` is the staging file, hence the substring match rather than a suffix.
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  const target = uiTempTarget("swept.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, async () => {
    await uiSnapshot({ localPath: target });
    await uiFind({ text: "首页" });
  });

  // The sweep is not awaited by the capture path, so give it a moment to reach the log.
  let sweeps = [];
  for (let attempt = 0; attempt < 40 && sweeps.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    sweeps = (await fake.argv()).filter((line) => line.includes("deveco_ui_*"));
  }
  assert.equal(sweeps.length, 1, "one sweep per device per process, across both entry points");
  // The age bound is what makes it safe to run while another server process may be mid-capture
  // against the same device: an unqualified rm would delete that file between write and recv.
  assert.match(sweeps[0], /-mmin \+60 -delete/);
  assert.ok(
    sweeps[0].includes("shell find /data/local/tmp -maxdepth 1 -name 'deveco_ui_*'"),
    `the whole command must be one argv element: ${sweeps[0]}`,
  );
});

test("ui_tap builds the uiInput command for each action", async (t) => {
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    assert.match((await uiTap({ action: "click", x: 640, y: 2710 })).sent, /uiInput click 640 2710$/);
    assert.match((await uiTap({ action: "swipe", x: 1, y: 2, x2: 3, y2: 4, velocity: 600 })).sent, /uiInput swipe 1 2 3 4 600$/);
    assert.match((await uiTap({ action: "dircFling", direction: 3 })).sent, /uiInput dircFling 3$/);
    assert.match((await uiTap({ action: "keyEvent", key1: "Back" })).sent, /uiInput keyEvent Back$/);
    assert.match((await uiTap({ action: "inputText", x: 5, y: 6, text: "BMI" })).sent, /uiInput inputText 5 6 'BMI'$/);
  });
});

test("ui_tap quotes whitespace-free text instead of restricting which characters it may contain", async (t) => {
  // Measured on a real device. hdc forwards an argument with no whitespace untouched, so a
  // single-quoted form is unquoted once by the device shell and everything inside arrives literally:
  // `id` printed the backticks rather than a uid, $HOME and ~ stayed unexpanded, and (b) no longer
  // raised the `/bin/sh: syntax error: unexpected '('` that the previous allowlist walked straight
  // into by permitting parentheses.
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    const cases = [
      ["BMI", "'BMI'"],
      ["`id`", "'`id`'"],
      ["$HOME", "'$HOME'"],
      ["a(b)c", "'a(b)c'"],
      ["a;echo", "'a;echo'"],
      ['a"b', `'a"b'`],
      ["a?b", "'a?b'"],
      // The old allowlist was letters/marks/digits plus an ASCII punctuation set, so it rejected
      // every CJK punctuation mark: `，` is none of \p{L}, \p{M}, \p{N}.
      ["你好，世界。", "'你好，世界。'"],
      // Close, escape, reopen -- and still no whitespace, so it stays in the regime that protects it.
      ["it's", `'it'\\''s'`],
    ];
    for (const [text, expected] of cases) {
      const report = await uiTap({ action: "inputText", x: 1, y: 1, text });
      assert.equal(report.sent, `uitest uiInput inputText 1 1 ${expected}`, `text: ${text}`);
    }

    // With whitespace, hdc wraps the argument in double quotes of its own. That already neutralises
    // parentheses, globs, # and ;, so the text passes through unquoted by us.
    assert.equal(
      (await uiTap({ action: "inputText", x: 1, y: 1, text: "hello world 你好，再见" })).sent,
      "uitest uiInput inputText 1 1 hello world 你好，再见",
    );
  });
});

test("ui_tap refuses text and keys the device shell would still expand", async (t) => {
  // The four that survive hdc's own double quotes, all confirmed live on a real device: $HOME
  // expanded to /root, a backtick ran id, a backslash was consumed, and a double quote closed the
  // wrapper outright -- `a" ; id ; "b` executed id. perform_ui_action stays available for these.
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    for (const text of ["$HOME y", "`id` x", 'a" ; id ; "b', "a\\b c", "line\nbreak"]) {
      await assert.rejects(
        () => uiTap({ action: "inputText", x: 1, y: 1, text }),
        (error) => error.code === "UI_ARGS_INVALID",
        `text must be rejected: ${JSON.stringify(text)}`,
      );
    }
    await assert.rejects(
      () => uiTap({ action: "keyEvent", key1: "Back; reboot" }),
      (error) => error.code === "UI_ARGS_INVALID",
    );
    await assert.rejects(() => uiTap({ action: "nope" }), (error) => error.code === "UI_ARGS_INVALID");
  });
  assert.equal((await fake.argv()).filter((line) => line.includes("uiInput")).length, 0);
});

test("ui_tap surfaces a uiInput failure instead of reporting a phantom tap", async (t) => {
  const fake = await makeUiHdc();
  // Replace the uiInput branch so it prints a usage line, which is what a real rejection looks like.
  const body = (await fs.readFile(fake.executable, "utf8"))
    .replace("*uiInput*) printf 'No Error\\n' ;;", "*uiInput*) printf 'error: coordinate out of range\\n' ;;");
  await fs.writeFile(fake.executable, body, { mode: 0o755 });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiTap({ action: "click", x: 1, y: 1 }),
      (error) => error.code === "UI_TAP_FAILED",
    );
  });
});
