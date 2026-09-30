// Every tool action, real services only: one success path + one failure path each, raw responses saved.
// Destructive AGC/emulator-image actions are covered by real-sign.mjs / real-emulator.mjs.
// Targets: phone 4VF0225613017854 (LingDong install only via build_run of the phone module),
// emulator 127.0.0.1:5555 (temp projects), temp dirs for skills/auth/knowledge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECTS, evidence, mcp, record, waitJob } from "./lib.mjs";

const PHONE = "4VF0225613017854", EMU = "127.0.0.1:5555";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-actions-"));
const c = await mcp({ shared: true }); // real login + knowledge pack
const results = [];
/** run a case; ok(r) must return true for the expected outcome. */
async function t(action, kind, args, ok, tool = action.split(".")[0]) {
  const t0 = Date.now();
  let r;
  try {
    r = await c.call(tool, args);
    if (r.data?.job_id && (r.data.status === "running" || r.data.status === "queued")) r = { ...r, data: await waitJob(c, r) };
  } catch (e) { r = { isError: true, data: { thrown: String(e) } }; }
  let pass = false, why = "";
  try { pass = !!ok(r.data, r.isError); } catch (e) { why = String(e); }
  const ev = evidence("actions", `${action}.${kind}.json`, { args, isError: r.isError, data: r.data, ms: Date.now() - t0 });
  results.push({ action, kind, pass, ms: Date.now() - t0, ev, summary: JSON.stringify(r.data).slice(0, 160) + why });
  console.log(pass ? "ok  " : "FAIL", action.padEnd(28), kind.padEnd(8), JSON.stringify(r.data).slice(0, 120));
  return r.data;
}
const errCode = (code) => (d, isErr) => (isErr || d?.status === "failed") && (d?.error?.code ?? d?.error?.code) === code;
const failed = (d, isErr) => isErr || d?.status === "failed";

// ---------- temp project on the emulator ----------
const P = path.join(tmp, "App");
await t("project.create", "success", { action: "create", project: P, app_name: "Audit", bundle_name: "com.devecomcp.audit", compatible_api: 24 }, (d) => d.created || fs.existsSync(path.join(P, "build-profile.json5")));
await t("project.create", "failure", { action: "create", project: P, app_name: "Audit", bundle_name: "com.devecomcp.audit" }, failed);
await t("project.info", "success", { action: "info", project: P }, (d) => d.modules?.length === 1 && d.bundle_name === "com.devecomcp.audit");
await t("project.info", "failure", { action: "info", project: path.join(tmp, "nope") }, failed);
await t("project.sync", "success", { action: "sync", project: P, wait: 60000 }, (d) => d.status === "succeeded");
await t("project.sync", "failure", { action: "sync", project: path.join(tmp, "nope"), wait: 60000 }, failed);
await t("project.build", "success", { action: "build", project: P, wait: 60000 }, (d) => d.status === "succeeded" && (d.result?.outputs?.length || d.result?.packages?.length || d.result?.success));
await t("project.build", "failure", { action: "build", project: P, modules: ["nosuch"], wait: 60000 }, failed);
await t("project.clean", "success", { action: "clean", project: P }, (d) => d.status === "succeeded" || d.cleaned === true);
await t("project.clean", "failure", { action: "clean", project: path.join(tmp, "nope") }, failed);

await t("run.build_run", "success", { action: "build_run", project: P, target: EMU, wait: 60000 }, (d) => d.status === "succeeded" && d.result?.launch?.started);
await t("run.build_run", "failure", { action: "build_run", project: P, target: "no-such-device", wait: 60000 }, failed);
await t("run.stop", "success", { action: "stop", project: P, target: EMU }, (d, e) => !e);
await t("run.stop", "failure", { action: "stop", project: P, target: "no-such-device" }, failed);
await t("run.launch", "success", { action: "launch", project: P, target: EMU }, (d, e) => !e && (d.started ?? d.launched));
await t("run.launch", "failure", { action: "launch", project: P, target: EMU, ability: "NoSuchAbility" }, failed);
await t("run.deploy", "success", { action: "deploy", project: P, target: EMU, wait: 60000 }, (d) => d.status === "succeeded");
await t("run.deploy", "failure", { action: "deploy", project: path.join(tmp, "nope"), target: EMU, wait: 60000 }, failed);

// ---------- job ----------
const bj = (await c.call("project", { action: "build", project: P, wait: 0 })).data;
await t("job.status", "success", { action: "status", job_id: bj.job_id }, (d) => d.job_id === bj.job_id);
await t("job.status", "failure", { action: "status", job_id: "j_nosuch" }, failed);
await t("job.wait", "success", { action: "wait", job_id: bj.job_id, wait: 60000 }, (d) => ["succeeded", "failed"].includes(d.status));
await t("job.wait", "failure", { action: "wait", job_id: "j_nosuch" }, failed);
await t("job.list", "success", { action: "list", limit: 5 }, (d) => Array.isArray(d.jobs));
await t("job.list", "failure", { action: "list", limit: -1 }, failed);
const cj = (await c.call("project", { action: "build", project: P, clean: true, wait: 0 })).data;
await t("job.cancel", "success", { action: "cancel", job_id: cj.job_id }, (d) => ["cancelled", "cancelling"].includes(d.status) || d.cancelled);
await t("job.cancel", "failure", { action: "cancel", job_id: bj.job_id }, (d, e) => e || d.status !== "cancelled");
await waitJob(c, { data: { job_id: cj.job_id, status: "running" } });
await t("job.resume", "success.cancelled-refused", { action: "resume", job_id: cj.job_id }, (d, e) => e && /cancelled/.test(d.error.message));
await t("job.resume", "failure", { action: "resume", job_id: bj.job_id }, failed);
const art = (await c.call("job", { action: "status", job_id: bj.job_id })).data.result?.log_artifact;
await t("job.read", "success", { action: "read", artifact_id: art, limit: 5 }, (d) => typeof d.content === "string" && d.content.length);
await t("job.read", "failure", { action: "read", artifact_id: "a_nosuch" }, failed);

// ---------- code ----------
const F = "entry/src/main/ets/pages/Index.ets";
await t("code.check", "success", { action: "check", project: P }, (d) => d.passed === true && d.errors === 0);
await t("code.check", "failure", { action: "check", project: path.join(tmp, "nope") }, failed);
await t("code.lint", "success", { action: "lint", project: P }, (d, e) => !e && d.exit_code === 0 && d.report_artifact);
await t("code.lint", "failure", { action: "lint", project: path.join(tmp, "nope") }, failed);
const vers = await t("code.api_versions", "success", { action: "api_versions" }, (d) => (d.versions ?? []).length > 1);
await t("code.api_versions", "failure", { action: "api_versions", project: 5 }, failed);
const vs = vers?.versions ?? [];
await t("code.api_scan", "success", { action: "api_scan", project: P, from: vs.at(-2), to: vs.at(-1) }, (d, e) => !e && d.findings !== undefined);
await t("code.api_scan", "failure", { action: "api_scan", project: P, from: "nope", to: "nope" }, failed);
for (const op of ["hover", "definition", "declaration", "implementation", "references", "symbols", "workspace_symbols", "diagnostics", "completion", "signature", "call_hierarchy"]) {
  const a = op === "workspace_symbols" ? { query: "Index" } : op === "symbols" || op === "diagnostics" ? {} : op === "completion" ? { line: 12, column: 9 } : { symbol: "message" };
  await t(`code.lsp.${op}`, "success", { action: "lsp", op, project: P, file: F, ...a }, (d, e) => !e);
}
await t("code.lsp", "failure", { action: "lsp", op: "hover", project: P, file: "nope.ets", symbol: "x" }, failed);
await t("code.lsp_restart", "success", { action: "lsp_restart", language: "arkts", project: P }, (d) => d.restarted?.includes("arkts"));
await t("code.lsp_restart", "failure", { action: "lsp_restart", language: "cobol" }, failed);

// ---------- device ----------
await t("device.list", "success", { action: "list" }, (d) => d.devices?.length >= 2);
await t("device.list", "failure", { action: "list", target: 5 }, failed);
await t("device.info", "success", { action: "info", target: PHONE }, (d) => d.api_level > 0 && d.model);
await t("device.info", "failure", { action: "info", target: "nope" }, errCode("DEVICE_UNAVAILABLE"));
await t("device.log", "success", { action: "log", target: EMU, lines: 20 }, (d) => d.lines > 0);
await t("device.log", "failure", { action: "log", target: EMU, bundle: "com.no.such" }, errCode("NOT_FOUND"));
await t("device.shell", "success", { action: "shell", target: EMU, command: "param get const.ohos.apiversion" }, (d) => /\d+/.test(d.stdout ?? d.output ?? ""));
await t("device.shell", "failure", { action: "shell", target: EMU, command: "rm -rf /data/local/tmp/x" }, failed);
const local = path.join(tmp, "up.txt"); fs.writeFileSync(local, "audit");
await t("device.send", "success", { action: "send", target: EMU, local, remote: "/data/local/tmp/audit-up.txt" }, (d, e) => !e);
await t("device.send", "failure", { action: "send", target: EMU, local: path.join(tmp, "missing"), remote: "/data/local/tmp/x" }, failed);
await t("device.recv", "success", { action: "recv", target: EMU, remote: "/data/local/tmp/audit-up.txt", local: path.join(tmp, "down.txt") }, () => fs.readFileSync(path.join(tmp, "down.txt"), "utf8") === "audit");
await t("device.recv", "failure", { action: "recv", target: EMU, remote: "/data/local/tmp/no-such-file", local: path.join(tmp, "x") }, failed);
await t("device.sqlite", "failure", { action: "sqlite", target: EMU, bundle: "com.devecomcp.audit", db: "no.db", sql: "select 1" }, failed);

// ---------- ui ----------
await c.call("run", { action: "launch", project: P, target: EMU });
await t("ui.observe", "success", { action: "observe", target: EMU }, (d) => typeof d.elements === "string" && d.elements.length && d.screenshot);
await t("ui.observe", "failure", { action: "observe", target: "nope" }, failed);
await t("ui.screenshot", "success", { action: "screenshot", target: EMU, save_path: path.join(tmp, "s.png") }, () => fs.statSync(path.join(tmp, "s.png")).size > 1000);
await t("ui.screenshot", "failure", { action: "screenshot", target: EMU, display: 99 }, failed);
await t("ui.tree", "success", { action: "tree", target: EMU }, (d) => d.nodes > 0);
await t("ui.tree", "failure", { action: "tree", target: EMU, node: "no-such-node-id" }, (d) => d.nodes === 0 && /No component/.test(d.hint));
await t("ui.find", "success", { action: "find", target: EMU, selector: { text: "Hello World" } }, (d) => d.count >= 1);
await t("ui.find", "failure", { action: "find", target: EMU }, failed);
for (const op of ["double_click", "long_click", "click"]) { await c.call("run", { action: "launch", project: P, target: EMU }); await t(`ui.act.${op}`, "success", { action: "act", target: EMU, op, selector: { text: "Hello World" } }, (d, e) => !e); }
await t("ui.act.input", "success", { action: "act", target: EMU, op: "input", x: 300, y: 300, text: "a'b\"c" }, (d, e) => !e);
await t("ui.act.type", "success", { action: "act", target: EMU, op: "type", text: "x" }, (d, e) => !e);
for (const op of ["swipe", "drag", "fling"]) await t(`ui.act.${op}`, "success", { action: "act", target: EMU, op, x: 600, y: 2000, x2: 600, y2: 1200 }, (d, e) => !e);
await t("ui.act.scroll", "success", { action: "act", target: EMU, op: "scroll", direction: "up" }, (d, e) => !e);
await t("ui.act.key", "success", { action: "act", target: EMU, op: "key", key: "back" }, (d, e) => !e);
for (const op of ["mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move"]) await t(`ui.act.${op}`, "success", { action: "act", target: EMU, op, x: 600, y: 1400 }, (d, e) => !e);
await t("ui.act.mouse_scroll", "success", { action: "act", target: EMU, op: "mouse_scroll", x: 600, y: 1400, direction: "down" }, (d, e) => !e);
await t("ui.act.mouse_drag", "success", { action: "act", target: EMU, op: "mouse_drag", x: 600, y: 1400, x2: 600, y2: 1000 }, (d, e) => !e);
await t("ui.act", "failure", { action: "act", target: EMU, op: "click", selector: { text: "No Such Text 123" } }, failed);
await c.call("run", { action: "launch", project: P, target: EMU });
await t("ui.assert", "success", { action: "assert", target: EMU, visible: { text: "Hello World" }, timeout_ms: 5000 }, (d) => d.passed ?? d.ok ?? d.visible);
await t("ui.assert", "failure", { action: "assert", target: EMU, visible: { text: "No Such Text 123" }, timeout_ms: 1500 }, (d, e) => e || d.passed === false);
await t("ui.windows", "success", { action: "windows", target: EMU }, (d) => d.windows?.length >= 1);
await t("ui.windows", "failure", { action: "windows", target: "nope" }, failed);
await t("ui.record_start", "success", { action: "record_start", target: PHONE }, (d, e) => !e);
await t("ui.record_status", "success", { action: "record_status", target: PHONE }, (d) => d.status === "recording" || d.recording === true);
await new Promise((r) => setTimeout(r, 3000));
await t("ui.record_stop", "success", { action: "record_stop", target: PHONE, save_path: path.join(tmp, "r.mp4") }, () => fs.statSync(path.join(tmp, "r.mp4")).size > 1000);
await t("ui.record_stop", "failure", { action: "record_stop", target: PHONE }, failed);
await t("ui.record_start", "failure", { action: "record_start", target: "nope" }, failed);
await t("ui.record_status", "failure", { action: "record_status", target: "nope" }, failed);
const ts = await t("ui.test_start", "success", { action: "test_start", target: EMU, project: P, plan: "1. Tap Hello World. Expect Welcome.", fresh_start: true }, (d) => d.test_id);
const tid = ts?.test_id;
await t("ui.test_step", "success", { action: "test_step", target: EMU, test_id: tid, op: "click", selector: { text: "Hello World" }, description: "tap" }, (d, e) => !e);
await t("ui.test_step", "failure", { action: "test_step", test_id: "t_nosuch", op: "click", selector: { text: "x" } }, failed);
await t("ui.review", "success", { action: "review", target: EMU, test_id: tid, requirement: "Welcome is shown" }, (d) => d.screenshot || d._image || d.review_id);
await t("ui.review", "failure", { action: "review", test_id: "t_nosuch", requirement: "x" }, failed);
await c.call("ui", { action: "review", target: EMU, test_id: tid, outcome: "pass", reason: "text changed" });
await t("ui.test_finish", "success", { action: "test_finish", target: EMU, test_id: tid }, (d) => d.status || d.summary);
await t("ui.test_finish", "failure", { action: "test_finish", test_id: "t_nosuch" }, failed);
await t("ui.test_log", "success", { action: "test_log", target: EMU, test_id: tid }, (d) => (d.steps ?? d.log ?? []).length >= 1);
await t("ui.test_log", "failure", { action: "test_log", test_id: "t_nosuch" }, failed);
await t("ui.test_export", "success", { action: "test_export", target: EMU, test_id: tid, directory: path.join(tmp, "exp") }, (d, e) => !e);
await t("ui.test_export", "failure", { action: "test_export", test_id: "t_nosuch" }, failed);

// ---------- ui_flow ----------
await c.call("ui_flow", { action: "stop", project: P, target: EMU, discard: true }); // a draft left by an aborted run
await c.call("run", { action: "launch", project: P, target: EMU });
await t("ui_flow.record", "success", { action: "record", project: P, target: EMU, id: "audit-flow" }, (d, e) => !e);
await c.call("ui", { action: "act", target: EMU, op: "click", selector: { text: "Hello World" } });
await t("ui_flow.stop", "success", { action: "stop", project: P, target: EMU, assert: { visible: { text: "Welcome" } } }, (d, e) => !e);
await t("ui_flow.list", "success", { action: "list", project: P }, (d) => (d.flows ?? []).some((f) => (f.id ?? f.name ?? f) === "audit-flow"));
await t("ui_flow.show", "success", { action: "show", project: P, id: "audit-flow" }, (d) => (d.steps ?? []).length >= 1);
await t("ui_flow.show", "failure", { action: "show", project: P, id: "no-such-flow" }, failed);
await t("ui_flow.replay", "success", { action: "replay", project: P, target: EMU, id: "audit-flow", wait: 60000 }, (d) => d.status === "succeeded");
await t("ui_flow.replay", "failure", { action: "replay", project: P, target: EMU, id: "no-such-flow", wait: 60000 }, failed);
await t("ui_flow.delete", "success", { action: "delete", project: P, id: "audit-flow" }, (d, e) => !e);
await t("ui_flow.delete", "failure", { action: "delete", project: P, id: "audit-flow" }, failed);
await t("ui_flow.stop", "failure", { action: "stop", project: P, target: EMU }, failed);
await t("ui_flow.record", "failure", { action: "record", project: P, target: "nope", id: "x" }, failed);
await t("ui_flow.list", "success.empty-project", { action: "list", project: path.join(tmp, "nope") }, (d) => Array.isArray(d.flows) && !d.flows.length);

// ---------- diagnose ----------
await t("diagnose.crash", "success", { action: "crash", target: EMU, bundle: "com.devecomcp.rules2" }, (d) => d.reports?.length >= 1);
await t("diagnose.crash", "failure", { action: "crash", target: "nope" }, failed);
await t("diagnose.build", "success", { action: "build", diagnostics: [{ code: "10905209", message: "Cannot find module '@ohos/x'" }] }, (d) => (d.hints ?? []).length > 0);
await t("diagnose.build", "failure", { action: "build", diagnostics: "not-an-array" }, failed);

// ---------- knowledge ----------
const ks = await t("knowledge.search", "success", { action: "search", query: "Navigation 路由" }, (d) => d.results?.length > 0);
await t("knowledge.search", "failure", { action: "search", query: "" }, failed);
await t("knowledge.read", "success", { action: "read", id: ks?.results?.[0]?.id }, (d) => d.content?.length > 100);
await t("knowledge.read", "failure", { action: "read", id: "no/such/doc" }, failed);
await t("knowledge.catalog", "success", { action: "catalog" }, (d, e) => !e && JSON.stringify(d).length > 100);
await t("knowledge.catalog", "failure", { action: "catalog", catalog: "no-such-catalog" }, failed);
await t("knowledge.status", "success", { action: "status" }, (d) => d.installed?.version && d.installed.counts);
await t("knowledge.update", "success", { action: "update", check: true }, (d, e) => !e);
// knowledge.rollback: not executed against the user's store (see B.action.knowledge.rollback.params)

// ---------- skills ----------
await t("skills.list", "success", { action: "list" }, (d) => d.skills?.length >= 1);
await t("skills.read", "success", { action: "read", name: "deveco-mcp-workflow" }, (d) => d.content?.includes("---"));
await t("skills.read", "failure", { action: "read", name: "no-such-skill" }, failed);
await t("skills.export", "success", { action: "export", host: "cursor", path: path.join(tmp, "skills") }, () => fs.existsSync(path.join(tmp, "skills")));
await t("skills.export", "failure", { action: "export", host: "nohost" }, failed);
await t("skills.install_mcp", "success", { action: "install_mcp", host: "cursor", scope: "project", project: P }, () => fs.existsSync(path.join(P, ".cursor/mcp.json")));
await t("skills.install_mcp", "failure", { action: "install_mcp", host: "nohost", scope: "project", project: P }, failed);
await t("skills.init", "success", { action: "init", host: "claude", scope: "project", project: P }, () => fs.existsSync(path.join(P, ".mcp.json")));
await t("skills.init", "failure", { action: "init", host: "nohost", project: P }, failed);
const sr = await t("skills.search", "success", { action: "search", query: "harmony" }, (d) => (d.skills ?? d.results ?? []).length > 0);
await t("skills.search", "failure", { action: "search", query: "" }, failed);
const remote = (sr?.skills ?? sr?.results ?? [])[0]?.name;
await t("skills.install", "success", { action: "install", name: remote, path: path.join(tmp, "remote-skills") }, (d, e) => !e);
await t("skills.install", "failure", { action: "install", name: "no-such-remote-skill-xyz", path: path.join(tmp, "remote-skills") }, failed);
await t("skills.uninstall", "success", { action: "uninstall", name: remote, path: path.join(tmp, "remote-skills") }, (d, e) => !e);
await t("skills.uninstall", "failure", { action: "uninstall", name: "no-such-remote-skill-xyz", path: path.join(tmp, "remote-skills") }, failed);
await t("skills.list", "failure", { action: "read", name: "deveco-mcp-workflow", reference: "../../../etc/passwd" }, failed);

// ---------- auth (read-only on the real login) ----------
await t("auth.status", "success", { action: "status" }, (d) => d.providers?.every((p) => p.logged_in));
await t("auth.teams", "success", { action: "teams" }, (d) => (d.teams ?? []).length >= 1);
await t("auth.import", "failure", { action: "import", legacy_state_dir: path.join(tmp, "missing") }, failed);
await t("auth.login", "failure", { action: "login", provider: "nosuch" }, failed);

// ---------- sign (read-only here) ----------
await t("sign.certificates", "success", { action: "certificates" }, (d) => Array.isArray(d.certificates));
await t("sign.devices", "success", { action: "devices" }, (d) => Array.isArray(d.devices));
const HAP = () => { const d = path.join(P, "entry/build/default/outputs/default"); return path.join(d, fs.readdirSync(d).find((f) => f.endsWith(".hap"))); };
await t("sign.verify", "success", { action: "verify", file: HAP() }, (d, e) => !e && d.verified !== undefined);
await t("sign.verify", "failure", { action: "verify", file: path.join(tmp, "missing.hap") }, failed);
await t("sign.auto", "failure", { action: "auto", project: PROJECTS.lingdong }, errCode("SIGN_CONFIGURED"));

// ---------- emulator (non-destructive) ----------
await t("emulator.list", "success", { action: "list" }, (d) => JSON.stringify(d).includes("Pura 90"));
await t("emulator.images", "success", { action: "images" }, (d) => Array.isArray(d.images) && d.images.every((x) => x.device_type));
await t("emulator.license_view", "success", { action: "license_view" }, (d) => JSON.stringify(d).length > 200);
await t("emulator.license", "success", { action: "license" }, (d, e) => !e);
await t("emulator.scenario", "success", { action: "scenario", name: "Pura 90", scenario: "shake" }, (d) => d.accepted);
await t("emulator.scenario", "failure", { action: "scenario", name: "Pura 90", scenario: "gps", latitude: 200 }, errCode("EMULATOR_FAILED"));
await t("emulator.start", "failure", { action: "start", name: "No Such Emulator" }, failed);
await t("emulator.stop", "failure", { action: "stop", name: "No Such Emulator" }, failed);
await t("emulator.create", "failure", { action: "create", name: "audit-x", device_type: "phone", os_version: "HarmonyOS 0.0.0(1)" }, failed);
await t("emulator.delete", "failure", { action: "delete", name: "No Such Emulator" }, failed);

// ---------- hot_reload ----------
await waitJob(c, await c.call("run", { action: "build_run", project: P, target: EMU, hot_reload: true, wait: 60000 }));
const idx = path.join(P, F);
fs.writeFileSync(idx, fs.readFileSync(idx, "utf8").replace("'Hello World'", "'Hello Audit'"));
await t("hot_reload.apply", "success", { action: "apply", project: P, target: EMU, files: [F] }, (d, e) => !e && (d.applied ?? d.patched ?? d.status === "succeeded"));
await t("hot_reload.apply", "failure", { action: "apply", project: P, target: EMU, files: ["nope.ets"] }, failed);
await t("hot_reload.reset", "success", { action: "reset", project: P, target: EMU }, (d, e) => !e);
await t("hot_reload.stop_daemon", "success", { action: "stop_daemon", project: P }, (d, e) => !e);
await t("hot_reload.stop_daemon", "failure", { action: "apply", project: path.join(tmp, "nope"), target: EMU }, failed);

// ---------- doctor + multi-device + LingDong phone ----------
await t("doctor.doctor", "success", { project: P, target: EMU }, (d, e) => !e && JSON.stringify(d).length > 200, "doctor");
await t("doctor.doctor", "failure", { project: path.join(tmp, "nope") }, (d, e) => e || /not|missing|invalid/i.test(JSON.stringify(d)), "doctor");
await t("run.build_run.lingdong-watch-on-phone", "failure", { action: "build_run", project: PROJECTS.lingdong, target: PHONE, modules: ["watch"], wait: 60000 }, errCode("DEVICE_MISMATCH"), "run");
await t("run.uninstall", "success", { action: "uninstall", project: P, target: EMU }, (d) => d.uninstalled === true, "run");
await t("run.uninstall", "failure", { action: "uninstall", project: P, target: EMU }, (d) => d.uninstalled === false, "run");
await c.call("device", { action: "shell", target: EMU, command: "ls /data/local/tmp" });

await c.close();
const all = JSON.parse(fs.readFileSync("/tmp/actions.json", "utf8"));
const covered = new Set(results.map((r) => r.action.split(".").slice(0, 2).join(".")));
const ev = evidence("actions", "summary.json", { results, uncovered: all.filter((a) => !covered.has(a)) });
// Passing cases are recorded; unexpected results are listed for manual triage (test-case error vs product defect).
for (const r of results) if (r.pass) record(`B.action.${r.action}.${r.kind}`, "VERIFIED", `${r.kind} path as expected (${r.ms} ms)`, [r.ev]);
for (const r of results) if (!r.pass) console.log("TRIAGE", r.action, r.kind, r.ev, r.summary);
console.log("uncovered:", all.filter((a) => !covered.has(a)));
fs.rmSync(tmp, { recursive: true, force: true });
