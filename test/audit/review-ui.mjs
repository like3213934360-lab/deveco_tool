// Review 1.3 (A): batch act, after diff, repeat hint, visual, perf, layout on a real phone.
// AUDIT_TARGET (default Mate 80), AUDIT_PROJECT (default MyStarRing). Leaves no flows/baselines behind.
import fs from "node:fs";
import path from "node:path";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966";
const P = process.env.AUDIT_PROJECT ?? PROJECTS.mystarring;
const c = await mcp({ shared: false });
const ev = (n, d) => evidence("review-1.3", n, d);
const call = async (tool, args) => { const t = Date.now(); const r = await c.call(tool, args); return { ...r, ms: Date.now() - t, bytes: JSON.stringify(r.data ?? {}).length }; };
const launch = () => call("run", { action: "launch", project: P, target: T });
const tab = (text) => ({ op: "click", selector: { text, exact: true, clickable: true } });
const rows = {};
const only = process.env.ONLY ? process.env.ONLY.split(",") : undefined;
const want = (s) => !only || only.includes(s);
try {
  /* ---------------- batch act ---------------- */
  if (want("batch")) {
  await launch();
  // 1. Long path with mixed ops: tabs, scroll, wait, back.
  const steps = [tab("工具"), { op: "scroll", direction: "down" }, { op: "scroll", direction: "up" }, { op: "wait", ms: 300 }, tab("我的"), tab("首页"), tab("工具"),
    { op: "click", selector: { text: "视频转 GIF", exact: true } }, { op: "key", key: "back" }, { op: "wait", selector: { text: "壁纸工坊" }, timeout_ms: 5000 }];
  const long = await call("ui", { action: "act", target: T, steps });
  rows.long = { ms: long.ms, passed: long.data.passed, per_step: long.data.steps?.map((s) => `${s.op}:${s.ms}`), failed: long.data.failed_step, error: long.data.error };
  record("F.batch.mixed-ops", long.data.passed ? "VERIFIED" : "DEFECT", `10-step mixed path (tabs, scroll, wait, back, wait-for-selector) in one call: passed=${long.data.passed}, ${long.ms} ms (${(long.ms / steps.length).toFixed(0)} ms/step)`, [ev("batch-mixed.json", rows.long)]);

  // 2. Ambiguous selector: 2 matches without clickable/index -> resolved deterministically or reported.
  await launch();
  const amb = await call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "工具" }, timeout_ms: 2000 }] });
  rows.ambiguous = { passed: amb.data.passed, target: amb.data.steps?.[0]?.target, error: amb.data.error };
  record("F.batch.ambiguous", amb.data.passed || amb.data.error?.code === "UI_AMBIGUOUS" ? "VERIFIED" : "DEFECT",
    `selector {text:"工具"} (tab label + tab column): ${amb.data.passed ? `clicked ${amb.data.steps[0].target}` : amb.data.error?.code}`, [ev("batch-ambiguous.json", amb.data)]);

  // 3. Element never appears: timeout honoured and the visible list is app content.
  const t0 = Date.now();
  const miss = await call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "不存在XYZ" }, timeout_ms: 3000 }] });
  rows.missing = { ms: Date.now() - t0, code: miss.data.error?.code, visible: miss.data.visible?.slice(0, 6) };
  record("F.batch.timeout", miss.data.error?.code === "UI_NOT_FOUND" && rows.missing.ms < 3000 + 2500 ? "VERIFIED" : "DEFECT",
    `missing element timeout_ms=3000 -> ${miss.data.error?.code} after ${rows.missing.ms} ms; visible starts with ${JSON.stringify(rows.missing.visible?.slice(0, 3))}`, [ev("batch-timeout.json", rows.missing)]);

  // 4. Step limit: 31 steps rejected before anything runs.
  const over = await call("ui", { action: "act", target: T, steps: Array.from({ length: 31 }, () => ({ op: "wait", ms: 0 })) });
  record("F.batch.limit", over.isError && /30|steps/i.test(JSON.stringify(over.data)) ? "VERIFIED" : "DEFECT", `31 steps -> ${over.isError ? over.data.error?.code : "accepted"}`, [ev("batch-limit.json", over.data)]);

  // 5. op + steps together rejected; save_flow without assert rejected.
  const both = await call("ui", { action: "act", target: T, op: "click", x: 1, y: 1, steps: [{ op: "wait", ms: 0 }] });
  const noAssert = await call("ui", { action: "act", target: T, steps: [{ op: "wait", ms: 0 }], save_flow: { project: P, id: "x-review" } });
  record("F.batch.validation", both.isError && noAssert.isError ? "VERIFIED" : "DEFECT", `op+steps -> ${both.data.error?.code}; save_flow without assert -> ${noAssert.data.error?.code}`, [ev("batch-validation.json", { both: both.data, noAssert: noAssert.data })]);

  // 6. save_flow -> replay reproduces it.
  await launch();
  const saved = await call("ui", { action: "act", target: T, steps: [tab("工具"), { op: "click", selector: { text: "视频转 GIF", exact: true } }], assert: { visible: { text: "视频转 GIF", exact: true } }, save_flow: { project: P, id: "review-gif" } });
  let rep = (await call("ui_flow", { action: "replay", project: P, target: T, id: "review-gif", wait: 55000 })).data;
  while (rep.status === "running") rep = (await call("job", { action: "wait", job_id: rep.job_id, wait: 55000 })).data;
  record("F.batch.save-replay", saved.data.saved_flow && rep.status === "succeeded" && rep.result?.passed ? "VERIFIED" : "DEFECT", `save_flow -> ${saved.data.saved_flow?.steps} steps; replay ${rep.status}, passed ${rep.result?.passed}`, [ev("batch-save-replay.json", { saved: saved.data.saved_flow, replay: rep })]);

  }
  /* ---------------- single act vs batch on the same ambiguous selector ---------------- */
  if (want("after")) {
  await launch();
  await call("ui", { action: "act", target: T, ...tab("工具"), diff: false });
  const single = await call("ui", { action: "act", target: T, op: "click", selector: { text: "视频转 GIF", exact: true } });
  record("F.act.ambiguity-consistency", !single.isError ? "VERIFIED" : "DEFECT",
    `the same selector {text:"视频转 GIF",exact} (section title + card label, neither clickable): steps picks the top-most and succeeds (F.batch.save-replay), single act -> ${single.isError ? single.data.error?.code : "ok"}; hosts get different behaviour for the same input`, [ev("act-ambiguity.json", single.data)]);

  /* ---------------- after diff ---------------- */
  await launch();
  const kinds = {}, ms = {};
  const step = async (name, args) => { const r = await call("ui", { action: "act", target: T, ...args }); kinds[name] = r.isError ? { error: r.data.error?.code } : r.data.after; ms[name] = r.ms; };
  await step("tab", tab("工具"));
  await step("page", { op: "click", selector: { text: "视频转 GIF", exact: true, index: 0 } });
  await step("back", { op: "key", key: "back" });
  await step("scroll", { op: "scroll", direction: "down" });
  await step("tab_home", tab("首页"));
  rows.after_ms = ms;
  const sizes = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, JSON.stringify(v).length]));
  rows.after = { kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v?.kind])), sizes };
  record("F.after.size", Object.values(sizes).every((s) => s <= 1024) ? "VERIFIED" : "DEFECT", `after sizes ${JSON.stringify(sizes)} (budget 1 KB)`, [ev("after-kinds.json", kinds)]);
  const cnt = (a) => a ? `+${(a.added?.length ?? 0) + (a.more_added ?? 0)} -${(a.removed?.length ?? 0) + (a.more_removed ?? 0)}` : "";
  // Opening a full-screen page and switching to another tab are page changes; the field exists to tell the host so.
  const nav = ["page", "back", "tab_home"].filter((k) => kinds[k]?.kind !== "navigated");
  record("F.after.navigated-detection", nav.length === 0 ? "VERIFIED" : "DEFECT",
    `kind per action: tab=${kinds.tab?.kind} (${cnt(kinds.tab)}), open page=${kinds.page?.kind} (${cnt(kinds.page)}), back=${kinds.back?.kind} (${cnt(kinds.back)}), scroll=${kinds.scroll?.kind} (${cnt(kinds.scroll)}), tab home=${kinds.tab_home?.kind} (${cnt(kinds.tab_home)}); page changes not reported as navigated: ${nav.join(", ") || "none"}`, [ev("after-navigated.json", kinds)]);
  record("F.after.latency", Math.max(...Object.values(ms)) < 2500 ? "VERIFIED" : "DEFECT",
    `single act latency with diff (ms): ${JSON.stringify(ms)}; a dump is ~1.3 s, so before+after dumps dominate`, [ev("after-latency.json", ms)]);
  }

  /* ---------------- repeat hint false positives ---------------- */
  if (want("repeat")) {
  await launch();
  const h1 = (await call("ui", { action: "act", target: T, steps: [tab("工具"), tab("我的")] })).data.suggest;
  await launch();
  const h2 = (await call("ui", { action: "act", target: T, steps: [tab("我的"), tab("工具")] })).data.suggest; // different order: no hint
  await launch();
  const h3 = (await call("ui", { action: "act", target: T, steps: [tab("工具"), tab("我的")] })).data.suggest; // repeat of run 1: hint
  record("F.repeat.precision", !h1 && !h2 && !!h3 ? "VERIFIED" : "DEFECT", `first walk hint=${!!h1}, different order hint=${!!h2}, repeat hint=${!!h3}`, [ev("repeat.json", { h1, h2, h3 })]);
  }
} finally {
  await c.call("ui_flow", { action: "delete", project: P, id: "review-gif" }).catch(() => {});
  fs.rmSync(path.join(P, ".arkpilot", "baselines"), { recursive: true, force: true });
  await c.close();
}
console.log(JSON.stringify(rows, null, 1).slice(0, 3000));
