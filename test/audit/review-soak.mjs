// Review 1.3 (D): soak - 100 acts and 20 deploys; server RSS, child processes, open handles, host and
// device temp files before/after; response sizes per action.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { evidence, mcp, record, PROJECTS } from "./lib.mjs";

const T = process.env.AUDIT_TARGET ?? "6XE0225B06010966", P = PROJECTS.mystarring;
const ACTS = Number(process.env.ACTS ?? 100), DEPLOYS = Number(process.env.DEPLOYS ?? 20);
const H = "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc";
const c = await mcp({ shared: false });
const pid = c.child.pid;
const ev = (n, d) => evidence("review-1.3", n, d);
const sample = () => {
  const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
  const kids = execFileSync("ps", ["-axo", "ppid="]).toString().split("\n").filter((l) => Number(l) === pid).length;
  let fds = 0; try { fds = execFileSync("lsof", ["-p", String(pid)]).toString().trim().split("\n").length - 1; } catch { /* lsof missing */ }
  const devTmp = Number(execFileSync(H, ["-t", T, "shell", "ls /data/local/tmp | grep -c deveco- || true"]).toString().trim()) || 0;
  const hostTmp = fs.readdirSync(process.env.TMPDIR ?? "/tmp").filter((f) => /^(deveco-|upstream-|api-scan-|vis-|layout-)/.test(f)).length;
  return { rss_mb: Math.round(rss), children: kids, fds, device_tmp: devTmp, host_tmp: hostTmp };
};
const sizes = {};
const call = async (tool, args, label) => {
  const r = await c.call(tool, args);
  const bytes = JSON.stringify(r.data ?? {}).length + (r.content?.find((x) => x.type === "image")?.data.length ?? 0);
  (sizes[label] ??= []).push(bytes);
  return r;
};
const series = [];
try {
  await call("run", { action: "launch", project: P, target: T }, "run.launch");
  await call("ui", { action: "act", target: T, op: "click", selector: { text: "不允许", exact: true } }, "ui.act").catch(() => {});
  series.push({ at: "start", ...sample() });
  const tabs = ["工具", "我的", "首页"];
  for (let i = 0; i < ACTS; i++) {
    await call("ui", { action: "act", target: T, op: "click", selector: { text: tabs[i % 3], exact: true, clickable: true } }, "ui.act");
    if (i % 25 === 24) series.push({ at: `act ${i + 1}`, ...sample() });
  }
  // response sizes of the read actions
  await call("ui", { action: "observe", target: T }, "ui.observe");
  await call("ui", { action: "tree", target: T }, "ui.tree");
  await call("ui", { action: "find", target: T, selector: { text: "工具" } }, "ui.find");
  await call("ui", { action: "screenshot", target: T }, "ui.screenshot");
  await call("ui", { action: "layout", target: T }, "ui.layout");
  await call("ui", { action: "perf", target: T, repeat: 1 }, "ui.perf");
  await call("ui", { action: "act", target: T, steps: [{ op: "click", selector: { text: "工具", exact: true, clickable: true } }, { op: "click", selector: { text: "首页", exact: true, clickable: true } }] }, "ui.act.steps");
  await call("device", { action: "log", target: T, lines: 300 }, "device.log");
  await call("device", { action: "info", target: T }, "device.info");
  await call("project", { action: "info", project: P }, "project.info");
  for (let i = 0; i < DEPLOYS; i++) {
    let d = (await call("run", { action: "build_run", project: P, target: T, wait: 55000 }, "run.build_run")).data;
    while (d.status === "running") d = (await c.call("job", { action: "wait", job_id: d.job_id, wait: 55000 })).data;
    (sizes["run.build_run.result"] ??= []).push(JSON.stringify(d).length);
    if (i % 5 === 4) series.push({ at: `deploy ${i + 1}`, ...sample() });
  }
} finally {
  series.push({ at: "end", ...sample() });
  await c.close();
}
const start = series[0], end = series.at(-1);
const sizeSummary = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, { n: v.length, max: Math.max(...v), median: v.sort((a, b) => a - b)[Math.floor(v.length / 2)] }]));
const e = ev("soak.json", { series, sizes: sizeSummary });
record("F.soak.memory", end.rss_mb - start.rss_mb < 60 ? "VERIFIED" : "DEFECT", `RSS over ${ACTS} acts + ${DEPLOYS} deploys: ${series.map((s) => `${s.at}=${s.rss_mb} MB`).join(", ")}`, [e]);
record("F.soak.children-fds", end.children <= start.children + 3 && end.fds <= start.fds + 20 ? "VERIFIED" : "DEFECT", `children ${start.children} -> ${end.children}, open fds ${start.fds} -> ${end.fds} (${series.map((s) => `${s.at}:${s.children}/${s.fds}`).join(" ")})`, [e]);
record("F.soak.temp-files", end.device_tmp <= start.device_tmp && end.host_tmp <= start.host_tmp ? "VERIFIED" : "DEFECT", `deveco temp files on device ${start.device_tmp} -> ${end.device_tmp}, on host ${start.host_tmp} -> ${end.host_tmp}`, [e]);
const big = Object.entries(sizeSummary).filter(([k, v]) => !/screenshot|observe/.test(k) && v.max > 8000);
record("F.soak.response-sizes", big.length === 0 ? "VERIFIED" : "DEFECT", `response bytes (max/median, image bytes included for screenshot/observe): ${Object.entries(sizeSummary).map(([k, v]) => `${k} ${v.max}/${v.median}`).join(", ")}${big.length ? `; text responses over 8 KB: ${big.map(([k]) => k).join(", ")}` : ""}`, [e], big.length ? { severity: "low", dimension: "efficiency" } : {});
