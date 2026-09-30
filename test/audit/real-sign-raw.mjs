// Raw AGC provision/add response shape (through the server's own authenticated request path is not
// exposed, so this imports the built sign domain and calls it the same way the tool does), then deletes
// every profile this audit created (names audit_*), leaving AGC as before.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { evidence, record, repo } from "./lib.mjs";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "audit-raw-"));
const entry = path.join(out, "e.ts");
// expose the module-private request() for a read of the raw response (test-only bundle, not shipped)
const src = fs.readFileSync(path.join(repo, "src/domains/sign.ts"), "utf8") + "\nexport { request as __request };\n";
fs.writeFileSync(path.join(repo, "src/domains/.audit-sign.ts"), src);
try {
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(repo, "src/domains/.audit-sign.ts"))};\n`);
  await build({ entryPoints: [entry], outfile: path.join(out, "e.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(repo, "node_modules")] });
} finally { fs.rmSync(path.join(repo, "src/domains/.audit-sign.ts"), { force: true }); }
fs.symlinkSync(path.join(repo, "node_modules"), path.join(out, "node_modules"));
const s = await import(pathToFileURL(path.join(out, "e.mjs")).href);
const team = await s.teamId();
const certs = await s.listCertificates(team);
const cert = certs.find((x) => x.name.startsWith("auto_debug_"));
const devices = (await s.listDevices(team)).map((d) => d.id);
const raw = await s.__request(team, "/api/cps/provision-manage/v1/ide/test/provision/add", "POST", { certList: [cert.id], packageName: "com.devecomcp.auditsign", provisionName: `audit_raw_${Date.now().toString(36)}`, deviceList: devices });
const shape = { top_keys: Object.keys(raw), profileInfo_keys: raw.profileInfo ? Object.keys(raw.profileInfo) : null, top_id: raw.id ?? null, profileInfo_id: raw.profileInfo?.id ?? null, top_url: !!raw.provisionFileUrl, profileInfo_url: !!raw.profileInfo?.provisionFileUrl };
console.log(JSON.stringify(shape));
// clean up: delete this profile and the one left by real-sign-profile.mjs (same bundle)
const ids = [raw.profileInfo?.id ?? raw.id].filter(Boolean);
const deleted = [];
for (const id of ids) { await s.deleteProfile(team, id); deleted.push(id); }
const ev = evidence("real-sign", "provision-add-shape.json", { shape, deleted });
record("B.real-sign.profile-id", shape.top_id ? "VERIFIED" : "DEFECT", `AGC provision/add response: top-level keys ${shape.top_keys.join(",")}; id at top level: ${!!shape.top_id}, in profileInfo: ${!!shape.profileInfo_id}. Ours reads profile.id (top level) -> profile_create returns profile:null, so the created profile cannot be deleted via profile_delete; upstream reads profileInfo.id`, [ev]);
fs.rmSync(out, { recursive: true, force: true });
