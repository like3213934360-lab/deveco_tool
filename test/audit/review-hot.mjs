// Review 1.3 (A): auto quick-fix decision table on a real phone (MyStarRing, Mate 80).
// Every case edits the project temporarily and restores it in finally; then a full deploy restores the device.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966";
const P = process.env.AUDIT_PROJECT ?? PROJECTS.mystarring;
const ENTRY = path.join(P, "products/phone/src/main/ets/pages/Index.ets");
const HAR = path.join(P, "features/tools/src/main/ets/viewmodels/media/VideoEditorViewModel.ets");
const RES = path.join(P, "products/phone/src/main/resources/base/element/string.json");
const MODULE = path.join(P, "products/phone/src/main/module.json5");
const NEWFILE = path.join(P, "products/phone/src/main/ets/pages/ReviewProbe.ets");
const c = await mcp({ shared: true });
const H = "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc";
const deploy = async (extra = {}) => {
  const t = Date.now();
  let d = (await c.call("run", { action: "build_run", project: P, target: T, wait: 55000, ...extra })).data;
  while (d.status === "running") d = (await c.call("job", { action: "wait", job_id: d.job_id, wait: 55000 })).data;
  return { ms: Date.now() - t, status: d.status, path: d.result?.path, fallback: d.result?.fallback_reason, error: d.error?.code, hot: d.result?.hot_reload?.files };
};
const originals = new Map([ENTRY, HAR, RES, MODULE].map((f) => [f, fs.readFileSync(f, "utf8")]));
const restore = () => { for (const [f, s] of originals) fs.writeFileSync(f, s); fs.rmSync(NEWFILE, { force: true }); };
const edit = (f, fn) => fs.writeFileSync(f, fn(originals.get(f)));
const entryEdit = (s) => s.replace("return '工具';", "return '工具R';");
const cases = [];
const only = process.env.ONLY ? process.env.ONLY.split(",") : undefined;
const caseRun = async (name, expect, prepare, extra) => {
  if (only && !only.some((o) => name.includes(o))) return;
  restore();
  await deploy(); // re-baseline
  prepare();
  const r = await deploy(extra);
  const ok = expect(r);
  cases.push({ name, ok, ...r });
  restore();
};
try {
  await deploy({ run_mode: "full" });
  await deploy(); // ensure baseline exists
  await caseRun("entry code edit", (r) => r.path === "hot_reload", () => edit(ENTRY, entryEdit));
  await caseRun("HAR code edit", (r) => r.path === "full" && /outside module/.test(r.fallback ?? ""), () => edit(HAR, (s) => s + "\n// review\n"));
  await caseRun("resource edit", (r) => r.path === "full" && /resources/.test(r.fallback ?? ""), () => edit(RES, (s) => s.replace(/\n?$/, "\n ")));
  await caseRun("module.json5 edit", (r) => r.path === "full" && /manifests|resources/.test(r.fallback ?? ""), () => edit(MODULE, (s) => s + "\n"));
  await caseRun("new file", (r) => r.path === "full" && /added/.test(r.fallback ?? ""), () => fs.writeFileSync(NEWFILE, "export const reviewProbe: number = 1;\n"));
  await caseRun("app not running", (r) => r.path === "full" && /not running/.test(r.fallback ?? ""), () => { edit(ENTRY, entryEdit); require_("force-stop"); });
  await caseRun("reinstalled by someone else", (r) => r.path === "full" && /reinstalled/.test(r.fallback ?? ""), () => { edit(ENTRY, entryEdit); require_("reinstall"); });
  await caseRun("release mode", (r) => r.path === undefined || r.path === "full", () => edit(ENTRY, entryEdit), { mode: "release" });
  await caseRun("run_mode=full", (r) => r.path === undefined, () => edit(ENTRY, entryEdit), { run_mode: "full" });
  await caseRun("compile error in entry", (r) => r.status === "failed" && r.error === "BUILD_FAILED", () => edit(ENTRY, (s) => s.replace("return '工具';", "return 工具未定义变量;")));
  if (!only || only.includes("three")) {
  // consecutive patches accumulate correctly: three edits in a row, the last text must be on screen
  restore(); await deploy();
  const seq = [];
  for (const v of ["A", "B", "C"]) { edit(ENTRY, (s) => s.replace("return '工具';", `return '工具${v}';`)); seq.push(await deploy()); }
  const shown = (await c.call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "我的", exact: true, clickable: true } }, { op: "click", selector: { text: "工具", clickable: true, index: 0 } }], assert: { visible: { text: "工具C", exact: true }, timeout_ms: 5000 } })).data;
  cases.push({ name: "three consecutive patches", ok: seq.every((r) => r.path === "hot_reload") && shown.passed, paths: seq.map((r) => r.path), ms: seq.map((r) => r.ms), shown: shown.passed });
  }
} finally {
  restore();
  const final = await deploy({ run_mode: "full" });
  cases.push({ name: "final restore deploy", ok: final.status === "succeeded", ...final });
  await c.close();
}
function require_(what) {
  if (what === "force-stop") execFileSync(H, ["-t", T, "shell", "aa", "force-stop", "com.dream.toollist"]);
  if (what === "reinstall") {
    const hap = path.join(P, "products/phone/build/default/outputs/default/phone-default-signed.hap");
    execFileSync(H, ["-t", T, "install", "-r", hap]);
  }
}
const evp = evidence("review-1.3", "hot-decisions.json", cases);
for (const k of cases) record(`F.hot.${k.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, k.ok ? "VERIFIED" : "DEFECT", `${k.name}: ${k.status ?? ""} path=${k.path ?? k.paths} fallback=${k.fallback ?? "-"} ${k.error ? `error=${k.error}` : ""} ${Array.isArray(k.ms) ? k.ms.join("/") : k.ms} ms`, [evp]);
