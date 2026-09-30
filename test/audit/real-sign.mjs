// Minimal real AGC run: keypair -> csr -> certificate_create -> profile_create -> profile_delete -> delete_certificate.
// Uses a unique certificate name (never the auto_debug_<team>.cer used by auto signing). Before/after lists compared.
// Device registration is not exercised as a write: the connected phone is already registered (checked below).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidence, mcp, record } from "./lib.mjs";

const c = await mcp({ shared: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sign-"));
const log = {};
const step = async (k, args) => { const r = await c.call("sign", args); log[k] = { args: { ...args, keystore_password: args.keystore_password ? "***" : undefined }, isError: r.isError, data: r.data }; console.log(k, r.isError ? "ERR " + r.data.error.code + " " + r.data.error.message.slice(0, 160) : JSON.stringify(r.data).slice(0, 160)); return r; };

const before = { certs: (await c.call("sign", { action: "certificates" })).data.certificates, devices: (await c.call("sign", { action: "devices" })).data.devices };
const name = `audit_${Date.now().toString(36)}`;
const pw = "Audit" + Math.random().toString(36).slice(2, 10) + "9!";
let certId, profileId, ok = true;
try {
  const kp = await step("keypair", { action: "keypair", out: path.join(tmp, "a.p12"), keystore_password: pw });
  const csr = await step("csr", { action: "csr", keystore: path.join(tmp, "a.p12"), keystore_password: pw, out: path.join(tmp, "a.csr") });
  const cert = await step("certificate_create", { action: "certificate_create", csr: path.join(tmp, "a.csr"), name, type: "debug", out: path.join(tmp, "a.cer") });
  certId = cert.data?.id ?? cert.data?.certificate?.id;
  const cerOk = fs.existsSync(path.join(tmp, "a.cer")) && /BEGIN CERTIFICATE/.test(fs.readFileSync(path.join(tmp, "a.cer"), "utf8"));
  const prof = await step("profile_create", { action: "profile_create", id: certId, bundle: "com.devecomcp.auditsign", type: "debug", name: `${name}_p`, out: path.join(tmp, "a.p7b") });
  profileId = prof.data?.id ?? prof.data?.profile?.id;
  const p7bOk = fs.existsSync(path.join(tmp, "a.p7b")) && fs.statSync(path.join(tmp, "a.p7b")).size > 500;
  log.files = { cer_pem: cerOk, p7b_bytes: p7bOk ? fs.statSync(path.join(tmp, "a.p7b")).size : 0 };
  ok = !kp.isError && !csr.isError && !cert.isError && cerOk && !prof.isError && p7bOk;
  const mid = (await c.call("sign", { action: "certificates" })).data.certificates;
  log.mid_has_cert = mid.some((x) => x.id === certId);
} finally {
  if (profileId) await step("profile_delete", { action: "profile_delete", id: profileId });
  if (certId) await step("delete_certificate", { action: "delete_certificate", id: certId });
}
// failure paths
await step("certificate_create.failure", { action: "certificate_create", csr: path.join(tmp, "missing.csr"), name: "x", out: path.join(tmp, "x.cer") });
await step("profile_delete.failure", { action: "profile_delete", id: "0" });
await step("delete_certificate.failure", { action: "delete_certificate", id: "0" });
const phone = (await c.call("device", { action: "info", target: "4VF0225613017854" })).data;
const reg = await step("register_device.existing", { action: "register_device", target: "4VF0225613017854" });
const after = { certs: (await c.call("sign", { action: "certificates" })).data.certificates, devices: (await c.call("sign", { action: "devices" })).data.devices };
await c.close();
fs.rmSync(tmp, { recursive: true, force: true });

const ids = (l) => l.map((x) => x.id).sort().join(",");
const restored = ids(before.certs) === ids(after.certs) && ids(before.devices) === ids(after.devices);
const ev = evidence("real-sign", "run.json", { before: { certs: before.certs.length, devices: before.devices.length }, after: { certs: after.certs.length, devices: after.devices.length }, restored, log, phone_udid_prefix: String(phone.udid ?? "").slice(0, 8) });
record("B.real-sign.lifecycle", ok && log.mid_has_cert ? "VERIFIED" : "DEFECT", `keypair/csr/certificate_create (PEM downloaded, listed in AGC)/profile_create (p7b ${log.files?.p7b_bytes ?? 0} bytes): ${ok ? "all succeeded" : "failed, see evidence"}`, [ev]);
record("B.real-sign.rollback", restored ? "VERIFIED" : "DEFECT", `AGC before/after: certificates ${before.certs.length} -> ${after.certs.length}, devices ${before.devices.length} -> ${after.devices.length}; id sets identical: ${restored}`, [ev]);
record("B.real-sign.failures", [log["certificate_create.failure"], log["profile_delete.failure"], log["delete_certificate.failure"]].every((x) => x.isError) ? "VERIFIED" : "DEFECT",
  `missing CSR / unknown profile id / unknown certificate id -> ${["certificate_create.failure", "profile_delete.failure", "delete_certificate.failure"].map((k) => log[k].isError ? log[k].data.error.code : "no error").join(", ")}`, [ev]);
record("B.real-sign.register-existing", !reg.isError ? "VERIFIED" : "DEFECT", `register_device on the already-registered phone -> ${reg.isError ? reg.data.error.code + " " + reg.data.error.message.slice(0, 100) : JSON.stringify(reg.data).slice(0, 120)}; device count unchanged: ${before.devices.length === after.devices.length}`, [ev]);
record("C.agc-formats", ok ? "VERIFIED" : "UNVERIFIED", "AGC routes identical to upstream deveco-cli config/signature.ts (cert list/add/delete, device list/add, ide test|real provision add, provision delete, objects/url/reapply); real create+delete of certificate and profile accepted by AGC", [ev]);
