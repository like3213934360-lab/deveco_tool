// Orphaned job: SIGKILL the server mid-build; a new server must report interrupted; resume + wait must finish.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-orphan-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "audit-orphan-state-"));
const a = connect({ DEVECO_STATE_DIR: state }); await a.initialize();
const P = path.join(tmp, "O");
await a.call("project", { action: "create", project: P, app_name: "O", bundle_name: "com.devecomcp.orphan" });
const j = (await a.call("project", { action: "build", project: P, clean: true, wait: 0 })).data;
await new Promise((r) => setTimeout(r, 1500));
a.child.kill("SIGKILL");
await new Promise((r) => setTimeout(r, 500));
const b = connect({ DEVECO_STATE_DIR: state }); await b.initialize();
const s1 = (await b.call("job", { action: "status", job_id: j.job_id })).data;
const r = (await b.call("job", { action: "resume", job_id: j.job_id })).data;
const again = (await b.call("job", { action: "resume", job_id: j.job_id })).data; // what an agent does when told next=resume
let s2 = (await b.call("job", { action: "wait", job_id: j.job_id, wait: 60000 })).data;
while (s2.status === "running" || s2.status === "queued") s2 = (await b.call("job", { action: "wait", job_id: j.job_id, wait: 60000 })).data;
await b.close();
const detail = (await (async () => { const x = connect({ DEVECO_STATE_DIR: state }); await x.initialize(); const d = (await x.call("job", { action: "status", job_id: j.job_id, detail: true })).data; await x.close(); return d; })());
const ev = evidence("claims", "job-orphan.json", { after_kill: s1.status, resume_returned: r, final: s2, detail });
record("C.job-orphan-resume", s1.status === "interrupted" && s2.status === "succeeded" ? "VERIFIED" : "DEFECT", `server SIGKILLed mid-build: new server reads ${s1.status}; resume -> then wait: ${s2.status}`, [ev]);
record("B.action.job.resume.stale-status", r.status === "running" && r.next?.action === "wait" ? "VERIFIED" : "DEFECT", `resume response: status=${r.status}, next=${JSON.stringify(r.next)}; a second resume right after returns ${again.error?.code ?? again.status}`, [ev]);
fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true });
