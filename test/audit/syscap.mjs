// Device-compatibility claims, each with a controlled experiment on the real toolchain:
//  S1 hvigor '[since N]' defect: API whose @syscap is 'X [since N]', X in every declared device's set.
//  S2 hvigor 'default' alias defect: phone-only HMS capability, deviceTypes ["default"] vs ["phone"].
//  S3 canIUse guard: warning disappears only with an enclosing if(canIUse('<exact syscap>')).
//  S4 runtime: unguarded 2in1-only API on a phone emulator crashes.
//  S5 incremental build without changes reports no warnings.
//  S6 30 unresolved API modules: which resolve with which deviceTypes (all 30, not just 22).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { evidence, mcp, record, waitJob } from "./lib.mjs";

const EMU = "127.0.0.1:5555";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-syscap-"));
const c = await mcp();
const api = (await c.call("device", { action: "info", target: EMU })).data.api_level;
async function project(name, deviceTypes, files) {
  const root = path.join(work, name);
  await c.call("project", { action: "create", project: root, app_name: "S", bundle_name: `com.devecomcp.sc${name.replace(/\W/g, "").toLowerCase().slice(0, 20)}`, compatible_api: api });
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.deviceTypes = deviceTypes; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), text);
  return root;
}
async function buildWarnings(root) {
  const b = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
  const log = b.result?.log_artifact ?? b.error?.details?.log_artifact;
  const g = (await c.call("job", { action: "read", artifact_id: log, grep: "not supported on all devices", limit: 200 })).data;
  return { status: b.status, syscap_warnings: g.matched_lines ?? 0, device_compat: b.result?.device_compat ?? null, lines: g.content?.split("\n").slice(0, 4) };
}
const out = {};
const idx = "entry/src/main/ets/pages/Index.ets";
const withCall = (imp, call) => `${imp}\n\n@Entry\n@Component\nstruct Index {\n  @State message: string = 'Hello World';\n\n  build() {\n    Column() {\n      Text(this.message).onClick(() => {\n        ${call}\n      })\n    }\n  }\n}\n`;

// S1: audio.getAudioManager: @syscap SystemCapability.Multimedia.Audio.Core [since 12] (checked below from SDK)
const sdkAudio = fs.readFileSync("/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/api/@ohos.multimedia.audio.d.ts", "utf8");
const tagLine = /function getAudioManager\(\)[\s\S]{0,0}/.test(sdkAudio) ? sdkAudio.slice(0, sdkAudio.indexOf("function getAudioManager()")).split("/**").pop().match(/@syscap .*/)?.[0] : null;
for (const dt of [["phone"], ["phone", "tablet", "2in1"]]) {
  const r = await project(`s1_${dt.join("_")}`, dt, { [idx]: withCall("import { audio } from '@kit.AudioKit';", "const m: audio.AudioManager = audio.getAudioManager(); this.message = m ? 'a' : 'b';") });
  out[`S1 ${dt}`] = { sdk_tag: tagLine, ...(await buildWarnings(r)) };
}
// S2: WearEngine is in hms phone.json / phone-hmos.json but not the OpenHarmony default.json
for (const dt of [["default"], ["phone"]]) {
  const r = await project(`s2_${dt}`, dt, { [idx]: withCall("import { wearEngine } from '@kit.WearEngine';", "this.message = typeof wearEngine.getDeviceClient;") });
  out[`S2 ${dt}`] = await buildWarnings(r);
}
// S3: guard variants on a 2in1-only API in a phone+tablet+2in1 module
const fg = "import { fileGuard } from '@kit.EnterpriseDataGuardKit';";
const make = (body) => withCall(fg, body);
const variants = {
  none: "const g: fileGuard.FileGuard = new fileGuard.FileGuard(); this.message = g ? 'a' : 'b';",
  enclosing_if: "if (canIUse('SystemCapability.PCService.FileGuard')) { const g: fileGuard.FileGuard = new fileGuard.FileGuard(); this.message = g ? 'a' : 'b'; }",
  early_return: "if (!canIUse('SystemCapability.PCService.FileGuard')) { return; } const g: fileGuard.FileGuard = new fileGuard.FileGuard(); this.message = g ? 'a' : 'b';",
  wrong_syscap: "if (canIUse('SystemCapability.Web.Webview.Core')) { const g: fileGuard.FileGuard = new fileGuard.FileGuard(); this.message = g ? 'a' : 'b'; }",
};
for (const [k, body] of Object.entries(variants)) {
  const r = await project(`s3_${k}`, ["phone", "tablet", "2in1"], { [idx]: make(body) });
  out[`S3 ${k}`] = await buildWarnings(r);
  if (k === "none") {
    // S5: rebuild without changes
    out["S5 incremental"] = await buildWarnings(r);
    // S4: run on the phone emulator and tap
    const run = await waitJob(c, await c.call("run", { action: "build_run", project: r, target: EMU, wait: 60000 }));
    await c.call("ui", { action: "act", target: EMU, op: "click", selector: { text: "Hello World" } });
    await new Promise((res) => setTimeout(res, 2000));
    const bundle = JSON5.parse(fs.readFileSync(path.join(r, "AppScope/app.json5"), "utf8")).app.bundleName;
    const crash = await c.call("diagnose", { action: "crash", target: EMU, bundle, since_minutes: 3 });
    out["S4 runtime"] = { run: run.status, crash: crash.isError ? crash.data.error.code : { kind: crash.data.reports?.[0]?.kind, message: crash.data.reports?.[0]?.message?.slice(0, 200) } };
    await c.call("run", { action: "uninstall", project: r, target: EMU });
  }
}
await c.close();
const ev = evidence("syscap", "experiments.json", out);
console.log(JSON.stringify(out, null, 1));

const w = (k) => out[k]?.syscap_warnings;
record("C.syscap-hvigor-bugs.since-suffix", w("S1 phone") > 0 ? "VERIFIED" : "DEFECT",
  `audio.getAudioManager (${out["S1 phone"].sdk_tag}) on deviceTypes ["phone"]: hvigor emits ${w("S1 phone")} 'not supported on all devices' warning(s); on phone+tablet+2in1: ${w("S1 phone,tablet,2in1")}. Audio.Core is in every device set, so any warning here is the '[since]' defect`, [ev]);
record("C.syscap-hvigor-bugs.default-alias", w("S2 default") > 0 && w("S2 phone") === 0 ? "VERIFIED" : w("S2 default") === w("S2 phone") ? "DEFECT" : "UNVERIFIED",
  `wearEngine.getDeviceClient: deviceTypes ["default"] -> ${w("S2 default")} warning(s), ["phone"] -> ${w("S2 phone")}`, [ev]);
record("C.canIUse-enclosing-if", w("S3 enclosing_if") === 0 && w("S3 none") > 0 ? "VERIFIED" : "DEFECT",
  `FileGuard in phone+tablet+2in1 module: unguarded ${w("S3 none")}, enclosing if(canIUse(exact)) ${w("S3 enclosing_if")}, early-return guard ${w("S3 early_return")}, canIUse(other syscap) ${w("S3 wrong_syscap")} warning(s)`, [ev]);
record("C.unguarded-crash", out["S4 runtime"].crash?.kind ? "VERIFIED" : "UNVERIFIED",
  `phone emulator, tap calls new fileGuard.FileGuard() unguarded: ${JSON.stringify(out["S4 runtime"].crash)}`, [ev]);
record("C.incremental-no-warnings", w("S5 incremental") === 0 ? "VERIFIED" : "DEFECT", `unchanged rebuild: ${w("S5 incremental")} syscap warnings (first build ${w("S3 none")})`, [ev]);
fs.rmSync(work, { recursive: true, force: true });
