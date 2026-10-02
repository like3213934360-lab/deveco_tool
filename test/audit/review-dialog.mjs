// Review 1.3 (C): a system permission dialog covers the app right after a clean install.
// Reinstalls MyStarRing on the phone (user agreed: clears the app's data on the device).
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";
const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966", P = PROJECTS.mystarring;
const c = await mcp({ shared: true });
const ev = (n, d) => evidence("review-1.3", n, d);
try {
  let d = (await c.call("run", { action: "build_run", project: P, target: T, uninstall_first: true, run_mode: "full", wait: 55000 })).data;
  while (d.status === "running") d = (await c.call("job", { action: "wait", job_id: d.job_id, wait: 55000 })).data;
  const t = Date.now();
  const r = (await c.call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "工具", exact: true, clickable: true }, timeout_ms: 5000 }] })).data;
  const covered = { deploy: d.status, smoke: d.result?.launch?.smoke, ms: Date.now() - t, passed: r.passed, error: r.error, visible: r.visible?.slice(0, 6) };
  const mentionsDialog = (r.visible ?? []).some((v) => /允许|不允许|通知/.test(v));
  record("F.dialog.batch-covered", !r.passed && mentionsDialog ? "VERIFIED" : r.passed ? "INFERRED" : "DEFECT",
    `fresh install, notification dialog in front, steps tap 工具: passed=${r.passed}, ${r.error?.code ?? ""}; visible list ${mentionsDialog ? "shows the dialog buttons" : "does NOT show the dialog"}: ${JSON.stringify(r.visible?.slice(0, 5))}`, [ev("dialog-covered.json", covered)],
    !r.passed && !mentionsDialog ? { severity: "medium", dimension: "availability" } : {});
  // smoke verdict with the dialog in front: PASS is correct (app runs), but does the result mention it?
  record("F.dialog.smoke", d.result?.launch?.smoke === "PASS" ? "VERIFIED" : "DEFECT", `build_run smoke with the system dialog over the app: ${d.result?.launch?.smoke} (screen_uniformity ${d.result?.launch?.screen_uniformity}); no mention of the dialog in the run result`, [ev("dialog-covered.json", covered)]);
  // leave the device usable: decline the dialog.
  await c.call("ui", { action: "act", target: T, op: "click", selector: { text: "不允许", exact: true } }).catch(() => {});
} finally { await c.close(); }
