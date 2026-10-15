// Real SQLite/device command construction, with no SDK lookup or device process execution.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../..");
const bundle = path.join(root, "node_modules/.cache/deveco-device.mjs");
const fixture = globalThis.__devecoDevice = { calls: [], result: { code: 0, signal: null, stdout: '[{"ok":1}]', stderr: "" } };
await build({ stdin: { contents: `export { sqlite, appDatabasePath } from ${JSON.stringify(path.join(root, "src/domains/device.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "device-process", setup(b) {
    b.onResolve({ filter: /(?:proc|toolchain)\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/device.ts") ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
      toolchain: `export function toolCommand(name,args){if(name!=='hdc')throw new Error('unexpected tool '+name);return {file:name,args}}`,
      proc: `export async function run(command,options){const f=globalThis.__devecoDevice;f.calls.push({command,options});return f.result}`,
    }[a.path] }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { fs.rmSync(bundle, { force: true }); delete globalThis.__devecoDevice; });

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
