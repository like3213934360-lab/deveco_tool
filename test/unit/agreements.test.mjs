import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const bundle = path.resolve("node_modules/.cache/deveco-agreements.mjs");
await build({ entryPoints: [path.resolve("src/domains/agreements.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const { agreementAction, resolveAgreements } = await import(pathToFileURL(bundle).href);
after(() => fs.rmSync(bundle, { force: true }));
const n = (i, text, type = "Text", extra = {}) => ({ i, parent: null, text, type, rect: { x1: 0, y1: i * 50, x2: 400, y2: i * 50 + 40 }, window: "front", bundle: "arbitrary.app", visible: true, checked: null, ...extra });
const dialog = (body, accept, extra = {}) => [n(0, body), n(1, "不同意", "Button"), n(2, accept, "Button", extra)];
test("agreement recognition is independent of app names, ids and onboarding provider", () => {
  for (const [body, button] of [
    ["请阅读并接受用户协议和隐私政策", "同意"], ["欢迎使用地图，请阅读服务条款", "同意并继续"],
    ["首次启动相机，请阅读隐私声明", "接受"], ["Please read our privacy policy and terms of use", "Agree"],
    ["请仔细阅读上述声明，点击“同意”，即表示您知悉并同意我们向您提供本应用服务。", "同意"],
    ["License agreement for a development tool", "Accept the agreement"], ["Please read our terms of service", "Agree & Continue"],
    ["权限请求：允许应用访问相机", "允许"], ["Camera permission: access to your camera", "Allow"],
    ["Location access permission for this application", "Allow only while using the app"],
    ["是否允许地图获取您的位置？", "仅在使用期间"], ["Allow Recorder to record audio?", "Allow once"],
  ]) assert.equal(agreementAction(dialog(body, button)).node.i, 2, `${body} / ${button}`);
});
test("negative, ordinary, consequential, disabled and unrelated-window controls are not accepted", () => {
  for (const button of ["不同意", "暂不同意", "Decline", "Disagree", "Agree to purchase", "同意并支付", "同意删除", "Continue", "允许并支付"])
    assert.equal(agreementAction(dialog("隐私政策与用户协议 terms of service", button)), undefined, button);
  assert.equal(agreementAction(dialog("Ordinary document", "Accept")), undefined);
  assert.equal(agreementAction(dialog("Ordinary request", "Allow")), undefined);
  assert.equal(agreementAction(dialog("隐私政策和服务协议", "同意", { enabled: false })), undefined);
  const other = dialog("隐私政策和服务协议", "Agree"); other[2].window = "chat"; assert.equal(agreementAction(other), undefined);
  assert.equal(agreementAction([n(0, "A chat message: terms of service"), n(1, "Agree", "TextInput")]), undefined);
  assert.equal(agreementAction([n(0, "A chat message: terms of service"), n(1, "Agree", "TextInput", { clickable: true })]), undefined);
});
test("checkbox then Continue and a second differently named agreement are handled in one bounded loop", async () => {
  const first = [n(0, "用户协议和隐私政策"), n(1, "我已阅读并同意用户协议", "Checkbox", { checked: false }), n(2, "Continue", "Button", { enabled: false })];
  const checked = first.map((v) => ({ ...v, ...(v.i === 1 ? { checked: true } : v.i === 2 ? { enabled: true } : {}) }));
  const second = dialog("Another application's license agreement", "Accept").map((v) => ({ ...v, bundle: "another.app" }));
  const frames = [checked, second, []], clicks = [];
  const result = await resolveAgreements(first, { read: async () => frames.shift(), click: async (node) => clicks.push(node.i) });
  assert.deepEqual(clicks, [1, 2, 2]); assert.equal(result.accepted.length, 3); assert.deepEqual(result.nodes, []);
});
test("unchanged consent is not clicked twice and cancellation sends no decision", async () => {
  const initial = dialog("用户协议和隐私政策", "同意"); let clicks = 0;
  await assert.rejects(resolveAgreements(initial, { read: async () => initial, click: async () => clicks++ }), (e) => e.code === "UI_AGREEMENT_BLOCKED"); assert.equal(clicks, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveAgreements(initial, { read: async () => initial, click: async () => clicks++ }, controller.signal)); assert.equal(clicks, 1);
});
test("a delayed unrelated agreement is handled without repeating the original action", async () => {
  const frames = [[], dialog("请阅读服务条款和隐私政策", "同意"), []];
  let clicks = 0;
  const result = await resolveAgreements([], { settleMs: 1000, read: async () => { await new Promise((r) => setTimeout(r, 10)); return frames.shift() ?? []; }, click: async () => clicks++ });
  assert.equal(clicks, 1); assert.equal(result.accepted.length, 1);
});
