import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { selectFaultlogs, faultlogTimestamp } from "../src/script-adapters/runtime.mjs";
import { setProjectPath } from "../src/project-context.mjs";
import { callCodeGenieTool, closeCodeGenie, getCodeGenieTools, probeCodeGenieTools } from "../src/codegenie-client.mjs";

const runFile = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deveco 管理 & review-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "项目 A");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "build-profile.json5"), "{}");
  const env = { ...process.env, PROJECT_PATH: project, DEVECO_CLI_STUDIO_PATH: "", DEVECO_HOME: "", DEVECO_PATH: "",
    DEVECO_CLI_CLT_PATH: path.join(dir, "Command Line Tools"), DEVECO_SDK_HOME: "" };
  const sdk = path.join(env.DEVECO_CLI_CLT_PATH, "sdk", "default");
  await fs.mkdir(sdk, { recursive: true });
  await fs.writeFile(path.join(sdk, "sdk-pkg.json"), JSON.stringify({ data: { apiVersion: 22, platformVersion: "6.0.2" } }));
  return { dir, project, env };
}

async function script(f, id, input = {}) {
  const source = `import { runRegisteredScript } from './src/script-registry.mjs';
    console.log(JSON.stringify(await runRegisteredScript(process.argv[1], JSON.parse(process.argv[2]))));`;
  const out = await runFile(process.execPath, ["--input-type=module", "-e", source, id, JSON.stringify(input)],
    { cwd: root, env: f.env, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(out.stdout);
}

async function fakeChild(f, options = {}) {
  const entry = path.join(f.dir, "child.mjs");
  await fs.writeFile(entry, `import fs from 'node:fs';
    let bound = ''; let input = ''; const options = ${JSON.stringify(options)};
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => {
      input += data; let newline;
      while ((newline = input.indexOf('\\n')) >= 0) {
        const line = input.slice(0, newline); input = input.slice(newline + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        const reply = result => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
        if (m.method === 'initialize') reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
        if (m.method === 'tools/list') {
          if (options.toolsLog) fs.appendFileSync(options.toolsLog,'list\\n');
          reply({tools:['init_project_path','check_cpp_files'].map(name=>({name,inputSchema:{type:'object'}}))});
        }
        if (m.method === 'tools/call') {
          if (m.params.name === 'init_project_path') {
            if (options.reject && m.params.arguments.project_path.endsWith('B')) {
              bound = m.params.arguments.project_path; // A failed bind may have partially changed native state.
              reply({isError:true,content:[{type:'text',text:'project rejected'}]}); continue;
            }
            if (options.stallSync) continue;
            bound = m.params.arguments.project_path;
            reply({content:[{type:'text',text:'ok'}]});
          } else setTimeout(()=>reply({content:[{type:'text',text:JSON.stringify({bound})}]}),30);
        }
      }
    });
    ${options.hung ? `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);` : ""}
    ${options.pidFile ? `fs.writeFileSync(${JSON.stringify(options.pidFile)}, String(process.pid));` : ""}
  `);
  return entry;
}

async function withChild(entry, task) {
  const previous = process.env.DEVECO_CODEGENIE_ENTRY;
  await closeCodeGenie();
  process.env.DEVECO_CODEGENIE_ENTRY = entry;
  try { return await task(); }
  finally {
    await closeCodeGenie();
    if (previous === undefined) delete process.env.DEVECO_CODEGENIE_ENTRY;
    else process.env.DEVECO_CODEGENIE_ENTRY = previous;
  }
}

test("copy_template expands the shipped template with CLT, spaces, CJK, and shell metacharacters", async (t) => {
  const f = await fixture(t);
  f.env.PATH = path.dirname(process.execPath); // No global devecocli installation.
  const parent = path.join(f.dir, "项目 & $(not-a-command)");
  const result = await script(f, "copy_template", { args: { projectPath: parent, appName: "ReviewApp", apiLevel: 21 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.parsed.verified, true);
  assert.equal(result.parsed.apiLevel, 21);
  assert.equal(result.parsed.projectRoot, path.join(parent, "ReviewApp"));
  const appRoot = result.parsed.projectRoot;
  assert.match(await fs.readFile(path.join(appRoot, 'AppScope/app.json5'), 'utf8'), /com.example.reviewapp/);
  assert.match(await fs.readFile(path.join(appRoot, 'build-profile.json5'), 'utf8'), /6\.0\.1\(21\)/);
  assert.match(await fs.readFile(path.join(appRoot, 'entry/src/main/resources/base/element/string.json'), 'utf8'), /ReviewApp/);
  assert.ok((await fs.stat(path.join(appRoot, 'entry/src/main/ets/pages/Index.ets'))).isFile());
  assert.ok((await fs.stat(path.join(appRoot, '.gitignore'))).isFile());
  const again = await script(f, "copy_template", { args: { projectPath: parent, appName: "ReviewApp" } });
  assert.equal(again.ok, false);
  assert.match(again.stderr, /PROJECT_EXISTS/);
  assert.equal((await script(f, "detect_sdk")).parsed.apiLevel, 22);
  const sdkOverride = path.join(f.dir, "External SDK");
  await fs.mkdir(path.join(sdkOverride, "default"), { recursive: true });
  await fs.writeFile(path.join(sdkOverride, "default/sdk-pkg.json"), JSON.stringify({ data: { apiVersion: 21, platformVersion: "6.0.1" } }));
  f.env.DEVECO_SDK_HOME = sdkOverride;
  assert.equal((await script(f, "detect_sdk")).parsed.apiLevel, 21);
});

test("PROJECT_PATH supplies the initial cwd to scripts and project context", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project, "crash.log"), "Error name: TypeError\nError message: project-specific failure\nStacktrace:\nat run (pages/Index.ets:12:5)\n");
  const result = await script(f, "jscrash_report", { args: { logFile: "crash.log" } });
  assert.equal(result.cwd, f.project);
  assert.equal(result.ok, true);
  assert.equal(result.parsed.error_message, "project-specific failure");
  const out = await runFile(process.execPath, ["--input-type=module", "-e", `
    import { getProjectContext } from './src/project-context.mjs';
    console.log(JSON.stringify(getProjectContext()));
  `], { cwd: root, env: f.env });
  const state = JSON.parse(out.stdout);
  assert.equal(state.projectPath, f.project);
});

test("doctor reports invalid project and unreadable auth without losing other diagnostics", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dir, ".deveco-knowledge-mcp"));
  await fs.writeFile(path.join(f.dir, ".deveco-knowledge-mcp/auth.json"), "invalid-json");
  const missing = path.join(f.dir, "missing-project");
  const out = await runFile(process.execPath, ["--input-type=module", "-e", `
    import os from 'node:os';
    os.homedir = () => process.argv[1];
    const { collectDoctorReport } = await import('./src/doctor.mjs');
    console.log(JSON.stringify(await collectDoctorReport()));
  `, f.dir], { cwd: root, env: { ...f.env, PROJECT_PATH: missing } });
  const result = JSON.parse(out.stdout);
  assert.equal(result.project.projectPath, missing);
  assert.ok(result.project.issue);
  assert.equal(result.auth.error.code, "DEVECO_AUTH_STATE_UNREADABLE");
  assert.ok(result.hdc);
  assert.ok(result.devecoCli);
});

test("faultlogger bundle and age filters never fall back to unrelated or expired logs", () => {
  const now = 1788500000000;
  const wanted = `jscrash-com.example.wanted-20010000-${now - 10000}.log`;
  const other = `jscrash-com.example.other-20010000-${now}.log`;
  const expired = "jscrash-com.example.wanted-20010000-1700000000000.log";
  assert.deepEqual(selectFaultlogs(`${wanted}\n${other}\n${expired}`, "com.example.wanted", 30, now), [wanted]);
  assert.deepEqual(selectFaultlogs(`${other}\n${expired}`, "com.example.wanted", 30, now), []);
  assert.deepEqual(selectFaultlogs(expired, "com.example.wanted", 0, now), [expired]);
});

test("Hiview extensionless calendar names use device time and timezone, not host timezone", () => {
  const name = "jscrash-com.example.wanted-20020456-20260905120000";
  const stamp = Date.UTC(2026, 8, 5, 4, 0, 0);
  assert.equal(faultlogTimestamp(name, 480), stamp);
  assert.equal(faultlogTimestamp(`${name}123.log`, 480), stamp + 123);
  assert.deepEqual(selectFaultlogs(name, "com.example.wanted", 30, stamp + 60000, 480), [`${name}.log`]);
  assert.deepEqual(selectFaultlogs(name, "com.example.wanted", 30, stamp + 3600000, 480), []);
  assert.deepEqual(selectFaultlogs(name, "com.example.wanted", 30, stamp - 1000, 480), []);
  assert.equal(faultlogTimestamp("jscrash-test-20260230120000.log", 480), null);
});

test("rejected project binding blocks the dependent tool and is retried", async (t) => {
  const f = await fixture(t);
  const b = path.join(f.dir, "项目 B");
  await fs.mkdir(b); await fs.writeFile(path.join(b, "oh-package.json5"), "{}");
  await withChild(await fakeChild(f, { reject: true }), async () => {
    setProjectPath(f.project);
    assert.equal(JSON.parse((await callCodeGenieTool("check_cpp_files")).content[0].text).bound, f.project);
    setProjectPath(b);
    for (let i = 0; i < 2; i++) await assert.rejects(callCodeGenieTool("check_cpp_files"), { code: "CODEGENIE_PROJECT_SYNC_FAILED" });
    setProjectPath(f.project);
    assert.equal(JSON.parse((await callCodeGenieTool("check_cpp_files")).content[0].text).bound, f.project);
  });
});

test("concurrent calls retain the project selected when each call began", async (t) => {
  const f = await fixture(t);
  const b = path.join(f.dir, "项目 B");
  await fs.mkdir(b); await fs.writeFile(path.join(b, "hvigorfile.ts"), "");
  await withChild(await fakeChild(f), async () => {
    setProjectPath(f.project);
    const first = callCodeGenieTool("check_cpp_files");
    setProjectPath(b);
    const second = callCodeGenieTool("check_cpp_files");
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(r => JSON.parse(r.content[0].text).bound), [f.project, b]);
  });
});

test("restart kills an uncooperative native backend below the npm wrapper", async (t) => {
  const f = await fixture(t);
  const pidFile = path.join(f.dir, "backend.pid");
  const backend = await fakeChild(f, { hung: true, pidFile });
  const wrapper = path.join(f.dir, "wrapper.mjs");
  await fs.writeFile(wrapper, `import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,[${JSON.stringify(backend)}],{stdio:'inherit'});
    child.on('exit',code=>process.exit(code??1));`);
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} } });
  await withChild(wrapper, async () => {
    await getCodeGenieTools();
    pid = Number(await fs.readFile(pidFile, "utf8"));
    await closeCodeGenie();
    await new Promise(r => setTimeout(r, 100));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    pid = undefined;
  });
});

test("CLI doctor reaps the native backend before exiting", async (t) => {
  const f = await fixture(t);
  const pidFile = path.join(f.dir, "cli-backend.pid");
  const backend = await fakeChild(f, { hung: true, pidFile });
  const wrapper = path.join(f.dir, "cli-wrapper.mjs");
  await fs.writeFile(wrapper, `import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,[${JSON.stringify(backend)}],{stdio:'inherit'});
    child.on('exit',code=>process.exit(code??1));`);
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} } });
  const out = await runFile(process.execPath, ["src/cli.mjs", "doctor", "--probe-codegenie"], {
    cwd: root, env: { ...f.env, DEVECO_CODEGENIE_ENTRY: wrapper }, timeout: 10000,
  });
  assert.equal(JSON.parse(out.stdout).codegenie.available, true);
  pid = Number(await fs.readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  pid = undefined;
});

test("doctor reports a failed replacement backend after restart", async (t) => {
  const f = await fixture(t);
  const entry = await fakeChild(f);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.mjs"], cwd: root,
    env: { ...f.env, DEVECO_CODEGENIE_ENTRY: entry }, stderr: "ignore" });
  const client = new Client({ name: "management-test", version: "1" });
  try {
    await client.connect(transport);
    const call = async (name, args = {}) => JSON.parse((await client.callTool({name,arguments:args})).content[0].text);
    const before = await call("deveco_doctor");
    assert.equal(before.codegenie.available, true);
    assert.equal(before.project.projectPath, f.project);
    await call("deveco_restart", { target: "cpp" });
    await fs.writeFile(entry, "process.exit(1);");
    const after = await call("deveco_doctor");
    assert.equal(after.codegenie.available, false);
    assert.equal(after.codegenie.error.code, "CODEGENIE_UNAVAILABLE");
    assert.ok((await client.listTools()).tools.some(t => t.name === "deveco_script"));
  } finally { await transport.close(); }
});

test("doctor probes an existing child instead of returning its cached tools", async (t) => {
  const f = await fixture(t);
  const toolsLog = path.join(f.dir, "list-requests.txt");
  const entry = await fakeChild(f, { toolsLog });
  await withChild(entry, async () => {
    await getCodeGenieTools();
    assert.ok((await probeCodeGenieTools()).length > 0);
    assert.equal((await fs.readFile(toolsLog, "utf8")).trim().split("\n").length, 2);
  });
});

test("a stalled project binding is included in timeout recovery", async (t) => {
  const f = await fixture(t);
  const entry = await fakeChild(f, { stallSync: true });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.mjs"], cwd: root,
    env: { ...f.env, DEVECO_CODEGENIE_ENTRY: entry, DEVECO_CODEGENIE_CALL_TIMEOUT_MS: "150" }, stderr: "ignore" });
  const client = new Client({ name: "binding-timeout-test", version: "1" });
  try {
    await client.connect(transport);
    const result = await client.callTool({name:"check_cpp_files",arguments:{files:["test.cpp"]}});
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).code, "CODEGENIE_TIMEOUT");
    await fakeChild(f);
    const recovered = await client.callTool({name:"check_cpp_files",arguments:{files:["test.cpp"]}});
    assert.notEqual(recovered.isError, true);
    assert.equal(JSON.parse(recovered.content[0].text).bound, f.project);
  } finally { await transport.close(); }
});

// POSIX executable fixture; the platform-independent CLI/process/context cases
// above also run on Windows. Actual HDC binaries are vendor supplied.
async function fakeHdc(f, body) {
  const executable = path.join(f.dir, "fake-hdc");
  await fs.writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';
    if (process.argv.at(-1) === "date '+%s %z'") { console.log(Math.floor(Date.now()/1000)+' +0800'); process.exit(0); }
    ${body}\n`, { mode: 0o755 });
  // A .mjs extension gives the executable ESM semantics on Node 22.
  await fs.rename(executable, `${executable}.mjs`);
  f.env.HDC_PATH = `${executable}.mjs`;
}

test("device scripts honor HDC_PATH under CLT and reject exit-zero HDC failures", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  await fakeHdc(f, `if(process.argv[2]==='list') console.log('device-one'); else console.log('[Fail]Device not found');`);
  for (const id of ["collect_hilog", "jscrash_report", "probe_faultlogger", "fetch_faultlog"]) {
    const args = id === "collect_hilog" ? { outputDir: path.join(f.dir,"logs") }
      : id === "fetch_faultlog" ? { outputDir: path.join(f.dir,"logs"), faultlogName: "jscrash-test.log" } : {};
    const result = await script(f, id, { args });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.parsed.next_action, /Device not found/);
  }
});

test("probe distinguishes remote failures from no matching logs", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  await fakeHdc(f, `if(process.argv[2]==='list') console.log('device-one'); else console.log('Permission denied\\n__DEVECO_REMOTE_EXIT__=1');`);
  const failed = await script(f, "probe_faultlogger");
  assert.equal(failed.ok, false);
  assert.equal(failed.parsed.status, "probe_failed");
  await fakeHdc(f, `if(process.argv[2]==='list') console.log('device-one'); else console.log('jscrash-com.example.other-1700000000000.log\\n__DEVECO_REMOTE_EXIT__=0');`);
  const empty = await script(f, "probe_faultlogger", { args: { bundleName: "com.example.wanted" } });
  assert.equal(empty.ok, true);
  assert.equal(empty.parsed.status, "not_found");
});

test("fetch cannot report success by reusing a stale destination file", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const output = path.join(f.dir, "logs"); await fs.mkdir(output);
  const stale = path.join(output, "jscrash-test.log"); await fs.writeFile(stale, "old log");
  await fakeHdc(f, `if(process.argv[2]==='list') console.log('device-one'); else console.log('file transfer finish');`);
  const result = await script(f, "fetch_faultlog", { args: { outputDir: output, faultlogName: "jscrash-test.log" } });
  assert.equal(result.ok, false);
  assert.equal(await fs.readFile(stale, "utf8"), "old log");
  assert.deepEqual(await fs.readdir(output), ["jscrash-test.log"]);
});

test("probe uses the millisecond filename option and its result can be fetched", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const name = "jscrash-com.example.wanted-20020456-20260831113834613.log";
  await fakeHdc(f, `
    if(process.argv[2]==='list') console.log('device-one');
    else if(process.argv.includes('recv')) {fs.writeFileSync(process.argv.at(-1),'Error name: TypeError\\nError message: device failure');console.log('file transfer finish');}
    else if(process.argv.at(-1).includes('-p Faultlogger %s -LogSuffixWithMs')) console.log('${name}\\n__DEVECO_REMOTE_EXIT__=0');
    else console.log('Permission denied\\n__DEVECO_REMOTE_EXIT__=1');
  `);
  const result = await script(f, "probe_faultlogger", { args: { bundleName: "com.example.wanted", maxAgeMinutes: 0 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.parsed.latest_faultlog, name);
  assert.equal(result.parsed.latest_timestamp, String(Date.UTC(2026, 7, 31, 3, 38, 34, 613)));
  const fetched = await script(f, "fetch_faultlog", { args: { outputDir: path.join(f.dir,"logs"), faultlogName: result.parsed.latest_faultlog } });
  assert.equal(fetched.ok, true, JSON.stringify(fetched));
  assert.match(await fs.readFile(fetched.parsed.local_path,"utf8"), /device failure/);
});
