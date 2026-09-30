// device_compat classification on every authorised project that builds: for each "unguarded call"
// the capability must be missing on at least one declared device (checked against the SDK's device-define
// files independently of syscap.ts), and for each "compiler false positive" it must be present on all.
// Independent re-derivation: parse hvigor's log ourselves, read the @syscap from the SDK .d.ts via LSP
// hover, and compute device sets with plain file reads (no import from src/).
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { PROJECTS, evidence, mcp, record, waitJob } from "./lib.mjs";

const S = "/Applications/DevEco-Studio.app/Contents/sdk/default";
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")).SysCaps ?? []; } catch { return []; } };
const caps = (t) => {
  const phone = t === "phone" || t === "default";
  const hmsDir = path.join(S, "hms/ets/api/device-define");
  const pref = phone ? "phone" : t;
  return new Set([...read(path.join(S, "openharmony/ets/api/device-define", `${phone ? "default" : t}.json`)),
    ...fs.readdirSync(hmsDir).filter((f) => f === `${pref}.json` || f === `${pref}-hmos.json`).flatMap((f) => read(path.join(hmsDir, f)))]);
};
const c = await mcp();
const summary = {};
for (const key of ["lingdong", "mystarring", "lingdong_wt", "e2e_acceptance"]) {
  const root = PROJECTS[key];
  const info = (await c.call("project", { action: "info", project: root })).data;
  const hap = (info.modules ?? []).filter((m) => m.type === "entry").map((m) => m.name);
  const b = await waitJob(c, await c.call("project", { action: "build", project: root, modules: hap.slice(0, 1), clean: true, preflight: false, wait: 60000 }));
  const dc = b.result?.device_compat;
  if (!dc) { summary[key] = { build: b.status, device_compat: null }; continue; }
  // independent check of every reported unguarded location
  const bad = [];
  for (const g of dc.capabilities ?? []) {
    for (const at of g.at) {
      const file = at.split(":")[0];
      const mod = [...info.modules].map((m) => ({ ...m, root: path.resolve(root, m.path) })).sort((a, z) => z.root.length - a.root.length).find((m) => path.resolve(root, file).startsWith(m.root + path.sep));
      const dts = JSON5.parse(fs.readFileSync(path.join(mod.root, "src/main/module.json5"), "utf8")).module.deviceTypes;
      const missing = dts.filter((t) => !caps(t).has(g.syscap)).map((t) => (t === "default" ? "phone" : t));
      if (!missing.length || missing.join("+") !== g.missing_on.join("+")) bad.push({ at, syscap: g.syscap, reported: g.missing_on, independent: missing });
    }
  }
  summary[key] = { build: b.status, unguarded: dc.unguarded_calls, false_pos: dc.compiler_false_positives, unverified: dc.unverified ?? 0, deps: dc.dependency_warnings, checked_locations: (dc.capabilities ?? []).reduce((n, g) => n + g.at.length, 0), mismatches: bad.length, bad: bad.slice(0, 10), capabilities: (dc.capabilities ?? []).map((g) => `${g.syscap}:${g.missing_on}:${g.count}`) };
  console.log(key, JSON.stringify(summary[key]).slice(0, 400));
}
await c.close();
const ev = evidence("syscap", "classification.json", summary);
for (const [k, s] of Object.entries(summary)) {
  if (s.unguarded === undefined) { record(`C.syscap-classify.${k}`, "UNVERIFIED", `no device_compat (build ${s.build}; no compile warnings of this kind)`, [ev]); continue; }
  record(`C.syscap-classify.${k}`, s.mismatches ? "DEFECT" : "VERIFIED",
    `unguarded ${s.unguarded}, compiler false positives ${s.false_pos}, unverified ${s.unverified}, deps ${s.deps}; independently re-derived ${s.checked_locations} listed locations: ${s.mismatches} mismatches`, [ev]);
}
