import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite, readJson5 } from "../core/files.js";
import { run } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { credentials } from "./auth.js";
import { listTargets, shell } from "./device.js";

const cloud = "https://connect-api.cloud.huawei.com";

/* ------------------------ Studio/Hvigor password material ------------------------ */
// Layout and algorithm match DevEco Studio / deveco-cli KeyManager (MIT):
// <dir>/material/{fd/0..2, ac, ce} ; AES-128-GCM frame [len(4)][iv(12)][ct+tag]
const FIXED = Buffer.from([0x31, 0xf3, 0x09, 0x73, 0xd6, 0xaf, 0x5b, 0xb8, 0xd3, 0xbe, 0xb1, 0x58, 0x65, 0x83, 0xc0, 0x77]);

function gcmEncrypt(key: Buffer, plain: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, iv, body]);
}
function gcmDecrypt(key: Buffer, data: Buffer) {
  const length = data.readUInt32BE(0);
  const body = data.subarray(16, 16 + length);
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, data.subarray(4, 16));
  decipher.setAuthTag(body.subarray(-16));
  return Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
}
function readUnique(dir: string): Buffer {
  const files = fs.readdirSync(dir).filter((f) => f !== ".DS_Store");
  invariant(files.length === 1, "SIGN_MATERIAL_INVALID", `Expected one file in ${dir}`);
  const file = path.join(dir, files[0]!);
  return fs.statSync(file).isDirectory() ? readUnique(file) : fs.readFileSync(file);
}
function rootKey(parts: Buffer[], salt: Buffer) {
  const merged = Buffer.from(FIXED);
  for (const part of parts) for (let i = 0; i < 16; i++) merged[i] = merged[i]! ^ part[i]!;
  return crypto.pbkdf2Sync(Buffer.from(merged.toString("utf8"), "utf8"), salt, 10000, 16, "sha256");
}
function workKey(baseDir: string): Buffer {
  const material = path.join(baseDir, "material");
  if (fs.existsSync(material)) {
    const parts = [0, 1, 2].map((i) => readUnique(path.join(material, "fd", String(i))));
    return gcmDecrypt(rootKey(parts, readUnique(path.join(material, "ac"))), readUnique(path.join(material, "ce")));
  }
  const parts = [0, 1, 2].map(() => crypto.randomBytes(16));
  const salt = crypto.randomBytes(16);
  const work = crypto.randomBytes(16);
  const put = (dir: string, data: Buffer) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, crypto.randomBytes(8).toString("hex")), data, { mode: 0o600 });
  };
  parts.forEach((p, i) => put(path.join(material, "fd", String(i)), p));
  put(path.join(material, "ac"), salt);
  put(path.join(material, "ce"), gcmEncrypt(rootKey(parts, salt), work));
  return work;
}
export const encryptPassword = (password: string, storeFile: string) => gcmEncrypt(workKey(path.dirname(storeFile)), Buffer.from(password)).toString("hex");
export const decryptPassword = (hex: string, storeFile: string) => gcmDecrypt(workKey(path.dirname(storeFile)), Buffer.from(hex, "hex")).toString("utf8");

/* ------------------------------ cloud requests ------------------------------ */

async function request(team: string, route: string, method: string, body?: unknown, signal?: AbortSignal) {
  let auth = await credentials("developer", false, signal);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(cloud + route, {
      method,
      headers: { uid: auth.userId, teamId: team, oauth2Token: auth.access, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
    });
    if (response.status === 401 && attempt === 0) { auth = await credentials("developer", true, signal); continue; }
    const text = await response.text();
    invariant(response.ok, "HTTP_ERROR", `AppGallery Connect returned HTTP ${response.status} ${response.statusText}`,
      { body: text.slice(0, 500) }, response.status === 403 ? "The account lacks AGC permission for this team, or a proxy blocks connect-api.cloud.huawei.com" : undefined);
    const data = text ? (JSON.parse(text) as Record<string, any>) : {};
    if (data.ret && data.ret.code !== 0) {
      const hint = /205389938/.test(text) ? "Profile limit reached: delete old debug profiles in AGC" : /205389859/.test(text) ? "Device limit reached: remove unused devices in AGC" : undefined;
      throw new ToolError("SIGN_CLOUD_REJECTED", `AGC rejected ${route} (${data.ret.code}): ${data.ret.msg ?? ""}`, undefined, hint);
    }
    return data;
  }
  throw new ToolError("AUTH_REQUIRED", "Developer login expired");
}

async function download(team: string, source: string, file: string, signal?: AbortSignal) {
  const reply = await request(team, "/api/amis/app-manage/v1/objects/url/reapply", "POST", { sourceUrls: source }, signal);
  const first = reply.urlsInfo?.[0] as { newUrl: string; sha256: string } | undefined;
  invariant(first, "SIGN_CLOUD_REJECTED", "AGC returned no download URL");
  const response = await fetch(first.newUrl, { signal: AbortSignal.timeout(60000) });
  invariant(response.ok, "HTTP_ERROR", `Download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  invariant(crypto.createHash("sha256").update(bytes).digest("hex") === first.sha256.toLowerCase(), "INTEGRITY_FAILED", "Downloaded signing file checksum mismatch");
  atomicWrite(file, bytes, 0o600);
  return file;
}

export async function teamId(team?: string) {
  if (team) return team;
  const auth = await credentials("developer");
  return auth.userId;
}

export async function listCertificates(team: string, signal?: AbortSignal) {
  const data = await request(team, "/api/cps/harmony-cert-manage/v1/cert/list", "POST", undefined, signal);
  return ((data.certList ?? []) as { id: string; certName: string; certType: number; expireTime?: string; certObjectId: string }[])
    .map((c) => ({ id: c.id, name: c.certName, type: c.certType === 1 ? "debug" : "release", expires: c.expireTime, object: c.certObjectId }));
}
export async function listDevices(team: string, signal?: AbortSignal) {
  const out: { id: string; udid: string; name: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const data = await request(team, `/api/cps/device-manage/v1/device/list?encodeFlag=0&start=${page}&pageSize=100`, "GET", undefined, signal);
    const list = (data.list ?? []) as { id: string; udid: string; deviceName: string }[];
    out.push(...list.map((d) => ({ id: d.id, udid: d.udid, name: d.deviceName })));
    if (out.length >= (data.totalCount ?? 0) || list.length === 0) break;
  }
  return out;
}
export async function deleteCertificate(team: string, id: string, signal?: AbortSignal) {
  await request(team, "/api/cps/harmony-cert-manage/v1/cert/delete", "DELETE", { certIds: [id] }, signal);
  return { deleted: id };
}

export async function deviceUdid(target: string, signal?: AbortSignal) {
  const out = (await shell(target, ["bm", "get", "-u"], signal)).stdout;
  const udid = /[A-Fa-f0-9]{64}/.exec(out)?.[0]?.toUpperCase();
  invariant(udid, "DEVICE_UNAVAILABLE", `Cannot read UDID from ${target}`, { output: out.slice(0, 200) });
  return udid;
}

export async function registerDevice(team: string, target: string, signal?: AbortSignal) {
  const udid = await deviceUdid(target, signal);
  const existing = await listDevices(team, signal);
  const found = existing.find((d) => d.udid.toUpperCase() === udid);
  if (found) return { registered: false, already: true, id: found.id, udid };
  const type = (await shell(target, ["param", "get", "const.product.devicetype"], signal)).stdout.trim();
  const deviceType = /wearable/i.test(type) ? "2" : /tv/i.test(type) ? "3" : "4";
  await request(team, "/api/cps/device-manage/v1/device/add", "POST", { udid, deviceName: `deveco_mcp_${udid.slice(0, 8)}`, deviceType }, signal);
  const after = await listDevices(team, signal);
  const added = after.find((d) => d.udid.toUpperCase() === udid);
  invariant(added, "SIGN_CLOUD_REJECTED", "Device registration was not confirmed");
  return { registered: true, id: added.id, udid };
}

/* ---------------------------- one-shot auto signing ---------------------------- */

async function signer(args: string[], signal?: AbortSignal) {
  const result = await run(toolCommand("signer", args), { signal, timeoutMs: 120000, allowFailure: true });
  const text = result.stdout + result.stderr;
  invariant(result.code === 0 && !/\bERROR\b|FAILED|Exception/.test(text), "SIGN_FAILED", `hap-sign-tool ${args[0]} failed`, { output: text.slice(-1200).replace(/-(keystorePwd|keyPwd)\s+\S+/g, "-$1 ***") });
  return text;
}

/**
 * Equivalent of `devecocli signature generate` (and DevEco "Automatically generate signature"):
 * keypair+CSR -> debug certificate -> register connected devices -> debug profile ->
 * write signingConfigs (passwords encrypted with Studio material) into build-profile.json5.
 */
export async function autoSign(project: string, options: { product?: string; team?: string; bundle: string; acl?: string[] }, signal: AbortSignal, log: (m: string) => void) {
  const root = path.resolve(project);
  const product = options.product ?? "default";
  const team = await teamId(options.team);
  const dir = path.join(os.homedir(), ".ohos", "config");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const hash = crypto.createHash("sha256").update(root).digest("base64url").replace(/[-_=]/g, "");
  const baseName = `${product.replace(/[\\/:*?"<>|=-]/g, "_")}_${path.basename(root)}_${hash}=`;
  const file = (ext: string) => path.join(dir, `${baseName}.${ext}`);
  const password = crypto.randomBytes(8).toString("hex");
  for (const ext of ["p12", "csr", "cer", "p7b"]) fs.rmSync(file(ext), { force: true });

  log("generating keypair and CSR");
  await signer(["generate-keypair", "-keyAlias", "debugKey", "-keyAlg", "ECC", "-keySize", "NIST-P-256", "-keystoreFile", file("p12"), "-keystorePwd", password, "-keyPwd", password], signal);
  await signer(["generate-csr", "-keyAlias", "debugKey", "-subject", "CN=DebugKey", "-signAlg", "SHA256withECDSA", "-keystoreFile", file("p12"), "-keystorePwd", password, "-keyPwd", password, "-outFile", file("csr")], signal);

  log("requesting debug certificate");
  const certName = `auto_debug_${team.replace(/[^A-Za-z0-9_]/g, "")}.cer`;
  const existing = (await listCertificates(team, signal)).find((c) => c.name === certName);
  if (existing) await deleteCertificate(team, existing.id, signal);
  await request(team, "/api/cps/harmony-cert-manage/v1/cert/add", "POST", { csr: fs.readFileSync(file("csr"), "utf8"), certName, certType: "1" }, signal);
  const cert = (await listCertificates(team, signal)).find((c) => c.name === certName);
  invariant(cert, "SIGN_CLOUD_REJECTED", "Created certificate not found in AGC");
  await download(team, cert.object, file("cer"), signal);

  log("registering connected devices");
  const targets = await listTargets(signal);
  for (const target of targets) {
    try { await registerDevice(team, target, signal); } catch (error) { log(`device ${target}: ${(error as Error).message}`); }
  }
  const devices = await listDevices(team, signal);
  invariant(devices.length, "DEVICE_UNAVAILABLE", "No devices registered in AGC; connect a device and retry");

  log("creating debug profile");
  const provisionName = crypto.createHash("sha256").update(`${product}_${options.bundle}_${options.bundle}`).digest("hex").slice(0, 16);
  const profile = await request(team, "/api/cps/provision-manage/v1/ide/test/provision/add", "POST", {
    certList: [cert.id], packageName: options.bundle, deviceList: devices.map((d) => d.id), provisionName,
    ...(options.acl?.length ? { aclPermissionList: options.acl } : {}),
  }, signal);
  invariant(profile.provisionFileUrl, "SIGN_CLOUD_REJECTED", "AGC returned no profile file");
  await download(team, profile.provisionFileUrl, file("p7b"), signal);
  if (profile.id) await request(team, `/api/cps/provision-manage/v1/provision/delete?${new URLSearchParams({ id: profile.id })}`, "DELETE", undefined, signal).catch(() => {});

  log("writing signingConfigs");
  const encrypted = encryptPassword(password, file("p12"));
  const profilePath = path.join(root, "build-profile.json5");
  const config = readJson5(profilePath) as { app: { signingConfigs?: any[]; products?: any[] } };
  config.app.signingConfigs = (config.app.signingConfigs ?? []).filter((c) => c.name !== product);
  config.app.signingConfigs.push({
    name: product, type: "HarmonyOS",
    material: { certpath: file("cer"), keyAlias: "debugKey", keyPassword: encrypted, profile: file("p7b"), signAlg: "SHA256withECDSA", storeFile: file("p12"), storePassword: encrypted },
  });
  for (const p of config.app.products ?? []) if (p.name === product) p.signingConfig = product;
  atomicWrite(profilePath, JSON5.stringify(config, null, 2));
  return { signed: true, product, team, certificate: cert.id, devices: devices.length, files: { p12: file("p12"), cer: file("cer"), p7b: file("p7b") }, next: { tool: "run", action: "build_run", project: root } };
}

/* ------------------------------- local signing ------------------------------- */

export async function signPackage(input: { file: string; out: string; project?: string; product?: string; keystore?: string; keystore_password?: string; key_alias?: string; key_password?: string; cert?: string; profile?: string }, signal?: AbortSignal) {
  let material = { keystore: input.keystore, storePwd: input.keystore_password, alias: input.key_alias, keyPwd: input.key_password, cert: input.cert, profile: input.profile };
  if (!material.keystore && input.project) {
    const config = readJson5(path.join(path.resolve(input.project), "build-profile.json5")) as { app: { signingConfigs?: any[] } };
    const entry = config.app.signingConfigs?.find((c) => c.name === (input.product ?? "default"));
    invariant(entry, "SIGN_CONFIG_MISSING", "No signingConfig for this product", undefined, "Run sign action=auto first");
    const m = entry.material;
    const store = path.resolve(input.project, m.storeFile);
    material = { keystore: store, storePwd: decryptPassword(m.storePassword, store), alias: m.keyAlias, keyPwd: decryptPassword(m.keyPassword, store), cert: path.resolve(input.project, m.certpath), profile: path.resolve(input.project, m.profile) };
  }
  invariant(material.keystore && material.storePwd && material.alias && material.keyPwd && material.cert && material.profile, "INVALID_INPUT", "Signing material incomplete: pass project (with signingConfigs) or keystore/password/alias/cert/profile");
  invariant(!fs.existsSync(input.out), "CONFLICT", `${input.out} already exists`);
  await signer(["sign-app", "-mode", "localSign", "-keyAlias", material.alias, "-keyPwd", material.keyPwd, "-appCertFile", material.cert, "-profileFile", material.profile,
    "-inFile", path.resolve(input.file), "-signAlg", "SHA256withECDSA", "-keystoreFile", material.keystore, "-keystorePwd", material.storePwd, "-outFile", path.resolve(input.out)], signal);
  return { signed: path.resolve(input.out), bytes: fs.statSync(input.out).size };
}

export async function verifyPackage(file: string, signal?: AbortSignal) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-verify-"));
  try {
    const output = await signer(["verify-app", "-inFile", path.resolve(file), "-outCertChain", path.join(dir, "chain.cer"), "-outProfile", path.join(dir, "profile.p7b")], signal);
    const profileText = fs.existsSync(path.join(dir, "profile.p7b")) ? fs.readFileSync(path.join(dir, "profile.p7b"), "latin1") : "";
    const json = /\{[\s\S]*"bundle-info"[\s\S]*\}/.exec(profileText)?.[0];
    let summary: Record<string, unknown> | undefined;
    if (json) {
      try {
        const p = JSON.parse(json);
        summary = { type: p.type, bundle: p["bundle-info"]?.["bundle-name"], devices: p["debug-info"]?.["device-ids"]?.length, expires: p.validity?.["not-after"] ? new Date(p.validity["not-after"] * 1000).toISOString() : undefined };
      } catch { /* keep raw */ }
    }
    return { verified: /verify.*success|success/i.test(output), profile: summary };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
