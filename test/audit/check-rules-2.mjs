// Second pass for rules whose first case did not match their trigger, plus device runs for rules that
// claim a runtime failure. Cases are written exactly in the shape each rule's source code matches.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record, waitJob } from "./lib.mjs";

const C = "/Applications/DevEco-Studio.app/Contents";
const EMU = "127.0.0.1:5555";
const cases = {
  "object-link-observed-type": `class P {\n  a: number = 0\n}\n\n@Component\nstruct Child {\n  @ObjectLink p: P\n\n  build() {\n    Text(\`\${this.p.a}\`)\n  }\n}\n\n@Entry\n@Component\nstruct Index {\n  @State p: P = new P()\n\n  build() {\n    Column() {\n      Child({ p: this.p })\n    }\n  }\n}\n`,
  "nav-destination-single-builder": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  @Builder\n  pageA(name: string) {\n    NavDestination() { Text('A') }\n  }\n\n  @Builder\n  pageB(name: string) {\n    NavDestination() { Text('B') }\n  }\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World').id('go').onClick(() => { this.stack.pushPath({ name: 'A' }) })\n    }\n    .navDestination(this.pageA)\n    .navDestination(this.pageB)\n  }\n}\n`,
  "hide-nav-bar-hides-content": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World')\n    }\n    .hideNavBar(true)\n  }\n}\n`,
  "nav-destination-root-node": `@Entry\n@Component\nstruct Index {\n  stack: NavPathStack = new NavPathStack()\n\n  @Builder\n  route(name: string) {\n    Column() { Text('ROUTED') }\n  }\n\n  build() {\n    Navigation(this.stack) {\n      Text('Hello World').id('go').onClick(() => { this.stack.pushPath({ name: 'A' }) })\n    }\n    .navDestination(this.route)\n  }\n}\n`,
  "appstorage-observedv2-mixing": `@ObservedV2\nclass M {\n  @Trace a: number = 0\n}\n\n@Entry\n@Component\nstruct Index {\n  aboutToAppear() {\n    AppStorage.setOrCreate('m', new M())\n  }\n\n  build() {\n    Text('Hello World')\n  }\n}\n`,
};
// what to look for on the device for each runtime claim
const deviceCheck = {
  "nav-destination-single-builder": async (c) => { await c.call("ui", { action: "act", target: EMU, op: "click", selector: { id: "go" } }); await new Promise((r) => setTimeout(r, 1500)); const a = (await c.call("ui", { action: "find", target: EMU, selector: { text: "A", exact: true } })).data.count; const b = (await c.call("ui", { action: "find", target: EMU, selector: { text: "B", exact: true } })).data.count; return { pushed_A_shows: a ? "A" : b ? "B" : "none" }; },
  "hide-nav-bar-hides-content": async (c) => ({ hello_visible: (await c.call("ui", { action: "find", target: EMU, selector: { text: "Hello World" } })).data.count > 0 }),
  "nav-destination-root-node": async (c) => { await c.call("ui", { action: "act", target: EMU, op: "click", selector: { id: "go" } }); await new Promise((r) => setTimeout(r, 1500)); return { routed_visible: (await c.call("ui", { action: "find", target: EMU, selector: { text: "ROUTED" } })).data.count > 0 }; },
  "appstorage-observedv2-mixing": async (c, launch) => ({ started: launch?.started, crashed: launch?.crashed ?? null, smoke: launch?.smoke }),
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rules2-"));
const c = await mcp();
const info = await c.call("device", { action: "info", target: EMU });
if (info.isError) { console.error("emulator not connected"); process.exit(2); }
const api = info.data.api_level;
const base = path.join(work, "base");
await c.call("project", { action: "create", project: base, app_name: "R", bundle_name: "com.devecomcp.rules2", compatible_api: api });
const results = [];
for (const [rule, src] of Object.entries(cases)) {
  const root = path.join(work, rule);
  fs.cpSync(base, root, { recursive: true });
  fs.writeFileSync(path.join(root, "entry/src/main/ets/pages/Index.ets"), src);
  let check;
  try { check = JSON.parse(execFileSync(`${C}/tools/node/bin/node`, [path.resolve("resources/vendor/arkts-check.cjs"), "--project", root], { env: { ...process.env, DEVECO_HOME: C }, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString()); }
  catch (e) { try { check = JSON.parse(e.stdout.toString()); } catch { check = { errors: [] }; } }
  const fired = (check.errors ?? []).filter((d) => d.rule === rule).map((d) => `${d.file}:${d.line} ${d.message.slice(0, 140)}`);
  const run = await waitJob(c, await c.call("run", { action: "build_run", project: root, target: EMU, wait: 60000 }));
  let device = null;
  if (run?.status === "succeeded" && deviceCheck[rule]) device = await deviceCheck[rule](c, run.result?.launch);
  else if (run?.status === "failed" && run.step === "launch" && rule === "appstorage-observedv2-mixing") device = { started: false, error: run.error?.message, details: run.error?.details };
  const buildFailed = run?.status === "failed" && ["build", "preflight"].includes(run.step);
  const buildErr = buildFailed ? (run.error?.details?.diagnostics ?? []).map((d) => d.message.slice(0, 160)).slice(0, 4) : [];
  results.push({ rule, fired, build: buildFailed ? "failed" : "ok", build_errors: buildErr, run: run?.status, step: run?.step, device });
  console.log(rule, "| fired", fired.length, "| build", buildFailed ? "FAILED" : "ok", "| device", JSON.stringify(device));
  await c.call("run", { action: "uninstall", project: root, target: EMU }).catch(() => {});
}
await c.close();
const ev = evidence("check-rules", "rules-pass2.json", results);
const judge = {
  // Accepted (docs/audit/AUDIT.md): hvigor builds @ObjectLink on a plain class and the upstream rule is dead code;
  // the expected outcome is "rule silent + build succeeds" (enabling the rule would be a false positive).
  "object-link-observed-type": (r) => (!r.fired.length && r.build !== "failed" ? ["VERIFIED", "accepted: checker silent and hvigor builds '@ObjectLink p: P' with a plain class (rule not wired in, by decision)"] : r.fired.length && r.build !== "failed" ? ["DEFECT", "rule now fires but hvigor builds the code (false positive)"] : ["DEFECT", `hvigor now rejects the case (build ${r.build}): the decision to keep the rule off must be revisited`]),
  "nav-destination-single-builder": (r) => (!r.fired.length ? ["DEFECT", "did not fire on two chained .navDestination calls"] : r.device?.pushed_A_shows === "B" ? ["VERIFIED", "fires; on device pushPath('A') opens B (last builder wins), as the rule states"] : ["DEFECT", `fires but device shows ${r.device?.pushed_A_shows} for route A — the rule's runtime claim is wrong`]),
  "hide-nav-bar-hides-content": (r) => (!r.fired.length ? ["DEFECT", "did not fire"] : r.device?.hello_visible === false ? ["VERIFIED", "fires; on device the content under Navigation is hidden"] : ["DEFECT", `fires but the content is visible on device (hello_visible=${r.device?.hello_visible}) — false positive`]),
  "nav-destination-root-node": (r) => (!r.fired.length ? ["DEFECT", "did not fire"] : r.device?.routed_visible === false ? ["VERIFIED", "fires; on device the routed page without NavDestination shows nothing"] : ["DEFECT", `fires but the routed content is visible on device (routed_visible=${r.device?.routed_visible}) — false positive`]),
  "appstorage-observedv2-mixing": (r) => (!r.fired.length ? ["DEFECT", "did not fire"] : r.device && (r.device.started === false || r.device.crashed) ? ["VERIFIED", `fires; app crashes/does not start on device (${JSON.stringify(r.device).slice(0, 160)})`] : ["DEFECT", `fires but the app starts normally on device (${JSON.stringify(r.device)}) — false positive`]),
};
for (const r of results) {
  if (r.rule !== "object-link-observed-type" && r.fired.length && !r.device) { record(`B.code.check.rule.${r.rule}`, "UNVERIFIED", `no device observation (run ${r.run} at ${r.step ?? "-"}) — cannot judge the runtime claim`, [ev]); continue; }
  const [v, s] = judge[r.rule](r); record(`B.code.check.rule.${r.rule}`, v, `${s} [pass 2, device ${EMU}]`, [ev]); }
fs.rmSync(work, { recursive: true, force: true });
