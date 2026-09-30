// Remove the AGC profiles this audit created (provisionName audit_*), using the provision/list route that
// DevEco Studio itself uses (hos-project-mgmt SignatureMgmt.properties: get.provision). Lists before/after.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { evidence, record, repo } from "./lib.mjs";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "audit-clean-"));
const tmpSrc = path.join(repo, "src/domains/.audit-sign.ts");
fs.writeFileSync(tmpSrc, fs.readFileSync(path.join(repo, "src/domains/sign.ts"), "utf8") + "\nexport { request as __request };\n");
try {
  fs.writeFileSync(path.join(out, "e.ts"), `export * from ${JSON.stringify(tmpSrc)};\n`);
  await build({ entryPoints: [path.join(out, "e.ts")], outfile: path.join(out, "e.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(repo, "node_modules")] });
} finally { fs.rmSync(tmpSrc, { force: true }); }
fs.symlinkSync(path.join(repo, "node_modules"), path.join(out, "node_modules"));
const s = await import(pathToFileURL(path.join(out, "e.mjs")).href);
const team = await s.teamId();
const list = async () => {
  const tries = [];
  for (const [m, q, body] of [
    ["GET", "?packageName=com.devecomcp.auditsign&start=1&pageSize=100"],
    ["POST", "", { packageName: "com.devecomcp.auditsign", start: 1, pageSize: 100 }],
    ["POST", "", { packageNames: ["com.devecomcp.auditsign"], start: 1, pageSize: 100 }],
    ["GET", "?packageNames=com.devecomcp.auditsign&start=1&pageSize=100"],
  ]) {
    try { const r = await s.__request(team, `/api/cps/provision-manage/v1/provision/list${q}`, m, body); return { method: m + q + (body ? JSON.stringify(body) : ""), data: r, tries }; } catch (e) { tries.push(`${m}${q}${body ? JSON.stringify(body) : ""}: ${String(e.message).slice(0, 120)}`); var last = tries.join(" | "); }
  }
  return { error: last };
};
const before = await list();
const rows = before.data ? (before.data.list ?? before.data.provisionList ?? before.data.data ?? []) : [];
const pick = (r) => ({ id: r.id ?? r.provisionId, name: r.provisionName ?? r.name, pkg: r.packageName });
const mine = rows.map(pick).filter((r) => /^audit_/.test(r.name ?? "") && r.pkg === "com.devecomcp.auditsign");
console.log("list via", before.method, "rows", rows.length, "audit rows", JSON.stringify(mine));
for (const r of mine) await s.deleteProfile(team, r.id);
const after = await list();
const rowsAfter = after.data ? (after.data.list ?? after.data.provisionList ?? after.data.data ?? []) : [];
const left = rowsAfter.map(pick).filter((r) => /^audit_/.test(r.name ?? ""));
const ev = evidence("real-sign", "cleanup.json", { list_method: before.method, keys: before.data ? Object.keys(before.data) : before.error, total_before: rows.length, deleted: mine, total_after: rowsAfter.length, audit_left: left });
record("B.real-sign.cleanup", before.data && !left.length ? "VERIFIED" : "UNVERIFIED", before.data ? `profiles: ${rows.length} -> ${rowsAfter.length}; deleted audit profiles ${mine.map((m) => m.name).join(", ") || "none found"}; audit profiles left: ${left.length}` : `could not list profiles: ${before.error}`, [ev]);
fs.rmSync(out, { recursive: true, force: true });
