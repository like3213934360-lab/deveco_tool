// POSIX process faults against this run's MCP/SDK children; never select another user's process.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { session } from "../support/acceptance.mjs";
import { connect, waitJob } from "../support/mcp.mjs";

function descendants(pid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).trim().split("\n").map((line) => {
    const [id, parent, ...command] = line.trim().split(/\s+/); return { pid: Number(id), ppid: Number(parent), command: command.join(" ") };
  });
  const ids = new Set([pid]);
  for (let size = 0; size !== ids.size;) { size = ids.size; for (const row of rows) if (ids.has(row.ppid)) ids.add(row.pid); }
  return rows.filter((row) => row.pid !== pid && ids.has(row.pid));
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

test("SDK children recover after process death and shut down cleanly", async (t) => {
  assert.notEqual(process.platform, "win32", "This process-fault suite requires POSIX ps");
  const { directory, receipt, defer } = await session(t);
  const state = path.join(directory, "state"), project = path.join(directory, "Process");
  let client, sequence = 0;
  const open = async () => {
    const c = connect({ DEVECO_STATE_DIR: state }); defer(() => c.close());
    receipt(`initialize-${sequence++}.json`, await c.initialize()); return c;
  };
  const raw = async (tool, args) => {
    const response = await client.call(tool, args);
    receipt(`call-${sequence++}.json`, { tool, args, ...response }); return response;
  };
  const call = async (tool, args) => {
    const response = await raw(tool, args); assert.equal(response.isError, false, JSON.stringify(response.data)); return response.data;
  };
  client = await open();
  await call("project", { action: "create", project, app_name: "Process", bundle_name: "com.devecomcp.process" });
  const started = await call("project", { action: "build", project, preflight: false, clean: true, wait: 0 });
  let children = [];
  for (let i = 0; i < 40; i++) {
    children = descendants(client.child.pid);
    if (children.some((p) => /hvigor/.test(p.command))) break;
    await delay(250);
  }
  assert.ok(children.some((p) => /hvigor/.test(p.command)), "Kill must occur during a real build");
  client.child.kill("SIGKILL"); await client.close(); await delay(3000);
  const orphans = children.filter((p) => alive(p.pid) && !/hvigor.*daemon/i.test(p.command));
  receipt("killed.json", { children, orphans });
  // Even a failed assertion must not leave owned children running.
  defer(() => { for (const p of orphans) if (alive(p.pid)) process.kill(p.pid, "SIGKILL"); });
  assert.equal(orphans.length, 0);
  client = await open();
  assert.equal((await call("job", { action: "status", job_id: started.job_id })).status, "interrupted");
  const resumed = await call("job", { action: "resume", job_id: started.job_id });
  assert.equal(resumed.status, "running"); assert.equal(resumed.next.action, "wait");
  assert.equal((await raw("job", { action: "resume", job_id: started.job_id })).isError, true);
  assert.equal((await waitJob(call, resumed)).status, "succeeded");
  const file = "entry/src/main/ets/pages/Index.ets";
  await call("code", { action: "check", project, files: [file] });
  await call("code", { action: "lsp", project, op: "symbols", file });
  children = descendants(client.child.pid);
  for (const pattern of [/resources\/vendor\/arkts/, /ace-server/]) {
    const process = children.find((p) => pattern.test(p.command)); assert.ok(process, `${pattern} must actually be running`);
    globalThis.process.kill(process.pid, "SIGKILL");
  }
  await delay(1000);
  assert.equal((await call("code", { action: "check", project, files: [file] })).errors, 0);
  assert.ok((await call("code", { action: "lsp", project, op: "symbols", file })).symbols.length);
  children = descendants(client.child.pid);
  await client.close(); await delay(2000);
  const left = children.filter((p) => alive(p.pid) && !/hvigor.*daemon/i.test(p.command));
  receipt("shutdown.json", { children, left }); assert.equal(left.length, 0);
});
