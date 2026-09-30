// Profile lifecycle on an EXISTING debug certificate (certificate quota full: AGC 205389872), then delete.
// Also checks whether deletes of non-existent ids are reported as success.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record } from "./lib.mjs";
const c = await mcp({ shared: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-prof-"));
const certs = (await c.call("sign", { action: "certificates" })).data.certificates;
const cert = certs.find((x) => x.name.startsWith("auto_debug_")) ?? certs.find((x) => x.type === "debug");
const out = path.join(tmp, "p.p7b");
const create = await c.call("sign", { action: "profile_create", id: cert.id, bundle: "com.devecomcp.auditsign", type: "debug", name: `audit_${Date.now().toString(36)}`, out });
const p7b = fs.existsSync(out) ? fs.statSync(out).size : 0;
const pid = create.data?.id;
const del = pid ? await c.call("sign", { action: "profile_delete", id: pid }) : undefined;
const delAgain = pid ? await c.call("sign", { action: "profile_delete", id: pid }) : undefined;
const bogus = await c.call("sign", { action: "delete_certificate", id: "1" });
const certsAfter = (await c.call("sign", { action: "certificates" })).data.certificates;
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });
const ev = evidence("real-sign", "profile.json", { cert: { name: cert.name, id: cert.id }, create: create.data, p7b_bytes: p7b, delete: del?.data, delete_again: delAgain?.data, delete_bogus_cert: bogus.data, certs_before: certs.length, certs_after: certsAfter.length });
record("B.real-sign.profile", !create.isError && p7b > 500 && del && !del.isError ? "VERIFIED" : "DEFECT", `profile_create on existing cert ${cert.name}: ${create.isError ? create.data.error.message.slice(0, 120) : `id ${pid}, p7b ${p7b} bytes`}; profile_delete -> ${del ? JSON.stringify(del.data).slice(0, 60) : "skipped"}; certificates ${certs.length} -> ${certsAfter.length}`, [ev]);
record("B.real-sign.delete-nonexistent", delAgain && !delAgain.isError || !bogus.isError ? "DEFECT" : "VERIFIED", `deleting an already-deleted profile -> ${delAgain ? JSON.stringify(delAgain.data).slice(0, 80) : "n/a"}; deleting certificate id '1' -> ${JSON.stringify(bogus.data).slice(0, 80)}. A delete of a non-existent id is reported as success (AGC returns ret.code 0), so an agent cannot tell whether anything was deleted`, [ev]);
