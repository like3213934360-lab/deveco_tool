import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { z } from "zod";
import { StateStore } from "../core/store.js";
import { ProcessService } from "../core/process.js";
import { invariant, ToolError, errorResult } from "../core/errors.js";
import { localKey } from "../core/crypto.js";
import { CallbackError, readAuthCallback } from "./auth-callback.js";

export const providerSchema = z.enum(["developer", "codegenie"]);
export type Provider = z.infer<typeof providerSchema>;
const base = "https://cn.devecostudio.huawei.com";
function callbackPage(kind: "received" | "cancelled" | "invalid"): string {
  const message = {
    received: "授权回调已接收。请返回 MCP 客户端确认登录结果。",
    cancelled: "本次登录已取消。可以返回 MCP 客户端。",
    invalid: "登录回调无效。请返回 MCP 客户端查看状态或重新发起登录。",
  }[kind];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DevEco MCP 登录</title></head><body><h1>DevEco MCP 登录</h1><p>${message}</p></body></html>`;
}
const credentialsSchema = z.object({
  jwt: z.string(),
  access: z.string(),
  saved: z.number(),
  userId: z.string(),
  userName: z.string(),
  expires: z.number().optional(),
});
type Credentials = z.infer<typeof credentialsSchema>;
const jwtPayload = z.object({
  userId: z.string().default(""),
  userName: z.string().default(""),
  exp: z.number().optional(),
});
interface CredentialRow {
  revision: string;
  ciphertext: Buffer | null;
}
interface Login {
  controller: AbortController;
  server: http.Server;
  url: string;
  browser_status: "opening" | "opened" | "manual_required";
  browser_error?: string;
  finished: Promise<void>;
  error?: ReturnType<typeof errorResult>;
  callback: {
    received: number;
    rejected: number;
    accepted: boolean;
    last_rejection?: string;
  };
}

const teamSchema = z.object({
  id: z
    .union([z.string().min(1), z.number().int().nonnegative()])
    .transform(String),
  name: z.string(),
  countryCode: z.string().optional(),
  siteId: z.number().int().optional(),
  userType: z.number().int().optional(),
});
export function developerTeams(raw: unknown) {
  const response = z
    .object({
      ret: z
        .object({ code: z.number(), msg: z.string().optional() })
        .optional(),
      teams: z.unknown().optional(),
    })
    .safeParse(raw);
  invariant(
    response.success,
    "TEAM_LIST_INVALID",
    "Invalid developer team response",
  );
  if (response.data.ret && response.data.ret.code !== 0)
    throw new ToolError(
      "TEAM_LIST_REJECTED",
      "Developer service rejected the team query",
      { code: response.data.ret.code },
    );
  const teams = z.array(teamSchema).max(1000).safeParse(response.data.teams);
  invariant(
    teams.success,
    "TEAM_LIST_INVALID",
    "Developer service did not return a valid team inventory",
  );
  return { teams: teams.data };
}

/** Bounded HTTP response reader. Errors deliberately exclude authentication headers and URLs containing tokens. */
export async function httpRequest(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<string> {
  return (await httpBytes(url, options, signal)).toString("utf8");
}
export async function httpBytes(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(20000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ToolError(
      "HTTP_ERROR",
      `Remote service returned HTTP ${response.status}`,
      { status: response.status },
    );
  }
  invariant(response.body, "HTTP_EMPTY", "Remote service returned no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      invariant(
        bytes <= 8 * 1024 * 1024,
        "HTTP_TOO_LARGE",
        "Remote response exceeds 8 MiB",
      );
      chunks.push(item.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class AuthService {
  private readonly key: Buffer;
  private readonly logins = new Map<Provider, Login>();
  private readonly loginStarts = new Map<
    Provider,
    {
      controller: AbortController;
      finished: Promise<{
        provider: Provider;
        login_url: string;
        pending: boolean;
      }>;
    }
  >();
  private readonly refreshes = new Map<Provider, Set<AbortController>>();
  private readonly refreshClosures = new Set<Promise<void>>();
  private closed = false;
  constructor(
    readonly store: StateStore,
    readonly processes: ProcessService,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, revision TEXT NOT NULL, ciphertext BLOB)",
    );
    const file = path.join(store.root, "credential.key");
    this.key = localKey(file);
    for (const provider of providerSchema.options)
      store.db
        .prepare("INSERT OR IGNORE INTO credentials VALUES (?,?,NULL)")
        .run(provider, crypto.randomUUID());
  }
  private row(provider: Provider): CredentialRow {
    return this.store.db
      .prepare("SELECT revision,ciphertext FROM credentials WHERE provider=?")
      .get(provider) as CredentialRow;
  }
  private read(provider: Provider): {
    revision: string;
    credentials: Credentials | null;
  } {
    const row = this.row(provider);
    if (!row.ciphertext) return { revision: row.revision, credentials: null };
    try {
      const iv = row.ciphertext.subarray(0, 12),
        tag = row.ciphertext.subarray(12, 28);
      const decoder = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decoder.setAAD(Buffer.from(provider));
      decoder.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decoder.update(row.ciphertext.subarray(28)),
        decoder.final(),
      ]);
      return {
        revision: row.revision,
        credentials: credentialsSchema.parse(
          JSON.parse(plaintext.toString("utf8")) as unknown,
        ),
      };
    } catch {
      throw new ToolError(
        "CREDENTIAL_UNREADABLE",
        "Stored credentials cannot be decrypted; explicitly log out and log in again",
      );
    }
  }
  private save(
    provider: Provider,
    revision: string,
    credentials: Credentials,
  ): void {
    const iv = crypto.randomBytes(12),
      encoder = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    encoder.setAAD(Buffer.from(provider));
    const data = Buffer.concat([
      encoder.update(JSON.stringify(credentials)),
      encoder.final(),
    ]);
    const changed = this.store.db
      .prepare(
        "UPDATE credentials SET ciphertext=? WHERE provider=? AND revision=?",
      )
      .run(
        Buffer.concat([iv, encoder.getAuthTag(), data]),
        provider,
        revision,
      ).changes;
    invariant(
      changed === 1,
      "AUTH_CANCELLED",
      "Login state changed during authentication",
    );
  }
  status(provider: Provider) {
    const { credentials } = this.read(provider);
    const login = this.logins.get(provider);
    return {
      provider,
      logged_in:
        !!credentials &&
        (!credentials.expires || credentials.expires * 1000 > Date.now()),
      user_id: credentials?.userId,
      user_name: credentials?.userName,
      login_pending: !!login && !login.controller.signal.aborted,
      ...(login && !login.controller.signal.aborted
        ? {
            login_url: login.url,
            browser_status: login.browser_status,
            ...(login.browser_error ? { browser_error: login.browser_error } : {}),
          }
        : {}),
      ...(login ? { callback: { ...login.callback } } : {}),
      ...(login?.error ? { error: login.error } : {}),
    };
  }
  async login(provider: Provider, openBrowser = true) {
    invariant(!this.closed, "AUTH_CLOSED", "Authentication service is closed");
    const previous = this.loginStarts.get(provider);
    if (previous) return previous.finished;
    const controller = new AbortController();
    // Register the owner before any asynchronous logout or listener setup.
    const finished = Promise.resolve().then(() =>
      this.startLogin(provider, openBrowser, controller),
    );
    this.loginStarts.set(provider, { controller, finished });
    try {
      return await finished;
    } finally {
      if (this.loginStarts.get(provider)?.finished === finished)
        this.loginStarts.delete(provider);
    }
  }
  private async startLogin(
    provider: Provider,
    openBrowser: boolean,
    controller: AbortController,
  ) {
    controller.signal.throwIfAborted();
    const active = this.logins.get(provider);
    if (active && !active.controller.signal.aborted)
      return { provider, login_url: active.url, pending: true };
    const revision = await this.clearProvider(provider);
    controller.signal.throwIfAborted();
    invariant(
      this.row(provider).revision === revision,
      "AUTH_CANCELLED",
      "Authentication changed while starting login",
    );
    const nonce = crypto.randomBytes(24).toString("hex");
    let accept: (value: string) => void = () => {},
      reject: (error: unknown) => void = () => {};
    const callback = new Promise<string>((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    void callback.catch(() => {});
    const callbackState: Login["callback"] = {
      received: 0,
      rejected: 0,
      accepted: false,
    };
    const server = http.createServer((request, response) => {
      callbackState.received++;
      request.setTimeout(10000, () => request.destroy());
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      );
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Connection", "close");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      void (async () => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new CallbackError(503, "CALLBACK_CLOSED");
        const result = await readAuthCallback(request, address.port, nonce);
        if (callbackState.accepted || controller.signal.aborted)
          throw new CallbackError(409, "CALLBACK_ALREADY_FINISHED");
        callbackState.accepted = true;
        response.writeHead(200);
        if (result.cancelled) {
          response.end(callbackPage("cancelled"));
          reject(
            new ToolError(
              "LOGIN_CANCELLED",
              "Browser authorization was cancelled",
            ),
          );
        } else {
          response.end(callbackPage("received"));
          accept(result.token);
        }
      })().catch((error: unknown) => {
        callbackState.rejected++;
        callbackState.last_rejection =
          error instanceof CallbackError ? error.code : "CALLBACK_READ_FAILED";
        if (!response.destroyed) {
          response.writeHead(
            error instanceof CallbackError ? error.status : 400,
          );
          response.end(callbackPage("invalid"));
        }
      });
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxConnections = 8;
    await new Promise<void>((resolve, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail);
        resolve();
      });
    });
    if (controller.signal.aborted) {
      server.close();
      server.closeAllConnections();
      reject(controller.signal.reason);
      controller.signal.throwIfAborted();
    }
    const address = server.address();
    invariant(
      address && typeof address !== "string",
      "LOGIN_LISTEN_FAILED",
      "Cannot bind login callback",
    );
    const appid = provider === "developer" ? "1009" : "1008";
    const url = `${base}/console/DevEcoIDE/apply?${new URLSearchParams({ port: String(address.port), appid, code: nonce })}`;
    const timer = setTimeout(
      () =>
        controller.abort(
          new ToolError("LOGIN_TIMEOUT", "Login callback timed out"),
        ),
      300000,
    );
    timer.unref();
    const watcher = setInterval(() => {
      if (this.row(provider).revision !== revision)
        controller.abort(
          new ToolError(
            "AUTH_CANCELLED",
            "Authentication was replaced or logged out",
          ),
        );
    }, 200);
    watcher.unref();
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true },
    );
    const login: Login = {
      controller,
      server,
      url,
      browser_status: openBrowser ? "opening" : "manual_required",
      finished: Promise.resolve(),
      callback: callbackState,
    };
    this.logins.set(provider, login);
    login.finished = (async () => {
      const temp = await callback;
      const query = new URLSearchParams({
        tempToken: temp.split("&")[0]!,
        site: "CN",
        version: "1.0.0",
        appid,
      });
      const jwt = (
        await httpRequest(
          `${base}/authrouter/auth/api/temptoken/check?${query}`,
          {},
          controller.signal,
        )
      ).trim();
      invariant(
        jwt.split(".").length === 3,
        "AUTH_RESPONSE_INVALID",
        "Authentication server returned an invalid session",
      );
      const payload = jwtPayload.parse(
        JSON.parse(
          Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"),
        ) as unknown,
      );
      const access = await this.check(jwt, false, controller.signal);
      controller.signal.throwIfAborted();
      this.save(provider, revision, {
        jwt,
        access,
        saved: Date.now(),
        userId: payload.userId,
        userName: payload.userName,
        expires: payload.exp,
      });
    })()
      .catch((error) => {
        login.error = errorResult(error);
      })
      .finally(() => {
        clearTimeout(timer);
        clearInterval(watcher);
        controller.abort();
        server.close();
        server.closeAllConnections();
      });
    if (openBrowser) {
      const executable =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32.exe"
            : "xdg-open";
      void this.processes
        .run(
          {
            executable,
            args:
              process.platform === "win32"
                ? ["url.dll,FileProtocolHandler", url]
                : [url],
          },
          { signal: controller.signal, timeoutMs: 15000 },
        )
        .then(() => {
          if (!controller.signal.aborted) login.browser_status = "opened";
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          login.browser_status = "manual_required";
          login.browser_error = errorResult(error).code;
        });
    }
    return { provider, login_url: url, pending: true };
  }
  private async check(
    jwt: string,
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = JSON.parse(
      await httpRequest(
        `${base}/authrouter/auth/api/jwToken/check`,
        { headers: { jwtToken: jwt, refresh: String(refresh) } },
        signal,
      ),
    ) as unknown;
    const parsed = z
      .object({
        status: z.literal(true),
        userInfo: z.object({ accessToken: z.string().min(1) }),
      })
      .safeParse(response);
    invariant(
      parsed.success,
      "AUTH_REQUIRED",
      "Authentication expired or was rejected; log in explicitly",
    );
    return parsed.data.userInfo.accessToken;
  }
  async credentials(
    provider: Provider,
    signal?: AbortSignal,
    force = false,
  ): Promise<Credentials> {
    invariant(!this.closed, "AUTH_CLOSED", "Authentication service is closed");
    const requested = this.row(provider),
      controller = new AbortController();
    const finished = Promise.withResolvers<void>();
    this.refreshClosures.add(finished.promise);
    const pending = this.refreshes.get(provider) ?? new Set<AbortController>();
    this.refreshes.set(provider, pending);
    pending.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      ...(signal ? [signal] : []),
    ]);
    // A different MCP process can log out while this process awaits the cloud.
    const watcher = setInterval(() => {
      if (this.row(provider).revision !== requested.revision)
        controller.abort(
          new ToolError(
            "AUTH_CANCELLED",
            "Authentication was replaced or logged out",
          ),
        );
    }, 200);
    watcher.unref();
    try {
      return await this.store.lease(
        `auth:${provider}`,
        async () => {
          const { credentials, revision } = this.read(provider);
          invariant(
            revision === requested.revision,
            "AUTH_CANCELLED",
            "Authentication changed while waiting to refresh",
          );
          invariant(
            credentials &&
              (!credentials.expires || credentials.expires * 1000 > Date.now()),
            "AUTH_REQUIRED",
            `Log in to ${provider} using harmony_auth`,
          );
          // A refresh completed while this request waited for the shared lease.
          // Compare encrypted bytes, not timestamps, so same-millisecond refreshes
          // also coalesce across processes without retaining a credential cache.
          const refreshed = !requested.ciphertext?.equals(
            this.row(provider).ciphertext ?? Buffer.alloc(0),
          );
          if ((!force || refreshed) && Date.now() - credentials.saved < 1800000)
            return credentials;
          const access = await this.check(credentials.jwt, true, combined);
          combined.throwIfAborted();
          const updated = { ...credentials, access, saved: Date.now() };
          this.save(provider, revision, updated);
          return updated;
        },
        combined,
      );
    } finally {
      clearInterval(watcher);
      pending.delete(controller);
      if (!pending.size) this.refreshes.delete(provider);
      this.refreshClosures.delete(finished.promise);
      finished.resolve();
    }
  }
  async teams(signal?: AbortSignal) {
    const auth = await this.credentials("developer", signal);
    return developerTeams(
      JSON.parse(
        await httpRequest(
          "https://connect-api.cloud.huawei.com/api/ups/user-permission-service/v1/user-team-list",
          {
            headers: {
              uid: auth.userId,
              oauth2Token: auth.access,
              source: "cli",
              lang: "zh_CN",
            },
          },
          signal,
        ),
      ) as unknown,
    );
  }
  async logout(provider: Provider) {
    const starting = this.loginStarts.get(provider);
    starting?.controller.abort(new ToolError("AUTH_CANCELLED", "Logged out"));
    await this.clearProvider(provider);
    if (starting) await Promise.allSettled([starting.finished]);
    return { provider, logged_in: false };
  }
  private async clearProvider(provider: Provider) {
    const revision = crypto.randomUUID();
    this.store.db
      .prepare(
        "UPDATE credentials SET revision=?,ciphertext=NULL WHERE provider=?",
      )
      .run(revision, provider);
    for (const controller of this.refreshes.get(provider) ?? [])
      controller.abort(new ToolError("AUTH_CANCELLED", "Logged out"));
    const login = this.logins.get(provider);
    login?.controller.abort(new ToolError("AUTH_CANCELLED", "Logged out"));
    await login?.finished;
    if (this.logins.get(provider) === login) this.logins.delete(provider);
    return revision;
  }
  async close() {
    this.closed = true;
    const starting = [...this.loginStarts.values()];
    for (const login of starting)
      login.controller.abort(
        new ToolError("AUTH_CANCELLED", "Authentication service is closing"),
      );
    for (const pending of this.refreshes.values())
      for (const controller of pending)
        controller.abort(
          new ToolError("AUTH_CANCELLED", "Authentication service is closing"),
        );
    for (const login of this.logins.values()) login.controller.abort();
    await Promise.all([
      ...this.refreshClosures,
      Promise.allSettled(starting.map((login) => login.finished)),
      ...[...this.logins.values()].map((login) => login.finished),
    ]);
    this.key.fill(0);
  }
}
