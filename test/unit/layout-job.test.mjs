import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-layout-"));
process.env.DEVECO_STATE_DIR = work;
const fixture = globalThis.__devecoLayoutFixture = { instances: [{ name: "deveco_layout_foldable", running: true }], mutations: [], rejectFold: false };
const bundle = path.join(root, "node_modules/.cache/deveco-layout-harness.mjs");
await build({ stdin: { contents: `export { uiTool } from ${JSON.stringify(path.join(root, "src/tools/core.ts"))}; export { layoutCheck } from ${JSON.stringify(path.join(root, "src/domains/layout.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "error", plugins: [{ name: "sdk", setup(b) {
    b.onResolve({ filter: /(?:device|project|emulator|ui|jobs)\.js$/ }, (a) => {
      if (/tools\/core\.ts$/.test(a.importer.replaceAll("\\", "/")) && /core\/jobs\.js$/.test(a.path)) return { path: "jobs", namespace: "fixture" };
      if (/tools\/core\.ts$/.test(a.importer.replaceAll("\\", "/")) && /device\.js$/.test(a.path)) return { path: "routing", namespace: "fixture" };
      if (/domains\/layout\.ts$/.test(a.importer.replaceAll("\\", "/"))) return { path: path.basename(a.path, ".js"), namespace: "fixture" };
    });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
      jobs: `export async function startJob(kind,input){globalThis.__devecoLayoutFixture.job={kind,input}; return {job_id:'owned',deduplicated:false}};export async function waitJob(){return {status:'running',job_id:'owned'}};`,
      routing: `export async function resolveTarget(){const e=new Error('Several devices connected');e.code='DEVICE_AMBIGUOUS';throw e};`,
      project: `export function inspectProject(root){return {root,bundleName:'com.test.layout',modules:[{name:'entry',type:'entry',deviceTypes:['phone']}]}};export function mainAbility(){return {ability:'EntryAbility',module:'entry'}};export async function buildOutputs(_p,task){return task==='assembleHap'?[{path:'/fake.hap'}]:[]};`,
      emulator: `const f=()=>globalThis.__devecoLayoutFixture;export async function images(){return {images:[{downloaded:true,device_type:'foldable',os_version:'HarmonyOS 7.0.0(26)'}]}};export async function listEmulators(){return f().instances};
        export async function createEmulator(input){f().mutations.push(['create',input]);f().instances.push({name:input.name,running:false})};export async function startEmulator(name,options){f().mutations.push(['start',name,options]);f().instances.find(e=>e.name===name).running=true;return {target:'owned-target'}};
        export async function stopEmulator(name,signal){if(signal.aborted)throw new Error('cleanup signal aborted');f().mutations.push(['stop',name]);f().instances.find(e=>e.name===name).running=false};export async function deleteEmulator(name){f().mutations.push(['delete',name]);f().instances=f().instances.filter(e=>e.name!==name)};
        export async function scenario(_name,s){if(f().rejectFold&&s.state==='close')throw new Error('unsupported fold')};`,
      device: `export async function install(){};export async function forceStop(){};export async function launch(){};export async function deviceInfo(){return {model:'fixture',screen:{width:1000,height:2000}}};export async function shell(){return {stdout:'VirtualPixelRatio: 3'}};`,
      ui: `export async function dumpTree(){return [{i:0,parent:null,type:'Text',text:'app',bundle:'com.test.layout',rect:{x1:0,y1:0,x2:300,y2:100}}]};export async function acceptAgreements(_t,_s,nodes){return {nodes,accepted:[]}};export function select(){return []};export function center(){return {x:1,y:1}};export async function act(){};export function invalidate(){};export async function listWindows(){return [{type:1,visible:true,name:'app',bounds:[0,0,1000,2000]}]};export async function saveTree(){return {artifact_id:'fixture'}};export async function screenshot(){return undefined};`,
    }[a.path], loader: "js" }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoLayoutFixture; });

test("forms routing bypasses unrelated target ambiguity while ordinary UI preserves it", async () => {
  const ctx = { signal: new AbortController().signal };
  const r = await m.uiTool.handler({ action: "layout", project: "/p", forms: ["foldable"] }, ctx);
  assert.equal(r.job_id, "owned"); assert.equal(fixture.job.kind, "layout_check");
  await assert.rejects(m.uiTool.handler({ action: "tree" }, ctx), (e) => e.code === "DEVICE_AMBIGUOUS");
});

test("forms use only their owned instance and an unapplied fold cannot pass", async () => {
  fixture.rejectFold = true;
  const r = await m.layoutCheck({ project: "/p", forms: ["foldable"] }, new AbortController().signal, () => {}, "j_owned");
  assert.equal(r.passed, false); assert.deepEqual(r.failed, ["foldable/close"]); assert.equal(r.checked_states, 1);
  assert.deepEqual(fixture.instances, [{ name: "deveco_layout_foldable", running: true }]);
  assert.ok(fixture.mutations.every((entry) => (typeof entry[1] === "string" ? entry[1] : entry[1].name) !== "deveco_layout_foldable"));
  const created = fixture.mutations.find((e) => e[0] === "create")[1];
  assert.ok(created.instance_path.startsWith(work)); assert.equal(fs.existsSync(created.instance_path), false);
});
