// Handshake time, idle RSS, tools/list size, RSS after the audit-like load, temp leftovers.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";
const rss = (pid) => Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024;
const hs = [];
for (let i = 0; i < 7; i++) { const c = connect(); const t = performance.now(); await c.initialize(); hs.push(performance.now() - t); await c.close(); }
hs.sort((a, b) => a - b);
const c = connect(); await c.initialize();
await new Promise((r) => setTimeout(r, 1500));
const idle = rss(c.child.pid);
const list = JSON.stringify((await c.request("tools/list", {})).result);
// load: 60 knowledge searches + 20 lsp-free checks on a small project
for (let i = 0; i < 60; i++) await c.call("knowledge", { action: "search", query: ["Navigation", "LazyForEach", "PushKit", "canIUse", "AppStorageV2"][i % 5] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-perf-"));
await c.call("project", { action: "create", project: path.join(tmp, "P"), app_name: "P", bundle_name: "com.devecomcp.perf" });
for (let i = 0; i < 20; i++) await c.call("code", { action: "check", project: path.join(tmp, "P") });
for (let i = 0; i < 20; i++) await c.call("code", { action: "lsp", op: "symbols", project: path.join(tmp, "P"), file: "entry/src/main/ets/pages/Index.ets" });
const loaded = rss(c.child.pid);
const kids = execSync(`pgrep -P ${c.child.pid} || true`).toString().trim().split("\n").filter(Boolean);
const kidRss = kids.reduce((s, k) => s + rss(k), 0);
await c.close();
await new Promise((r) => setTimeout(r, 1500));
const orphans = kids.filter((k) => { try { process.kill(Number(k), 0); return true; } catch { return false; } });
fs.rmSync(tmp, { recursive: true, force: true });
const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^(audit-|deveco-|devecomcp)/.test(f));
const out = { handshake_ms: { min: +hs[0].toFixed(1), median: +hs[3].toFixed(1), max: +hs[6].toFixed(1) }, idle_rss_mb: +idle.toFixed(1), tools_list_kb: +(list.length / 1024).toFixed(1), rss_after_load_mb: +loaded.toFixed(1), child_processes: kids.length, child_rss_mb: +kidRss.toFixed(0), orphans_after_close: orphans.length, tmp_leftovers: leftovers };
console.log(JSON.stringify(out, null, 1));
const ev = evidence("cross-risk", "perf.json", out);
record("C.perf", out.handshake_ms.median < 150 && out.idle_rss_mb < 90 ? "VERIFIED" : "DEFECT", `handshake median ${out.handshake_ms.median} ms (min ${out.handshake_ms.min}, max ${out.handshake_ms.max}); idle RSS ${out.idle_rss_mb} MB; tools/list ${out.tools_list_kb} KB (earlier claim: ~86-89 ms, 67-68 MB, ~36 KB)`, [ev]);
record("E.perf.load", out.orphans_after_close === 0 ? "VERIFIED" : "DEFECT", `after 60 searches + 20 checks + 20 LSP calls: server RSS ${out.rss_after_load_mb} MB, ${out.child_processes} child processes (${out.child_rss_mb} MB: checker daemon + ace-server); after close: ${out.orphans_after_close} orphaned children`, [ev]);
