import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { applyChanges, projectSync, resolveRunnableModule, startApp } from "../src/deveco-cli.mjs";
import { signatureGenerate } from "../src/deveco-official.mjs";
import { closeHotReload, hotReload } from "../src/hotreload.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
async function write(root, file, value) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value);
  return target;
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail("condition did not become true within 10 seconds");
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-build-中文 空格-"));
  const log = path.join(root, "commands.jsonl");
  await fs.writeFile(log, "");
  const cli = await write(root, "cli.mjs", `
    import fs from 'node:fs';
    import path from 'node:path';
    const args = process.argv.slice(2);
    const apply = args.indexOf('--hotreload-apply');
    const record = {args, pid:process.pid};
    if (apply >= 0) record.manifest = fs.readFileSync(path.join(process.cwd(), '.hvigor', args[apply+1]), 'utf8');
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(record)+'\\n');
    if (args.includes('--hotreload') && !args.includes('stop')) {
      setTimeout(()=>console.log('Hot-reload watch session active (socket persistent)'), Number(process.env.BUILD_TEST_READY_DELAY || 0));
      setInterval(()=>{},1000);
    } else if (args[0] === 'build') {
      if (args.includes('slow')) setInterval(()=>{},1000);
      else console.log('Build completed successfully.');
    } else if (args[0] === 'signature') {
      if (process.env.BUILD_TEST_MODE === 'failure') { console.error('Signature generation failed.'); process.exitCode=1; }
      else console.log('Signature generation completed successfully.');
    } else if (args.includes('stop')) console.log('Hvigor daemon stopped.');
    else if (apply >= 0) console.log('[HotReload] Apply complete.');
    else if (process.env.BUILD_TEST_MODE === 'failure') {
      console.log("App installed successfully\\nApplication 'com.example.test': error: failed to start ability.\\nerror: code: 16000001");
    } else if (process.env.BUILD_TEST_MODE === 'install-only') console.log('App installed successfully');
    else if (process.env.BUILD_TEST_MODE === 'no-ability') console.log("Application 'com.example.test' installed successfully (no ability to launch).");
    else if (args.includes('--apply')) console.log('[Apply] Apply complete.');
    else {
      console.log("Build completed successfully.\\nApp installed successfully\\nApplication 'com.example.test': start ability successfully.");
      if (process.env.BUILD_TEST_MODE === 'verbose') console.log('x'.repeat(600000));
    }
  `);
  await write(root, "build-profile.json5", "{modules:[{name:'phone',srcPath:'./features/手机'},{name:'library',srcPath:'./lib'}]}");
  await write(root, "features/手机/src/main/module.json5", "{module:{type:'entry'}}");
  await write(root, "lib/src/main/module.json5", "{module:{type:'har'}}");
  const changed = "features/手机/src/main/changed.ts";
  await write(root, changed, "export const value = 1;\n");
  const keys = ["DEVECO_CLI_ENTRY", "BUILD_TEST_MODE", "BUILD_TEST_READY_DELAY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DEVECO_CLI_ENTRY: cli, BUILD_TEST_MODE: "", BUILD_TEST_READY_DELAY: "" });
  const records = async () => (await fs.readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  t.after(async () => {
    await closeHotReload();
    // Also clean an orphan if a regression allows two watch processes to start.
    for (const record of await records()) if (record.args.includes('--hotreload') && !record.args.includes('stop')) {
      if (alive(record.pid)) { process.kill(record.pid); await until(() => !alive(record.pid)); }
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, cli, changed, records, args: { project_path: root, hvd: 'test-device', timeoutMs: 10000 } };
}

test("single-module discovery never deploys while selecting modules for run/apply/watch", async (t) => {
  const f = await fixture(t);
  assert.equal(await resolveRunnableModule({ project: f.root }), "phone");
  assert.deepEqual(await f.records(), []);
  await startApp(f.args);
  await applyChanges({ ...f.args, files: [f.changed] });
  const started = await hotReload({ ...f.args, action: "start" });
  assert.equal(started.active, true);
  await hotReload({ action: "stop" });
  const calls = await f.records();
  assert.equal(calls.length, 4, "only run, apply, watch and stop may execute");
  for (const { args } of calls.slice(0, 3)) assert.equal(args[args.indexOf('--module') + 1], "phone");
  assert.ok(calls[1].args.includes('--apply'));
  assert.ok(calls[2].args.includes('--hotreload'));
});

test("module discovery rejects ambiguity and malformed manifests without running CLI", async (t) => {
  const f = await fixture(t);
  await write(f.root, "lib/src/main/module.json5", "{module:{type:'feature'}}");
  for (const operation of [
    () => startApp(f.args),
    () => applyChanges({ ...f.args, files: [f.changed] }),
    () => hotReload({ ...f.args, action: "start" }),
  ]) await assert.rejects(operation, { code: "DEVECO_CLI_MODULE_REQUIRED" });
  await write(f.root, "lib/src/main/module.json5", "{malformed");
  await assert.rejects(startApp(f.args), { code: "DEVECO_CLI_MODULE_DISCOVERY_FAILED" });
  assert.deepEqual(await f.records(), []);
});

test("module discovery includes shared modules and supports the CLI's missing-manifest entry layout", async (t) => {
  const f = await fixture(t);
  await write(f.root, "features/手机/src/main/module.json5", "{module:{type:'shared'}}");
  assert.equal(await resolveRunnableModule({ project: f.root }), 'phone');
  await fs.rm(path.join(f.root, "features/手机/src/main/module.json5"));
  assert.equal(await resolveRunnableModule({ project: f.root }), 'phone');
  await write(f.root, "features/手机/src/main/module.json5", "{module:{type:'har'}}");
  await assert.rejects(startApp(f.args), { code: "DEVECO_CLI_NO_MODULES" });
  assert.deepEqual(await f.records(), []);
});

test("installation cannot hide a failed or missing launch, including apply recovery", async (t) => {
  const f = await fixture(t);
  for (const mode of ["failure", "install-only"]) {
    process.env.BUILD_TEST_MODE = mode;
    await assert.rejects(startApp(f.args), { code: "DEVECO_CLI_RUN_FAILED" });
    await assert.rejects(applyChanges({ ...f.args, files: [f.changed] }),
      (error) => error.code === "DEVECO_CLI_APPLY_FAILED" && /Recovery launch also failed/.test(error.message));
  }
  process.env.BUILD_TEST_MODE = "no-ability";
  assert.match(await startApp(f.args), /no ability to launch/);
});

test("final launch acknowledgement survives a verbose tail after build and install output", async (t) => {
  const f = await fixture(t);
  process.env.BUILD_TEST_MODE = "verbose";
  assert.match(await startApp(f.args), /Output truncated/);
});

test("hot reload applies the pinned product, mode, ability and deduplicated file list", async (t) => {
  const f = await fixture(t);
  await hotReload({ ...f.args, action: "start", product: "wearable", build_mode: "debug", ability: "CustomAbility" });
  await hotReload({ action: "apply", files: [f.changed, f.changed] });
  await hotReload({ action: "stop" });
  const calls = await f.records();
  const apply = calls[1];
  for (const flag of ['--product', '--build-mode', '--ability']) {
    assert.equal(apply.args[apply.args.indexOf(flag)+1], calls[0].args[calls[0].args.indexOf(flag)+1]);
  }
  assert.equal(apply.manifest, f.changed+'\n');
  assert.deepEqual(await fs.readdir(path.join(f.root, '.hvigor')), []);
});

test("signal exit makes hot reload inactive, rejects apply and permits a fresh start", async (t) => {
  const f = await fixture(t);
  const started = await hotReload({ ...f.args, action: "start" });
  process.kill(started.pid, "SIGTERM");
  await until(async () => (await hotReload({ action: "status" })).error?.code === "DEVECO_HOT_RELOAD_EXITED");
  assert.equal((await hotReload({ action: "status" })).active, false);
  await assert.rejects(hotReload({ action: "apply", files: [f.changed] }), { code: "DEVECO_HOT_RELOAD_NOT_RUNNING" });
  const restarted = await hotReload({ ...f.args, action: "start" });
  assert.equal(restarted.active, true);
  await hotReload({ action: "stop" });
  assert.equal(alive(restarted.pid), false);
});

test("concurrent starts reserve one watch and stop leaves no running child", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    hotReload({ ...f.args, action: 'start' }), hotReload({ ...f.args, action: 'start' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DEVECO_HOT_RELOAD_ALREADY_RUNNING');
  const stops = await Promise.all([hotReload({ action: 'stop' }), hotReload({ action: 'stop' })]);
  assert.ok(stops.every((result) => result.stopped));
  const calls = await f.records();
  assert.equal(calls.length, 2, 'one start and one stop');
  assert.equal(alive(calls[0].pid), false);
});

test("stop cancels startup before spawning and failed discovery releases its reservation", async (t) => {
  const f = await fixture(t);
  const pending = hotReload({ ...f.args, action: 'start' });
  const stopped = await hotReload({ action: 'stop' });
  assert.equal(stopped.stopped, true);
  await assert.rejects(pending, { code: 'DEVECO_HOT_RELOAD_START_CANCELLED' });
  assert.deepEqual(await f.records(), []);
  await write(f.root, 'lib/src/main/module.json5', "{module:{type:'entry'}}");
  await assert.rejects(hotReload({ ...f.args, action: 'start' }), { code: 'DEVECO_CLI_MODULE_REQUIRED' });
  assert.equal((await hotReload({ ...f.args, action: 'start', module: 'phone' })).active, true);
});

test("startup timeout reports failure and permits restart after the child closes", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const spawn = childProcess.spawn;
  let closed;
  t.mock.method(childProcess, "spawn", (file, args, options) => {
    const child = spawn(file, args, options);
    if (args[0] === f.cli && args.includes("--hotreload")) {
      closed = new Promise((resolve) => child.once("close", resolve));
    }
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  process.env.BUILD_TEST_READY_DELAY = '30000';
  await assert.rejects(hotReload({ ...f.args, action: 'start', timeoutMs: 1000 }), { code: 'DEVECO_HOT_RELOAD_START_TIMEOUT' });
  // On Windows the PID can disappear before Node dispatches the exit/close events.
  // The restart contract is after close, when the session has released its reservation.
  assert.ok(closed);
  await closed;
  assert.equal((await f.records()).some((r) => alive(r.pid)), false);
  process.env.BUILD_TEST_READY_DELAY = '';
  assert.equal((await hotReload({ ...f.args, action: 'start' })).active, true);
});

test("signing preserves selectors and propagates a failed official command", async (t) => {
  const f = await fixture(t);
  await signatureGenerate({ project_path: f.root, product: 'wearable', team_id: 'team-1', force: true });
  assert.deepEqual((await f.records())[0].args, ['signature','generate','--force','--team-id','team-1','--product','wearable']);
  process.env.BUILD_TEST_MODE = 'failure';
  await assert.rejects(signatureGenerate({ project_path: f.root }), { code: 'DEVECO_SIGNATURE_FAILED' });
});

test("CLT project sync forwards product and can omit dependency installation on every host", async (t) => {
  const f = await fixture(t);
  const clt = path.join(f.root, 'clt');
  const node = process.platform === 'win32' ? 'tool/node/node.exe' : 'tool/node/bin/node';
  await write(clt, node, '');
  await fs.copyFile(process.execPath, path.join(clt, node));
  await write(clt, 'ohpm/bin/pm-cli.js', "console.log('dependencies installed');");
  await write(clt, 'hvigor/bin/hvigorw.js', "console.log('synced',...process.argv.slice(2));");
  await write(clt, 'version.txt', '# Version: 26.0.0\n');
  const previous = process.env.DEVECO_CLI_CLT_PATH;
  process.env.DEVECO_CLI_CLT_PATH = clt;
  try {
    const full = await projectSync({ project_path: f.root, product: 'wearable' });
    assert.match(full, /dependencies installed/);
    assert.match(full, /synced --sync -p product=wearable/);
    const cached = await projectSync({ project_path: f.root, install_dependencies: false });
    assert.doesNotMatch(cached, /dependencies installed/);
    assert.match(cached, /synced --sync -p product=default/);
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CLI_CLT_PATH; else process.env.DEVECO_CLI_CLT_PATH = previous;
  }
});

test("MCP exposes build completion, cancellation, launch errors and exclusive watch startup", async (t) => {
  const f = await fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(repo,'src/server.mjs')], cwd: repo,
    env: { ...process.env }, stderr: 'ignore' });
  const client = new Client({ name: 'build-regression', version: '1' });
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
  const data = (result) => JSON.parse(result.content[0].text);
  try {
    await client.connect(transport);
    const build = data(await call('build_project', { project_path: f.root }));
    const completed = await call('build_project', { action: 'status', job_id: build.job_id, wait_ms: 10000 });
    assert.equal(data(completed).status, 'succeeded');
    const cancel = data(await call('build_project', { project_path: f.root, modules:['slow'] }));
    assert.equal(data(await call('build_project', { action:'cancel', job_id:cancel.job_id })).status, 'cancelled');
    const results = await Promise.all([call('hot_reload', { ...f.args, action:'start' }),call('hot_reload', { ...f.args, action:'start' })]);
    assert.equal(results.filter((r) => !r.isError).length, 1);
    assert.equal(data(results.find((r) => r.isError)).code, 'DEVECO_HOT_RELOAD_ALREADY_RUNNING');
    await call('hot_reload', { action:'stop' });
  } finally { await transport.close(); }
  const errors = new StdioClientTransport({ command: process.execPath, args:[path.join(repo,'src/server.mjs')], cwd:repo,
    env: { ...process.env, BUILD_TEST_MODE:'failure' }, stderr:'ignore' });
  const errorClient = new Client({ name:'build-error-regression', version:'1' });
  try {
    await errorClient.connect(errors);
    const failed = await errorClient.callTool({ name:'start_app', arguments:f.args });
    assert.equal(failed.isError, true);
    assert.equal(data(failed).code, 'DEVECO_CLI_RUN_FAILED');
  } finally { await errors.close(); }
});
