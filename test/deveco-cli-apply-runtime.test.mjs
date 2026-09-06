import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { runDevecoCli } from "../src/deveco-cli.mjs";

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("@deveco/deveco-cli/dist/cli.js"));
const observer = new URL("../src/deveco-cli-apply-runtime.mjs", import.meta.url).href;

test("cold-apply observer exposes HDC launch failures without changing subprocess results", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-launch-中文 空格-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const shim = path.join(directory, "spawn.mjs");
  // Run real child streams and execa on every host, without requiring a host HDC.
  // The shim only replaces the executable; the observer sees the original argv.
  await fs.writeFile(shim, `
    import cp from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    const spawn = cp.spawn;
    cp.spawn = function(file, args, options) {
      return spawn.call(this, process.execPath, ['-e', process.env.LAUNCH_TEST_SCRIPT], options);
    };
    syncBuiltinESMExports();
  `);
  const caller = path.join(directory, "caller.mjs");
  await fs.writeFile(caller, `
    import {execa} from ${JSON.stringify(pathToFileURL(cliRequire.resolve("execa")).href)};
    const {file,args} = JSON.parse(process.env.LAUNCH_TEST_COMMAND);
    const result = await execa(file, args, {reject:false});
    console.log(JSON.stringify({exitCode:result.exitCode, stdout:result.stdout}));
  `);
  const aa = ["-t", "test-device", "shell", "aa", "start", "-b", "com.example.test", "-a", "EntryAbility"];
  const cases = [
    {file:"/sdk/toolchains/hdc", args:aa, script:"process.stdout.write('start ability success');setTimeout(()=>process.stdout.write('fully.\\n'),10)", failed:false, code:0},
    {file:"C:\\SDK 中文\\toolchains\\hdc.exe", args:aa, script:"console.log('error: failed to start ability.');console.log('error: code: 16000001')", failed:true, code:0},
    {file:"hdc", args:aa, script:"console.error('transport disconnected');process.exitCode=1", failed:true, code:1},
    {file:"hdc", args:aa, script:"", failed:true, code:0},
    {file:"hdc", args:aa, script:"console.log('start ability successfully.');console.error('error: failed to start ability.')", failed:true, code:0},
    {file:"hdc", args:["-t","test-device","shell","aa","force-stop","com.example.test"], script:"console.log('not running')", failed:false, code:0},
    {file:"node", args:aa, script:"console.log('other subprocess')", failed:false, code:0},
  ];
  for (const entry of cases) {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(shim).href, "--import", observer, caller], {
      encoding:"utf8", timeout:10000,
      env:{...process.env, LAUNCH_TEST_SCRIPT:entry.script, LAUNCH_TEST_COMMAND:JSON.stringify(entry)},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).exitCode, entry.code, "observer must preserve execa's exit code");
    assert.equal(result.stderr.includes("[DevEco MCP] HDC launch failed:"), entry.failed, JSON.stringify(entry));
  }
});

test("cold-apply preserves the original lost-lock cause and still invokes the CLI callback", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-lock-cause-中文 空格-"));
  const previous = process.env.DEVECO_CLI_ENTRY;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const caller = path.join(directory, "caller.mjs");
  await fs.writeFile(caller, `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import {setTimeout as delay} from 'node:timers/promises';
    import {lock} from ${JSON.stringify(pathToFileURL(cliRequire.resolve("proper-lockfile")).href)};
    const mode=process.argv[2], file=process.cwd();
    const lockfilePath=path.join(file,'.hvigor',mode==='unrelated'?'other.lock':'.build-lock');
    await fs.mkdir(path.dirname(lockfilePath),{recursive:true});
    const release=await lock(file,{lockfilePath,realpath:false,stale:5000,update:1000,
      onCompromised:error=>console.log('Original callback: '+error.code)});
    if(mode==='removed'||mode==='unrelated') await fs.rmdir(lockfilePath);
    if(mode==='changed') {const earlier=new Date(Date.now()-60000);await fs.utimes(lockfilePath,earlier,earlier);}
    await delay(1400);
    try {await release();console.log('[Apply] Apply complete');}
    catch(error){console.error('[Apply] failed: '+error.message);}
    await fs.rm(lockfilePath,{recursive:true,force:true});
  `);
  process.env.DEVECO_CLI_ENTRY = caller;
  for (const mode of ["removed", "changed", "normal", "unrelated"]) {
    const result = await runDevecoCli([mode], { cwd: directory, observeApply: true, timeoutMs: 10000 });
    assert.equal(result.exitCode, 0, "observation must not change CLI exit behavior");
    if (mode === "removed" || mode === "changed") {
      assert.match(result.applyFailure, /Build lock lost: ECOMPROMISED/);
      assert.match(result.applyFailure, mode === "removed" ? /ENOENT/ : /Unable to update lock/);
      assert.match(result.stderr, /Lock is already released/);
    } else assert.doesNotMatch(result.stderr, /Build lock lost:/);
    if (mode !== "normal") assert.match(result.stdout, /Original callback: ECOMPROMISED/);
    else assert.match(result.stdout, /Apply complete/);
  }
});
