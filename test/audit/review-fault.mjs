// Review 1.3 (C): fault injection that needs no device: corrupted state, flows, concurrency on one state dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-fault-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const ev = (n, d) => evidence("review-1.3", n, d);
const state = path.join(tmp, "state");
const open = async (s = state) => { const c = connect({ DEVECO_STATE_DIR: s }); await c.initialize(); return c; };
const out = {};

// Project for flows / preflight state.
let c = await open();
const proj = path.join(tmp, "Fault");
await c.call("project", { action: "create", project: proj, app_name: "Fault", bundle_name: "com.devecomcp.fault" });

// 1. Corrupted flow file: list reports it as invalid, show/replay give a structured error, others unaffected.
const flows = path.join(proj, ".arkpilot", "flows");
fs.mkdirSync(flows, { recursive: true });
fs.writeFileSync(path.join(flows, "broken.json"), "{ not json");
fs.writeFileSync(path.join(flows, "partial.json"), JSON.stringify({ id: "partial", name: "x" }));
const list = (await c.call("ui_flow", { action: "list", project: proj })).data;
const show = await c.call("ui_flow", { action: "show", project: proj, id: "broken" });
const run = await c.call("run", { action: "build_run", project: proj, then_flow: "broken" });
out.flows = { list, show: show.data, then_flow: run.data };
record("F.fault.flow-corrupt", list.flows?.every((f) => f.invalid) && show.isError && show.data.error?.code && run.isError ? "VERIFIED" : "DEFECT",
  `corrupted flow files: list marks ${list.flows?.filter((f) => f.invalid).length}/2 invalid; show -> ${show.data.error?.code}: ${show.data.error?.message?.slice(0, 80)}; build_run then_flow -> ${run.data.error?.code} (before any build)`, [ev("fault-flows.json", out.flows)]);
record("F.fault.flow-corrupt-message", show.data.error?.code === "FLOW_INVALID" && show.data.error?.details?.file && show.data.error?.hint ? "VERIFIED" : "DEFECT",
  `a corrupted flow is reported as ${show.data.error?.code} "${show.data.error?.message?.slice(0, 100)}", file=${show.data.error?.details?.file ? "given" : "missing"}, hint=${show.data.error?.hint ? "given" : "missing"}`, [ev("fault-flows.json", out.flows)], { severity: "low", dimension: "availability" });
await c.close();

// 2. Corrupted hot-path and preflight state (both in the state dir): the next run must ignore them.
fs.mkdirSync(path.join(state, "hotpath"), { recursive: true });
for (const f of fs.readdirSync(path.join(state, "hotpath"))) fs.writeFileSync(path.join(state, "hotpath", f), "garbage");
fs.writeFileSync(path.join(state, "hotpath", "x.json"), "{broken");
c = await open();
const ok1 = await c.call("project", { action: "info", project: proj });
await c.close();
record("F.fault.hotpath-corrupt", !ok1.isError ? "VERIFIED" : "DEFECT", "corrupted hotpath state files: server starts and works (readState returns undefined -> treated as no baseline, see F.hot decisions)", [ev("fault-hotpath.json", ok1.data)]);

// 3. Corrupted SQLite state DB: does the server start, and does it say what to do?
const db = path.join(state, "state.db");
const dbFiles = fs.readdirSync(state).filter((f) => f.startsWith("state.db"));
for (const f of dbFiles) fs.rmSync(path.join(state, f));
fs.writeFileSync(db, "this is not a sqlite database".repeat(200));
let started = true, first;
try {
  c = await open();
  first = await c.call("job", { action: "list" });
  await c.close();
} catch (e) { started = false; first = { error: String(e.message).slice(0, 300) }; }
out.db = { started, first: first?.data ?? first, backups: fs.readdirSync(state).filter((f) => f.includes(".corrupt-")) };
const note = (first?.data?.notes ?? []).find((n) => /corrupted/.test(n));
record("F.fault.db-corrupt", started && !first?.isError && note && out.db.backups.length ? "VERIFIED" : "DEFECT",
  `corrupted state.db: server started=${started}; job list -> ${first?.isError ? `${first.data.error?.code}: ${first.data.error?.message?.slice(0, 120)}` : "ok"}; note: ${note ? note.slice(0, 140) : "none"}; backup kept: ${out.db.backups.join(", ") || "none"}`, [ev("fault-db.json", out.db)], { severity: "medium", dimension: "availability" });

// 4. Two server instances on one state dir: concurrent job writes do not corrupt each other.
const s2 = path.join(tmp, "state2");
const a = await open(s2), b = await open(s2);
const results = await Promise.all([
  ...Array.from({ length: 10 }, () => a.call("project", { action: "sync", project: proj, wait: 0 })),
  ...Array.from({ length: 10 }, () => b.call("job", { action: "list" })),
]);
const errors = results.filter((r) => r.isError).map((r) => r.data.error?.code);
await new Promise((r) => setTimeout(r, 3000));
const jobs = (await b.call("job", { action: "list", limit: 50 })).data.jobs ?? [];
await a.close(); await b.close();
out.concurrent = { errors, jobs: jobs.length, statuses: [...new Set(jobs.map((j) => j.status))] };
record("F.fault.two-instances", !errors.length && jobs.length >= 10 ? "VERIFIED" : "DEFECT",
  `two servers on one state dir, 10 sync jobs + 10 job lists in parallel: ${errors.length} errors ${JSON.stringify(errors)}, ${jobs.length} jobs visible from the other instance (${out.concurrent.statuses.join(",")})`, [ev("fault-concurrent.json", out.concurrent)]);
console.log(JSON.stringify(out).slice(0, 2000));
