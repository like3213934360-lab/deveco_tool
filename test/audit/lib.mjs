// Shared helpers for the evidence audit (docs/audit). Every finding is recorded with a verdict and
// the path of the raw evidence that supports it; nothing is reported without evidence.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../../tools/mcp-client.mjs";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const evidenceDir = path.join(repo, "docs/audit/evidence");
export const findingsFile = path.join(repo, "docs/audit/findings.jsonl");
fs.mkdirSync(evidenceDir, { recursive: true });

export const VERDICTS = ["VERIFIED", "DEFECT", "UNVERIFIED", "INFERRED"];

/** HarmonyOS projects on this machine (user-authorised for this audit, read-only). */
export const PROJECTS = {
  lingdong: "/Users/dreamlike/DreamLike/LingDong/Application",
  mystarring: "/Users/dreamlike/DreamLike/MyStarRing/client",
  locket: "/Users/dreamlike/DreamLike/Locket/Application",
  mytestapp: process.env.AUDIT_MYTESTAPP ?? "/path/with/non-ascii/myTestAPP", // local project under a non-ASCII path
  lingdong_wt: "/Users/dreamlike/.codex/worktrees/lingdong-4-6-7-install/Application",
  e2e_acceptance: "/Users/dreamlike/Documents/Codex/deveco-e2e-2026-09-05-reloaded/E2EAcceptance",
  settings_fixture: "/Users/dreamlike/Documents/Codex/deveco-device-ui-audit-2026-09-05/Settings 流程夹具",
};
/** Build-comparison copies (hvigor rejects non-ASCII project paths, 00306003). */
export const COPIES = { mytestapp_copy: "/tmp/audit-mytestapp/myTestAPP" };
export const PHONE = "4VF0225613017854";

/** Save raw evidence (string or JSON) under docs/audit/evidence/<area>/<name>; returns the repo-relative path. */
export function evidence(area, name, data) {
  const dir = path.join(evidenceDir, area);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return path.relative(repo, file);
}

/** Append one finding. id: stable key (e.g. "B.code.check.rule.entry-build-root-node"). */
export function record(id, verdict, summary, evidencePaths = [], extra = {}) {
  if (!VERDICTS.includes(verdict)) throw new Error(`bad verdict ${verdict}`);
  const row = { id, verdict, summary, evidence: [].concat(evidencePaths), at: new Date().toISOString(), ...extra };
  fs.appendFileSync(findingsFile, JSON.stringify(row) + "\n");
  console.log(`${verdict.padEnd(10)} ${id} — ${summary}`);
  return row;
}

/** MCP client with an isolated state dir (does not touch ~/.deveco-mcp unless shared=true). */
export async function mcp({ shared = false } = {}) {
  const state = shared ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), "audit-state-"));
  const c = connect(state ? { DEVECO_STATE_DIR: state } : {});
  await c.initialize();
  if (state) { const close = c.close.bind(c); c.close = async () => { await close(); fs.rmSync(state, { recursive: true, force: true }); }; }
  return c;
}

export async function waitJob(c, r) {
  let s = r.data;
  while (s && (s.status === "running" || s.status === "queued")) s = (await c.call("job", { action: "wait", job_id: s.job_id, wait: 60000 })).data;
  return s;
}

/** Source-file hash snapshot of a project (excludes build output, deps, VCS, IDE caches). */
const SKIP = new Set(["build", "oh_modules", "node_modules", ".git", ".hvigor", ".idea", ".preview", ".cxx", ".cache", ".deveco", ".agents"]);
export function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[path.relative(root, full)] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

export function diffSnapshots(before, after) {
  const changed = [], added = [], removed = [];
  for (const [f, h] of Object.entries(before)) if (!(f in after)) removed.push(f); else if (after[f] !== h) changed.push(f);
  for (const f of Object.keys(after)) if (!(f in before)) added.push(f);
  return { changed, added, removed };
}

/** Copy a project to a temp dir (for any check that must edit code). */
export function tempCopy(src) {
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-copy-")), path.basename(src));
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) || path.basename(p) === "oh_modules" });
  return dst;
}
