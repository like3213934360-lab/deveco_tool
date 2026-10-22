import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getEventListeners } from "node:events";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { temporaryDirectory } from "../support/workspace.mjs";

const work = temporaryDirectory("deveco-checker-process-"), bundle = path.join(work, "checker.mjs");
const mode = path.join(work, "mode"), started = path.join(work, "started");
process.env.DEVECO_STATE_DIR = path.join(work, "state");
fs.mkdirSync(path.join(work, "resources/vendor"), { recursive: true });
fs.writeFileSync(path.join(work, "resources/vendor/arkts-check.cjs"), `
const fs=require('node:fs'),readline=require('node:readline');
fs.appendFileSync(${JSON.stringify(started)},process.pid+'\\n');
if(fs.readFileSync(${JSON.stringify(mode)},'utf8')==='ready')console.log(JSON.stringify({ready:true}));
readline.createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);if(request.shutdown)process.exit(0);
 console.log(JSON.stringify({id:request.id,result:{checkedFiles:[],errors:[],summary:{errorCount:0,warnCount:0,fileCount:0}}}));
});`);
await build({ stdin: { contents: `export {arktsCheck} from './src/domains/code.ts';export {closeAllSessions} from './src/core/sessions.ts';export {stopCleanup} from './src/core/artifacts.ts';export {closeDatabase} from './src/core/db.ts';`, resolveDir: process.cwd() },
  outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error",
  plugins: [{ name: "checker-sdk-boundary", setup(b) {
    b.onResolve({ filter: /toolchain\.js$/ }, () => ({ path: "toolchain", namespace: "fixture" }));
    b.onResolve({ filter: /core\/config\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/code.ts") ? { path: "config", namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.path === "config"
      ? `export const assetRoot=${JSON.stringify(work)};export const stateDir=()=>${JSON.stringify(path.join(work, "state"))};`
      : `export const toolchain=()=>({root:${JSON.stringify(work)},content:${JSON.stringify(work)},components:{etsLoader:'fixture'}});export const component=()=>${JSON.stringify(process.execPath)};export const toolCommand=()=>{throw new Error('unexpected SDK call')};export const sdkInfo=()=>({});` }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(async () => { await m.closeAllSessions(); await m.stopCleanup(); m.closeDatabase(); fs.rmSync(work, { recursive: true, force: true }); });

test("warm checker requests release abort listeners after every result", async () => {
  fs.writeFileSync(mode, "ready");
  const controller = new AbortController();
  for (let i = 0; i < 15; i++) {
    assert.equal((await m.arktsCheck(work, [], controller.signal)).passed, true);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  assert.equal(fs.readFileSync(started, "utf8").trim().split("\n").length, 1);
  await m.closeAllSessions();
});

test("cancellation during checker startup rejects promptly and kills its owned process", async () => {
  fs.writeFileSync(mode, "silent");
  const controller = new AbortController(), pending = m.arktsCheck(work, [], controller.signal);
  const before = performance.now();
  const timer = setTimeout(() => controller.abort(), 200);
  try { await assert.rejects(pending, { code: "CANCELLED" }); }
  finally { clearTimeout(timer); }
  assert.ok(performance.now() - before < 1500);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const pid = Number(fs.readFileSync(started, "utf8").trim().split("\n").at(-1));
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("cancelled checker still running");
});
