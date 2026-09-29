// Full-feature smoke test against real projects and a real phone.
// Rules: never edit the given projects (code-changing checks run on temp copies); never change signing.
// Usage: node test/smoke/real-projects.mjs --multi <multi-device project> [--single <single-module project>]
//        --phone <serial> [--emulator <serial>] [--report <file.md>]
// Without --single, every check runs against the multi-device project (its phone entry module).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { connect } from "../../tools/mcp-client.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const MULTI = arg("--multi"), PHONE = arg("--phone"), EMU = arg("--emulator");
const SINGLE = arg("--single") ?? MULTI;
if (!MULTI || !PHONE) { console.error("usage: --multi <project> [--single <project>] --phone <serial> [--emulator <serial>]"); process.exit(2); }

const c = connect();
await c.initialize();
const results = [];
const wait = async (r) => { while (r.data?.status === "running" || r.data?.status === "queued") r = await c.call("job", { action: "wait", job_id: r.data.job_id, wait: 60000 }); return r; };
/** Run one check: fn returns [ok, note] or throws. */
async function check(area, name, fn) {
  const t0 = Date.now();
  let ok = false, note = "";
  try { [ok, note] = await fn(); } catch (e) { note = `exception: ${e.message}`; }
  const ms = Date.now() - t0;
  results.push({ area, name, ok, ms, note: String(note).slice(0, 220) });
  console.log(`${ok ? "PASS" : "FAIL"} [${area}] ${name} (${ms} ms) ${note ? "— " + String(note).slice(0, 200) : ""}`);
}
const call = (tool, args) => c.call(tool, args);
const err = (r) => (r.isError ? `${r.data.error?.code}: ${r.data.error?.message}` : "");
const copyProject = (src) => {
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "smoke-copy-")), path.basename(src));
  execFileSync("rsync", ["-a", "--exclude", "build", "--exclude", ".hvigor", "--exclude", ".idea", "--exclude", ".git", `${src}/`, `${dst}/`]);
  return dst;
};
const bundleOf = (p) => JSON.parse(execFileSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(path.join(path.dirname(new URL(import.meta.url).pathname), "../../node_modules/json5"))}).parse(require("fs").readFileSync(${JSON.stringify(path.join(p, "AppScope/app.json5"))},"utf8")).app.bundleName))`]).toString());
const MULTI_BUNDLE = bundleOf(MULTI), SINGLE_BUNDLE = bundleOf(SINGLE);
// Home page of the phone entry module of the project used for code/hot-reload checks.
const entryPage = (p) => {
  for (const dir of ["products/default", "products/phone", "entry"]) {
    const f = path.join(dir, "src/main/ets/pages/Index.ets");
    if (fs.existsSync(path.join(p, f))) return f;
  }
  throw new Error(`no entry Index.ets in ${p}`);
};
const PAGE = entryPage(SINGLE);

/* ------------------------------- environment ------------------------------- */
await check("doctor", "doctor on multi-device project", async () => {
  const r = await call("doctor", { project: MULTI, target: PHONE });
  const failed = (r.data.checks ?? []).filter((x) => !x.ok).map((x) => x.name);
  return [!r.isError && !failed.filter((n) => !["auth", "knowledge"].includes(n)).length, `failed checks: ${failed.join(",") || "none"}`];
});

/* --------------------------------- project --------------------------------- */
await check("project", "info (modules, deviceTypes, signing untouched)", async () => {
  const r = await call("project", { action: "info", project: MULTI });
  const entries = r.data.modules?.filter((m) => m.type === "entry").map((m) => m.name);
  return [!r.isError && entries?.length === 2, `entries: ${entries}`];
});
await check("project", "build single module (phone entry only)", async () => {
  const r = await wait(await call("project", { action: "build", project: MULTI, modules: ["default"], wait: 60000 }));
  const arts = r.data.result?.artifacts?.map((a) => path.basename(a.path)) ?? [];
  return [r.data.status === "succeeded" && arts.length === 1 && arts[0].startsWith("default-"), `${r.data.status} ${arts.join(",")} ${r.data.error?.message ?? ""}`];
});
await check("project", "build watch module (wearable entry)", async () => {
  const r = await wait(await call("project", { action: "build", project: MULTI, modules: ["watch"], wait: 60000 }));
  const arts = r.data.result?.artifacts?.map((a) => path.basename(a.path)) ?? [];
  return [r.data.status === "succeeded" && arts.every((a) => a.startsWith("watch-")), `${r.data.status} ${arts.join(",")}`];
});
await check("job", "status / list / read (build log) / cancel / resume refusal", async () => {
  const jobs = (await call("job", { action: "list", limit: 20 })).data.jobs;
  const build = jobs.find((j) => j.kind === "build" && j.status === "succeeded");
  if (!build) return [false, "no finished build job"];
  const st = await call("job", { action: "status", job_id: build.job_id, detail: true });
  const art = st.data.result?.log_artifact;
  const page = await call("job", { action: "read", artifact_id: art, limit: 10 });
  const grep = await call("job", { action: "read", artifact_id: art, grep: "BUILD SUCCESSFUL" });
  const copy = copyProject(SINGLE);
  const running = await call("project", { action: "build", project: copy, modules: ["default"], wait: 0 });
  const cancel = await call("job", { action: "cancel", job_id: running.data.job_id });
  const resume = await call("job", { action: "resume", job_id: running.data.job_id });
  return [!st.isError && page.data.total_lines > 0 && grep.data.matched_lines >= 1 && cancel.data.status === "cancelled" && resume.data.error?.code === "INVALID_INPUT",
    `log ${page.data.total_lines} lines, cancel=${cancel.data.status}, resume=${resume.data.error?.code}`];
});
await check("project", "sync (ohpm install) on a copy", async () => {
  const copy = copyProject(SINGLE);
  const r = await wait(await call("project", { action: "sync", project: copy, wait: 60000 }));
  return [r.data.status === "succeeded", `${r.data.status} ${r.data.error?.message ?? ""}`];
});
await check("project", "create + clean (scratch project)", async () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "smoke-new-")), "Scratch");
  const cr = await call("project", { action: "create", project: p, app_name: "Scratch", bundle_name: "com.devecomcp.scratch" });
  const cl = await call("project", { action: "clean", project: p });
  return [!cr.isError && !cl.isError, err(cr) || err(cl) || `${cr.data.files} files`];
});

/* ----------------------------------- code ---------------------------------- */
const MULTI_PAGE = "products/default/src/main/ets/pages/Index.ets";
await check("code", "check (ArkTS static, advisory)", async () => {
  const r = await call("code", { action: "check", project: MULTI, files: [MULTI_PAGE] });
  return [!r.isError && typeof r.data.errors === "number", err(r) || `errors=${r.data.errors} warnings=${r.data.warnings} (advisory)`];
});
await check("code", "lint (Code Linter, one file)", async () => {
  const r = await call("code", { action: "lint", project: MULTI, file: MULTI_PAGE });
  return [!r.isError, err(r) || `issues=${r.data.total}`];
});
await check("code", "api_versions", async () => {
  const r = await call("code", { action: "api_versions" });
  return [!r.isError && r.data.versions.length > 5, `${r.data.versions?.length} versions`];
});
await check("code", "api_scan (one file)", async () => {
  const v = (await call("code", { action: "api_versions" })).data.versions;
  const r = await call("code", { action: "api_scan", project: SINGLE, files: [PAGE], from: v[v.length - 4], to: v[v.length - 1] });
  return [!r.isError, err(r) || `findings=${r.data.findings}`];
});
// Real symbols of the single-module project's home page; every operation must return a non-empty answer.
const lspOps = [
  ["hover", { symbol: "IndexViewModel" }, (d) => !!d.hover],
  ["definition", { symbol: "IndexViewModel", line: 60 }, (d) => d.locations?.length > 0],
  ["declaration", { symbol: "IndexViewModel", line: 60 }, (d) => d.locations?.length > 0],
  ["references", { symbol: "isFloatingTabBar" }, (d) => d.total >= 1],
  ["symbols", {}, (d) => d.symbols?.length > 0],
  ["completion", { symbol: "vm", line: 284 }, (d) => d.total > 0],
  ["signature", { symbol: "showSystemBar" }, (d) => d.signatures?.length > 0],
  ["call_hierarchy", { symbol: "mainTabContents" }, (d) => d.calls?.length > 0],
  ["diagnostics", {}, (d) => typeof d.errors === "number"],
];
for (const [op, extra, good] of lspOps) {
  await check("code", `lsp ${op}`, async () => {
    const r = await call("code", { action: "lsp", op, project: SINGLE, file: PAGE, ...extra });
    return [!r.isError && good(r.data), err(r) || JSON.stringify(r.data).slice(0, 120)];
  });
}
await check("code", "lsp implementation (interface -> class)", async () => {
  const r = await call("code", { action: "lsp", op: "implementation", project: MULTI, file: "products/default/src/main/ets/agent/AgentNavigationCoordinator.ets", symbol: "AgentNavigationPort", line: 37 });
  return [!r.isError && r.data.locations?.some((l) => l.line === 55), err(r) || JSON.stringify(r.data.locations?.map((l) => `${l.file}:${l.line}`)).slice(0, 180)];
});
await check("code", "lsp workspace_symbols", async () => {
  const r = await call("code", { action: "lsp", op: "workspace_symbols", project: SINGLE, query: "Index" });
  return [!r.isError && r.data.symbols.length > 0, err(r) || `${r.data.symbols.length} symbols`];
});
await check("code", "lsp_restart arkts", async () => {
  const r = await call("code", { action: "lsp_restart", project: SINGLE, language: "arkts" });
  return [!r.isError, err(r)];
});

/* ---------------------------------- device --------------------------------- */
await check("device", "list", async () => {
  const r = await call("device", { action: "list" });
  return [r.data.devices?.some((d) => d.target === PHONE), `${r.data.devices?.map((d) => `${d.target}:${d.model}`).join(", ")}`];
});
await check("device", "info", async () => { const r = await call("device", { action: "info", target: PHONE }); return [!!r.data.api_level, `${r.data.model} API ${r.data.api_level}`]; });
await check("device", "log tail/level/grep", async () => { const r = await call("device", { action: "log", target: PHONE, lines: 100, level: "W" }); return [!r.isError, `${r.data.lines} lines`]; });
await check("device", "log from/to window", async () => { const r = await call("device", { action: "log", target: PHONE, from: "3m", to: "2m", lines: 20 }); return [!r.isError && !!r.data.window, `${r.data.lines} lines ${JSON.stringify(r.data.window)}`]; });
await check("device", "log follow + cursor", async () => {
  const a = await call("device", { action: "log", target: PHONE, follow: true, lines: 5, wait_ms: 3000 });
  const b = await call("device", { action: "log", target: PHONE, follow: true, cursor: a.data.cursor, lines: 5, wait_ms: 5000 });
  return [!a.isError && !b.isError && b.data.cursor >= a.data.cursor, `${a.data.cursor} -> ${b.data.cursor}`];
});
await check("device", "shell (read-only) + write blocked", async () => {
  const ok = await call("device", { action: "shell", target: PHONE, command: "param get const.product.model" });
  const bad = await call("device", { action: "shell", target: PHONE, command: "rm -rf /data/local/tmp/x" });
  return [!ok.isError && bad.isError, `${ok.data.stdout?.trim?.() ?? JSON.stringify(ok.data).slice(0, 60)}; rm blocked=${bad.isError}`];
});
await check("device", "send/recv file", async () => {
  const f = path.join(os.tmpdir(), `smoke-${Date.now()}.txt`); fs.writeFileSync(f, "smoke");
  const s = await call("device", { action: "send", target: PHONE, local: f, remote: "/data/local/tmp/smoke.txt" });
  const back = f + ".back";
  const r = await call("device", { action: "recv", target: PHONE, remote: "/data/local/tmp/smoke.txt", local: back });
  return [!s.isError && !r.isError && fs.readFileSync(back, "utf8") === "smoke", err(s) || err(r)];
});
await check("device", "sqlite (memory db, read-only guard)", async () => {
  const r = await call("device", { action: "sqlite", target: PHONE, db: ":memory:", sql: "select 1 as a" });
  const w = await call("device", { action: "sqlite", target: PHONE, db: ":memory:", sql: "create table t(a)" });
  return [!r.isError && w.isError, `rows=${JSON.stringify(r.data.rows)} write blocked=${w.isError}`];
});

/* ------------------------------------ run ---------------------------------- */
await check("run", "build_run multi-device project on phone (auto-selects phone module)", async () => {
  const r = await wait(await call("run", { action: "build_run", project: MULTI, target: PHONE, wait: 60000 }));
  const d = r.data.result;
  return [r.data.status === "succeeded" && d.modules.join() === "default" && d.launch.smoke === "PASS",
    `${r.data.status} modules=${d?.modules} installed=${d?.installed?.packages} smoke=${d?.launch?.smoke} ${r.data.error?.message ?? ""}`];
});
await check("run", "watch module refused on phone before install", async () => {
  const r = await wait(await call("run", { action: "deploy", project: MULTI, target: PHONE, modules: ["watch"], wait: 60000 }));
  return [r.data.status === "failed" && r.data.error?.code === "DEVICE_MISMATCH", r.data.error?.message];
});
await check("run", "stop / launch", async () => {
  const s = await call("run", { action: "stop", project: MULTI, target: PHONE });
  const l = await call("run", { action: "launch", project: MULTI, target: PHONE });
  return [!s.isError && l.data.started, err(s) || err(l) || `pid ${l.data.pid} smoke ${l.data.smoke}`];
});
await check("run", "deploy single-module project with skip_build", async () => {
  const r = await wait(await call("run", { action: "build_run", project: SINGLE, target: PHONE, skip_build: true, wait: 60000 }));
  return [r.data.status === "succeeded", `${r.data.status} ${r.data.result?.installed?.packages} ${r.data.error?.message ?? ""}`];
});

/* ------------------------------------ ui ----------------------------------- */
await check("ui", "observe (screenshot + elements)", async () => {
  const r = await call("ui", { action: "observe", target: PHONE, limit: 30 });
  return [!r.isError && r.content.some((x) => x.type === "image"), `${(r.data.elements ?? "").split("\n").length} lines`];
});
await check("ui", "screenshot save_path", async () => {
  const f = path.join(os.tmpdir(), `smoke-shot-${Date.now()}.jpg`);
  const r = await call("ui", { action: "screenshot", target: PHONE, save_path: f });
  return [!r.isError && fs.existsSync(f), err(r) || `${r.data.bytes} bytes`];
});
await check("ui", "tree / windows / all_windows", async () => {
  const t = await call("ui", { action: "tree", target: PHONE, limit: 50 });
  const w = await call("ui", { action: "windows", target: PHONE });
  const a = await call("ui", { action: "tree", target: PHONE, all_windows: true, limit: 50 });
  return [!t.isError && !w.isError && !a.isError, `nodes=${t.data.nodes} windows=${w.data.windows?.length} all=${a.data.nodes}`];
});
await check("ui", "find + act (verify_change) + assert on LingDong", async () => {
  await call("run", { action: "launch", project: MULTI, target: PHONE }); // bring LingDong to the front
  await new Promise((r) => setTimeout(r, 2000));
  const f = await call("ui", { action: "find", target: PHONE, selector: { clickable: true, bundle: MULTI_BUNDLE } });
  const el = f.data.matches?.find((m) => m.bounds && m.bounds[1] > 300 && m.bounds[3] < 2600);
  if (!el) return [false, `no clickable element (${f.data.count})`];
  const a = await call("ui", { action: "act", target: PHONE, op: "click", x: Math.round((el.bounds[0] + el.bounds[2]) / 2), y: Math.round((el.bounds[1] + el.bounds[3]) / 2), verify_change: true });
  // No blind "back": if the tap opened nothing, back would leave the app. Assert the app is still in front.
  const as = await call("ui", { action: "assert", target: PHONE, visible: { bundle: MULTI_BUNDLE }, timeout_ms: 5000 });
  await call("run", { action: "launch", project: MULTI, target: PHONE }); // reset to the home page
  return [!a.isError && as.data.passed, `clicked ${el.type} "${el.text ?? el.key ?? ""}" changed=${a.data.changed}`];
});
await check("ui", "swipe / scroll / key chord / mouse move", async () => {
  const s = await call("ui", { action: "act", target: PHONE, op: "scroll", direction: "up" });
  const k = await call("ui", { action: "act", target: PHONE, op: "key", keys: ["ctrl", "a"] });
  const m = await call("ui", { action: "act", target: PHONE, op: "mouse_move", x: 600, y: 1200 });
  return [!s.isError && !k.isError && !m.isError, err(s) || err(k) || err(m)];
});
await check("ui", "double/long click, drag, fling, mouse ops on LingDong (app stays in front)", async () => {
  await call("run", { action: "launch", project: MULTI, target: PHONE });
  await new Promise((r) => setTimeout(r, 1500));
  const ops = [
    { op: "double_click", x: 660, y: 1400 }, { op: "long_click", x: 660, y: 1400 },
    { op: "drag", x: 660, y: 1800, x2: 660, y2: 1200 }, { op: "fling", x: 660, y: 1200, x2: 660, y2: 1900 },
    { op: "mouse_click", x: 660, y: 1400 }, { op: "mouse_double_click", x: 660, y: 1400 }, { op: "mouse_long_click", x: 660, y: 1400 },
    { op: "mouse_scroll", x: 660, y: 1400, direction: "down", ticks: 3 }, { op: "mouse_drag", x: 660, y: 1800, x2: 660, y2: 1300 },
  ];
  const failed = [];
  for (const o of ops) {
    const r = await call("ui", { action: "act", target: PHONE, ...o });
    if (r.isError) failed.push(`${o.op}: ${err(r)}`);
    // A long press may open a menu or a page; bring LingDong back to a known state between ops.
    await call("run", { action: "launch", project: MULTI, target: PHONE });
  }
  const as = await call("ui", { action: "assert", target: PHONE, visible: { bundle: MULTI_BUNDLE }, timeout_ms: 5000 });
  return [!failed.length && as.data.passed, failed.join("; ") || `${ops.length} ops ok`];
});
await check("ui", "screen recording start/status/stop", async () => {
  const st = await call("ui", { action: "record_start", target: PHONE });
  await new Promise((r) => setTimeout(r, 3000));
  const s = await call("ui", { action: "record_status", target: PHONE });
  const sp = await call("ui", { action: "record_stop", target: PHONE });
  return [!st.isError && s.data.status === "recording" && !sp.isError, err(st) || err(sp) || `${sp.data.seconds}s ${sp.data.bytes} bytes`];
});
await check("ui", "test session start/step/review/finish/log/export", async () => {
  const s = await call("ui", { action: "test_start", target: PHONE, project: MULTI, fresh_start: true, plan: "1. 打开应用\n2. 首页正常显示" });
  if (s.isError) return [false, err(s)];
  const id = s.data.test_id;
  const st = await call("ui", { action: "test_step", target: PHONE, test_id: id, description: "应用在前台", visible: { bundle: MULTI_BUNDLE } });
  const rv = await call("ui", { action: "review", target: PHONE, test_id: id, requirement: "首页内容已加载" });
  await call("ui", { action: "review", target: PHONE, test_id: id, outcome: "passed", reason: "smoke" });
  const fin = await call("ui", { action: "test_finish", test_id: id });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-uitest-"));
  const ex = await call("ui", { action: "test_export", test_id: id, directory: dir });
  const lg = await call("ui", { action: "test_log", test_id: id, max_chars: 300 });
  return [st.data.passed && rv.content.some((x) => x.type === "image") && fin.data.status === "passed" && !ex.isError && !lg.isError,
    `step=${st.data.passed} status=${fin.data.status} exported=${ex.data.exported}`];
});

/* ---------------------------------- ui_flow -------------------------------- */
await check("ui_flow", "record/stop/list/show/replay/delete (flows dir in a copy)", async () => {
  const copy = copyProject(MULTI);
  const rec = await call("ui_flow", { action: "record", project: copy, target: PHONE, id: "smoke" });
  await call("ui", { action: "act", target: PHONE, op: "key", key: "back" });
  const stop = await call("ui_flow", { action: "stop", project: copy, target: PHONE, assert: { hidden: { text: "__never__" } } });
  const list = await call("ui_flow", { action: "list", project: copy });
  const show = await call("ui_flow", { action: "show", project: copy, id: "smoke" });
  const del = await call("ui_flow", { action: "delete", project: copy, id: "smoke" });
  return [!rec.isError && !stop.isError && list.data.flows?.length >= 1 && !show.isError && !del.isError, err(rec) || err(stop) || err(show) || "ok"];
});

/* --------------------------------- diagnose -------------------------------- */
await check("diagnose", "crash (device faultlog, 7 days)", async () => {
  const r = await call("diagnose", { action: "crash", target: PHONE, since_minutes: 10080, latest: 1 });
  return [!r.isError || r.data.error?.code === "NOT_FOUND", r.isError ? r.data.error.message : `${r.data.reports[0].type} ${r.data.reports[0].kind} candidates=${r.data.reports[0].candidates.length}`];
});
await check("diagnose", "build hints", async () => {
  const r = await call("diagnose", { action: "build", diagnostics: [{ code: "10505001", message: "Property 'x' does not exist" }] });
  return [!r.isError, `${r.data.hints?.length} hints`];
});

/* --------------------------------- knowledge ------------------------------- */
await check("knowledge", "search / read / catalog / status", async () => {
  const s = await call("knowledge", { action: "search", query: "Navigation 路由 跳转", limit: 3 });
  const rd = s.data.results?.[0] ? await call("knowledge", { action: "read", id: s.data.results[0].id }) : { isError: true };
  const ct = await call("knowledge", { action: "catalog" });
  const st = await call("knowledge", { action: "status" });
  return [s.data.results?.length > 0 && !rd.isError && !ct.isError && st.data.installed, `top: ${s.data.results?.[0]?.title}`];
});

/* ---------------------------------- skills --------------------------------- */
await check("skills", "list / read reference / export to temp path", async () => {
  const l = await call("skills", { action: "list" });
  const r = await call("skills", { action: "read", name: "hmos-arkui-develop-skill", reference: "quick-apis/_index.md" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-skills-"));
  const e = await call("skills", { action: "export", path: dir });
  return [l.data.skills.length === 3 && !r.isError && e.data.exported?.length === 3, err(r) || err(e) || `${l.data.skills.map((s) => s.name)}`];
});
await check("skills", "market install/uninstall + init + install_mcp (temp dirs only)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-skills-mkt-"));
  const name = (await call("skills", { action: "search", query: "arkui", limit: 1 })).data.skills?.[0]?.name;
  const i = await call("skills", { action: "install", name, path: dir });
  const u = await call("skills", { action: "uninstall", name, path: dir });
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-host-"));
  const init = await call("skills", { action: "init", host: "codex", scope: "project", project: proj });
  const again = await call("skills", { action: "install_mcp", host: "codex", scope: "project", project: proj });
  return [!i.isError && fs.existsSync(path.join(dir, name ?? "x")) === false && !u.isError && init.data.skills?.exported?.length === 3 && init.data.mcp?.written && again.data.written === false,
    err(i) || err(u) || err(init) || `${name}; init exported ${init.data.skills?.exported?.length}`];
});
await check("skills", "market search", async () => {
  const r = await call("skills", { action: "search", query: "harmony", limit: 3 });
  return [!r.isError, err(r) || `${r.data.total ?? r.data.skills?.length} results`];
});

/* ---------------------------------- emulator ------------------------------- */
await check("emulator", "list / images / license_view", async () => {
  const l = await call("emulator", { action: "list" });
  const i = await call("emulator", { action: "images", device_type: "phone" });
  const v = await call("emulator", { action: "license_view" });
  return [!l.isError && !i.isError && !v.isError, `${l.data.emulators?.length} emulators`];
});
if (EMU) {
  await check("emulator", "scenario battery/sensor on running emulator", async () => {
    const name = (await call("emulator", { action: "list" })).data.emulators.find((e) => e.running)?.name;
    if (!name) return [false, "no running emulator"];
    const b = await call("emulator", { action: "scenario", name, scenario: "battery", level: 80, battery_status: "charging" });
    const s = await call("emulator", { action: "scenario", name, scenario: "sensor", light: 500, steps: 1000 });
    return [!b.isError && !s.isError, err(b) || err(s) || name];
  });
}

await check("emulator", "list details / images all (read-only)", async () => {
  const l = await call("emulator", { action: "list", details: true });
  const i = await call("emulator", { action: "images", all: true });
  return [!l.isError && !i.isError && /deviceType/.test(i.data.output), err(l) || err(i) || `${l.data.emulators?.length} emulators`];
});

/* --------------------------------- hot reload ------------------------------ */
await check("hot_reload", "baseline + apply + reset on a copy (project signing)", async () => {
  const copy = copyProject(SINGLE);
  const page = path.join(copy, PAGE);
  const src = fs.readFileSync(page, "utf8");
  fs.writeFileSync(page, src.replace(/  aboutToAppear\(\)( ?: ?void)? \{/, (m) => `${m}\n    console.info('SMOKE_HR_A');`));
  const b = await wait(await call("run", { action: "build_run", project: copy, target: PHONE, hot_reload: true, wait: 60000 }));
  if (b.data.status !== "succeeded") return [false, `baseline ${b.data.error?.message}`];
  fs.writeFileSync(page, src.replace(/  aboutToAppear\(\)( ?: ?void)? \{/, (m) => `${m}\n    console.info('SMOKE_HR_B');`));
  const a = await call("hot_reload", { action: "apply", project: copy, target: PHONE, restart: true });
  await new Promise((r) => setTimeout(r, 2500));
  const log = await call("device", { action: "log", target: PHONE, bundle: SINGLE_BUNDLE, grep: "SMOKE_HR_B", lines: 3000 });
  const rs = await call("hot_reload", { action: "reset", project: copy, target: PHONE });
  await wait(await call("run", { action: "deploy", project: SINGLE, target: PHONE, wait: 60000 })); // back to the real app
  return [!a.isError && log.data.lines >= 1 && !rs.isError, err(a) || `patched code ran: ${log.data.lines >= 1}`];
});

await check("hot_reload", "stop_daemon (copy)", async () => {
  const r = await call("hot_reload", { action: "stop_daemon", project: copyProject(SINGLE) });
  return [!r.isError && r.data.stopped, err(r) || r.data.output];
});

/* ------------------------------- auth + sign + cloud ----------------------- */
await check("auth", "status (both providers)", async () => {
  const d = await call("auth", { action: "status", provider: "developer" });
  const g = await call("auth", { action: "status", provider: "codegenie" });
  return [d.data.logged_in && g.data.logged_in, `developer=${d.data.logged_in}(${d.data.user ?? ""}) codegenie=${g.data.logged_in}`];
});
await check("auth", "teams", async () => { const r = await call("auth", { action: "teams" }); return [!r.isError, err(r) || `${r.data.teams?.length} teams`]; });
await check("knowledge", "cloud search (CodeGenie)", async () => {
  const r = await call("knowledge", { action: "search", query: "ArkUI List 懒加载 LazyForEach", source: "cloud", limit: 3 });
  return [!r.isError && (r.data.content?.length ?? 0) > 100, err(r) || `${r.data.content?.length} chars: ${r.data.content?.slice(0, 60)}`];
});
await check("sign", "certificates / devices (AGC, read-only)", async () => {
  const cs = await call("sign", { action: "certificates" });
  const ds = await call("sign", { action: "devices" });
  return [!cs.isError && !ds.isError, err(cs) || err(ds) || `${cs.data.certificates?.length} certs, ${ds.data.devices?.length} devices`];
});
await check("sign", "auto refuses on configured projects (no change)", async () => {
  const a = await wait(await call("sign", { action: "auto", project: MULTI }));
  const b = await wait(await call("sign", { action: "auto", project: SINGLE }));
  return [a.data.error?.code === "SIGN_CONFIGURED" && b.data.error?.code === "SIGN_CONFIGURED", `${a.data.error?.code} / ${b.data.error?.code}`];
});
await check("sign", "verify installed package signature", async () => {
  const hap = path.join(MULTI, "products/default/build/default/outputs/default/default-default-signed.hap");
  const r = await call("sign", { action: "verify", file: hap });
  const unsigned = await call("sign", { action: "verify", file: hap.replace("-signed.hap", "-unsigned.hap") });
  return [!r.isError && r.data.verified && r.data.profile?.bundle === MULTI_BUNDLE && unsigned.data.verified === false, err(r) || JSON.stringify(r.data.profile).slice(0, 180)];
});
await check("sign", "keypair + csr (temp files only)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-sign-"));
  const k = await call("sign", { action: "keypair", out: path.join(dir, "k.p12"), keystore_password: "Smoke123!" });
  const c2 = await call("sign", { action: "csr", keystore: path.join(dir, "k.p12"), keystore_password: "Smoke123!", out: path.join(dir, "k.csr") });
  return [!k.isError && !c2.isError, err(k) || err(c2)];
});

/* ----------------------------------- report -------------------------------- */
await c.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
const report = arg("--report");
if (report) {
  const md = ["| 区域 | 检查项 | 结果 | 耗时 | 说明 |", "| --- | --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.area} | ${r.name} | ${r.ok ? "PASS" : "FAIL"} | ${(r.ms / 1000).toFixed(1)}s | ${r.note.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(report, md + "\n");
}
process.exitCode = passed === results.length ? 0 : 1;
