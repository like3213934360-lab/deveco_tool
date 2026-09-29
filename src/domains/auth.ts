import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { stateDir } from "../core/config.js";
import { database } from "../core/db.js";
import { invariant, ToolError } from "../core/errors.js";
import { spawnIndependent } from "../core/proc.js";

export type Provider = "developer" | "codegenie";
export type Region = "cn" | "global";
/** Login portals (upstream ApiEndpoints.CN_LOGIN_URL / LOGIN_URL). */
export const regionBase: Record<Region, string> = { cn: "https://cn.devecostudio.huawei.com", global: "https://devecostudio.huawei.com" };
/** Callback siteId -> country code sent to temptoken/check (upstream utils/region.ts). */
export const siteCountry: Record<string, string> = { "1": "CN", "5": "SG", "7": "EU", "8": "RU" };
/** Which callback sites a region accepts: cn only the China site, global the overseas sites. */
export function siteAllowed(region: Region, siteId: string | null) {
  if (!siteId) return true;
  return region === "cn" ? siteId === "1" : siteId in siteCountry && siteId !== "1";
}
const appIds: Record<Provider, string> = { developer: "1009", codegenie: "1008" };

interface Credentials { jwt: string; access: string; saved: number; userId: string; userName: string; expires?: number; region?: Region }

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

async function load(provider: Provider): Promise<Credentials | undefined> {
  const row = (await database()).prepare("SELECT data FROM credentials WHERE provider=?").get(provider) as { data: Uint8Array | null } | undefined;
  if (!row?.data) return undefined;
  const data = Buffer.from(row.data);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(provider));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    throw new ToolError("AUTH_REQUIRED", "Stored credentials cannot be decrypted", undefined, `auth action=logout provider=${provider}, then log in again`);
  }
}
async function save(provider: Provider, value: Credentials | undefined) {
  const db = await database();
  if (!value) { db.prepare("DELETE FROM credentials WHERE provider=?").run(provider); return; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  cipher.setAAD(Buffer.from(provider));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  db.prepare("INSERT OR REPLACE INTO credentials(provider,data) VALUES(?,?)").run(provider, Buffer.concat([iv, cipher.getAuthTag(), body]));
}

async function checkJwt(jwt: string, refresh: boolean, region: Region, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${regionBase[region]}/authrouter/auth/api/jwToken/check`, { headers: { jwtToken: jwt, refresh: String(refresh) }, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
  const data = (await response.json().catch(() => ({}))) as { status?: boolean; userInfo?: { accessToken?: string } };
  invariant(response.ok && data.status === true && data.userInfo?.accessToken, "AUTH_REQUIRED", "Login expired or was rejected", undefined, "Log in again with auth action=login");
  return data.userInfo.accessToken;
}

export async function credentials(provider: Provider, force = false, signal?: AbortSignal): Promise<Credentials> {
  const current = await load(provider);
  invariant(current && (!current.expires || current.expires * 1000 > Date.now()), "AUTH_REQUIRED", `Not logged in to ${provider}`, undefined, `auth action=login provider=${provider}`);
  if (!force && Date.now() - current.saved < 30 * 60000) return current;
  const access = await checkJwt(current.jwt, true, current.region ?? "cn", signal);
  const updated = { ...current, access, saved: Date.now() };
  await save(provider, updated);
  return updated;
}

/* ---------------------------------- login ---------------------------------- */

const logins = new Map<Provider, { url: string; server: http.Server; done: Promise<void>; error?: string; browser: string; region: Region }>();

export async function login(provider: Provider, openBrowser = true, region: Region = "cn") {
  const active = logins.get(provider);
  if (active) return { provider, region: active.region, pending: true, login_url: active.url, browser: active.browser };
  const base = regionBase[region];
  let site = "1";
  const nonce = crypto.randomBytes(24).toString("hex");
  let accept!: (token: string) => void;
  let reject!: (error: Error) => void;
  const token = new Promise<string>((a, r) => { accept = a; reject = r; });
  token.catch(() => {});
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
      if (!siteAllowed(region, params.get("siteId"))) throw new Error(`account site ${params.get("siteId")} does not match region ${region}`);
      site = params.get("siteId") ?? site;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      if (["true", "access_denied", "quit"].includes(params.get("quit") ?? "")) {
        res.end("<h1>登录已取消</h1>");
        reject(new ToolError("AUTH_REQUIRED", "Login was cancelled in the browser"));
        return;
      }
      const temp = params.get("tempToken");
      if (!temp) throw new Error("missing token");
      res.end("<h1>DevEco MCP 登录成功</h1><p>可以关闭此页面并返回。</p>");
      accept(temp);
    })().catch(() => { if (!res.headersSent) { res.writeHead(400); res.end("invalid"); } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `${base}/console/DevEcoIDE/apply?${new URLSearchParams({ port: String(port), appid: appIds[provider], code: nonce })}`;
  const timeout = setTimeout(() => reject(new ToolError("TIMEOUT", "Login timed out after 5 minutes")), 300000);
  timeout.unref();
  const entry = { url, server, browser: openBrowser ? "opened" : "manual", done: Promise.resolve(), region } as { url: string; server: http.Server; done: Promise<void>; error?: string; browser: string; region: Region };
  entry.done = (async () => {
    try {
      const temp = await token;
      const query = new URLSearchParams({ tempToken: temp.split("&")[0]!, site: siteCountry[site] ?? "CN", version: "1.0.0", appid: appIds[provider] });
      const response = await fetch(`${base}/authrouter/auth/api/temptoken/check?${query}`, { signal: AbortSignal.timeout(20000) });
      const jwt = (await response.text()).trim();
      invariant(jwt.split(".").length === 3, "AUTH_REQUIRED", "Authentication server returned an invalid session");
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { userId?: string; userName?: string; exp?: number };
      const access = await checkJwt(jwt, false, region);
      await save(provider, { jwt, access, saved: Date.now(), userId: payload.userId ?? "", userName: payload.userName ?? "", expires: payload.exp, region });
    } catch (error) {
      entry.error = (error as Error).message;
    } finally {
      clearTimeout(timeout);
      server.close();
      server.closeAllConnections();
      setTimeout(() => logins.delete(provider), 60000).unref();
    }
  })();
  logins.set(provider, entry);
  if (openBrowser) {
    const opener = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
    try { spawnIndependent({ file: opener[0] as string, args: opener[1] as string[] }); } catch { entry.browser = "manual"; }
  }
  return { provider, region, pending: true, login_url: url, browser: entry.browser, next: { tool: "auth", action: "status", provider, note: "Call after completing the browser login" } };
}

export async function status(provider: Provider) {
  const current = await load(provider).catch(() => undefined);
  const pending = logins.get(provider);
  return {
    provider,
    logged_in: !!current && (!current.expires || current.expires * 1000 > Date.now()),
    user: current?.userName || undefined,
    ...(current ? { region: current.region ?? "cn" } : {}),
    ...(pending ? { login_pending: !pending.error && !current, login_url: pending.url, ...(pending.error ? { error: pending.error } : {}) } : {}),
  };
}

export async function logout(provider: Provider) {
  const pending = logins.get(provider);
  if (pending) { pending.server.close(); logins.delete(provider); }
  await save(provider, undefined);
  return { provider, logged_in: false };
}

export async function teams(signal?: AbortSignal) {
  const auth = await credentials("developer", false, signal);
  const response = await fetch("https://connect-api.cloud.huawei.com/api/ups/user-permission-service/v1/user-team-list", {
    headers: { uid: auth.userId, oauth2Token: auth.access, source: "cli", lang: "zh_CN" }, signal: AbortSignal.timeout(20000),
  });
  const data = (await response.json()) as { ret?: { code: number; msg?: string }; teams?: { id: string | number; name: string; userType?: number }[] };
  invariant(!data.ret || data.ret.code === 0, "HTTP_ERROR", `Team query rejected: ${data.ret?.msg ?? data.ret?.code}`);
  return { teams: (data.teams ?? []).map((t) => ({ id: String(t.id), name: t.name, role: t.userType })) };
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
