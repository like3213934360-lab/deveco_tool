// Acceptance of the 1.3.0 efficiency features on a real phone with a real project (evidence audit).
// Each check records a verdict with raw evidence under docs/audit/evidence/efficiency/.
//
//   AUDIT_TARGET=<hdc serial> AUDIT_PROJECT=<project root> node test/audit/efficiency.mjs
//
// Requirements: the project builds and installs on the device (debug signing that includes it), and
// AUDIT_ENTRY_FILE (an .ets file of the entry module, path relative to the project) contains
// AUDIT_ENTRY_TEXT, a string literal shown on screen after tapping AUDIT_TAB.
// The script only edits that file temporarily (restored in finally) and leaves no flows, baselines
// or temp files behind.
import fs from "node:fs";
import path from "node:path";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966";
const P = process.env.AUDIT_PROJECT ?? PROJECTS.mystarring;
const ENTRY_FILE = path.join(P, process.env.AUDIT_ENTRY_FILE ?? "products/phone/src/main/ets/pages/Index.ets");
const ENTRY_TEXT = process.env.AUDIT_ENTRY_TEXT ?? "return '工具';";
const TAB = process.env.AUDIT_TAB ?? "工具";
const PATH = [{ op: "click", selector: { text: TAB, exact: true, clickable: true } }, { op: "click", selector: { text: process.env.AUDIT_PAGE ?? "视频转 GIF", exact: true } }];
const GOAL = { visible: { text: process.env.AUDIT_PAGE ?? "视频转 GIF", exact: true } };
const FLOW = "audit-efficiency";

const c = await mcp({ shared: true });
const calls = [];
const call = async (tool, args) => {
  const t = Date.now();
  const r = await c.call(tool, args);
  calls.push({ tool, action: args.action, ms: Date.now() - t });
  return r;
};
const job = async (tool, args) => {
  let d = (await call(tool, { ...args, wait: 55000 })).data;
  while (d.status === "running") d = (await call("job", { action: "wait", job_id: d.job_id, wait: 55000 })).data;
  return d;
};
const original = fs.readFileSync(ENTRY_FILE, "utf8");
const out = {};
try {
  // 1. Batch act: the whole path in one call, verified by assert.
  await call("run", { action: "launch", project: P, target: T });
  let t = Date.now();
  const batch = (await call("ui", { action: "act", target: T, steps: PATH, assert: GOAL })).data;
  out.batch = { ms: Date.now() - t, passed: batch.passed, steps: batch.steps, after: batch.after };
  record("E.batch-act", batch.passed ? "VERIFIED" : "DEFECT", `ui act steps (${PATH.length} taps + assert) in one call: ${batch.passed}, ${out.batch.ms} ms`, [evidence("efficiency", "batch.json", out.batch)]);

  // 2. Every act returns the screen diff (no observe needed).
  const single = (await call("ui", { action: "act", target: T, op: "key", key: "back" })).data;
  out.diff = single.after;
  record("E.act-diff", single.after?.changed && single.after.added.length + single.after.removed.length > 0 ? "VERIFIED" : "DEFECT",
    `act key=back -> after.kind=${single.after?.kind}, +${single.after?.added.length} -${single.after?.removed.length}`, [evidence("efficiency", "diff.json", single)]);

  // 3. save_flow + then_flow: deploy lands on the page.
  await call("run", { action: "launch", project: P, target: T });
  const saved = (await call("ui", { action: "act", target: T, steps: PATH, assert: GOAL, save_flow: { project: P, id: FLOW } })).data;
  const deployed = await job("run", { action: "build_run", project: P, target: T, then_flow: FLOW, run_mode: "full" });
  const landed = (await call("ui", { action: "assert", target: T, ...GOAL, timeout_ms: 3000 })).data;
  out.then_flow = { saved: saved.saved_flow, status: deployed.status, flow: deployed.result?.flow, landed: landed.passed };
  record("E.then-flow", deployed.status === "succeeded" && deployed.result?.flow?.passed && landed.passed ? "VERIFIED" : "DEFECT",
    `build_run then_flow=${FLOW}: ${deployed.status}, flow passed ${deployed.result?.flow?.passed}, on page ${landed.passed}`, [evidence("efficiency", "then-flow.json", out.then_flow)]);

  // 4. Auto quick fix: second deploy records the baseline, a code edit is patched in seconds,
  //    a resource-free unchanged project only relaunches.
  const d2 = await job("run", { action: "build_run", project: P, target: T });
  fs.writeFileSync(ENTRY_FILE, original.replace(ENTRY_TEXT, ENTRY_TEXT.replace(/'([^']*)'/, "'$1·'")));
  t = Date.now();
  const d3 = await job("run", { action: "build_run", project: P, target: T });
  const hotMs = Date.now() - t;
  const shown = (await call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "我的", exact: true, clickable: true } }, { op: "click", selector: { text: TAB, exact: true, clickable: true } }], assert: { visible: { text: `${TAB}·`, exact: true }, timeout_ms: 5000 } })).data;
  fs.writeFileSync(ENTRY_FILE, original);
  const d4 = await job("run", { action: "build_run", project: P, target: T });
  const d5 = await job("run", { action: "build_run", project: P, target: T });
  out.hot = { second: { path: d2.result?.path, baseline: d2.result?.baseline }, edit: { path: d3.result?.path, ms: hotMs, shown: shown.passed }, revert: d4.result?.path, unchanged: d5.result?.path };
  record("E.auto-hot", d3.result?.path === "hot_reload" && shown.passed && hotMs < 10000 && d5.result?.path === "relaunch" ? "VERIFIED" : "DEFECT",
    `edit -> path=${d3.result?.path} in ${hotMs} ms, new text on screen ${shown.passed}; unchanged -> ${d5.result?.path}`, [evidence("efficiency", "hot.json", out.hot)]);

  // 5. Scroll performance from composer frame times.
  await call("ui", { action: "act", target: T, op: "click", selector: { text: TAB, exact: true, clickable: true }, diff: false });
  const perf = (await call("ui", { action: "perf", target: T })).data;
  out.perf = perf;
  record("E.perf", perf.source === "composer" && perf.avg_fps > 0 && perf.frames > 100 ? "VERIFIED" : "DEFECT",
    `ui perf: ${perf.source}, ${perf.frames} frames, ${perf.avg_fps} fps @ ${perf.refresh_hz} Hz, ${perf.janky_frames} janky -> ${perf.verdict}`, [evidence("efficiency", "perf.json", perf)]);

  // 6. Visual regression: same page = same; other tab = changed regions + diff image.
  const v1 = (await call("ui", { action: "visual", target: T, project: P, name: "audit" })).data;
  const v2 = (await call("ui", { action: "visual", target: T, project: P, name: "audit" })).data;
  await call("ui", { action: "act", target: T, op: "click", selector: { text: "我的", exact: true, clickable: true }, diff: false });
  const v3 = (await call("ui", { action: "visual", target: T, project: P, name: "audit" })).data;
  out.visual = { first: v1.baseline, same: v2.same, other: { same: v3.same, changed_ratio: v3.changed_ratio, regions: v3.regions?.length, image: !!v3.diff_artifact } };
  record("E.visual", v2.same && !v3.same && v3.changed_ratio > 0.05 && v3.diff_artifact ? "VERIFIED" : "DEFECT",
    `baseline ${v1.baseline}; same page same=${v2.same}; other tab changed_ratio=${v3.changed_ratio} (${v3.regions?.length} regions)`, [evidence("efficiency", "visual.json", out.visual)]);

  // 7. Layout rules on the current screen.
  const layout = (await call("ui", { action: "layout", target: T })).data;
  out.layout = layout;
  record("E.layout-screen", Array.isArray(layout.issues) ? "VERIFIED" : "DEFECT", `ui layout on ${layout.window}: passed=${layout.passed}, ${JSON.stringify(layout.counts)}`, [evidence("efficiency", "layout-screen.json", layout)]);
} finally {
  fs.writeFileSync(ENTRY_FILE, original);
  await c.call("ui_flow", { action: "delete", project: P, id: FLOW }).catch(() => {});
  fs.rmSync(path.join(P, ".arkpilot", "baselines"), { recursive: true, force: true });
  await c.close();
}
const ev = evidence("efficiency", "calls.json", calls);
record("E.calls", "VERIFIED", `${calls.length} tool calls for the whole acceptance run`, [ev]);
console.log(JSON.stringify({ calls: calls.length, ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, JSON.stringify(v).slice(0, 160)])) }, null, 1));
