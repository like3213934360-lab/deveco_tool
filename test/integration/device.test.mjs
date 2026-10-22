// Real SQLite/device command construction, with no SDK lookup or device process execution.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { temporaryDirectory } from "../support/workspace.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const work = temporaryDirectory("device"), bundle = path.join(work, "device.mjs");
const fixture = globalThis.__devecoDevice = { calls: [], result: { code: 0, signal: null, stdout: '[{"ok":1}]', stderr: "" } };
await build({ stdin: { contents: `export { sqlite, appDatabasePath, launchAndCheck, selectLogLines, hilog } from ${JSON.stringify(path.join(root, "src/domains/device.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "device-process", setup(b) {
    b.onResolve({ filter: /(?:proc|toolchain|ui|repeat)\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/device.ts") ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
      toolchain: `export function toolCommand(name,args){if(name!=='hdc')throw new Error('unexpected tool '+name);return {file:name,args}}`,
      proc: `export async function run(command,options){options.signal?.throwIfAborted();const f=globalThis.__devecoDevice;f.calls.push({command,options});return f.respond ? f.respond(command) : f.result}`,
      ui: `export async function blankScreen(){const f=globalThis.__devecoDevice;f.screenChecks++;return {blank:f.blank,uniform:f.blank?1:0.2}}`,
      repeat: `export function noteLaunch(){}`,
    }[a.path] }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoDevice; });

test("log filtering precedes limits and follow preserves matches sharing a timestamp", async () => {
  const stamp = '10-16 10:00:00.123';
  const raw = [`${stamp} E app: first needle`, `${stamp} E app: second needle`, `${stamp} I noise`, '10-16 10:00:01.000 I noise'].join('\n');
  assert.match(m.selectLogLines(raw, { limit: 1, grep: 'needle' }).text, /second needle$/);
  const first = m.selectLogLines(raw, { limit: 1, grep: 'needle', cursor: '10-16 09:59:59.000' });
  assert.match(first.text, /first needle$/); assert.equal(first.has_more, true);
  const second = m.selectLogLines(raw, { limit: 1, grep: 'needle', cursor: first.cursor });
  assert.match(second.text, /second needle$/); assert.equal(second.has_more, false);
  assert.equal(m.selectLogLines(raw, { limit: 1, grep: 'needle', cursor: second.cursor }).text, '');
  assert.equal(m.selectLogLines(raw, { limit: 3, grep: 'needle', lower: '10-16 10:00:01.000' }).text, '');
  fixture.respond = ({ args }) => {
    assert.match(args.at(-1), /tail -n 50001$/);
    return { code: 0, stdout: raw, stderr: '', truncated: false };
  };
  try { const result = await m.hilog('fixture-device', { lines: 1, grep: 'needle' }); assert.match(result.tail, /second needle$/); assert.equal(result.scan.has_more, true); }
  finally { delete fixture.respond; }
});

test("SQLite paths with whitespace or option-like text stay inside one quoted database argument", async () => {
  const result = await m.sqlite("fixture-device", "/data/foo -init /tmp/rc", "SELECT 1");
  assert.deepEqual(result, { rows: [{ ok: 1 }], total: 1 });
  assert.deepEqual(fixture.calls.at(-1).command, {
    file: "hdc", args: ["-t", "fixture-device", "shell", "sqlite3 -json -readonly '/data/foo -init /tmp/rc' 'SELECT 1'"],
  });
  const before = fixture.calls.length;
  await assert.rejects(m.sqlite("fixture-device", "/data/unsafe'path.db", "SELECT 1"), { code: "INVALID_INPUT" });
  assert.equal(fixture.calls.length, before, "a rejected database path never reaches the process runner");
});

test("launch smoke distinguishes missing processes, fresh crashes, old logs and blank screens", async (t) => {
  const app = "com.example.app", old = `jscrash-${app}-old`, fresh = `jscrash-${app}-new`;
  for (const c of [
    { name: "no process and no new crash", pid: "", logs: [old], blank: false, smoke: "FAIL_NO_PROCESS", crashed: false, started: false },
    { name: "fresh crash without process", pid: "", logs: [old, fresh], blank: false, smoke: "FAIL_CRASH", crashed: true, started: false },
    { name: "fresh crash with surviving process", pid: "42", logs: [old, fresh], blank: false, smoke: "FAIL_CRASH", crashed: true, started: false },
    { name: "old and unrelated crashes do not fail launch", pid: "42", logs: [old, "jscrash-com.other.app-new"], blank: false, smoke: "PASS", crashed: false, started: true },
    { name: "blank screen still fails smoke", pid: "42", logs: [old], blank: true, smoke: "FAIL_BLANK", crashed: false, started: true },
  ]) await t.test(c.name, async () => {
    let launched = false;
    fixture.screenChecks = 0; fixture.blank = c.blank;
    fixture.respond = ({ args }) => {
      assert.deepEqual(args.slice(0, 3), ["-t", "fixture-device", "shell"]);
      const command = args.slice(3);
      let stdout = "";
      if (command[0] === "ls") stdout = (launched ? c.logs : [old]).join("\n");
      else if (command[0] === "pidof") stdout = c.pid;
      else if (command[0] === "aa" && command[1] === "start") { launched = true; stdout = "start ability successfully"; }
      else assert.deepEqual(command, ["aa", "force-stop", app]);
      return { code: 0, signal: null, stdout, stderr: "" };
    };
    try {
      const result = await m.launchAndCheck("fixture-device", app, "MatrixAbility", "phone", new AbortController().signal, 0);
      assert.equal(result.smoke, c.smoke); assert.equal(result.started, c.started); assert.equal(result.crashed, c.crashed);
      assert.deepEqual(result.new_crash_logs, c.crashed ? [fresh] : []);
      assert.equal(fixture.screenChecks, c.started ? 1 : 0);
      if (c.smoke === "FAIL_NO_PROCESS") {
        assert.deepEqual(result.next, { tool: "device", action: "log", target: "fixture-device", grep: "com\\.example\\.app", from: "1m" });
        assert.match(result.hint, /without bundle/);
        assert.doesNotMatch(result.hint, /diagnose action=crash/);
      } else if (c.crashed) assert.deepEqual(result.next, { tool: "diagnose", action: "crash", target: "fixture-device", bundle: app });
      else assert.equal(result.next, undefined);
    } finally { delete fixture.respond; }
  });
});

test("SQLite uses the explicit owning module and reports the resolved path when opening fails", async () => {
  const db = m.appDatabasePath("com.example.app", "app.db", "default");
  assert.equal(db, "/data/app/el2/100/database/com.example.app/default/rdb/app.db");
  fixture.result = { code: 1, signal: null, stdout: "", stderr: "Error: unable to open database file" };
  await assert.rejects(m.sqlite("fixture-device", db, ".tables"), (error) => {
    assert.equal(error.code, "SQLITE_FAILED");
    assert.equal(error.details.db, db);
    assert.match(error.hint, /exact bundle, owning module and db name/);
    return true;
  });
  assert.deepEqual(fixture.calls.at(-1).command.args, [
    "-t", "fixture-device", "shell", "sqlite3 -readonly '/data/app/el2/100/database/com.example.app/default/rdb/app.db' '.tables'",
  ]);
});
