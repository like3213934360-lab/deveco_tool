// Review 1.3 (A): incremental preflight correctness, auto quick-fix decisions, crash parsing edge cases.
// Uses a throw-away copy of a small project for preflight; MyStarRing on the Mate 80 for deploy paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { evidence, mcp, record, repo, PROJECTS } from "./lib.mjs";

const ev = (n, d) => evidence("review-1.3", n, d);
const only = process.env.ONLY ? process.env.ONLY.split(",") : undefined;
const want = (s) => !only || only.includes(s);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rb-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const entry = path.join(tmp, "e.ts");
fs.writeFileSync(entry, [
  `export { snapshotSources, diffSources, changedSources, rememberSources } from ${JSON.stringify(path.join(repo, "src/domains/preflight.ts"))};`,
  `export { parseCrash, matchPatterns } from ${JSON.stringify(path.join(repo, "src/domains/diagnose.ts"))};`,
  `export { locate } from ${JSON.stringify(path.join(repo, "src/domains/sourcemap.ts"))};`,
].join("\n"));
await build({ entryPoints: [entry], outfile: path.join(tmp, "e.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(repo, "node_modules")] });
fs.symlinkSync(path.join(repo, "node_modules"), path.join(tmp, "node_modules"), "junction");
process.env.DEVECO_STATE_DIR = path.join(tmp, "state");
const m = await import(pathToFileURL(path.join(tmp, "e.mjs")).href);

/* ---------------- preflight: incremental vs full on real errors ---------------- */
if (want("preflight")) {
  const c = await mcp();
  const proj = path.join(tmp, "Pre");
  const created = await c.call("project", { action: "create", project: proj, app_name: "Pre", bundle_name: "com.devecomcp.pre" });
  const idx = path.join(proj, "entry/src/main/ets/pages/Index.ets");
  const helper = path.join(proj, "entry/src/main/ets/pages/Helper.ets");
  fs.writeFileSync(helper, "export function twice(n: number): number {\n  return n * 2;\n}\n");
  const pre = async () => (await import("node:fs")).existsSync(proj) ? await m.changedSources(proj) : undefined;
  const check = async (files) => (await c.call("code", { action: "check", project: proj, ...(files ? { files } : {}) })).data;
  const runs = [];
  // first: whole project
  let s = await pre(); runs.push({ step: "first", files: s.files });
  let r = await check(s.files); await m.rememberSources(proj, s.snapshot, r.issues.filter((i) => i.severity === "error").map((i) => i.file));
  // introduce an error in Helper -> only Helper checked, error found
  fs.writeFileSync(helper, "export function twice(n: number): number {\n  let x: any = n;\n  return x * 2;\n}\n");
  s = await pre(); runs.push({ step: "error introduced", files: s.files });
  r = await check(s.files);
  const errs1 = r.errors;
  await m.rememberSources(proj, s.snapshot, r.issues.filter((i) => i.severity === "error").map((i) => i.file));
  // unrelated edit elsewhere: failing Helper must still be re-checked
  fs.writeFileSync(idx, fs.readFileSync(idx, "utf8") + "\n// touch\n");
  s = await pre(); runs.push({ step: "unrelated edit", files: s.files });
  r = await check(s.files);
  const errs2 = r.errors;
  await m.rememberSources(proj, s.snapshot, r.issues.filter((i) => i.severity === "error").map((i) => i.file));
  // the whole project check for comparison
  const full = await check(undefined);
  // fix the error -> Helper checked once, then clean
  fs.writeFileSync(helper, "export function twice(n: number): number {\n  return n * 2;\n}\n");
  s = await pre(); runs.push({ step: "fixed", files: s.files });
  r = await check(s.files); await m.rememberSources(proj, s.snapshot, []);
  s = await pre(); runs.push({ step: "steady", files: s.files });
  // a dependent file: Index imports Helper; changing Helper's signature breaks Index but only Helper is "changed"
  fs.writeFileSync(idx, "import { twice } from './Helper';\n" + fs.readFileSync(idx, "utf8") + "\nexport function useTwice(): number {\n  return twice(2);\n}\n");
  s = await pre(); r = await check(s.files); await m.rememberSources(proj, s.snapshot, []);
  fs.writeFileSync(helper, "export function twice(n: string): string {\n  return n + n;\n}\n");
  s = await pre(); runs.push({ step: "signature change in dependency", files: s.files });
  const inc = await check(s.files);
  const whole = await check(undefined);
  await c.close();
  const data = { runs, errs1, errs2, full_errors: full.errors, dependent: { incremental_errors: inc.errors, whole_errors: whole.errors, whole_issues: whole.issues?.slice(0, 3) } };
  ev("preflight.json", data);
  record("F.preflight.recheck-failing", errs1 > 0 && errs2 > 0 && runs[2].files?.includes("entry/src/main/ets/pages/Helper.ets") ? "VERIFIED" : "DEFECT",
    `error introduced -> checked ${JSON.stringify(runs[1].files)} (${errs1} errors); after an unrelated edit the failing file is re-checked: ${JSON.stringify(runs[2].files)} (${errs2} errors); steady state checks ${JSON.stringify(runs[4].files)}`, ["docs/audit/evidence/review-1.3/preflight.json"]);
  record("F.preflight.dependents", inc.errors >= whole.errors ? "VERIFIED" : "DEFECT",
    `changing an exported signature in Helper.ets breaks its importer Index.ets: incremental preflight checked ${JSON.stringify(runs[5].files)} -> ${inc.errors} errors; whole-project check -> ${whole.errors} errors. ${inc.errors < whole.errors ? "Importers of a changed file are not re-checked, so the advisory preflight misses errors the full check finds (hvigor still catches them at build time)" : ""}`,
    ["docs/audit/evidence/review-1.3/preflight.json"], inc.errors < whole.errors ? { severity: "low", dimension: "reliability" } : {});
}

/* ---------------- crash parsing: cppcrash / appfreeze ---------------- */
if (want("crash")) {
  const cpp = [
    "Generated by HiviewDFX@OpenHarmony", "================================================================",
    "Device info:HUAWEI Mate 80", "Module name:com.dream.toollist", "Process name:com.dream.toollist",
    "Reason:Signal:SIGSEGV(SEGV_MAPERR)@0x0000000000000000  probably caused by NULL pointer dereference",
    "Fault thread info:", "Tid:12345, Name:com.dream.tool",
    "#00 pc 00000000000a1b2c /data/storage/el1/bundle/libs/arm64/libentry.so(Napi_Process+44)(abc123)",
    "#01 pc 0000000000012345 /system/lib64/platformsdk/libace_napi.z.so(ArkNativeFunction+120)",
    "Tid:12346, Name:OS_IPC", "#00 pc 0000000000099999 /system/lib64/libc.so",
  ].join("\n");
  const pc = m.parseCrash(cpp, "cppcrash-com.dream.toollist-20020075-20261002112233000.log");
  const freeze = [
    "Generated by HiviewDFX@OpenHarmony", "Module name:com.dream.toollist", "Reason:THREAD_BLOCK_6S",
    "Fault time:2026/10/02-11:22:33", "MSG = Fault time:2026/10/02-11:22:33 App main thread is not response!",
    "Tid:12345, Name:com.dream.tool", "#00 pc 00000000000e1c2c /system/lib/ld-musl-aarch64.so.1(__timedwait_cp+188)",
    "#01 at onClick (phone|phone|1.0.0|src/main/ets/pages/Index.ts:80:5)",
  ].join("\n");
  const pf = m.parseCrash(freeze, "appfreeze-com.dream.toollist-20020075-20261002112233.log");
  ev("crash-parse.json", { cpp: pc, freeze: pf });
  record("F.crash.cppcrash-parse", pc.type === "cppcrash" && pc.kind === "SIGSEGV" && pc.bundle === "com.dream.toollist" && pc.frames.length === 2 && pc.app_frames.length >= 1 ? "VERIFIED" : "DEFECT",
    `cppcrash sample: type=${pc.type} kind=${pc.kind} bundle=${pc.bundle} frames=${pc.frames.length} (only the faulting thread) app_frames=${JSON.stringify(pc.app_frames)}`, ["docs/audit/evidence/review-1.3/crash-parse.json"]);
  record("F.crash.appfreeze-parse", pf.type === "appfreeze" && pf.kind === "THREAD_BLOCK_6S" && pf.app_frames.length >= 1 ? "VERIFIED" : "DEFECT",
    `appfreeze sample: type=${pf.type} kind=${pf.kind} app_frames=${JSON.stringify(pf.app_frames)}`, ["docs/audit/evidence/review-1.3/crash-parse.json"]);
  // HAR frame -> source (MyStarRing tools HAR) through the build's source maps, when present.
  const P = PROJECTS.mystarring;
  const proj = { root: P, modules: fs.readdirSync(path.join(P, "features")).map((n) => ({ name: n, root: path.join(P, "features", n) })).concat([{ name: "phone", root: path.join(P, "products/phone") }]) };
  const maps = JSON.parse(fs.readFileSync(path.join(P, "products/phone/build/default/intermediates/loader_out/default/ets/sourceMaps.map"), "utf8"));
  // Keys are "<entry>|<module>|<version>|<path>" (verified: HAR files appear as phone|tools|1.0.0|...).
  const harKey = Object.keys(maps).find((k) => k.split("|")[1] === "tools" && /VideoEditorViewModel/.test(k));
  const har = harKey ? m.locate(`at f (${harKey}:40:5)`, proj) : [];
  ev("crash-har.json", { harKey, har });
  record("F.crash.har-source", har[0]?.file?.startsWith("features/tools/") ? "VERIFIED" : "DEFECT",
    `HAR frame ${harKey}:40:5 -> ${har[0] ? `${har[0].file}:${har[0].line} (mapped_from ${har[0].mapped_from})` : "not located"}`, ["docs/audit/evidence/review-1.3/crash-har.json"]);
}
