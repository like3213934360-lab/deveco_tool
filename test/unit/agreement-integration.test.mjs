// Actual tool, UI, batch and replay code; only device transport is simulated.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-consent-"));
process.env.DEVECO_STATE_DIR = work;
process.env.DEVECO_CONFIG = path.join(work, "config.json");
fs.writeFileSync(process.env.DEVECO_CONFIG, "{}");
const f = globalThis.__devecoConsent = { frames: [], clicks: [], taps: 0 };
const raw = (text, type = "Text", y = 0, attrs = {}) => ({ attributes: { type, text, bounds: `[0,${y}][200,${y + 40}]`, visible: true, enabled: true, ...attrs } });
const dialog = (body, button, bundle) => ({ attributes: { bundleName: bundle, windowId: "dialog", bounds: "[0,0][400,800]" }, children: [raw(body), raw("不同意", "Button", 100), raw(button, "Button", 200)] });
const app = () => ({ attributes: { bundleName: "example.application", windowId: "app", bounds: "[0,0][400,800]" }, children: [raw(`taps:${f.taps}`, "Button", 400, { id: "action", clickable: true })] });
const reset = (frames) => { f.frames = frames; f.clicks = []; f.taps = 0; m.invalidate("test"); };
const bundle = path.join(root, "node_modules/.cache/deveco-consent-integration.mjs");
await build({ stdin: { contents: `export {uiTool} from ${JSON.stringify(path.join(root, "src/tools/core.ts"))};export * from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};export {runBatch} from ${JSON.stringify(path.join(root, "src/domains/uibatch.ts"))};export {replayFlow,writeFlow} from ${JSON.stringify(path.join(root, "src/domains/flows.ts"))};export {resetConfig} from ${JSON.stringify(path.join(root, "src/core/config.ts"))};export {closeDatabase} from ${JSON.stringify(path.join(root, "src/core/db.ts"))};`, resolveDir: root }, outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "transport", setup(b) {
  b.onResolve({ filter: /device\.js$/ }, (a) => /(?:domains\/(?:ui|flows)\.ts|tools\/core\.ts)$/.test(a.importer.replaceAll("\\", "/")) ? { path: "device", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `import fs from 'node:fs';const f=()=>globalThis.__devecoConsent;export async function resolveTarget(){return 'test'};export async function assertConnected(){};export async function forceStop(){};export async function launch(){};export async function deviceInfo(){return {screen:{width:400,height:800}}};
    export async function hdc(args){fs.writeFileSync(args.at(-1),JSON.stringify(f().frames[0]));return {stdout:'',stderr:'',code:0}};
    export async function shell(_target,args,signal){signal?.throwIfAborted();const command=args.join(' ');if(command.includes('dumpLayout'))return {stdout:'DumpLayout saved',stderr:'',code:0};if(args[0]==='rm')return {stdout:'',stderr:'',code:0};const hit=/uiInput click (\\d+) (\\d+)/.exec(command);if(!hit)throw new Error('unexpected command '+command);f().clicks.push(Number(hit[2]));if(Number(hit[2])===220)f().frames.shift();else if(Number(hit[2])===420){f().taps++;f().onTap?.()};return {stdout:'No Error',stderr:'',code:0}};` }));
} }] });
const m = await import(pathToFileURL(bundle).href);
const ctx = { signal: new AbortController().signal };
after(async () => { await m.closeDatabase(); fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoConsent; });

test("ordinary UI selector resolves after unrelated agreements, and read-only observation never accepts", async () => {
  reset([dialog("地图服务的用户协议和隐私政策", "同意并继续", "map.vendor"), dialog("Camera permission: access to your camera", "Allow", "camera.vendor"), app()]);
  await m.uiTool.handler({ action: "tree", target: "test" }, ctx); assert.deepEqual(f.clicks, []);
  const result = await m.uiTool.handler({ action: "act", target: "test", op: "click", selector: { id: "action" }, diff: false }, ctx);
  assert.deepEqual(f.clicks, [220, 220, 420]); assert.equal(result.agreements_accepted.length, 2); assert.equal(f.taps, 1);
});
test("batch accepts a new consent between steps and reports both decisions", async () => {
  reset([dialog("A different application's license agreement", "Accept", "editor.vendor"), app()]);
  f.onTap = () => { if (f.taps === 1) f.frames.unshift(dialog("访问照片需要您的权限授权", "允许", "photo.vendor")); };
  const result = await m.runBatch("test", [{ op: "click", selector: { id: "action" } }, { op: "click", selector: { id: "action" } }], {}, ctx.signal);
  delete f.onTap;
  assert.equal(result.passed, true); assert.equal(result.agreements_accepted.length, 2); assert.equal(f.taps, 2);
  assert.deepEqual(f.clicks, [220, 420, 220, 420]);
});
test("ordinary action accepts an agreement that appears after the requested click", async () => {
  reset([app()]);
  f.onTap = () => f.frames.unshift(dialog("首次使用，请阅读协议与隐私政策", "同意", "input.vendor"));
  const result = await m.uiTool.handler({ action: "act", target: "test", op: "click", selector: { id: "action" } }, ctx);
  delete f.onTap;
  assert.equal(result.agreements_accepted.length, 1); assert.equal(f.taps, 1);
  assert.deepEqual(f.clicks, [420, 220]);
});
test("replay handles consent at startup and in final assertion without recording consent as user steps", async () => {
  reset([dialog("首次使用，请阅读用户协议与隐私政策", "接受", "welcome.vendor"), app()]);
  f.onTap = () => { f.frames.unshift(dialog("Please read our terms of service", "Agree", "terms.vendor")); };
  m.writeFlow(work, { version: 2, id: "consent", name: "consent", app: { bundleName: "example.application", ability: "EntryAbility", module: "entry" }, start: { mode: "attach" }, variables: {}, steps: [{ id: "tap", action: "tap", selector: { node_id: "action" } }], assert: { visible: { node_id: "action" } } });
  const result = await m.replayFlow(work, "consent", "test", {}, {}, ctx.signal, () => {});
  delete f.onTap;
  assert.equal(result.passed, true); assert.equal(result.steps, 1); assert.equal(result.agreements_accepted.length, 2);
  assert.deepEqual(f.clicks, [220, 420, 220]);
});
test("invalid action arguments accept no consent", async () => {
  reset([dialog("用户协议与隐私政策", "同意", "any.vendor")]);
  for (const args of [{}, { op: "click", steps: [{ op: "click", x: 1, y: 1 }] }, { op: "input", selector: { id: "action" } }])
    await assert.rejects(m.uiTool.handler({ action: "act", target: "test", ...args }, ctx), (e) => e.code === "INVALID_INPUT");
  assert.deepEqual(f.clicks, []);
});
test("configuration opt-out leaves consent untouched", async () => {
  reset([dialog("用户协议与隐私政策", "同意", "any.vendor")]);
  fs.writeFileSync(process.env.DEVECO_CONFIG, JSON.stringify({ auto_accept_ui_agreements: false })); m.resetConfig();
  const result = await m.acceptAgreements("test", ctx.signal); assert.deepEqual(result.accepted, []); assert.deepEqual(f.clicks, []);
});
