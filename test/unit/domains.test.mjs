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
const entry = path.join(out, "entry.ts");
fs.writeFileSync(entry, [
  `export { parseWindows, pngGray, blankScore } from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};`,
  `export { checklist } from ${JSON.stringify(path.join(root, "src/domains/uitest.ts"))};`,
  `export { mergeCodexToml, mergeJsonConfig } from ${JSON.stringify(path.join(root, "src/domains/hostconfig.ts"))};`,
  `export { projectAclPermissions } from ${JSON.stringify(path.join(root, "src/domains/sign.ts"))};`,
  `export { siteAllowed, regionBase } from ${JSON.stringify(path.join(root, "src/domains/auth.ts"))};`,
  `export { apiOf, compatibility } from ${JSON.stringify(path.join(root, "src/domains/doctor.ts"))};`,
  `export { faultTime } from ${JSON.stringify(path.join(root, "src/domains/diagnose.ts"))};`,
  `export { chordCodes, treeSignature, subtree, deviceText } from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};`,
  `export { createArgs, agreementsAccepted } from ${JSON.stringify(path.join(root, "src/domains/emulator.ts"))};`,
  `export { parseDuration } from ${JSON.stringify(path.join(root, "src/domains/device.ts"))};`,
  `export { findProjectRoot, selectRunModules } from ${JSON.stringify(path.join(root, "src/domains/project.ts"))};`,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-acl-"));
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-find-"));
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
