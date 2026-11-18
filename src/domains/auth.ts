import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { stateDir } from "../core/config.js";
import { database } from "../core/db.js";
import { invariant, ToolError } from "../core/errors.js";
import { spawnIndependent } from "../core/proc.js";
import { resolveRegion } from "./region-services.js";

export type Provider = "developer" | "codegenie";
export type Region = "cn" | "global" | "hk" | "mo";
/** Login portals (upstream ApiEndpoints.CN_LOGIN_URL / LOGIN_URL). */
export const regionBase = process.env.DEVECO_LOGIN_URL
  ? { cn: process.env.DEVECO_LOGIN_URL, global: process.env.DEVECO_LOGIN_URL } // tests: local mock portal
  : { cn: "https://cn.devecostudio.huawei.com", global: "https://devecostudio.huawei.com" };
/** Callback siteId -> country code sent to temptoken/check (upstream utils/region.ts). */
export const siteCountry: Record<string, string> = { "1": "CN", "5": "SG", "7": "EU", "8": "RU" };
/** Which callback sites a region accepts: cn only the China site, global the overseas sites. */
export function siteAllowed(region: Region, siteId: string | null) {
  if (region === "hk" || region === "mo") return !!siteId && Object.hasOwn(siteCountry, siteId);
  if (!siteId) return true;
  return region === "cn" ? siteId === "1" : Object.hasOwn(siteCountry, siteId) && siteId !== "1";
}
async function loginBase(region: Region, site?: string, signal?: AbortSignal) {
  if (region === "cn" || region === "global") return regionBase[region];
  if (process.env.DEVECO_LOGIN_URL) return process.env.DEVECO_LOGIN_URL;
  if (site === "CN") return regionBase.cn;
  return (await resolveRegion(site ?? region.toUpperCase(), signal)).spaceintroduce;
}

export async function serviceBase(region: Region = "cn", service: "agcups" | "agcsign" | "spaceintroduce", signal?: AbortSignal) {
  const override = service === "spaceintroduce" ? process.env.DEVECO_LOGIN_URL : process.env.DEVECO_AGC_URL;
  if (override) return override;
  if (region === "hk" || region === "mo") return (await resolveRegion(region.toUpperCase(), signal))[service];
  return service === "spaceintroduce" ? regionBase.cn : "https://connect-api.cloud.huawei.com";
}
const appIds: Record<Provider, string> = { developer: "1009", codegenie: "1008" };

interface Credentials { jwt: string; access: string; saved: number; userId: string; userName: string; expires?: number; region?: Region; site?: string }

let key: Buffer | undefined;
function secret(): Buffer {
  if (key) return key;
  const file = path.join(stateDir(), "credential.key");
  if (!fs.existsSync(file)) {
    try { fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: "wx" }); } catch { /* raced */ }
  }
  key = fs.readFileSync(file);
  invariant(key.length === 32, "AUTH_REQUIRED", "Credential key is invalid; delete credential.key and log in again");
  return key;
}

async function load(provider: Provider): Promise<{ value: Credentials; data: Buffer } | undefined> {
  const row = (await database()).prepare("SELECT data FROM credentials WHERE provider=?").get(provider) as { data: Uint8Array | null } | undefined;
  if (!row?.data) return undefined;
  const data = Buffer.from(row.data);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(provider));
    decipher.setAuthTag(data.subarray(12, 28));
    return { value: JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as Credentials, data };
  } catch {
    throw new ToolError("AUTH_REQUIRED", "Stored credentials cannot be decrypted", undefined, `auth action=logout provider=${provider}, then log in again`);
  }
}
async function save(provider: Provider, value: Credentials | undefined, expected?: Buffer) {
  const db = await database();
  if (!value) { db.prepare("DELETE FROM credentials WHERE provider=?").run(provider); return; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  cipher.setAAD(Buffer.from(provider));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  const encrypted = Buffer.concat([iv, cipher.getAuthTag(), body]);
  if (expected) {
    const changed = db.prepare("UPDATE credentials SET data=? WHERE provider=? AND data=?").run(encrypted, provider, expected);
    invariant(changed.changes === 1, "AUTH_REQUIRED", "Login changed during token refresh; the old refresh was discarded");
  } else db.prepare("INSERT OR REPLACE INTO credentials(provider,data) VALUES(?,?)").run(provider, encrypted);
}

async function checkJwt(jwt: string, refresh: boolean, region: Region, base: string, signal?: AbortSignal) {
  const response = await fetch(`${base}/authrouter/auth/api/jwToken/check`, { redirect: "error", headers: { jwtToken: jwt, refresh: String(refresh) }, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
  const data = (await response.json().catch(() => ({}))) as { status?: boolean; userInfo?: { accessToken?: string; nationalCode?: string } };
  invariant(response.ok && data.status === true && data.userInfo?.accessToken, "AUTH_REQUIRED", "Login expired or was rejected", undefined, "Log in again with auth action=login");
  const market = typeof data.userInfo.nationalCode === "string" ? data.userInfo.nationalCode.toLowerCase() : undefined;
  if (region === "hk" || region === "mo") invariant(market === region, "AUTH_REQUIRED", "Verified account region does not match the selected region");
  return { access: data.userInfo.accessToken, region: market === "hk" || market === "mo" ? market as Region : region };
}

export async function credentials(provider: Provider, force = false, signal?: AbortSignal): Promise<Credentials> {
  const stored = await load(provider), current = stored?.value;
  invariant(current && (!current.expires || current.expires * 1000 > Date.now()), "AUTH_REQUIRED", `Not logged in to ${provider}`, undefined, `auth action=login provider=${provider}`);
  if (!force && Date.now() - current.saved < 30 * 60000) return current;
  const region = current.region ?? "cn";
  const checked = await checkJwt(current.jwt, true, region, await loginBase(region, current.site, signal), signal);
  const updated = { ...current, ...checked, saved: Date.now() };
  await save(provider, updated, stored!.data);
  return updated;
}

/* ---------------------------------- login ---------------------------------- */

interface Login {
  url: string; server: http.Server; done: Promise<void>; pending: boolean; cancel: () => void;
  error?: string; browser: string; region: Region;
}
const logins = new Map<Provider, Login>();
const starting = new Map<Provider, { region: Region; ready: ReturnType<typeof startLogin> }>();

export async function login(provider: Provider, openBrowser = true, region: Region = "cn") {
  const initial = starting.get(provider);
  if (initial) {
    invariant(initial.region === region, "CONFLICT", "Another region already has a pending login for this provider");
    return initial.ready;
  }
  const ready = startLogin(provider, openBrowser, region);
  starting.set(provider, { region, ready });
  try { return await ready; } finally { starting.delete(provider); }
}

async function startLogin(provider: Provider, openBrowser: boolean, region: Region) {
  const active = logins.get(provider);
  if (active?.pending) {
    invariant(active.region === region, "CONFLICT", "Another region already has a pending login for this provider");
    return { provider, region: active.region, pending: true, login_url: active.url, browser: active.browser };
  }
  const base = await loginBase(region);
  const nonce = crypto.randomBytes(24).toString("hex");
  let accept!: (value: { temp: string; site: string }) => void;
  let reject!: (error: Error) => void;
  const token = new Promise<{ temp: string; site: string }>((a, r) => { accept = a; reject = r; });
  token.catch(() => {});
  const controller = new AbortController();
  const cancel = (error: ToolError) => { controller.abort(error); reject(error); };
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let params = url.searchParams;
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error("too large"); }
        params = new URLSearchParams(body);
      }
      const code = Buffer.from(params.get("code") ?? "");
      const expected = Buffer.from(nonce);
      const hostOk = [`127.0.0.1:${(server.address() as { port: number }).port}`, `localhost:${(server.address() as { port: number }).port}`].includes(req.headers.host ?? "");
      if (!hostOk || url.pathname !== "/callback" || code.length !== expected.length || !crypto.timingSafeEqual(code, expected)) throw new Error("invalid callback");
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      if (["true", "access_denied", "quit"].includes(params.get("quit") ?? "")) {
        res.end("<h1>登录已取消</h1>");
        reject(new ToolError("AUTH_REQUIRED", "Login was cancelled in the browser"));
        return;
      }
      const temp = params.get("tempToken");
      if (!temp || !siteAllowed(region, params.get("siteId"))) throw new Error("invalid token or site");
      res.end("<h1>DevEco MCP 已收到登录信息</h1><p>正在验证，请返回宿主通过 auth status 确认登录结果。</p>");
      accept({ temp, site: siteCountry[params.get("siteId") ?? "1"]! });
    })().catch(() => { if (!res.headersSent) { res.writeHead(400); res.end("invalid"); } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `${base}/console/DevEcoIDE/apply?${new URLSearchParams({ port: String(port), appid: appIds[provider], code: nonce })}`;
  const timeout = setTimeout(() => cancel(new ToolError("TIMEOUT", "Login timed out after 5 minutes")), 300000);
  timeout.unref();
  const entry: Login = { url, server, browser: openBrowser ? "opened" : "manual", done: Promise.resolve(), region, pending: true,
    cancel: () => cancel(new ToolError("AUTH_REQUIRED", "Login was cancelled by logout")) };
  entry.done = (async () => {
    try {
      const { temp, site } = await token;
      const exchange = await loginBase(region, site, controller.signal);
      const query = new URLSearchParams({ tempToken: temp.split("&")[0]!, site, version: "1.0.0", appid: appIds[provider] });
      const response = await fetch(`${exchange}/authrouter/auth/api/temptoken/check?${query}`, { redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      invariant(response.ok, "AUTH_REQUIRED", "Token exchange was rejected");
      const jwt = (await response.text()).trim();
      invariant(jwt.split(".").length === 3, "AUTH_REQUIRED", "Authentication server returned an invalid session");
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { userId?: string; userName?: string; exp?: number };
      const checked = await checkJwt(jwt, false, region, exchange, controller.signal);
      controller.signal.throwIfAborted();
      await save(provider, { jwt, ...checked, saved: Date.now(), userId: payload.userId ?? "", userName: payload.userName ?? "", expires: payload.exp, site });
    } catch (error) {
      entry.error = (error as Error).message;
    } finally {
      entry.pending = false;
      clearTimeout(timeout);
      server.close();
      server.closeAllConnections();
      setTimeout(() => { if (logins.get(provider) === entry) logins.delete(provider); }, 60000).unref();
    }
  })();
  logins.set(provider, entry);
  if (openBrowser) {
    const opener = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
    try { await (await spawnIndependent({ file: opener[0] as string, args: opener[1] as string[] })).detach(); } catch { entry.browser = "manual"; }
  }
  return { provider, region, pending: true, login_url: url, browser: entry.browser, next: { tool: "auth", action: "status", provider, note: "Call after completing the browser login" } };
}

export async function status(provider: Provider) {
  const current = (await load(provider).catch(() => undefined))?.value;
  const pending = logins.get(provider);
  return {
    provider,
    logged_in: !!current && (!current.expires || current.expires * 1000 > Date.now()),
    user: current?.userName || undefined,
    ...(current ? { region: current.region ?? "cn" } : {}),
    ...(pending ? { login_pending: pending.pending, login_url: pending.url, ...(pending.error ? { error: pending.error } : {}) } : {}),
  };
}

export async function logout(provider: Provider) {
  await starting.get(provider)?.ready.catch(() => undefined); // A failed start has no listener to cancel.
  const pending = logins.get(provider);
  if (pending) {
    pending.cancel();
    await pending.done;
    if (logins.get(provider) === pending) logins.delete(provider);
  }
  await save(provider, undefined);
  return { provider, logged_in: false };
}

export async function teams(signal?: AbortSignal) {
  const auth = await credentials("developer", false, signal);
  const base = await serviceBase(auth.region, "agcups", signal);
  const lang = auth.region === "hk" || auth.region === "mo" ? "en_" + auth.region.toUpperCase() : "zh_CN";
  const response = await fetch(`${base}/api/ups/user-permission-service/v1/user-team-list`, {
    redirect: "error", headers: { uid: auth.userId, oauth2Token: auth.access, source: "cli", lang }, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
  });
  invariant(response.ok, "HTTP_ERROR", `Team query returned HTTP ${response.status}`);
  const data = (await response.json()) as { ret?: { code: number; msg?: string }; teams?: { id: string | number; name: string; userType?: number }[] };
  invariant(!data.ret || data.ret.code === 0, "HTTP_ERROR", `Team query rejected: ${data.ret?.msg ?? data.ret?.code}`);
  invariant(Array.isArray(data.teams) && data.teams.every((t) => t && ["string", "number"].includes(typeof t.id) && typeof t.name === "string"), "EVIDENCE_MISSING", "Invalid developer team list");
  return { teams: data.teams.map((t) => {
    const characters = [...(t.name ?? "")];
    const name = characters.length ? `${characters.slice(0, Math.max(1, Math.floor(characters.length / 2))).join("")}****` : "";
    return { id: String(t.id), name, role: t.userType };
  }) };
}

/** One-time import of v0.x credentials (same AES-GCM format, provider as AAD). */
export async function migrateLegacy(legacyStateDir: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(legacyStateDir, "state.sqlite");
  const keyFile = path.join(legacyStateDir, "credential.key");
  invariant(fs.existsSync(file) && fs.existsSync(keyFile), "NOT_FOUND", `No v0.x credentials under ${legacyStateDir}`);
  const legacyKey = fs.readFileSync(keyFile);
  const db = new DatabaseSync(file, { readOnly: true });
  const imported: string[] = [];
  try {
    for (const row of db.prepare("SELECT provider, ciphertext FROM credentials WHERE ciphertext IS NOT NULL").all() as { provider: Provider; ciphertext: Uint8Array }[]) {
      const data = Buffer.from(row.ciphertext);
      const decipher = crypto.createDecipheriv("aes-256-gcm", legacyKey, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(row.provider));
      decipher.setAuthTag(data.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as Credentials;
      await save(row.provider, value);
      imported.push(row.provider);
    }
  } finally {
    db.close();
  }
  return { imported };
}
