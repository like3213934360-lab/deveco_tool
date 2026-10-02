// Every compiler syscap warning of LingDong's own code, classified independently of src/domains/syscap.ts:
// hvigor log (raw) -> location -> LSP hover at the location -> SDK @syscap tag (range-aware) -> device sets
// from SDK files. Compared with what the MCP reported (unguarded / false positive totals).
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { PROJECTS, evidence, mcp, record } from "./lib.mjs";

const S = "/Applications/DevEco-Studio.app/Contents/sdk/default";
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")).SysCaps ?? []; } catch { return []; } };
const caps = (t) => { const ph = t === "phone" || t === "default"; const d = path.join(S, "hms/ets/api/device-define"); const p = ph ? "phone" : t;
  return new Set([...read(path.join(S, "openharmony/ets/api/device-define", `${ph ? "default" : t}.json`)), ...fs.readdirSync(d).filter((f) => f === `${p}.json` || f === `${p}-hmos.json`).flatMap((f) => read(path.join(d, f)))]); };
const tagAt = (hover, api) => { // range-aware: API 26 compile level
  const tags = [...hover.matchAll(/@syscap\s+(SystemCapability(?:\.\w+)+)(?:\s*\[since\s+(\d+)(?:\s*-\s*(\d+))?\])?/g)];
  for (const t of tags) { const a = t[2] ? +t[2] : undefined, b = t[3] ? +t[3] : undefined; if ((a === undefined || api >= a) && (b === undefined || api <= b)) return t[1]; }
  return undefined;
};
const root = PROJECTS.lingdong;
const c = await mcp({ shared: true });
// The latest successful LingDong build in the shared state; without one, build it now (the
// classification needs the full hvigor log of the current code).
const jobs = (await c.call("job", { action: "list", limit: 60 })).data.jobs.filter((j) => j.kind === "build" && j.status === "succeeded");
let res;
for (const j of jobs) {
  const s = (await c.call("job", { action: "status", job_id: j.job_id })).data;
  if (path.resolve(s.input?.project ?? "") === path.resolve(root) && s.result?.device_compat && s.result?.log_artifact) { res = s.result; break; }
}
if (!res) {
  console.error("no LingDong build in the shared state: building it (a few minutes)");
  let job = (await c.call("project", { action: "build", project: root, wait: 55000 })).data;
  while (job.status === "running" || job.status === "queued") job = (await c.call("job", { action: "wait", job_id: job.job_id, wait: 55000 })).data;
  if (job.status !== "succeeded" || !job.result?.device_compat) { console.error(`LingDong build ${job.status}: ${JSON.stringify(job.error ?? {}).slice(0, 300)}`); await c.close(); process.exit(2); }
  res = job.result;
}
let all = "", line = 0;
for (;;) { const p = (await c.call("job", { action: "read", artifact_id: res.log_artifact, line, limit: 2000 })).data; all += p.content + "\n"; if (p.next_line == null) break; line = p.next_line; }
const lines = all.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
const locs = [];
for (let i = 0; i < lines.length; i++) if (/system capacity of this api/.test(lines[i])) { const m = /File:\s*(\S+?):(\d+):(\d+)/.exec(lines[i - 1] ?? ""); if (m && !/oh_modules/.test(m[1])) locs.push({ file: m[1].replace(root + "/", ""), line: +m[2], col: +m[3] }); }
const bp = JSON5.parse(fs.readFileSync(path.join(root, "build-profile.json5"), "utf8"));
const mods = bp.modules.map((m) => path.resolve(root, m.srcPath)).sort((a, b) => b.length - a.length);
const tally = { real: 0, false: 0, unverifiable: 0 };
const rows = [];
for (const w of locs) {
  const mroot = mods.find((m) => path.resolve(root, w.file).startsWith(m + path.sep));
  const dts = JSON5.parse(fs.readFileSync(path.join(mroot, "src/main/module.json5"), "utf8")).module.deviceTypes;
  let tag;
  for (const col of [w.col + 1, w.col]) { const h = (await c.call("code", { action: "lsp", op: "hover", project: root, file: w.file, line: w.line, column: col })).data; tag = h?.hover ? tagAt(h.hover, 26) : undefined; if (tag) break; }
  const missing = tag ? dts.filter((t) => !caps(t).has(tag)) : null;
  const k = !tag ? "unverifiable" : missing.length ? "real" : "false";
  tally[k]++;
  rows.push({ ...w, deviceTypes: dts, syscap: tag ?? null, missing, cls: k });
}
await c.close();
const ev = evidence("syscap", "lingdong-full.json", { mcp: { unguarded: res.device_compat.unguarded_calls, false_pos: res.device_compat.compiler_false_positives, unverified: res.device_compat.unverified }, independent: tally, rows });
const same = tally.real === res.device_compat.unguarded_calls && tally.false === res.device_compat.compiler_false_positives && tally.unverifiable === (res.device_compat.unverified ?? 0);
record("C.syscap-hvigor-bugs", same ? "VERIFIED" : "DEFECT", `LingDong ${locs.length} project warnings, independent classification: real ${tally.real}, false ${tally.false}, unverifiable ${tally.unverifiable}; MCP reported ${res.device_compat.unguarded_calls}/${res.device_compat.compiler_false_positives}/${res.device_compat.unverified ?? 0}`, [ev]);
console.log(JSON.stringify(tally));
