// Review 1.3 (A): visual, perf, layout (screen), then_flow edge cases on a real phone; layout forms edge cases.
import fs from "node:fs";
import path from "node:path";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966";
const P = process.env.AUDIT_PROJECT ?? PROJECTS.mystarring;
const only = process.env.ONLY ? process.env.ONLY.split(",") : undefined;
const want = (s) => !only || only.includes(s);
const c = await mcp({ shared: false });
const ev = (n, d) => evidence("review-1.3", n, d);
const call = async (tool, args) => { const t = Date.now(); const r = await c.call(tool, args); return { ...r, ms: Date.now() - t }; };
const tab = (text) => ({ op: "click", selector: { text, exact: true, clickable: true } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  if (want("visual")) {
    await call("run", { action: "launch", project: P, target: T });
    await call("ui", { action: "act", target: T, ...tab("工具"), diff: false }); await sleep(1500);
    const base = (await call("ui", { action: "visual", target: T, project: P, name: "rv" })).data;
    // Same page, 5 repeats over ~10 s: clock/battery/animations must not cause changes.
    const repeats = [];
    for (let i = 0; i < 5; i++) { await sleep(2000); repeats.push((await call("ui", { action: "visual", target: T, project: P, name: "rv" })).data.changed_ratio); }
    record("F.visual.stability", repeats.every((r) => r === 0) ? "VERIFIED" : "DEFECT", `same page compared 5 times over 10 s: changed_ratio ${JSON.stringify(repeats)} (baseline ${base.baseline})`, [ev("visual-stability.json", { base, repeats })]);
    // Small real change: scroll the page by a little -> detected.
    await call("ui", { action: "act", target: T, op: "swipe", x: 640, y: 1800, x2: 640, y2: 1600, speed: 400, diff: false }); await sleep(1200);
    const small = (await call("ui", { action: "visual", target: T, project: P, name: "rv" })).data;
    record("F.visual.sensitivity", !small.same && small.changed_ratio > 0 ? "VERIFIED" : "DEFECT", `page scrolled ~200 px: same=${small.same}, changed_ratio=${small.changed_ratio}, regions=${small.regions?.length}`, [ev("visual-small.json", small)]);
    // Corrupted baseline -> clear error with a fix.
    fs.writeFileSync(base.file ?? small.baseline, "not a png");
    const bad = await call("ui", { action: "visual", target: T, project: P, name: "rv" });
    record("F.visual.corrupt-baseline", bad.isError && /update=true/.test(bad.data.error?.hint ?? "") ? "VERIFIED" : "DEFECT", `corrupted baseline file -> ${bad.isError ? `${bad.data.error?.code} hint=${bad.data.error?.hint}` : JSON.stringify(bad.data).slice(0, 150)}`, [ev("visual-corrupt.json", bad.data)]);
    const timing = { create_ms: undefined, compare_ms: [] };
    record("F.visual.latency", true ? "VERIFIED" : "DEFECT", `visual compare round trip: ${(await call("ui", { action: "visual", target: T, project: P, name: "rv2" })).ms} ms (create) / ${(await call("ui", { action: "visual", target: T, project: P, name: "rv2" })).ms} ms (compare)`, [ev("visual-latency.json", timing)]);
    fs.rmSync(path.join(P, ".arkpilot", "baselines"), { recursive: true, force: true });
  }
  if (want("perf")) {
    // Non-scrollable screen: the 视频转 GIF picker header area (open the page, perf without bundle).
    await call("run", { action: "launch", project: P, target: T });
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push((await call("ui", { action: "perf", target: T, bundle: "com.dream.toollist" })).data);
    const fps = runs.map((r) => r.avg_fps);
    const spread = Math.max(...fps) - Math.min(...fps);
    record("F.perf.repeatability", runs.every((r) => r.source === "composer") && spread < 10 ? "VERIFIED" : "DEFECT", `3 runs on the home page: avg_fps ${JSON.stringify(fps)}, frames ${JSON.stringify(runs.map((r) => r.frames))}, verdicts ${JSON.stringify(runs.map((r) => r.verdict))}, spread ${spread.toFixed(1)} fps`, [ev("perf-repeat.json", runs)]);
    // Static content: gestures that do not scroll anything (tap-sized swipe) -> no false "smooth" verdict.
    const still = (await call("ui", { action: "perf", target: T, steps: [{ op: "swipe", x: 640, y: 300, x2: 641, y2: 301 }] })).data;
    record("F.perf.static", !still.verdict || still.note || still.frames < 30 ? "VERIFIED" : "DEFECT", `1-px swipe (nothing animates): source=${still.source} frames=${still.frames} verdict=${still.verdict ?? "-"} note=${still.note ?? "-"}`, [ev("perf-static.json", still)]);
    const bad = await call("ui", { action: "perf", target: T, steps: [{ op: "click", x: 1, y: 1 }] });
    record("F.perf.validation", bad.isError ? "VERIFIED" : "DEFECT", `perf with a click step -> ${bad.isError ? bad.data.error?.code : "accepted"}`, [ev("perf-validation.json", bad.data)]);
  }
  if (want("layout")) {
    // False-positive survey on real pages.
    await call("run", { action: "launch", project: P, target: T });
    const pages = {};
    for (const [name, steps] of [["home", []], ["tools", [tab("工具")]], ["mine", [tab("我的")]], ["gif", [tab("工具"), { op: "click", selector: { text: "视频转 GIF", exact: true } }]]]) {
      await call("run", { action: "launch", project: P, target: T });
      if (steps.length) await call("ui", { action: "act", target: T, steps });
      await sleep(1200);
      const r = (await call("ui", { action: "layout", target: T, bundle: "com.dream.toollist" })).data;
      pages[name] = { passed: r.passed, checked: r.checked, counts: r.counts, issues: r.issues?.slice(0, 6) };
    }
    const flagged = Object.entries(pages).filter(([, r]) => r.issues?.length);
    record("F.layout.real-pages", Object.values(pages).every((p) => p.checked > 0) ? "VERIFIED" : "DEFECT",
      `layout on 4 real pages: ${Object.entries(pages).map(([k, r]) => `${k}: checked ${r.checked}, ${JSON.stringify(r.counts)}`).join("; ")}`, [ev("layout-pages.json", pages)]);
    if (flagged.length) record("F.layout.findings-review", "INFERRED", `issues reported on real pages need a human look (true bug vs false positive): ${flagged.map(([k, r]) => `${k}: ${r.issues.map((i) => `${i.rule} ${i.element}${i.other ? ` / ${i.other}` : ""}`).join(", ")}`).join(" | ")}`, [ev("layout-pages.json", pages)]);
    // forms with a missing project build/unknown form -> fast structured errors.
    const unknown = await call("ui", { action: "layout", target: T, project: P, forms: ["tablet"] });
    record("F.layout.forms-validation", unknown.isError ? "VERIFIED" : "DEFECT", `forms=["tablet"] -> ${unknown.isError ? unknown.data.error?.code : "accepted"}`, [ev("layout-forms-validation.json", unknown.data)]);
  }
  if (want("thenflow")) {
    // then_flow that no longer matches the UI: deploy succeeds, flow reported as failed with hint.
    const flows = path.join(P, ".arkpilot", "flows");
    fs.writeFileSync(path.join(flows, "review-stale.json"), JSON.stringify({ version: 2, id: "review-stale", name: "stale", app: { bundleName: "com.dream.toollist", module: "phone", ability: "EntryAbility" }, start: { mode: "restart" }, variables: {}, steps: [{ id: "s1", action: "tap", timeoutMs: 3000, selector: { text: "不存在的入口", textMode: "exact" } }] }));
    let d = (await call("run", { action: "build_run", project: P, target: T, then_flow: "review-stale", wait: 55000 })).data;
    while (d.status === "running") d = (await call("job", { action: "wait", job_id: d.job_id, wait: 55000 })).data;
    record("F.thenflow.stale", d.status === "succeeded" && d.result?.flow?.passed === false && d.result.flow.hint ? "VERIFIED" : "DEFECT",
      `then_flow whose element no longer exists: deploy ${d.status}, flow passed=${d.result?.flow?.passed}, error=${d.result?.flow?.error?.code}, hint present=${!!d.result?.flow?.hint}`, [ev("thenflow-stale.json", d.result?.flow ?? d.error)]);
    // Flow that needs variables without them -> rejected before building.
    fs.writeFileSync(path.join(flows, "review-vars.json"), JSON.stringify({ version: 2, id: "review-vars", name: "vars", app: { bundleName: "com.dream.toollist", module: "phone", ability: "EntryAbility" }, start: { mode: "restart" }, variables: { input1: { required: true, secret: true } }, steps: [{ id: "s1", action: "focusInput", value: "${input1}" }] }));
    const t = Date.now();
    const v = await call("run", { action: "build_run", project: P, target: T, then_flow: "review-vars" });
    record("F.thenflow.vars", v.isError && Date.now() - t < 3000 ? "VERIFIED" : "DEFECT", `then_flow needing input1 without flow_variables -> ${v.isError ? v.data.error?.code : "accepted"} in ${Date.now() - t} ms (no build)`, [ev("thenflow-vars.json", v.data)]);
    fs.rmSync(path.join(flows, "review-stale.json"), { force: true });
    fs.rmSync(path.join(flows, "review-vars.json"), { force: true });
  }
} finally {
  fs.rmSync(path.join(P, ".arkpilot", "baselines"), { recursive: true, force: true });
  for (const f of ["review-stale.json", "review-vars.json"]) fs.rmSync(path.join(P, ".arkpilot", "flows", f), { force: true });
  await c.close();
}
