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
  `export { BuildOutputParser } from ${src("domains/project.ts")};`,
  `export { noteLaunch, noteTaps, repeatSuggestion, resetRepeats } from ${src("domains/repeat.ts")};`,
  `export { decideHot, changedInputs, inputsSnapshot } from ${src("domains/hotpath.ts")};`,
  `export { encodePng, decodeGray, compareGray, annotate, baselinePath } from ${src("domains/visual.ts")};`,
  `export { pngGray } from ${src("domains/ui.ts")};`,
  `export { checkLayout } from ${src("domains/layout.ts")};`,
  `export { parseComposerFps, mergeFrames, frameStats, perfVerdict, parseSpFps, parsePss } from ${src("domains/perf.ts")};`,
  `export { buildFailureHints } from ${src("domains/diagnose.ts")};`,
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

test("build parser: a failed signing step reports the signer's cause, not just 'Tools execution failed'", () => {
  // MyStarRing on 2026-10-01: the debug certificate expired at 15:36.
  const log = [
    "> hvigor \u001b[91mERROR: Failed :phone:default@SignHap... \u001b[39m",
    "> hvigor \u001b[91mERROR: Tools execution failed.",
    "10-01 20:20:46.862  ERROR - The certificate has expired! NotAfter: Thu Oct 01 15:36:53 CST 2026",
    "10-01 20:20:47.109  ERROR - ",
    "ERROR: 11013002 Certificate format is incorrect, please check your appCertFile parameter.",
    "Error Message: The certificate has expired! NotAfter: Thu Oct 01 15:36:53 CST 2026",
    "> hvigor \u001b[91mERROR: BUILD FAILED in 5 s 937 ms \u001b[39m",
  ];
  const p = new m.BuildOutputParser("/proj");
  for (const l of log) p.line(l);
  const r = p.finish();
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "11013002");
  assert.match(errors[0].message, /certificate has expired/);
  assert.deepEqual(r.failed_tasks, ["phone:default@SignHap"]);
  assert.ok(m.buildFailureHints(errors).some((h) => /expired.*sign action=auto force=true/.test(h)));
  // Without a coded cause the generic line is still reported (never an empty error list).
  const q = new m.BuildOutputParser("/proj");
  for (const l of [log[0], log[1], log[6]]) q.line(l);
  assert.deepEqual(q.finish().diagnostics.map((d) => d.message), ["Tools execution failed. (phone:default@SignHap)"]);
});

test("repeat detection: the same opening taps after a relaunch are suggested once, with exact selectors", () => {
  m.resetRepeats();
  const tools = { text: "工具", exact: true, clickable: true }, gif = { text: "视频转 GIF", exact: true };
  m.noteLaunch("d1");
  assert.equal(m.noteTaps("d1", [tools, gif]), undefined, "first walk: nothing to compare with");
  m.noteLaunch("d1");
  assert.equal(m.noteTaps("d1", [tools]), undefined, "one tap is not a path");
  assert.deepEqual(m.noteTaps("d1", [gif]), [tools, gif], "same 2 taps after a relaunch (across calls)");
  assert.equal(m.noteTaps("d1", []), undefined, "suggested only once");
  // Another device has its own history; a coordinate tap breaks the path.
  m.noteLaunch("d2");
  assert.equal(m.noteTaps("d2", [tools, gif]), undefined);
  m.noteLaunch("d2");
  assert.equal(m.noteTaps("d2", [tools, undefined, gif]), undefined);
  // A different start is not a repeat.
  m.noteLaunch("d1");
  assert.equal(m.noteTaps("d1", [{ text: "我的" }, gif]), undefined);
  const s = m.repeatSuggestion([tools, gif]);
  assert.deepEqual(s.steps, [{ op: "click", selector: tools }, { op: "click", selector: gif }]);
  assert.match(s.note, /then_flow/);
});

test("auto hot reload: only provably equivalent changes are quick-fixed; every other case says why", () => {
  const src = { "products/phone/src/main/ets/pages/Index.ets": "1:1:a", "features/tools/src/main/ets/A.ets": "1:1:b" };
  const i1 = { "products/phone/src/main/resources/base/element/string.json": "1:1:r1" };
  const state = { module: "phone", moduleRoot: "/p/products/phone", target: "D", install: "100:200", sources: src, inputs: i1 };
  const now = (o = {}) => ({ target: "D", install: "100:200", running: true, sources: src, inputs: i1, moduleRel: "products/phone", ...o });
  const edit = { ...src, "products/phone/src/main/ets/pages/Index.ets": "2:1:c" };
  assert.deepEqual(m.decideHot(state, now({ sources: edit })), { hot: true, files: ["products/phone/src/main/ets/pages/Index.ets"] });
  assert.equal(m.decideHot(state, now()).unchanged, true, "nothing changed: relaunch only");
  const reason = (s, n) => m.decideHot(s, n).reason;
  assert.match(reason(undefined, now()), /no quick-fix baseline/);
  assert.match(reason({ ...state, install: "" }, now()), /no quick-fix baseline/);
  assert.match(reason(state, now({ target: "E", sources: edit })), /another device/);
  assert.match(reason(state, now({ install: "100:300", sources: edit })), /reinstalled/);
  assert.match(reason(state, now({ running: false, sources: edit })), /not running/);
  assert.match(reason(state, now({ inputs: { "products/phone/src/main/resources/base/element/string.json": "2:1:r2" }, sources: edit })), /resources, manifests or dependencies changed \(products\/phone\/src\/main\/resources/);
  // A resource touched but restored (same content, new mtime) is not a change.
  assert.equal(m.decideHot(state, now({ inputs: { "products/phone/src/main/resources/base/element/string.json": "9:1:r1" } })).unchanged, true);
  assert.match(reason({ ...state, inputs: "legacy-digest" }, now()), /no quick-fix baseline/, "old state format is ignored");
  assert.match(reason(state, now({ sources: { ...src, "products/phone/src/main/ets/pages/New.ets": "1:1:n" } })), /added/);
  assert.match(reason(state, now({ sources: { "features/tools/src/main/ets/A.ets": "1:1:b" } })), /deleted/);
  assert.match(reason(state, now({ sources: { ...src, "features/tools/src/main/ets/A.ets": "2:1:z" } })), /outside module phone/);
  // A touched file with the same content is not a change.
  assert.equal(m.decideHot(state, now({ sources: { ...src, "features/tools/src/main/ets/A.ets": "9:1:b" } })).unchanged, true);
});

test("perf: composer timestamps -> fps, percentiles and jank, independent of the idle refresh rate", () => {
  const dump = ["", "----RenderService----", "The fps of screen [Id:0] is:", ...Array.from({ length: 5 }, (_, i) => String(32380167659063 - i * 8333333)), ""].join("\n");
  assert.equal(m.parseComposerFps(dump).length, 5);
  // 1 s of smooth 120 Hz, then a 3-frame hitch, then smooth again; a 2 s idle pause between gestures.
  const t0 = 1e12, frame = 1e9 / 120, series = [];
  let t = t0;
  for (let i = 0; i < 120; i++) series.push((t += frame));
  series.push((t += 4 * frame)); // 33 ms gap: 3 frames missed
  for (let i = 0; i < 60; i++) series.push((t += frame));
  t += 2e9; // idle
  for (let i = 0; i < 60; i++) series.push((t += frame));
  const merged = m.mergeFrames(series.slice(0, 150), series.slice(100)); // overlapping polls
  assert.equal(merged.length, series.length);
  const s = m.frameStats(merged, 60); // the device reported 60 Hz (idle reading): 120 Hz is inferred
  assert.equal(s.refresh_hz, 120);
  assert.equal(s.janky_frames, 1);
  assert.equal(s.missed_frames, 3);
  assert.ok(s.avg_fps > 115 && s.avg_fps < 120, String(s.avg_fps));
  assert.equal(s.frame_ms.p50, 8.33);
  assert.equal(s.frame_ms.max, 33.3);
  assert.equal(m.perfVerdict(s), "smooth");
  const bad = []; t = t0;
  for (let i = 0; i < 100; i++) bad.push((t += i % 4 === 0 ? 4 * frame : frame));
  assert.equal(m.perfVerdict(m.frameStats(bad, 120)), "janky");
  assert.equal(m.frameStats([t0, t0 + frame], 120), undefined, "too few frames: no verdict");
  assert.deepEqual(m.parseSpFps("set num:4 success\nfps:30|1790762831007\nfps:118|1790762834007\n"), [{ fps: 30, at: 1790762831007 }, { fps: 118, at: 1790762834007 }]);
  assert.equal(m.parsePss("order:45 pss=900413\norder:46 refreshrate=60"), 900413);
});

test("visual: PNG round trip, unchanged screen = same, a moved card = one boxed region; bars ignored", () => {
  const W = 120, H = 240;
  const screen = (card = { x: 20, y: 60 }, clock = 0) => {
    const g = new Uint8Array(W * H).fill(240);
    for (let y = 0; y < 10; y++) for (let x = 0; x < W; x++) g[y * W + x] = clock; // status bar (top 6 %)
    for (let y = card.y; y < card.y + 40; y++) for (let x = card.x; x < card.x + 50; x++) g[y * W + x] = 40;
    return { width: W, height: H, gray: g };
  };
  const a = screen();
  const png = m.encodePng(W, H, a.gray);
  assert.deepEqual(m.decodeGray(png), a, "grayscale round trip");
  // The RGB annotation decodes with the generic decoder too.
  assert.equal(m.pngGray(m.annotate(a, [{ x: 0, y: 20, w: 30, h: 30 }])).width, W);
  assert.deepEqual(m.compareGray(a, screen({ x: 20, y: 60 }, 255)), { changed_ratio: 0, regions: [] }, "clock change in the status bar is ignored");
  const moved = m.compareGray(a, screen({ x: 20, y: 150 }));
  assert.ok(moved.changed_ratio > 0.05);
  assert.equal(moved.regions.length, 2, "old and new position are separate regions");
  const r = moved.regions.find((x) => x.y >= 130);
  assert.ok(r.x <= 20 && r.x + r.w >= 70 && r.y <= 150 && r.y + r.h >= 190, JSON.stringify(r));
  assert.throws(() => m.compareGray(a, { width: 10, height: 10, gray: new Uint8Array(100) }), /differ in size/);
  assert.match(m.baselinePath("/p", "gif-page", "VYG-AL00"), /\.arkpilot[\\/]baselines[\\/]gif-page@VYG-AL00\.png$/);
  assert.throws(() => m.baselinePath("/p", "../x", "m"), /baseline name/);
});

test("layout rules: off-screen, overlapping targets, clipped/collapsed text; scrollers and tab bars are not bugs", () => {
  let id = 0;
  const n = (type, rect, extra = {}) => ({ i: id++, parent: extra.parent ?? null, depth: 1, id: null, type, key: extra.key ?? "", text: extra.text ?? "",
    rect: rect ? { x1: rect[0], y1: rect[1], x2: rect[2], y2: rect[3] } : null, clickable: extra.clickable ?? false, enabled: true, visible: true,
    checked: null, selected: null, focused: null, bundle: extra.bundle ?? "com.app", window: null, page: null });
  const screen = { w: 1000, h: 2000 };
  const root = n("Column", [0, 0, 1000, 2000]);
  const ok = [root, n("Button", [100, 100, 400, 260], { parent: root.i, text: "确定", clickable: true })];
  assert.deepEqual(m.checkLayout(ok, screen, { density: 3 }), { passed: true, checked: 1, counts: {}, issues: [] });
  // A system dialog in front (no app element): no verdict instead of a false pass.
  const covered = m.checkLayout([n("Text", [0, 0, 100, 50], { text: "允许通知？", bundle: "com.ohos.notificationdialog" })], screen, { bundle: "com.app" });
  assert.equal(covered.passed, false);
  assert.match(covered.error, /nothing was checked/);

  const row = n("Row", [0, 300, 1000, 400]);
  const list = n("List", [0, 0, 1000, 2000]);
  const bar = n("Stack", [0, 1800, 1000, 2000], { clickable: true }); // unlabelled tab-bar background
  const nodes = [
    root, row, list, bar,
    n("Text", [900, 310, 1200, 390], { parent: row.i, text: "很长的标题被挤出屏幕" }), // off screen + clipped by row
    n("Button", [100, 500, 400, 650], { text: "A", clickable: true }),
    n("Button", [150, 520, 450, 660], { text: "B", clickable: true }), // overlaps A
    n("Text", [10, 700, 10, 760], { text: "看不见" }), // collapsed
    n("Text", [0, 2100, 500, 2200], { parent: list.i, text: "滚动区里的下一项" }), // below the fold inside a List: fine
    n("Column", [100, 1850, 300, 1990], { parent: bar.i, text: "首页", clickable: true }), // tab over its bar: fine
    n("Image", [600, 500, 660, 560], { key: "close", clickable: true }), // 20x20 vp
  ];
  const r = m.checkLayout(nodes, screen, { density: 3 });
  assert.equal(r.passed, false);
  assert.deepEqual(r.counts, { offscreen: 1, collapsed: 1, tiny_target: 1, overlap: 1, clipped: 1 });
  assert.equal(r.issues.find((x) => x.rule === "overlap").other, 'Button "B"');
  assert.equal(r.issues.find((x) => x.rule === "tiny_target").detail, "20x20 vp");
  // tiny targets alone are advice, not a failure; other bundles are ignored.
  assert.equal(m.checkLayout([root, nodes.at(-1)], screen, { density: 3 }).passed, true);
  assert.equal(m.checkLayout(nodes, screen, { bundle: "com.other" }).issues.length, 0);
});

test("hot path inputs: resources compared by content", () => {
  const proj = fs.mkdtempSync(path.join(out, "in-"));
  const f = path.join(proj, "entry/src/main/resources/base/element/string.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "{}");
  fs.writeFileSync(path.join(proj, "entry/src/main/ets.ets"), "code");
  const a = m.inputsSnapshot(proj);
  assert.deepEqual(Object.keys(a), ["entry/src/main/resources/base/element/string.json"]);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(f, later, later);
  assert.deepEqual(m.changedInputs(a, m.inputsSnapshot(proj, a)), [], "touched, same content");
  fs.writeFileSync(f, '{"x":1}');
  assert.deepEqual(m.changedInputs(a, m.inputsSnapshot(proj, a)), ["entry/src/main/resources/base/element/string.json"]);
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
