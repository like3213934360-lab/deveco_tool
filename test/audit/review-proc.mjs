// Review 1.3 (C): process faults - MCP killed mid-build, checker/LSP killed, no orphan processes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-proc-"));
const state = path.join(tmp, "state");
const ev = (n, d) => evidence("review-1.3", n, d);
const open = async () => { const c = connect({ DEVECO_STATE_DIR: state }); await c.initialize(); return c; };
const descendants = (pid) => {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="]).toString().trim().split("\n").map((l) => {
    const [p, pp, ...cmd] = l.trim().split(/\s+/);
    return { pid: Number(p), ppid: Number(pp), cmd: cmd.join(" ").slice(0, 160) };
  });
  const kids = new Set([pid]); let grew = true;
  while (grew) { grew = false; for (const r of rows) if (kids.has(r.ppid) && !kids.has(r.pid)) { kids.add(r.pid); grew = true; } }
  kids.delete(pid);
  return rows.filter((r) => kids.has(r.pid)).map(({ pid: p, cmd }) => ({ pid: p, cmd }));
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const out = {};
try {
  let c = await open();
  const proj = path.join(tmp, "Proc");
  await c.call("project", { action: "create", project: proj, app_name: "Proc", bundle_name: "com.devecomcp.proc" });

  // 1. Kill the MCP server (SIGKILL) during a build: job becomes interrupted and resumable; no orphans keep running.
  const started = (await c.call("project", { action: "build", project: proj, preflight: false, clean: true, wait: 0 })).data;
  // Kill while hvigor is still running (poll until the build step started and a child exists).
  for (let i = 0; i < 40 && !descendants(c.child.pid).some((k) => /hvigor/.test(k.cmd)); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 1000));
  const kids = descendants(c.child.pid);
  c.child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 3000));
  const orphans = kids.filter((k) => alive(k.pid) && !/hvigor.*daemon/i.test(k.cmd));
  c = await open();
  const after = (await c.call("job", { action: "status", job_id: started.job_id })).data;
  const resumed = await c.call("job", { action: "resume", job_id: started.job_id });
  let fin = resumed.data;
  while (fin.status === "running") fin = (await c.call("job", { action: "wait", job_id: started.job_id, wait: 55000 })).data;
  out.kill = { kids, orphans, status_after_restart: after.status, resumed: resumed.isError ? resumed.data : resumed.data.status, final: fin.status };
  record("F.proc.kill-mcp-mid-build", after.status === "interrupted" && fin.status === "succeeded" ? "VERIFIED" : "DEFECT",
    `SIGKILL of the server while hvigor was running (${kids.filter((k) => /hvigor/.test(k.cmd)).length} hvigor processes): after restart the job is ${after.status}; resume -> ${fin.status}`, [ev("proc-kill.json", out.kill)]);
  record("F.proc.orphans-after-sigkill", orphans.length === 0 ? "VERIFIED" : "DEFECT",
    `children of the SIGKILLed server still alive 3 s later (hvigor daemon excluded): ${orphans.length ? orphans.map((o) => o.cmd).join(" | ") : "none"}`, [ev("proc-kill.json", out.kill)], orphans.length ? { severity: "medium", dimension: "reliability" } : {});
  for (const o of orphans) { try { process.kill(o.pid, "SIGKILL"); } catch { /* gone */ } }

  // 2. Kill the ArkTS checker daemon and the LSP: next call recovers transparently.
  const idx = "entry/src/main/ets/pages/Index.ets";
  await c.call("code", { action: "check", project: proj, files: [idx] });
  await c.call("code", { action: "lsp", project: proj, op: "symbols", file: idx });
  const procs = descendants(c.child.pid);
  // Verified command lines: checker = node ... resources/vendor/arkts...; LSP = node ... plugins/openharmony/ace-server/...
  const checker = procs.find((p) => /resources\/vendor\/arkts/.test(p.cmd));
  const lsp = procs.find((p) => /ace-server/.test(p.cmd));
  if (checker) process.kill(checker.pid, "SIGKILL");
  if (lsp) process.kill(lsp.pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 1000));
  const chk = await c.call("code", { action: "check", project: proj, files: [idx] });
  const sym = await c.call("code", { action: "lsp", project: proj, op: "symbols", file: idx });
  out.recover = { checker: checker?.cmd, lsp: lsp?.cmd, check: chk.isError ? chk.data : { errors: chk.data.errors }, lsp_after: sym.isError ? sym.data : "ok" };
  record("F.proc.checker-lsp-recover", checker && lsp && !chk.isError && !sym.isError ? "VERIFIED" : checker && lsp ? "DEFECT" : "UNVERIFIED",
    `killed checker (${checker ? "found" : "not found"}) and LSP (${lsp ? "found" : "not found"}); next check ${chk.isError ? chk.data.error?.code : "ok"}, next lsp ${sym.isError ? sym.data.error?.code : "ok"}`, [ev("proc-recover.json", out.recover)]);

  // 3. Clean shutdown leaves no children.
  const before = descendants(c.child.pid);
  const pid = c.child.pid;
  await c.close();
  await new Promise((r) => setTimeout(r, 2000));
  const left = before.filter((p) => alive(p.pid) && !/hvigor.*daemon/i.test(p.cmd));
  record("F.proc.clean-shutdown", left.length === 0 ? "VERIFIED" : "DEFECT", `server ${pid} closed with ${before.length} children: ${left.length} left running ${left.map((l) => l.cmd).join(" | ")}`, [ev("proc-shutdown.json", { before, left })]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
