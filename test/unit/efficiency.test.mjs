// Efficiency features (batch UI steps, screen diff, incremental preflight, ...): pure logic, no device.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-eff-"));
process.on("exit", () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
process.env.DEVECO_STATE_DIR = path.join(out, "state");
const src = (f) => JSON.stringify(path.join(root, "src", f));
const entry = path.join(out, "entry.ts");
fs.writeFileSync(entry, [
  `export { screenDiff, stepAction, visibleLabels } from ${src("domains/uibatch.ts")};`,
  `export { snapshotSources, diffSources } from ${src("domains/preflight.ts")};`,
  `export { saveExecutedFlow, readFlow } from ${src("domains/flows.ts")};`,
  `export { parseSourceRefs, resolveRef, locate, snippet } from ${src("domains/sourcemap.ts")};`,
].join("\n"));
await build({ entryPoints: [entry], outfile: path.join(out, "entry.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(root, "node_modules")] });
fs.symlinkSync(path.join(root, "node_modules"), path.join(out, "node_modules"), "junction");
const m = await import(pathToFileURL(path.join(out, "entry.mjs")).href);

let seq = 0;
const node = (type, text, rect, extra = {}) => ({
  i: seq++, parent: null, depth: 1, id: null, type, key: extra.key ?? null, text, rect: { x1: rect[0], y1: rect[1], x2: rect[2], y2: rect[3] },
  clickable: extra.clickable ?? false, enabled: true, visible: true, checked: extra.checked ?? null, selected: null, focused: null,
  bundle: extra.bundle ?? "com.app", window: null, page: null,
});

test("screenDiff: page navigation lists the new page top-down and marks it navigated", () => {
  const home = [node("Text", "首页", [0, 0, 100, 50]), node("Text", "工具", [0, 60, 100, 110], { clickable: true }), node("Text", "我的", [0, 120, 100, 170]), node("Text", "推荐", [0, 180, 100, 230])];
  const tool = [node("Text", "选择壁纸", [0, 0, 100, 50]), node("Button", "本地导入", [0, 60, 100, 110], { clickable: true }), node("Text", "风景", [0, 120, 100, 170]), node("Text", "全部", [0, 70, 50, 90])];
  const d = m.screenDiff(home, tool);
  assert.equal(d.changed, true);
  assert.equal(d.kind, "navigated");
  assert.deepEqual(d.added, ['Text "选择壁纸"', 'Button "本地导入" clickable', 'Text "全部"', 'Text "风景"']);
  assert.equal(d.removed.length, 4);
});

test("screenDiff: a dialog over the page is an update, a toggle is a state change, no-op is none", () => {
  const page = [node("Text", "A", [0, 0, 10, 10]), node("Text", "B", [0, 20, 10, 30]), node("Text", "C", [0, 40, 10, 50]), node("Toggle", "", [0, 60, 10, 70], { key: "sw", checked: false })];
  const dialog = [...page, node("Text", "确定删除?", [0, 80, 10, 90]), node("Button", "取消", [0, 100, 10, 110], { clickable: true })];
  assert.equal(m.screenDiff(page, dialog).kind, "updated");
  const toggled = page.map((n) => (n.key === "sw" ? { ...n, checked: true } : n));
  const s = m.screenDiff(page, toggled);
  assert.equal(s.changed, true);
  assert.equal(s.kind, "state");
  assert.deepEqual([s.added, s.removed], [[], []]);
  assert.deepEqual(m.screenDiff(page, page), { changed: false, added: [], removed: [], kind: "none" });
});

test("screenDiff: output is bounded (10 per side + counts)", () => {
  const many = Array.from({ length: 30 }, (_, i) => node("Text", `item${i}`, [0, i * 10, 10, i * 10 + 5]));
  const d = m.screenDiff([], many);
  assert.equal(d.added.length, 10);
  assert.equal(d.more_added, 20);
  assert.ok(JSON.stringify(d).length < 1024);
});

test("visibleLabels: app content first, status bar skipped", () => {
  const nodes = [
    node("Text", "12:30", [0, 0, 50, 20], { bundle: "com.ohos.systemui" }),
    node("Text", "选择壁纸", [0, 30, 100, 60]), node("Button", "本地导入", [0, 70, 100, 90], { clickable: true }),
    node("Row", "", [0, 100, 100, 120], { key: "layout-only" }),
  ];
  assert.deepEqual(m.visibleLabels(nodes), ['Text "选择壁纸"', 'Button "本地导入" clickable']);
});

test("stepAction: selector point wins; missing inputs are reported by op", () => {
  assert.deepEqual(m.stepAction({ op: "click", x: 1, y: 2 }, { x: 50, y: 60 }), { action: "click", x: 50, y: 60 });
  assert.deepEqual(m.stepAction({ op: "input", text: "你好" }, { x: 5, y: 6 }), { action: "input", x: 5, y: 6, text: "你好", append: undefined });
  assert.deepEqual(m.stepAction({ op: "key", keys: ["ctrl", "a"] }), { action: "keys", keys: ["ctrl", "a"] });
  assert.deepEqual(m.stepAction({ op: "scroll", direction: "down" }), { action: "scroll", direction: "down", speed: undefined });
  assert.throws(() => m.stepAction({ op: "click" }), /click needs selector or x,y/);
  assert.throws(() => m.stepAction({ op: "swipe", x: 1, y: 2 }), /x,y,x2,y2/);
});

test("preflight: only real content edits count; build rewrites of BuildProfile.ets are ignored", () => {
  const proj = fs.mkdtempSync(path.join(out, "pf-"));
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true }); fs.writeFileSync(path.join(proj, f), s); };
  write("entry/src/main/ets/pages/Index.ets", "a");
  write("entry/src/main/ets/pages/Other.ets", "b");
  write("entry/BuildProfile.ets", "gen");
  write("entry/build/generated/X.ets", "x");
  write("entry/oh_modules/lib/Y.ets", "y");
  write("entry/src/main/ets/types.d.ts", "declare");
  const first = m.snapshotSources(proj);
  assert.deepEqual(Object.keys(first).sort(), ["entry/src/main/ets/pages/Index.ets", "entry/src/main/ets/pages/Other.ets"]);
  // Touch without changing content (what hvigor does to generated files): not a change.
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(proj, "entry/src/main/ets/pages/Other.ets"), later, later);
  write("entry/BuildProfile.ets", "gen2");
  assert.deepEqual(m.diffSources(first, m.snapshotSources(proj, first)), []);
  // A real edit and a new file are changes.
  write("entry/src/main/ets/pages/Index.ets", "a2");
  write("entry/src/main/ets/pages/New.ets", "n");
  assert.deepEqual(m.diffSources(first, m.snapshotSources(proj, first)), ["entry/src/main/ets/pages/Index.ets", "entry/src/main/ets/pages/New.ets"]);
});

test("parseSourceRefs: debug, release-bundle, normalized OHM and compiler locations; system frames skipped", () => {
  const text = [
    "Stacktrace:",
    "    at onClick (entry/src/main/ets/pages/Index.ets:25:13)",
    "    at anonymous (entry|entry|1.0.0|src/main/ets/pages/Index.ts:30:5)",
    "    at f (@normalized:N&&&Toolbox/src/main/ets/tool/Page&1.0.0:12:5)",
    "    at g (/system/lib/foo.ts:1:1)",
    "    at h (oh_modules/lib/x.ets:4:4)",
    "WARN: ArkTS:WARN File: /proj/features/Toolbox/src/main/ets/x/Page.ets:12:5",
    "10-01 12:30:45.123  1234  1234 I A0/tag: ok 10:23",
    "    at onClick (entry/src/main/ets/pages/Index.ets:25:13)",
  ].join("\n");
  const refs = m.parseSourceRefs(text);
  assert.deepEqual(refs.map((r) => [r.module ?? null, r.rel, r.line, r.column]), [
    [null, "entry/src/main/ets/pages/Index.ets", 25, 13],
    ["entry", "entry/src/main/ets/pages/Index.ts", 30, 5],
    [null, "Toolbox/src/main/ets/tool/Page.ets", 12, 5],
    [null, "/proj/features/Toolbox/src/main/ets/x/Page.ets", 12, 5],
  ]);
});

test("locate: module names map to module folders, .ts frames find .ets sources, snippet marks the line", () => {
  const proj = fs.mkdtempSync(path.join(out, "src-"));
  const file = path.join(proj, "features/Toolbox/src/main/ets/tool/Page.ets");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"));
  const project = { root: proj, modules: [{ name: "Toolbox", root: path.join(proj, "features/Toolbox") }, { name: "entry", root: path.join(proj, "entry") }] };
  const found = m.locate("at f (Toolbox|Toolbox|1.0.0|src/main/ets/tool/Page.ts:12:5)\nat g (entry/src/main/ets/Missing.ets:1:1)", project);
  assert.equal(found.length, 1);
  assert.equal(found[0].file, "features/Toolbox/src/main/ets/tool/Page.ets");
  assert.equal(found[0].line, 12);
  assert.deepEqual(found[0].snippet, ["     9 | line 9", "    10 | line 10", "    11 | line 11", ">   12 | line 12", "    13 | line 13", "    14 | line 14", "    15 | line 15"]);
  // Paths outside the project are never read.
  assert.equal(m.resolveRef({ rel: "/etc/hosts", line: 1 }, project), undefined);
  assert.deepEqual(m.locate("no locations here", project), []);
  assert.deepEqual(m.locate("x.ets:1:1", undefined), []);
});

test("saveExecutedFlow: executed batch becomes a replayable flow with secret input variables", () => {
  const proj = fs.mkdtempSync(path.join(out, "flow-"));
  const saved = m.saveExecutedFlow(proj, "open-rain", "打开雨雾悬停", { bundleName: "com.app", module: "entry", ability: "EntryAbility" }, [
    { action: { action: "click", x: 10, y: 20 }, selector: { text: "工具", exact: true } },
    { action: { action: "input", x: 5, y: 5, text: "p@ss-w0rd" }, selector: { key: "search" } },
    { action: { action: "mouse_move", x: 1, y: 1 } },
    { action: { action: "click", x: 500, y: 1000 } },
  ], { visible: { text: "选择壁纸" } }, { w: 1000, h: 2000 });
  assert.equal(saved.steps, 3);
  assert.deepEqual(saved.not_saved, ["mouse_move"]);
  const flow = m.readFlow(proj, "open-rain");
  assert.deepEqual(flow.steps[0].selector, { text: "工具", textMode: "exact" });
  assert.equal(flow.steps[1].value, "${input1}");
  assert.equal(fs.readFileSync(saved.file, "utf8").includes("p@ss-w0rd"), false, "typed text is not stored in the flow file");
  assert.equal(flow.variables.input1.secret, true);
  assert.deepEqual(flow.steps[2].point, { xPercent: 50, yPercent: 50 });
  assert.deepEqual(flow.assert.visible, { text: "选择壁纸", textMode: "contains" });
  assert.throws(() => m.saveExecutedFlow(proj, "Bad Id", "x", { bundleName: "a", module: "b", ability: "c" }, [], { visible: { text: "x" } }), /Flow id/);
});
