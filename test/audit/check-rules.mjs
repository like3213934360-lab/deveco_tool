// Per-rule ground truth: for every custom arkts-check rule, a minimal project that violates it.
// Each case is checked by the checker AND compiled by hvigor (assembleHap). A rule is:
//   agrees      checker error  <=> hvigor error (same cause)
//   false-pos   checker error, hvigor builds (or fails for an unrelated reason)
//   missed      no checker error, hvigor error
// Runtime-only rules (the checker claims a crash/white screen, hvigor compiles) are marked "runtime"
// and must be proven on a device separately (not counted as agreement).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { evidence, mcp, record, waitJob } from "./lib.mjs";

const C = "/Applications/DevEco-Studio.app/Contents";
const page = (body, head = "") => `${head}@Entry\n@Component\nstruct Index {\n${body}\n}\n`;
const V2 = (body, head = "") => `${head}@Entry\n@ComponentV2\nstruct Index {\n${body}\n}\n`;
/** name -> { files: {relPath: content}, edit?: (root)=>void, runtime?: true } */
const cases = {
  "resource-name-check": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Column() { Text($r('sys.color.no_such_sys_color_xyz')) }\n  }") } },
  "app-resource-name-check": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Column() { Text($r('app.string.no_such_string_xyz')) }\n  }") } },
  "page-file-exists": { edit: (r) => addPage(r, "pages/Missing") },
  "page-entry-count": { edit: (r) => { addPage(r, "pages/NoEntry"); fs.writeFileSync(path.join(r, "entry/src/main/ets/pages/NoEntry.ets"), "@Component\nexport struct NoEntry {\n  build() { Text('x') }\n}\n"); } },
  "route-map-invalid-json": { edit: (r) => routeMap(r, "{ this is not json") },
  "route-map-unknown-key": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", pageSourceFile: "src/main/ets/pages/Index.ets", buildFunction: "b", bogus: 1 }] })) },
  "route-map-missing-key": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", buildFunction: "b" }] })) },
  "route-map-build-function-missing": { edit: (r) => routeMap(r, JSON.stringify({ routerMap: [{ name: "a", pageSourceFile: "src/main/ets/pages/Index.ets", buildFunction: "noSuchBuilder" }] })) },
  "resource-dir-name": { edit: (r) => fs.mkdirSync(path.join(r, "entry/src/main/resources/zz-bogus-qualifier/element"), { recursive: true }) },
  "component-decorator-version-mismatch": { files: { "entry/src/main/ets/pages/Index.ets": V2("  @State n: number = 0\n  build() { Text(`${this.n}`) }") } },
  "observed-v2-state-property-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  @State m: M = new M()\n  build() { Text(`${this.m.a}`) }", "@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n") } },
  "regular-property-init": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Child({ v: 1 }) } }", "@ComponentV2\nstruct Child {\n  v: number = 0\n  build() { Text(`${this.v}`) }\n}\n") } },
  "struct-name-builtin-collision": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Button() } }", "@Component\nstruct Button {\n  build() { Text('x') }\n}\n") } },
  "entry-build-root-node": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() {\n    Image($r('app.media.startIcon'))\n  }") } },
  "builder-body-ui-only": { files: { "entry/src/main/ets/pages/Index.ets": page("  @Builder\n  item() {\n    let x: number = 1\n    Text(`${x}`)\n  }\n  build() { Column() { this.item() } }") } },
  "nav-destination-root-node": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  route(name: string) {\n    if (name === 'a') {\n      Column() { Text('a') }\n    }\n  }\n  build() { Navigation(this.stack) { Text('home') }.navDestination(this.route) }") } },
  "nav-destination-single-builder": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  @Builder\n  r1(name: string) { NavDestination() { Text('1') } }\n  @Builder\n  r2(name: string) { NavDestination() { Text('2') } }\n  build() { Column() { Navigation(this.stack) { Text('a') }.navDestination(this.r1)\n Navigation(this.stack) { Text('b') }.navDestination(this.r2) } }") } },
  "hide-nav-bar-hides-content": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  stack: NavPathStack = new NavPathStack()\n  build() { Navigation(this.stack) { Text('home') }.hideNavBar(true) }") } },
  "appstorage-observedv2-mixing": { runtime: true, files: { "entry/src/main/ets/pages/Index.ets": page("  aboutToAppear() { AppStorage.setOrCreate('m', new M()) }\n  build() { Text('x') }", "@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n") } },
  "v1-decorator-function-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  build() { Column() { Child({ cb: () => {} }) } }", "@Component\nstruct Child {\n  @Prop cb: () => void = () => {}\n  build() { Text('x') }\n}\n") } },
  "param-requires-require": { files: { "entry/src/main/ets/pages/Index.ets": V2("  build() { Column() { Child({ v: 1 }) } }").replace("@Entry", "@ComponentV2\nstruct Child {\n  @Param v: number\n  build() { Text(`${this.v}`) }\n}\n@Entry") } },
  "object-link-observed-type": { files: { "entry/src/main/ets/pages/Index.ets": page("  @State p: P = new P()\n  build() { Column() { Child({ p: this.p }) } }", "class P {\n  a: number = 0\n}\n@Component\nstruct Child {\n  @ObjectLink p: P\n  build() { Text(`${this.p.a}`) }\n}\n") } },
  "model-version-consistency": { edit: (r) => { const f = path.join(r, "hvigor/hvigor-config.json5"); const j = JSON5.parse(fs.readFileSync(f, "utf8")); j.modelVersion = "5.0.0"; fs.writeFileSync(f, JSON.stringify(j, null, 2)); } },
  "permission-reason-required": { edit: (r) => perm(r, { name: "ohos.permission.CAMERA", usedScene: { abilities: ["EntryAbility"], when: "inuse" } }) },
  "permission-reason-resource": { edit: (r) => perm(r, { name: "ohos.permission.CAMERA", reason: "$string:no_such_reason_key", usedScene: { abilities: ["EntryAbility"], when: "inuse" } }) },
  "permission-name-exists": { edit: (r) => perm(r, { name: "ohos.permission.NO_SUCH_PERMISSION_XYZ" }) },
};

function addPage(root, p) {
  const f = path.join(root, "entry/src/main/resources/base/profile/main_pages.json");
  const j = JSON.parse(fs.readFileSync(f, "utf8")); j.src.push(p); fs.writeFileSync(f, JSON.stringify(j, null, 2));
}
function routeMap(root, text) {
  fs.writeFileSync(path.join(root, "entry/src/main/resources/base/profile/route_map.json"), text);
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.routerMap = "$profile:route_map"; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
}
function perm(root, p) {
  const mf = path.join(root, "entry/src/main/module.json5");
  const j = JSON5.parse(fs.readFileSync(mf, "utf8")); j.module.requestPermissions = [p]; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rules-"));
const c = await mcp();
const base = path.join(work, "base");
await c.call("project", { action: "create", project: base, app_name: "R", bundle_name: "com.devecomcp.rules" });
await waitJob(c, await c.call("project", { action: "build", project: base, preflight: false, wait: 60000 })); // warm + oh_modules
const results = [];
for (const [rule, spec] of Object.entries(cases)) {
  const root = path.join(work, rule);
  fs.cpSync(base, root, { recursive: true, filter: (p) => !/[\\/]build$|[\\/]\.hvigor$/.test(p) });
  for (const [rel, text] of Object.entries(spec.files ?? {})) fs.writeFileSync(path.join(root, rel), text);
  spec.edit?.(root);
  let check;
  try { check = JSON.parse(execFileSync(`${C}/tools/node/bin/node`, [path.resolve("resources/vendor/arkts-check.cjs"), "--project", root], { env: { ...process.env, DEVECO_HOME: C }, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString()); }
  catch (e) { try { check = JSON.parse(e.stdout.toString()); } catch { check = { errors: [], error: "checker crashed" }; } }
  const ck = (check.errors ?? []).filter((d) => d.severity === "error");
  const ckRule = ck.filter((d) => d.rule === rule || (rule === "regular-property-init" && /property-init/.test(d.rule ?? "")));
  const b = await waitJob(c, await c.call("project", { action: "build", project: root, preflight: false, wait: 60000 }));
  const log = b?.error?.details?.log_artifact ?? b?.result?.log_artifact;
  const hvText = log ? (await c.call("job", { action: "read", artifact_id: log, grep: "ERROR|Error Message|Cause", limit: 40 })).data.content.replace(/\x1b\[[0-9;]*m/g, "") : "";
  const hvErr = b?.status !== "succeeded";
  const verdict = ckRule.length && hvErr ? "agrees" : ckRule.length && !hvErr ? (spec.runtime ? "runtime" : "false-pos") : !ckRule.length && hvErr ? "missed" : "no-signal";
  results.push({ rule, verdict, checker: ckRule.map((d) => `${d.file}:${d.line} ${d.message.slice(0, 160)}`), checker_other: ck.filter((d) => !ckRule.includes(d)).map((d) => `${d.rule ?? "tsc"}: ${d.message.slice(0, 120)}`).slice(0, 4), hvigor: b?.status, hvigor_errors: hvText.split("\n").filter((l) => /ERROR|Error Message/.test(l)).slice(0, 6).map((l) => l.slice(0, 220)) });
  console.log(verdict.padEnd(10), rule, "| hvigor", b?.status);
}
await c.close();
const ev = evidence("check-rules", "rules-vs-hvigor.json", results);
for (const r of results) {
  const v = r.verdict === "agrees" ? "VERIFIED" : r.verdict === "runtime" ? "UNVERIFIED" : "DEFECT";
  record(`B.code.check.rule.${r.rule}`, v, r.verdict === "agrees" ? "violation case: checker and hvigor both reject"
    : r.verdict === "runtime" ? "checker reports an error for code hvigor compiles; rule claims a runtime failure (white screen/crash) — needs a device run to confirm"
    : r.verdict === "false-pos" ? `checker errors but hvigor builds this code: ${r.checker[0] ?? ""}`
    : r.verdict === "missed" ? `hvigor rejects the case but the rule did not fire: ${r.hvigor_errors.join(" | ").slice(0, 300)}`
    : "rule did not fire and hvigor built: test case does not exercise the rule", [ev]);
}
fs.rmSync(work, { recursive: true, force: true });
