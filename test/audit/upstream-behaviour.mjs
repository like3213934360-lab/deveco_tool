// Behavioural spot-checks of upstream `full` options whose semantics (not just presence) matter.
// Each check states the upstream behaviour (with source file) and records what ours actually does.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record, waitJob, PROJECTS } from "./lib.mjs";

const PHONE = "4VF0225613017854", EMU = "127.0.0.1:5555";
const c = await mcp();
const raw = {};
const call = async (key, tool, args) => { const r = await c.call(tool, args); raw[key] = r.data; return r; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ub-"));

// log --tail / lines
{ const r = await call("log.lines5", "device", { action: "log", target: PHONE, lines: 5 });
  record("A.upstream.log.tail", r.data.lines <= 5 ? "VERIFIED" : "DEFECT", `lines=5 -> ${r.data.lines} lines returned (upstream --tail N = latest N lines)`, [evidence("upstream", "log-lines.json", r.data)]); }
// log --keyword vs grep (upstream: hilog -e <keyword>, regex on device)
{ const r = await call("log.grep", "device", { action: "log", target: PHONE, lines: 2000, grep: "ability|Ability" });
  const bad = (r.data.tail ?? "").split("\n").filter((l) => l && !/ability/i.test(l));
  record("A.upstream.log.keyword", !bad.length ? "VERIFIED" : "DEFECT", `grep 'ability|Ability' over 2000 lines -> ${r.data.lines} matches, ${bad.length} non-matching lines (upstream --keyword uses hilog -e regex on device; ours filters locally, case-insensitive)`, [evidence("upstream", "log-grep.json", { lines: r.data.lines, bad: bad.slice(0, 5) })]); }
// log --crash (upstream: latest faultlog, filtered by bundle)
{ const r = await call("log.crash", "diagnose", { action: "crash", target: EMU, bundle: "com.devecomcp.rules2" });
  const k = r.isError ? r.data.error.code : r.data.reports?.[0]?.kind;
  record("A.upstream.log.crash", !r.isError && k ? "VERIFIED" : "UNVERIFIED", `crash for bundle with a known crash (rules pass-2 appstorage case): ${k} ${(r.data.reports?.[0]?.message ?? "").slice(0, 100)}`, [evidence("upstream", "log-crash.json", r.data)]); }
// ui screenshot --display
{ const r = await call("ui.shot.display", "ui", { action: "screenshot", target: PHONE, display: 0 });
  const r2 = await call("ui.shot.baddisplay", "ui", { action: "screenshot", target: PHONE, display: 99 });
  record("A.upstream.ui.screenshot-display", !r.isError && r2.isError ? "VERIFIED" : "DEFECT", `display=0 -> ${r.isError ? r.data.error.code : "ok"}; display=99 -> ${r2.isError ? `${r2.data.error.code}: ${r2.data.error.message.slice(0, 100)}` : "ok (no error for a non-existent display)"}`, [evidence("upstream", "ui-screenshot-display.json", { ok: r.isError ? r.data : { artifact: r.data.artifact_id }, bad: r2.data })]); }
// ui windows --all
{ const a = await call("ui.win", "ui", { action: "windows", target: PHONE });
  const b = await call("ui.win.all", "ui", { action: "windows", target: PHONE, all: true });
  const n = (x) => (x.data.windows ?? []).length;
  record("A.upstream.ui.window-all", n(b) > n(a) ? "VERIFIED" : "DEFECT", `windows: default ${n(a)}, all=true ${n(b)} (upstream --all adds system windows)`, [evidence("upstream", "ui-windows.json", { app: a.data, all: b.data })]); }
// ui text without target (upstream: `uitest uiInput text` into focused field)
{ const r = await call("ui.text.nofocus", "ui", { action: "act", target: EMU, op: "input", text: "abc" });
  record("A.upstream.ui.text-focused", !r.isError ? "VERIFIED" : "UNVERIFIED", `input text without selector/coordinates -> ${r.isError ? `${r.data.error.code}: ${r.data.error.message.slice(0, 120)}` : JSON.stringify(r.data).slice(0, 120)} (upstream: types into the focused field)`, [evidence("upstream", "ui-text-focused.json", r.data)]); }
// device view --target (upstream: device info)
// sqlite (upstream sqlite3 on device) - read-only guard
{ const r = await call("sqlite.write", "device", { action: "sqlite", target: PHONE, bundle: "com.huawei.hmos.settings", db: "x.db", sql: "DELETE FROM t" });
  record("A.upstream.device.sqlite-readonly", r.isError ? "VERIFIED" : "DEFECT", `write SQL without write=true -> ${r.isError ? r.data.error.code : "executed"}`, [evidence("upstream", "sqlite-readonly.json", r.data)]); }
// build --build-mode unknown (upstream: 'Build mode X not found. Available modes: ...')
{ const r = await call("build.badmode", "project", { action: "build", project: PROJECTS.e2e_acceptance, build_mode: "nosuchmode", preflight: false, wait: 60000 });
  const s = r.data.status === "running" ? await waitJob(c, r) : r.data;
  record("A.upstream.build.build-mode", s.status === "failed" && s.error?.code === "INVALID_INPUT" ? "VERIFIED" : "DEFECT", `build_mode=nosuchmode -> ${s.status} ${s.error?.code ?? ""} ${(s.error?.message ?? "").slice(0, 140)} (upstream validates against debug/release + buildModeSet before running hvigor)`, [evidence("upstream", "build-badmode.json", s)]); }
// create --api-level (upstream: compatible/target from api level)
{ const p = path.join(tmp, "api"); const r = await call("create.api", "project", { action: "create", project: p, app_name: "A", bundle_name: "com.devecomcp.api", compatible_api: 12 });
  const bp = fs.existsSync(path.join(p, "build-profile.json5")) ? fs.readFileSync(path.join(p, "build-profile.json5"), "utf8") : "";
  record("A.upstream.create.api-level", /compatibleSdkVersion["']?\s*:\s*["']5\.0\.0\(12\)/.test(bp) ? "VERIFIED" : "DEFECT", `compatible_api=12 -> ${/compatibleSdkVersion[^\n]*/.exec(bp)?.[0] ?? r.data?.error?.message}`, [evidence("upstream", "create-api.json", { result: r.data, profile: bp.slice(0, 800) })]); }
// emulator image list --all / --device-type
{ const r = await call("img.list", "emulator", { action: "images" });
  const r2 = await call("img.list.all", "emulator", { action: "images", all: true });
  record("A.upstream.emulator.image-list", !r.isError && !r2.isError ? "VERIFIED" : "DEFECT", `images: local ${(r.data.images ?? []).length}; all=true ${(r2.data.images ?? []).length} (upstream --all includes remote)`, [evidence("upstream", "emulator-images.json", { local: r.data, all: r2.data })]); }
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });
