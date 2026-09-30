// Retention in a controlled state dir: artifacts, tracked save_path copies, test exports and ui_tests rows
// older than retention_days are removed by the startup cleanup; an untracked user file next to them survives.
// Ages are simulated by rewinding timestamps in the state DB (the only way to test "1 day" without waiting).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";

const EMU = "127.0.0.1:5555";
const state = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ret-state-"));
const user = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ret-user-"));
const env = { DEVECO_STATE_DIR: state };
let c = connect(env); await c.initialize();
const shotPath = path.join(user, "shot.png");
const s = await c.call("ui", { action: "screenshot", target: EMU, save_path: shotPath });
const ts = (await c.call("ui", { action: "test_start", target: EMU, bundle: "com.huawei.hmos.settings", plan: "1. look" })).data;
await c.call("ui", { action: "test_step", target: EMU, test_id: ts.test_id, visible: { text: "设置" }, description: "look" });
await c.call("ui", { action: "test_finish", target: EMU, test_id: ts.test_id });
const expDir = path.join(user, "export");
await c.call("ui", { action: "test_export", target: EMU, test_id: ts.test_id, directory: expDir });
const keep = path.join(user, "my-own-notes.txt"); fs.writeFileSync(keep, "user file");
await c.close();
const artifactsDir = path.join(state, "artifacts");
const before = { shot: fs.existsSync(shotPath), export: fs.readdirSync(expDir).length, artifacts: fs.readdirSync(artifactsDir).length, keep: fs.existsSync(keep) };
// rewind every timestamp by 2 days
const db = new DatabaseSync(path.join(state, "state.db"));
const twoDays = 2 * 86400000;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
for (const t of tables) for (const col of ["created", "updated"]) { try { db.prepare(`UPDATE ${t} SET ${col}=${col}-?`).run(twoDays); } catch {} }
db.close();
for (const f of fs.readdirSync(artifactsDir)) { const p = path.join(artifactsDir, f); const old = new Date(Date.now() - twoDays); fs.utimesSync(p, old, old); }
// new session: startup cleanup runs ~5 s after start
c = connect(env); await c.initialize();
await new Promise((r) => setTimeout(r, 8000));
const ui = await c.call("ui", { action: "test_log", target: EMU, test_id: ts.test_id });
await c.close();
const after = { shot: fs.existsSync(shotPath), export: fs.existsSync(expDir) ? fs.readdirSync(expDir).length : 0, artifacts: fs.readdirSync(artifactsDir).length, keep: fs.existsSync(keep), ui_test: ui.isError ? ui.data.error.code : "still there" };
const ev = evidence("cross-risk", "retention.json", { before, after });
const ok = before.shot && before.export > 0 && !after.shot && after.export === 0 && after.artifacts === 0 && after.keep && after.ui_test !== "still there";
record("C.retention", ok ? "VERIFIED" : "DEFECT", `after 2 simulated days + restart: save_path copy ${before.shot}->${after.shot}, test_export files ${before.export}->${after.export} (directory itself kept on purpose), artifacts ${before.artifacts}->${after.artifacts}, ui test ${after.ui_test}, untracked user file kept: ${after.keep}`, [ev]);
fs.rmSync(state, { recursive: true, force: true }); fs.rmSync(user, { recursive: true, force: true });
