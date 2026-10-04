import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import type { StepContext } from "../core/jobs.js";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite, readJson5, sha256 } from "../core/files.js";
import { run } from "../core/proc.js";
import { toolchain } from "../core/toolchain.js";
import { listTargets } from "./device.js";
import { decryptPassword, encryptPassword, existingSigning, listCertificates, listDevices, registerDevice, request, download, signer, projectAclPermissions, profilePayload, profileSummary, teamId } from "./sign.js";

export interface AutoInput { project: string; product?: string; team?: string; acl?: string[]; force?: boolean }
type Context = StepContext<AutoInput>;
interface Prepared {
  root: string; product: string; bundle: string; team: string; dir: string; lock: string;
  previous: string; certName: string; beforeIds: string[]; password: string; acl: string[];
}
const prepared = (ctx: Context) => {
  invariant(!ctx.outputs.compensation?.closed, "SIGN_ATTEMPT_CLOSED", "This signing attempt was compensated; start a new sign auto job");
  const p = ctx.outputs.prepare as Prepared;
  invariant(!fs.existsSync(path.join(p.dir, "compensation.json")), "SIGN_ATTEMPT_CLOSED", "Signing compensation was started; reconcile cleanup before starting a new attempt");
  return p;
};
const file = (p: Prepared, ext: string) => path.join(p.dir, `debug.${ext}`);
const uncertain = (stage: string, cause?: unknown) => new ToolError("EFFECT_UNCERTAIN", `Auto signing ${stage} may have executed; existing signing remains unchanged`,
  { stage, ...(cause instanceof Error ? { cause: cause.message } : {}) }, "Inspect AGC and job status detail=true, then resume to reconcile. Force never repeats uncertain certificate/profile creation.");
function releaseLock(ctx: Context, p: Prepared) {
  if (fs.existsSync(p.lock) && fs.readFileSync(p.lock, "utf8") === ctx.job_id) fs.rmSync(p.lock);
}
function ownsLock(ctx: Context, p: Prepared) {
  invariant(fs.existsSync(p.lock) && fs.readFileSync(p.lock, "utf8") === ctx.job_id, "CONFLICT", "Signing attempt no longer owns the project lock");
}

/** Local generation is repeatable in this job's exclusive directory; no old file is touched. */
export async function prepare(ctx: Context): Promise<Prepared> {
  const { inspectProject } = await import("./project.js");
  const project = inspectProject(ctx.input.project, ctx.input.product);
  const root = project.root, product = project.product;
  invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
  const current = existingSigning(root, product);
  invariant(!current || ctx.input.force, "SIGN_CONFIGURED", "Project already has signing; nothing changed", current, "Build with existing signing, or explicitly request force=true to prepare a replacement (requires free certificate quota)");
  invariant(!current || current.source === "build-profile.json5", "SIGN_CONFIGURED", `Signing comes from ${current?.source}; edit that override instead`);
  const team = await teamId(ctx.input.team, true);
  const base = path.join(os.homedir(), ".ohos", "config");
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const lock = path.join(base, `.auto-${sha256(root).slice(0, 24)}.lock`);
  if (fs.existsSync(lock)) invariant(fs.readFileSync(lock, "utf8") === ctx.job_id, "CONFLICT", "Another signing attempt owns this project", undefined, "Inspect/resume the existing job before starting another replacement");
  else { const fd = fs.openSync(lock, "wx", 0o600); try { fs.writeFileSync(fd, ctx.job_id); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  const dir = path.join(base, `.auto-${ctx.job_id}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { mode: 0o700 });
    const password = crypto.randomBytes(16).toString("hex");
    const p: Prepared = { root, product, bundle: project.bundleName, team, dir, lock,
      previous: sha256(fs.readFileSync(path.join(root, "build-profile.json5"))), certName: `auto_debug_${ctx.job_id}.cer`,
      beforeIds: (await listCertificates(team, ctx.signal)).map((c) => c.id), password: "",
      acl: [...new Set([...projectAclPermissions(project.modules).acl, ...(ctx.input.acl ?? [])])] };
    ctx.log("preparing isolated keypair and CSR (old material retained)");
    await signer(["generate-keypair", "-keyAlias", "debugKey", "-keyAlg", "ECC", "-keySize", "NIST-P-256", "-keystoreFile", file(p, "p12"), "-keystorePwd", password, "-keyPwd", password], ctx.signal);
    await signer(["generate-csr", "-keyAlias", "debugKey", "-subject", "CN=DebugKey", "-signAlg", "SHA256withECDSA", "-keystoreFile", file(p, "p12"), "-keystorePwd", password, "-keyPwd", password, "-outFile", file(p, "csr")], ctx.signal);
    p.password = encryptPassword(password, file(p, "p12")); // no plaintext password in the job DB
    return p;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    releaseLock(ctx, { lock } as Prepared);
    throw error;
  }
}

async function ownedCertificate(p: Prepared, signal?: AbortSignal) {
  const list = (await listCertificates(p.team, signal)).filter((c) => c.name === p.certName && !p.beforeIds.includes(c.id));
  invariant(list.length <= 1, "EFFECT_UNCERTAIN", "Multiple certificates match the exclusive attempt name; inspect AGC");
  return list[0];
}
export async function reconcileCertificate(ctx: Context) {
  const p = prepared(ctx);
  ownsLock(ctx, p);
  // Absence does not prove that a disconnected POST was not accepted. Never reissue it.
  return ownedCertificate(p, ctx.signal);
}
export async function certificate(ctx: Context) {
  const p = prepared(ctx);
  ownsLock(ctx, p);
  ctx.signal.throwIfAborted();
  try {
    await request(p.team, "/api/cps/harmony-cert-manage/v1/cert/add", "POST", { csr: fs.readFileSync(file(p, "csr"), "utf8"), certName: p.certName, certType: "1" }, ctx.signal);
    const cert = await ownedCertificate(p, ctx.signal);
    if (!cert) throw uncertain("certificate");
    return cert;
  } catch (error) {
    if (error instanceof ToolError && error.code === "SIGN_CLOUD_REJECTED") throw error;
    throw uncertain("certificate", error);
  }
}
export async function devices(ctx: Context) {
  const p = prepared(ctx);
  for (const target of await listTargets(ctx.signal)) {
    // registerDevice reconciles by UDID before writing; registration cannot be rolled back.
    try { await registerDevice(p.team, target, ctx.signal); } catch (error) { ctx.signal.throwIfAborted(); ctx.log(`device registration: ${(error as Error).message}`); }
  }
  const list = await listDevices(p.team, ctx.signal);
  invariant(list.length, "DEVICE_UNAVAILABLE", "No registered devices; keep existing signing and register a device explicitly");
  return { ids: list.map((d) => d.id), udids: list.map((d) => d.udid.toUpperCase()) };
}
export async function profile(ctx: Context) {
  const p = prepared(ctx);
  ownsLock(ctx, p);
  ctx.signal.throwIfAborted();
  try {
    const result = await request(p.team, "/api/cps/provision-manage/v1/ide/test/provision/add", "POST", {
      certList: [ctx.outputs.certificate.id], packageName: p.bundle, deviceList: ctx.outputs.devices.ids,
      provisionName: `mcp_${ctx.job_id}`, ...(p.acl.length ? { aclPermissionList: p.acl } : {}),
    }, ctx.signal);
    if (!result.provisionFileUrl) throw uncertain("profile");
    // Persist the URL as the receipt. AGC returns no deletable profile id; never invent one.
    return { object: result.provisionFileUrl as string, deletion: "IDE endpoint returns no profile id" };
  } catch (error) {
    if (error instanceof ToolError && error.code === "SIGN_CLOUD_REJECTED") throw error;
    throw uncertain("profile", error);
  }
}

/** Check file integrity, validity, bundle and key correspondence before publishing references. */
export async function material(ctx: Context) {
  const p = prepared(ctx);
  await download(p.team, ctx.outputs.certificate.object, file(p, "cer"), ctx.signal);
  await download(p.team, ctx.outputs.profile.object, file(p, "p7b"), ctx.signal);
  const cert = new crypto.X509Certificate(fs.readFileSync(file(p, "cer")));
  invariant(Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(), "SIGN_MATERIAL_INVALID", "New certificate is not currently valid");
  const tc = toolchain();
  invariant(tc.components.java, "CAPABILITY_UNAVAILABLE", "Java keytool is required to validate signing keys");
  const keytool = path.join(path.dirname(tc.components.java), process.platform === "win32" ? "keytool.exe" : "keytool");
  const password = decryptPassword(p.password, file(p, "p12"));
  const stored = await run({ file: keytool, args: ["-list", "-rfc", "-alias", "debugKey", "-keystore", file(p, "p12"), "-storepass", password] }, { signal: ctx.signal, timeoutMs: 30000 });
  const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(stored.stdout)?.[0];
  invariant(pem, "SIGN_MATERIAL_INVALID", "Keystore public key could not be read");
  const publicKey = (c: crypto.X509Certificate) => c.publicKey.export({ type: "spki", format: "der" });
  invariant(publicKey(cert).equals(publicKey(new crypto.X509Certificate(pem))), "SIGN_MATERIAL_INVALID", "New certificate does not match the prepared keypair");
  const bytes = fs.readFileSync(file(p, "p7b")), summary = profileSummary(bytes), payload = profilePayload(bytes);
  invariant(summary?.bundle === p.bundle && summary.type === "debug" && summary.expired === false && summary.valid_from && Date.parse(summary.valid_from) <= Date.now(),
    "SIGN_MATERIAL_INVALID", "New debug profile does not match this bundle/devices or is expired");
  const actual = payload?.["debug-info"]?.["device-ids"];
  invariant(Array.isArray(actual) && JSON.stringify(actual.map((v: string) => v.toUpperCase()).sort()) === JSON.stringify([...ctx.outputs.devices.udids].sort()),
    "SIGN_MATERIAL_INVALID", "New debug profile device identities differ from the requested set");
  const embedded = payload?.["bundle-info"]?.["development-certificate"];
  invariant(typeof embedded === "string" && new crypto.X509Certificate(embedded).raw.equals(cert.raw), "SIGN_MATERIAL_INVALID", "New profile is bound to a different certificate");
  invariant(p.acl.every((permission) => summary.acl_permissions?.includes(permission)), "SIGN_MATERIAL_INVALID", "New profile is missing requested ACL permissions");
  await signer(["verify-profile", "-inFile", file(p, "p7b")], ctx.signal);
  return { hashes: Object.fromEntries(["p12", "cer", "p7b"].map((ext) => [ext, sha256(fs.readFileSync(file(p, ext)))])) };
}
function committed(p: Prepared) {
  const config = readJson5(path.join(p.root, "build-profile.json5")) as any;
  const entry = config.app.signingConfigs?.find((c: any) => c.name === p.product);
  return entry?.material?.storeFile === file(p, "p12") && entry?.material?.certpath === file(p, "cer") && entry?.material?.profile === file(p, "p7b")
    && config.app.products?.find((v: any) => v.name === p.product)?.signingConfig === p.product;
}
function result(ctx: Context, p: Prepared) {
  return { signed: true, product: p.product, team: p.team, certificate: ctx.outputs.certificate.id, devices: ctx.outputs.devices.ids.length, acl_permissions: p.acl,
    files: { p12: file(p, "p12"), cer: file(p, "cer"), p7b: file(p, "p7b") }, previous_material: "retained; never revoked automatically", next: { tool: "run", action: "build_run", project: p.root } };
}
function validateHashes(ctx: Context, p: Prepared) {
  for (const [ext, hash] of Object.entries(ctx.outputs.material.hashes))
    invariant(fs.existsSync(file(p, ext)) && sha256(fs.readFileSync(file(p, ext))) === hash, "SIGN_MATERIAL_INVALID", `Prepared ${ext} changed before commit`);
}
export async function commit(ctx: Context) {
  const p = prepared(ctx);
  ownsLock(ctx, p);
  ctx.signal.throwIfAborted();
  validateHashes(ctx, p);
  const profilePath = path.join(p.root, "build-profile.json5");
  const original = fs.readFileSync(profilePath);
  invariant(sha256(original) === p.previous, "CONFLICT", "Project signing configuration changed during preparation; nothing overwritten");
  const config = JSON5.parse(original.toString()) as any;
  config.app.signingConfigs = (config.app.signingConfigs ?? []).filter((c: any) => c.name !== p.product);
  config.app.signingConfigs.push({ name: p.product, type: "HarmonyOS", material: { certpath: file(p, "cer"), keyAlias: "debugKey", keyPassword: p.password,
    profile: file(p, "p7b"), signAlg: "SHA256withECDSA", storeFile: file(p, "p12"), storePassword: p.password } });
  for (const v of config.app.products ?? []) if (v.name === p.product) v.signingConfig = p.product;
  atomicWrite(profilePath, JSON5.stringify(config, null, 2));
  return result(ctx, p);
}
export async function reconcileCommit(ctx: Context) {
  const p = prepared(ctx);
  if (!committed(p)) return undefined;
  validateHashes(ctx, p);
  return result(ctx, p);
}
export async function release(ctx: Context) {
  const p = prepared(ctx);
  // The directory is now intentional active material, not a disposable staging directory.
  fs.rmSync(file(p, "csr"), { force: true });
  releaseLock(ctx, p);
  return { active_material: p.dir, old_material: "retained" };
}

/** Definite precommit failure: revoke only a receipted attempt-owned certificate, never the old chain. */
export async function compensate(ctx: Context, error: unknown) {
  const p = ctx.outputs.prepare as Prepared | undefined;
  if (!p || (ctx.signal.reason as ToolError | undefined)?.code === "SHUTDOWN") return;
  if (committed(p)) { await release(ctx); return; } // config rename succeeded before receipt persisted
  if ((error as ToolError)?.code === "EFFECT_UNCERTAIN" && !fs.existsSync(path.join(p.dir, "compensation.json"))) return; // retain recovery evidence, no speculative DELETE
  if (ctx.outputs.compensation?.closed) return;
  const cert = ctx.outputs.certificate as { id: string; name: string } | undefined;
  if (cert) {
    invariant(cert.name === p.certName && !p.beforeIds.includes(cert.id), "EFFECT_UNCERTAIN", "Certificate ownership cannot be proven for compensation");
    // A delete intent is persisted to the owned directory before network I/O. If interrupted,
    // later recovery only queries the list and never blindly repeats DELETE.
    const intent = path.join(p.dir, "compensation.json");
    const signal = AbortSignal.timeout(30000); // cancellation must still allow bounded cleanup
    const present = (await listCertificates(p.team, signal)).find((c) => c.id === cert.id);
    if (present) {
      if (fs.existsSync(intent)) throw uncertain("compensation");
      invariant(present.name === p.certName, "EFFECT_UNCERTAIN", "Certificate ownership changed");
      atomicWrite(intent, JSON.stringify({ id: cert.id, state: "intent" }), 0o600);
      try { await request(p.team, "/api/cps/harmony-cert-manage/v1/cert/delete", "DELETE", { certIds: [cert.id] }, signal); }
      catch (cause) { throw uncertain("compensation", cause); }
      if ((await listCertificates(p.team, signal)).some((c) => c.id === cert.id)) throw uncertain("compensation");
    }
  }
  ctx.outputs.compensation = { closed: true, certificate: cert?.id ?? null,
    profile: ctx.outputs.profile ? "IDE file-only profile: cloud deletion cannot be confirmed (no id)" : "none" };
  fs.rmSync(p.dir, { recursive: true, force: true });
  releaseLock(ctx, p);
}
