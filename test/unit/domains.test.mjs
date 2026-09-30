// Pure domain logic (no device): bundled on the fly from src/ with esbuild.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-unit-"));
process.on("exit", () => fs.rmSync(out, { recursive: true, force: true })); // tests leave nothing behind
const entry = path.join(out, "entry.ts");
fs.writeFileSync(entry, [
  `export { parseWindows, pngGray, blankScore } from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};`,
  `export { checklist } from ${JSON.stringify(path.join(root, "src/domains/uitest.ts"))};`,
  `export { mergeCodexToml, mergeJsonConfig } from ${JSON.stringify(path.join(root, "src/domains/hostconfig.ts"))};`,
  `export { projectAclPermissions, profileSummary } from ${JSON.stringify(path.join(root, "src/domains/sign.ts"))};`,
  `export { siteAllowed, regionBase } from ${JSON.stringify(path.join(root, "src/domains/auth.ts"))};`,
  `export { apiOf, compatibility } from ${JSON.stringify(path.join(root, "src/domains/doctor.ts"))};`,
  `export { faultTime, buildFailureHints } from ${JSON.stringify(path.join(root, "src/domains/diagnose.ts"))};`,
  `export { chordCodes, treeSignature, subtree, deviceText } from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};`,
  `export { createArgs, agreementsAccepted, emulatorFailure } from ${JSON.stringify(path.join(root, "src/domains/emulator.ts"))};`,
  `export { labelCloudSources, packCloudSections, AUTHORITY } from ${JSON.stringify(path.join(root, "src/domains/knowledge.ts"))};`,
  `export { applicableSyscap, deviceCaps } from ${JSON.stringify(path.join(root, "src/domains/syscap.ts"))};`,
  `export { parseDuration } from ${JSON.stringify(path.join(root, "src/domains/device.ts"))};`,
  `export { findProjectRoot, selectRunModules, BuildOutputParser } from ${JSON.stringify(path.join(root, "src/domains/project.ts"))};`,
  `export { readonlySqlAllowed } from ${JSON.stringify(path.join(root, "src/domains/device.ts"))};`,
].join("\n"));
await build({ entryPoints: [entry], outfile: path.join(out, "entry.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(root, "node_modules")] });
fs.symlinkSync(path.join(root, "node_modules"), path.join(out, "node_modules"), "junction"); // junction: no admin rights needed on Windows
const m = await import(pathToFileURL(path.join(out, "entry.mjs")).href);

test("parses the WindowManagerService window table", () => {
  const raw = [
    "WindowName           DisplayId Pid     WinId Type Mode Flag ZOrd Orientation [ x    y    w    h    ]",
    "nimble_widget_app0   0         2494    197   1    1    0    3    0           [ 0    0    1276 2848 ]",
    "SCBStatusBar24       0         1453    27    2108 1    0    2202 0           [ 0    0    1320 117  ]",
    "---------------------------------------------------------------------------------------",
    "xxwidgt0             0         6628    200   1    1    0    -1   0           [ 0    0    1276 2848 ]",
    "Focus window: 197",
    "Total window num: 3",
  ].join("\n");
  const w = m.parseWindows(raw);
  assert.equal(w.length, 3);
  assert.deepEqual(w[0], { id: 197, name: "nimble_widget_app0", pid: 2494, display: 0, type: 1, focused: true, visible: true, bounds: [0, 0, 1276, 2848] });
  assert.equal(w[2].visible, false);
});

test("splits a test plan into a checklist", () => {
  assert.deepEqual(m.checklist("1. 打开首页\n2) 点击登录\n- 看到欢迎"), ["打开首页", "点击登录", "看到欢迎"]);
  assert.deepEqual(m.checklist("打开首页。点击登录。"), ["打开首页。", "点击登录。"]);
});

test("sqlite guard only allows read statements by default", () => {
  assert.ok(m.readonlySqlAllowed("select * from t; pragma table_info(t)"));
  assert.ok(m.readonlySqlAllowed(".tables"));
  assert.ok(!m.readonlySqlAllowed("select 1; delete from t"));
  assert.ok(!m.readonlySqlAllowed("update t set a=1"));
});

test("merges host MCP configs idempotently (JSON + TOML)", () => {
  const spec = { command: "/usr/bin/node", args: ["/x/cli.js", "mcp"], env: { A: "1" } };
  const data = { mcpServers: { other: { command: "y" } } };
  assert.equal(m.mergeJsonConfig(data, "standard", "deveco", spec, false).changed, true);
  assert.equal(m.mergeJsonConfig(data, "standard", "deveco", spec, false).changed, false);
  assert.ok(data.mcpServers.other);
  const oc = {};
  m.mergeJsonConfig(oc, "opencode", "deveco", spec, false);
  assert.deepEqual(oc.mcp.deveco.command, ["/usr/bin/node", "/x/cli.js", "mcp"]);
  const toml = 'model = "o3"\n\n[mcp_servers.deveco]\ncommand = "old"\n[mcp_servers.deveco.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "a"\n';
  assert.equal(m.mergeCodexToml(toml, "deveco", spec, false).changed, false);
  const merged = m.mergeCodexToml(toml, "deveco", spec, true).text;
  assert.ok(merged.includes('model = "o3"') && merged.includes("[mcp_servers.other]") && !merged.includes('"old"') && !merged.includes('X = "1"'));
  assert.ok(merged.includes('args = ["/x/cli.js", "mcp"]') && merged.includes('A = "1"'));
});

test("derives ACL permissions from module.json5 and SDK definitions", () => {
  const dir = fs.mkdtempSync(path.join(out, "acl-"));
  fs.mkdirSync(path.join(dir, "src/main"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/ohosTest"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/main/module.json5"), '{ module: { requestPermissions: [{ name: "ohos.permission.INTERNET" }, { name: "ohos.permission.READ_AUDIO" }] } }');
  fs.writeFileSync(path.join(dir, "src/ohosTest/module.json5"), '{ module: { requestPermissions: [{ name: "ohos.permission.SYSTEM_FLOAT_WINDOW" }] } }');
  const defs = path.join(dir, "defs.json");
  fs.writeFileSync(defs, JSON.stringify({ definePermissions: [
    { name: "ohos.permission.INTERNET", availableLevel: "normal", availableType: "NORMAL", provisionEnable: true },
    { name: "ohos.permission.READ_AUDIO", availableLevel: "system_basic", availableType: "NORMAL", provisionEnable: true },
    { name: "ohos.permission.SYSTEM_FLOAT_WINDOW", availableLevel: "system_basic", availableType: "NORMAL", provisionEnable: true },
    { name: "ohos.permission.X", availableLevel: "system_basic", availableType: "SYSTEM", provisionEnable: true },
  ] }));
  const r = m.projectAclPermissions([{ root: dir }], defs);
  assert.deepEqual(r.acl, ["ohos.permission.READ_AUDIO", "ohos.permission.SYSTEM_FLOAT_WINDOW"]);
  assert.equal(r.requested.length, 3);
});

test("login region endpoints and site checks", () => {
  assert.equal(m.regionBase.cn, "https://cn.devecostudio.huawei.com");
  assert.equal(m.regionBase.global, "https://devecostudio.huawei.com");
  assert.ok(m.siteAllowed("cn", "1") && !m.siteAllowed("cn", "5"));
  assert.ok(m.siteAllowed("global", "7") && !m.siteAllowed("global", "1"));
  assert.ok(m.siteAllowed("cn", null));
});

test("SDK compatibility assessment", () => {
  assert.equal(m.apiOf("5.0.0(12)"), 12);
  assert.equal(m.apiOf("6.0.2(22)"), 22);
  assert.equal(m.apiOf("26.0.0"), 26);
  assert.equal(m.compatibility({ compile: "6.0.2(22)", compatible: "5.0.0(12)" }, 22, 20).ok, true);
  const bad = m.compatibility({ compile: "6.0.2(22)", compatible: "6.0.0(20)" }, 20, 18);
  assert.equal(bad.ok, false);
  assert.equal(bad.detail.problems.length, 2);
});

test("blank-screen smoke check decodes PNG and detects solid screens", async () => {
  const zlib = await import("node:zlib");
  const png = (w, h, pixel) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = y % 2 ? 2 : 1; const row = Buffer.alloc(w * 3); for (let x = 0; x < w; x++) row.set(pixel(x, y), x * 3);
      // encode with Sub (odd rows Up) filters to exercise the decoder
      const prev = y ? Buffer.from(raw.subarray((y - 1) * (w * 3 + 1) + 1, y * (w * 3 + 1))) : null;
      for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = y % 2 ? (row[i] - (prevRows[y - 1]?.[i] ?? 0)) & 0xff : (row[i] - (i >= 3 ? row[i - 3] : 0)) & 0xff;
      prevRows[y] = row; void prev; }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };
  const prevRows = [];
  const white = m.pngGray(png(64, 128, () => [255, 255, 255]));
  assert.equal(white.width, 64);
  assert.equal(m.blankScore(white).blank, true);
  prevRows.length = 0;
  const content = m.pngGray(png(64, 128, (x, y) => (y > 40 && y < 80 && x > 10 && x < 54 && (x + y) % 3 ? [0, 0, 0] : [255, 255, 255])));
  assert.equal(content.gray[0], 255);
  assert.equal(m.blankScore(content).blank, false);
});

test("faultlog names carry epoch or device-local timestamps", () => {
  assert.deepEqual(m.faultTime("jscrash-com.a.b-20020075-1790589122140"), { ms: 1790589122140, local: false });
  const local = m.faultTime("cppcrash-com.dream.app-20020075-20260928124716885.log");
  assert.equal(local.local, true);
  assert.equal(local.ms, Date.UTC(2026, 8, 28, 12, 47, 16, 885));
  assert.equal(m.faultTime("appfreeze-x-20260928124716").ms, Date.UTC(2026, 8, 28, 12, 47, 16));
  assert.equal(m.faultTime("sysfreeze-noname"), undefined);
});

test("key chords and tree signatures", () => {
  assert.deepEqual(m.chordCodes(["ctrl", "a"]), [2072, 2017]);
  assert.deepEqual(m.chordCodes(["ctrl", "shift", "z"]), [2072, 2047, 2042]);
  assert.throws(() => m.chordCodes(["a", "b", "c", "d"]));
  assert.throws(() => m.chordCodes(["nokey"]));
  const node = (text) => ({ type: "Text", text, clickable: true, key: null, rect: { x1: 0, y1: 0, x2: 10, y2: 10 }, checked: null, selected: null });
  assert.equal(m.treeSignature([node("a")]), m.treeSignature([node("a")]));
  assert.notEqual(m.treeSignature([node("a")]), m.treeSignature([node("b")]));
});

test("relative durations for log windows", () => {
  assert.equal(m.parseDuration("30s"), 30000);
  assert.equal(m.parseDuration("2.5m"), 150000);
  assert.equal(m.parseDuration("120"), 120000);
  assert.equal(m.parseDuration("1h"), 3600000);
  assert.throws(() => m.parseDuration("5 minutes"));
});

test("emulator create arguments and license state", () => {
  assert.deepEqual(m.createArgs({ name: "E", device_type: "foldable", os_version: "HarmonyOS 6.0.0(20)", screen: ["2200 2480 480 7.8", "1080 2480 480 6.4"], hot_boot: false, instance_path: "/i", force: true }),
    ["-create", "E", "-deviceType", "foldable", "-osVersion", "HarmonyOS 6.0.0(20)", "-instancePath", "/i", "-screen", "2200 2480 480 7.8", "1080 2480 480 6.4", "-hotBoot", "false", "-force"]);
  assert.throws(() => m.createArgs({ name: "E", device_type: "phone", os_version: "x", screen: ["1080x2340"] }));
  assert.equal(m.agreementsAccepted("HarmonyOS_Software_Service_Agreement:agree\nHarmonyOS_SDK_Agreement:agree\n"), true);
  assert.equal(m.agreementsAccepted("HarmonyOS_Software_Service_Agreement:agree\nHarmonyOS_SDK_Agreement:disagree\n"), false);
  assert.equal(m.agreementsAccepted(""), false);
});

test("component subtree by id and device-side text encoding", () => {
  const n = (i, parent, id) => ({ i, parent, depth: 0, id, key: id, type: "X", text: "", rect: null });
  const nodes = [n(0, null, "root"), n(1, 0, "box"), n(2, 1, "a"), n(3, 2, "b"), n(4, 0, "other")];
  assert.deepEqual(m.subtree(nodes, "box").map((x) => x.id), ["box", "a", "b"]);
  assert.deepEqual(m.subtree(nodes, "nope"), []);
  const encoded = m.deviceText(`a"b $x 'q'`);
  assert.match(encoded, /^"\$\(printf '%s' '[A-Za-z0-9+/=]+' \| base64 -d\)"$/);
  assert.equal(Buffer.from(/'([A-Za-z0-9+/=]+)'/.exec(encoded)[1], "base64").toString(), `a"b $x 'q'`);
});

test("project root auto-detection searches down, never up", () => {
  const base = fs.mkdtempSync(path.join(out, "find-"));
  const proj = path.join(base, "work", "MyApp");
  fs.mkdirSync(path.join(proj, "AppScope"), { recursive: true });
  fs.writeFileSync(path.join(proj, "build-profile.json5"), "{}");
  assert.equal(m.findProjectRoot(base), proj);
  assert.equal(m.findProjectRoot(path.join(proj, "AppScope")), undefined);
});

test("run module selection follows the device type (phone vs watch entry)", () => {
  const mod = (name, type, deviceTypes) => ({ name, type, deviceTypes, root: "/x/" + name, target: "default" });
  const project = { root: "/x", product: "default", products: ["default"], modules: [
    mod("default", "entry", ["phone", "tablet", "2in1"]), mod("watch", "entry", ["wearable"]), mod("utils", "har", ["default"]),
  ] };
  assert.deepEqual(m.selectRunModules(project, { deviceType: "phone" }).modules.map((x) => x.name), ["default"]);
  assert.deepEqual(m.selectRunModules(project, { deviceType: "wearable" }).modules.map((x) => x.name), ["watch"]);
  assert.throws(() => m.selectRunModules(project, {}), /Several runnable modules/);
  assert.throws(() => m.selectRunModules(project, { deviceType: "tv" }), /No runnable module supports device type tv/);
  assert.throws(() => m.selectRunModules(project, { modules: ["watch"], deviceType: "phone" }), /cannot run on this phone device/);
  assert.deepEqual(m.selectRunModules(project, { modules: ["watch"], deviceType: "wearable" }).modules.map((x) => x.name), ["watch"]);
  const single = { ...project, modules: [mod("phone", "entry", ["phone"])] };
  assert.equal(m.selectRunModules(single, {}).reason, "only runnable module");
});

test("emulator CLI failures are detected from output (it exits 0)", () => {
  assert.equal(m.emulatorFailure("delete", "Device does not exist: x\n\nDevice delete fail.").code, "NOT_FOUND");
  assert.equal(m.emulatorFailure("delete", "[WARNING] Force delete enabled. Removing device folder:x\n\nDevice delete success."), undefined);
  assert.equal(m.emulatorFailure("stop", 'Stop emulator  "x"  failed, emulator is not exists.').code, "NOT_FOUND");
  assert.equal(m.emulatorFailure("stop", "Stop emulator x successfully"), undefined);
  assert.equal(m.emulatorFailure("create", "Device already exists. Please start it directly or use a different device name.\nDevice create fail.").code, "EMULATOR_FAILED");
  assert.equal(m.emulatorFailure("create", "The hotBoot parameter is not set, the default startup mode is cold boot.\n\nDevice create success. You can use the '-start' command to start it."), undefined);
  assert.equal(m.emulatorFailure("install_image", "The type or version entered is incorrect; download is not possible.").code, "EMULATOR_FAILED");
  assert.equal(m.emulatorFailure("install_image", "image is downloaded successfully."), undefined);
  assert.equal(m.emulatorFailure("remove_image", "No images are available in the local environment.").code, "NOT_FOUND");
});

test("signed profile summary is parsed from the p7b payload", () => {
  const payload = JSON.stringify({ "version-name": "2.0.0", type: "debug", "bundle-info": { "bundle-name": "com.a.b", "developer-id": "d1", "development-certificate": "-----BEGIN CERTIFICATE-----\n{x}\n-----END" }, "debug-info": { "device-ids": ["u1", "u2"] }, validity: { "not-before": 1, "not-after": 4102444800 }, acls: { "allowed-acls": ["ohos.permission.X"] } });
  const p7b = Buffer.concat([Buffer.from([0x30, 0x82, 0x10, 0x00]), Buffer.from(payload), Buffer.from([0xa0, 0x82, 0x7b, 0x7d])]);
  const s = m.profileSummary(p7b);
  assert.equal(s.bundle, "com.a.b");
  assert.equal(s.devices, 2);
  assert.equal(s.expired, false);
  assert.deepEqual(s.acl_permissions, ["ohos.permission.X"]);
  assert.equal(m.profileSummary(Buffer.from("not a profile")), undefined);
});

test("ArkTS checker: braces in comments/strings and HMS containers are not errors", async () => {
  const { createRequire } = await import("node:module");
  const chk = createRequire(import.meta.url)(path.join(root, "resources/vendor/arkts-check.cjs"));
  const dir = fs.mkdtempSync(path.join(out, "chk-"));
  const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
  const rules = (fn, f) => fn([f], dir).map((d) => d.rule);
  // A commented-out `Text() {` used to keep the scan "inside" the builder: every later method was flagged.
  const comment = write("A.ets", "@Component\nstruct A {\n  @Builder\n  item() {\n    Column() {\n      // Text() {\n      Text('a')\n    }\n  }\n  private later(): number {\n    const v: number = 1;\n    for (let i = 0; i < 2; i++) {}\n    return v;\n  }\n  build() { this.item() }\n}\n");
  assert.deepEqual(rules(chk.validateBuilderBodyStatements, comment), []);
  const strings = write("B.ets", "@Component\nstruct B {\n  @Builder\n  item() {\n    Text('{ open')\n    Text(`} close`)\n  }\n  private calc(): number {\n    const a: number = 1;\n    return a;\n  }\n  build() { this.item() }\n}\n");
  assert.deepEqual(rules(chk.validateBuilderBodyStatements, strings), []);
  // Real violations are still reported.
  const bad = write("C.ets", "@Component\nstruct C {\n  @Builder\n  item() {\n    let x: number = 1\n    Text('a')\n  }\n  build() { this.item() }\n}\n");
  assert.deepEqual(rules(chk.validateBuilderBodyStatements, bad), ["builder-body-ui-only"]);
  // @Entry root: an atomic component is an error; an unknown/custom component is not judged.
  const leaf = write("D.ets", "@Entry\n@Component\nstruct D {\n  build() {\n    Image('x')\n  }\n}\n");
  assert.deepEqual(rules(chk.validateEntryBuildRootNode, leaf), ["entry-build-root-node"]);
  const custom = write("E.ets", "@Entry\n@Component\nstruct E {\n  build() {\n    HdsNavigation(this.stack) {\n      Text('x')\n    }\n  }\n}\n");
  assert.deepEqual(rules(chk.validateEntryBuildRootNode, custom), []);
  const commented = write("F.ets", "@Entry\n@Component\nstruct F {\n  build() {\n    // Row() {\n    Column() {\n      Text('x')\n    }\n  }\n}\n");
  assert.deepEqual(rules(chk.validateEntryBuildRootNode, commented), []);
});

test("ArkTS checker: resources of nested modules, AppScope and local libs; comments/strings; directory names", async () => {
  const { createRequire } = await import("node:module");
  const chk = createRequire(import.meta.url)(path.join(root, "resources/vendor/arkts-check.cjs"));
  const proj = fs.mkdtempSync(path.join(out, "res-"));
  const put = (rel, text) => { const f = path.join(proj, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  put("build-profile.json5", JSON.stringify({ modules: [{ name: "entry", srcPath: "./entry" }, { name: "lib", srcPath: "./features/sub/lib" }] }));
  put("entry/src/main/resources/base/element/string.json", JSON.stringify({ string: [{ name: "entry_s", value: "x" }] }));
  put("features/sub/lib/src/main/resources/base/element/string.json", JSON.stringify({ string: [{ name: "nested_s", value: "x" }] }));
  put("AppScope/resources/base/element/color.json", JSON.stringify({ color: [{ name: "app_c", value: "#fff" }] }));
  put("libs/vendor/x/src/main/resources/base/element/string.json", JSON.stringify({ string: [{ name: "vendor_s", value: "x" }] }));
  const lib = put("features/sub/lib/src/main/ets/A.ets", "Text($r('app.string.nested_s'))\nText($r('app.color.app_c'))\nText($r('app.string.entry_s'))\n// Text($r('app.string.nope_c'))\nText(\"$r('app.string.nope_s')\")\nText($r('app.string.missing'))\n");
  const vendor = put("libs/vendor/x/src/main/ets/V.ets", "Text($r('app.string.vendor_s'))\n");
  const found = chk.validateAppResources([lib, vendor], proj).map((d) => `${path.basename(d.file)}:${d.line}`);
  assert.deepEqual(found, ["A.ets:6"], "only the really missing resource is reported");
  put("entry/src/main/resources/zz-bogus/element/x.json", "{}");
  put("entry/src/main/resources/zz_ZX/element/x.json", "{}");
  put("features/sub/lib/src/main/resources/dark/bad/x.txt", "");
  const dirs = chk.validateResourceDirNames(proj).map((d) => d.file.split(path.sep).slice(-2).join("/"));
  assert.deepEqual(dirs.sort(), ["dark/bad", "resources/zz-bogus"]);
});

test("cloud answers: labelled by text found in official docs, not by title; official first, duplicates once", async () => {
  const pushDoc = "Push Token标识了每台设备上每个应用，开发者调用getToken()接口向Push Kit服务端请求Token，获取到Token后，使用Push Token来推送消息。Token一般情况不会变化，仅下列场景Token会发生变化：清除应用数据后重新打开应用。";
  const navDoc = "Navigation组件是路由导航的根视图容器，一般作为页面的根容器使用，其内部默认包含了标题栏、内容区和工具栏。NavPathStack提供pushPath等路由跳转接口。";
  const docs = { "push/get-token": pushDoc, "arkui/navigation": navDoc };
  const lookup = async () => Object.entries(docs).map(([id, text]) => ({ id, text }));
  const sec = (n, title, body) => `[${n}]网页标题：${title}|||网页时间：|||网页分类：无|||网页内容：${body}\n`;
  const content = sec(1, "Push Kit 从入门到精通：全指南", "一、引言：我在项目里踩了很多坑，这篇文章记录我自己的实践经验和心得体会，".repeat(8))
    + sec(2, "HarmonyOS 在线和离线推送（API12+）", `问题解答：${pushDoc}`) // community-looking title, official text
    + sec(3, "推送服务-获取Push Token", pushDoc)
    + sec(4, "路由", navDoc)
    + sec(5, "获取和注销Token", "# 获取和注销Token\n public class TokenAbilitySlice extends AbilitySlice { private static final HiLogLabel LABEL = null; }")
    + sec(6, "短", "太短");
  const r = await m.labelCloudSources(content, lookup);
  assert.deepEqual(r.sources.map((s) => s.origin), ["community", "official", "official", "official", "official_other_platform", "unverified"]);
  assert.equal(r.sources[1].local_doc, "push/get-token");
  assert.equal(r.sources[3].local_doc, "arkui/navigation");
  assert.match(r.content, /\[1\]【社区文章\/community/);
  assert.match(r.content, /\[5\]【官方文档·非 ArkTS 平台/);
  const packed = m.packCloudSections(r.sections, 3000);
  assert.ok(packed.content.indexOf("[3]【官方") < packed.content.indexOf("[1]【社区"), "official sections come first");
  assert.equal(packed.shown.has(3), false, "a second section of the same official doc is not repeated");
  assert.ok(packed.content.length <= 3100);
  assert.match(m.AUTHORITY, /SDK declarations/);
});

test("device-compatibility: build warnings summarized, capability hints instead of 'missing dependency'", () => {
  const p = new m.BuildOutputParser("/proj");
  const lines = [
    "\u001b[33mWARN: \u001b[33mArkTS:WARN File: /proj/entry/src/main/ets/pages/Use.ets:4:38", " The system capacity of this api 'fileGuard' is not supported on all devices", "",
    "WARN: ArkTS:WARN File: /proj/entry/src/main/ets/pages/Use.ets:9:12", " The system capacity of this api 'fileGuard' is not supported on all devices", "",
    "WARN: ArkTS:WARN File: /proj/oh_modules/.ohpm/x/oh_modules/x/src/main/ets/A.ts:21:36", " The system capacity of this api 'createRandom' is not supported on all devices", "",
    "WARN: ArkTS:WARN File: /proj/entry/src/main/ets/pages/B.ets:3:3", " Some other warning", "",
  ];
  for (const l of lines) p.line(l);
  const r = p.finish();
  assert.equal(r.device_compat.project_warnings, 2);
  assert.equal(r.device_compat.dependency_warnings, 1);
  assert.deepEqual(r.device_compat.apis, [{ api: "fileGuard", count: 2, at: ["entry/src/main/ets/pages/Use.ets:4:38", "entry/src/main/ets/pages/Use.ets:9:12"] }]);
  const hints = m.buildFailureHints([{ code: "2307", message: "The default system capabilities of devices phone do not include SystemCapability.PCService.FileGuard. Configure the capabilities in syscap.json." }]);
  assert.equal(hints.length, 1);
  assert.match(hints[0], /Not a missing dependency: SystemCapability\.PCService\.FileGuard is not available/);
  assert.doesNotMatch(hints.join(), /oh-package|query="2307"/);
  assert.match(m.buildFailureHints([{ code: "28057", message: "The API is not supported on all devices. Use the canIUse condition to determine whether the API is supported." }])[0], /canIUse/);
  assert.match(m.buildFailureHints([{ message: "Cannot find module 'foo'" }])[0], /Missing dependency/);
});

test("build output: every ArkTS error block and the cause line of hvigor errors are kept", () => {
  const p = new m.BuildOutputParser("/proj");
  const lines = [
    "> hvigor ERROR: Failed :lib:default@HarCompileArkTS... ",
    "> hvigor ERROR: 00305015 Rollup Error",
    "Error Message: Unexpected token (Note that you need plugins to import files that are not JavaScript)",
    ". At file: /proj/lib/src/main/ets/A.ets:271",
    ...Array.from({ length: 150 }, (_, i) => [`${i + 1} ERROR: 10605040 ArkTS Compiler Error`, `Error Message: Object literals cannot be used as type declarations (arkts-no-obj-literals-as-types) At File: /proj/lib/src/main/ets/A.ets:${i + 1}:5`, "", ""]).flat(),
    "> hvigor ERROR: 00306003 Specification Limit Violation",
    "Error Message: Invalid project path. Current path does not match: /中文/路径",
    "> hvigor ERROR: BUILD FAILED in 1 s",
  ];
  for (const l of lines) p.line(l);
  const r = p.finish();
  assert.equal(r.counts.error, 152, "every error is counted");
  assert.equal(r.diagnostics.filter((d) => d.severity === "error" && d.file).length, 100, "100 compile errors listed");
  assert.equal(r.more_errors, 51, "150 compile + 1 rollup error with a file, 100 listed");
  assert.equal(r.diagnostics[0].code, "00306003", "build-level errors are never crowded out and come first");
  assert.deepEqual(r.failed_tasks, ["lib:default@HarCompileArkTS"]);
  const obj = r.diagnostics.find((d) => d.code === "10605040");
  assert.deepEqual([obj.file, obj.line, obj.column], ["lib/src/main/ets/A.ets", 1, 5]);
  assert.match(obj.message, /^Object literals cannot/);
  const rollup = r.diagnostics.find((d) => d.code === "00305015");
  assert.equal(rollup.file, "lib/src/main/ets/A.ets");
  assert.equal(rollup.line, 271);
  const path0 = r.diagnostics.find((d) => d.code === "00306003");
  assert.match(path0.message, /Specification Limit Violation: Invalid project path/, "the cause line is kept");
  assert.match(m.buildFailureHints([path0]).join(), /ASCII-only path/);
});

test("syscap verification: version-ranged tags and the 'default' (phone) alias are resolved like the SDK", () => {
  const hover = "@syscap SystemCapability.Security.CryptoFramework [since 9 - 11]\n@syscap SystemCapability.Security.CryptoFramework.Cipher [since 12]";
  assert.equal(m.applicableSyscap(hover, 11), "SystemCapability.Security.CryptoFramework");
  assert.equal(m.applicableSyscap(hover, 26), "SystemCapability.Security.CryptoFramework.Cipher");
  assert.equal(m.applicableSyscap("@syscap SystemCapability.Multimedia.Audio.Core [since 12]", 26), "SystemCapability.Multimedia.Audio.Core");
  assert.equal(m.applicableSyscap("@syscap SystemCapability.AI.Agent.AgentKit", 26), "SystemCapability.AI.Agent.AgentKit");
  assert.equal(m.applicableSyscap("no tags here", 26), undefined);
  // Fake SDK: 'default' must include phone's HMS capabilities (hvigor drops them), exact file names only.
  const sdk = fs.mkdtempSync(path.join(out, "sdk-"));
  const oh = path.join(sdk, "default/openharmony/ets/api/device-define"), hm = path.join(sdk, "default/hms/ets/api/device-define");
  fs.mkdirSync(oh, { recursive: true }); fs.mkdirSync(hm, { recursive: true });
  const put = (dir, name, caps) => fs.writeFileSync(path.join(dir, name), JSON.stringify({ SysCaps: caps }));
  put(oh, "default.json", ["SystemCapability.A"]);
  put(hm, "phone-hmos.json", ["SystemCapability.Health.WearEngine"]);
  put(oh, "wearable.json", ["SystemCapability.W"]);
  put(hm, "liteWearable-hmos.json", ["SystemCapability.Lite"]);
  const d = m.deviceCaps("default", sdk);
  assert.ok(d.has("SystemCapability.A") && d.has("SystemCapability.Health.WearEngine"));
  assert.deepEqual([...m.deviceCaps("wearable", sdk)], ["SystemCapability.W"], "liteWearable files are not wearable");
});
