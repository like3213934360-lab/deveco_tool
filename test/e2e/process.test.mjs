// POSIX process faults against this run's MCP/SDK children; never select another user's process.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { hashes, session, sha } from "../support/acceptance.mjs";
import { connect, waitJob } from "../support/mcp.mjs";

function processRows() {
  const output = execFileSync("ps", ["-axww", "-o", "pid=,ppid=,lstart=,command="], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 5000, maxBuffer: 8 * 1024 * 1024,
  });
  return output.trim().split("\n").map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
    assert.ok(match, `Cannot establish process identity: ${line}`);
    return { pid: Number(match[1]), ppid: Number(match[2]), started: match[3], command: match[4] };
  });
}
const sameIdentity = (saved, current) => !!current && current.pid === saved.pid && current.started === saved.started && current.command === saved.command;
// --daemon and --no-daemon belong to foreground clients, not daemon identity.
// These are the installed SDK's Node daemon boot entry and Java daemon JAR.
const sharedDaemon = ({ command }) =>
  /^(?:.*\/)?node(?:\s+--\S+)*\s+.+\/hvigor\/src\/base\/daemon\/process\/daemon-process-boot-script\.js(?:\s|$)/.test(command) ||
  /^(?:.*\/)?java(?:\s+-\S+)*\s+-jar\s+.+\/hvigor\/lib\/hvigor-java-daemon\.jar(?:\s|$)/.test(command);
function descendants(owner) {
  const rows = processRows();
  assert.ok(sameIdentity(owner, rows.find((p) => p.pid === owner.pid)), "MCP identity changed; do not claim its current descendants");
  const ids = new Set([owner.pid]);
  for (let size = 0; size !== ids.size;) { size = ids.size; for (const row of rows) if (ids.has(row.ppid)) ids.add(row.pid); }
  return rows.filter((row) => row.pid !== owner.pid && ids.has(row.pid));
}
function survivors(children) {
  const rows = processRows();
  // A changed command with the same start time is not proof of exit; fail closed,
  // while signalOwned still refuses to signal anything without the full identity match.
  return children.filter((p) => !sharedDaemon(p) && rows.some((current) => current.pid === p.pid && current.started === p.started));
}
function signalOwned(saved) {
  const current = processRows().find((p) => p.pid === saved.pid);
  if (!sameIdentity(saved, current)) return { signaled: false, saved, current }; // Absent/reused PID: never signal its new owner.
  assert.ok(saved.pid > 1 && saved.pid !== process.pid && !sharedDaemon(saved));
  try { process.kill(saved.pid, "SIGKILL"); }
  catch (error) { if (error.code === "ESRCH") return { signaled: false, saved }; throw error; }
  return { signaled: true, saved };
}

test("shared hvigor daemons are identified by entrypoint, not CLI flags", () => {
  const cli = "/sdk/node/bin/node /sdk/hvigor/bin/hvigorw.js assembleHap";
  for (const flag of ["--daemon", "--no-daemon"]) assert.equal(sharedDaemon({ command: `${cli} ${flag}` }), false);
  const node = "/sdk with spaces/node/bin/node --expose-gc /sdk with spaces/hvigor/src/base/daemon/process/daemon-process-boot-script.js";
  const java = "/sdk/java/bin/java -Xmx512m -jar /sdk/hvigor/lib/hvigor-java-daemon.jar 45050 session";
  assert.equal(sharedDaemon({ command: node }), true);
  assert.equal(sharedDaemon({ command: java }), true);
  assert.equal(sharedDaemon({ command: `${node}.backup` }), false);
  assert.equal(sharedDaemon({ command: java.replace(" -jar ", " -cp ") }), false);
});

test("SDK children recover after process death and shut down cleanly", async (t) => {
  assert.notEqual(process.platform, "win32", "This process-fault suite requires POSIX ps");
  const { directory, receipt, defer } = await session(t);
  const state = path.join(directory, "state"), project = path.join(directory, "Process");
  let client, failure, sequence = 0;
  const owned = new Map();
  const capture = (c) => {
    const children = descendants(c.owner);
    for (const child of children) if (!sharedDaemon(child)) owned.set(`${child.pid}:${child.started}:${child.command}`, { ...child, owner: c.owner });
    return children;
  };
  // Register before open(): session's LIFO hooks close all MCPs before cleaning their captured remnants.
  defer(async () => {
    const errors = [], actions = [];
    for (const child of owned.values()) {
      try { actions.push(signalOwned(child)); } catch (error) { errors.push(error); }
    }
    let left;
    try {
      for (let i = 0; i < 30; i++) {
        left = survivors([...owned.values()]);
        if (!left.length) break;
        await delay(100);
      }
      assert.equal(left.length, 0, `Owned descendants survived protected cleanup: ${JSON.stringify(left)}`);
    } catch (error) { errors.push(error); }
    try { receipt("owned-cleanup.json", { owned: [...owned.values()], actions, left, error: failure?.stack, cleanup_errors: errors.map((error) => error.stack) }); }
    catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors], "Owned process cleanup failed", { cause: failure });
  });
  const open = async () => {
    const c = connect({ DEVECO_STATE_DIR: state }); defer(() => c.close());
    receipt(`initialize-${sequence++}.json`, await c.initialize());
    assert.equal(c.child.exitCode, null); assert.equal(c.child.signalCode, null);
    c.owner = processRows().find((p) => p.pid === c.child.pid);
    assert.ok(c.owner && c.owner.ppid === process.pid, "MCP must be this test's direct child");
    return c;
  };
  const raw = async (tool, args) => {
    const response = await client.call(tool, args);
    receipt(`call-${sequence++}.json`, { tool, args, ...response }); return response;
  };
  const call = async (tool, args) => {
    const response = await raw(tool, args); assert.equal(response.isError, false, JSON.stringify(response.data)); return response.data;
  };
  try {
    client = await open();
    assert.equal(fs.lstatSync(project, { throwIfNoEntry: false }), undefined, "Recovery may only touch this run's new project");
    const created = await call("project", { action: "create", project, app_name: "Process", bundle_name: "com.devecomcp.process" });
    const ownedDirectory = fs.realpathSync(directory), projectRoot = path.join(ownedDirectory, "Process");
    assert.equal(fs.realpathSync(created.created), projectRoot); assert.equal(fs.realpathSync(project), projectRoot);
    const inputsBefore = hashes(project), buildStartedAt = Date.now();
    const started = await call("project", { action: "build", project, preflight: false, clean: true, wait: 0 });
    let children = [];
    for (let i = 0; i < 40; i++) {
      children = capture(client);
      if (children.some((p) => /hvigor/.test(p.command))) break;
      await delay(250);
    }
    assert.ok(children.some((p) => /hvigor/.test(p.command)), "Kill must occur during a real build");
    assert.ok(sameIdentity(client.owner, processRows().find((p) => p.pid === client.child.pid)), "MCP identity changed before SIGKILL");
    const killedOwner = client.owner, killedAt = Date.now();
    client.child.kill("SIGKILL"); await client.close(); await delay(3000);
    const orphans = survivors(children);
    receipt("killed.json", { owner: killedOwner, children, orphans });
    assert.equal(orphans.length, 0);
    client = await open();
    assert.equal((await call("job", { action: "status", job_id: started.job_id })).status, "interrupted");
    // SIGKILL deliberately leaves the shared lease. Reconcile only this run's local clean build;
    // an interrupted job is not permission to steal a lease or replay uncertain external effects.
    assert.equal(fs.realpathSync(project), projectRoot);
    const stateFile = path.join(ownedDirectory, "state", "state.db");
    assert.equal(fs.realpathSync(stateFile), stateFile);
    const db = new DatabaseSync(stateFile, { readOnly: true });
    let interrupted, effects;
    try {
      interrupted = db.prepare("SELECT id,kind,status,step,input,outputs,owner FROM jobs WHERE id=?").get(started.job_id);
      effects = db.prepare("SELECT step,state,receipt FROM effects WHERE job_id=? ORDER BY step").all(started.job_id);
    } finally { db.close(); }
    assert.ok(interrupted, "The interrupted job must exist in this run's private state");
    const input = JSON.parse(interrupted.input), outputs = JSON.parse(interrupted.outputs);
    const inputsAfter = Object.fromEntries(Object.keys(inputsBefore).map((file) => [file, sha(fs.readFileSync(path.join(projectRoot, file)))]));
    const audit = fs.readFileSync(path.join(state, "audit", "operations.jsonl"), "utf8").split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((entry) => entry.job_id === started.job_id);
    const resource = `project:${projectRoot}`, reservations = await call("job", { action: "resources" });
    const leases = reservations.filter((entry) => entry.resource === resource);
    const remaining = survivors([...owned.values()].filter((child) => sameIdentity(killedOwner, child.owner)));
    const ownerNow = processRows().find((entry) => entry.pid === killedOwner.pid);
    receipt("interrupted-inspection.json", { owner: killedOwner, owner_now: ownerNow ?? null, project: projectRoot, resource,
      job: { ...interrupted, input, outputs }, effects, inputs_before: inputsBefore, inputs_after: inputsAfter,
      project_entries: fs.readdirSync(projectRoot).sort(), audit, leases, remaining });
    assert.equal(interrupted.kind, "build"); assert.equal(interrupted.status, "interrupted"); assert.equal(interrupted.step, "build");
    assert.equal(interrupted.owner, killedOwner.pid); assert.equal(input.project, project);
    assert.equal(input.clean, true); assert.equal(input.preflight, false); assert.equal(input.target, undefined);
    assert.equal(Object.hasOwn(outputs, "build"), false); assert.equal(effects.length, 0, "No uncertain effect may be replayed");
    assert.deepEqual(inputsAfter, inputsBefore, "Original project inputs changed; inspect before releasing its lease");
    assert.equal(audit.length, 1); assert.equal(audit[0].phase, "intent"); assert.equal(audit[0].operation, "job:build");
    assert.equal(audit[0].pid, killedOwner.pid); assert.deepEqual(audit[0].resources, [resource]);
    assert.equal(remaining.length, 0, "Captured descendants still own interrupted build effects");
    assert.equal(ownerNow, undefined, "The original owner PID must be dead, not reused");
    assert.equal(leases.length, 1); const lease = leases[0];
    assert.equal(lease.pid, killedOwner.pid); assert.equal(lease.operation, "job:build"); assert.equal(lease.owner_alive, false);
    assert.ok(lease.acquired >= buildStartedAt && lease.acquired <= killedAt, "Lease must belong to this interrupted build attempt");
    assert.deepEqual(await call("job", { action: "release_resource", resource, owner_pid: killedOwner.pid }),
      { released: resource, owner_pid: killedOwner.pid, effects_replayed: false });
    assert.equal((await call("job", { action: "resources" })).some((entry) => entry.resource === resource), false);
    const resumed = await call("job", { action: "resume", job_id: started.job_id });
    assert.equal(resumed.status, "running"); assert.equal(resumed.next.action, "wait"); assert.equal(resumed.error, undefined);
    const inFlight = await call("job", { action: "status", job_id: started.job_id });
    assert.equal(inFlight.status, "running"); assert.equal(inFlight.error, undefined);
    const duplicate = await raw("job", { action: "resume", job_id: started.job_id });
    assert.equal(duplicate.isError, true); assert.equal(duplicate.data.error.code, "CONFLICT");
    assert.equal((await waitJob(call, resumed)).status, "succeeded");
    const file = "entry/src/main/ets/pages/Index.ets";
    await call("code", { action: "check", project, files: [file] });
    await call("code", { action: "lsp", project, op: "symbols", file });
    children = capture(client);
    for (const pattern of [/resources\/vendor\/arkts/, /ace-server/]) {
      const child = children.find((p) => pattern.test(p.command)); assert.ok(child, `${pattern} must actually be running`);
      assert.equal(signalOwned(child).signaled, true, "Selected SDK child changed identity; no fault was injected");
    }
    await delay(1000);
    assert.equal((await call("code", { action: "check", project, files: [file] })).errors, 0);
    assert.ok((await call("code", { action: "lsp", project, op: "symbols", file })).symbols.length);
    children = capture(client);
    await client.close(); await delay(2000);
    const left = survivors(children);
    receipt("shutdown.json", { owner: client.owner, children, left }); assert.equal(left.length, 0);
  } catch (error) { failure = error; throw error; }
});
