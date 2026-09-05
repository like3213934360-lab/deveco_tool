/**
 * @file DevEco 账号登录(浏览器回环) + token 落盘与自动刷新
 * @author dreamlike
 *
 * 流程(复刻 deveco-code MIT 实现, 无烘焙密钥):
 *   1. 生成随机 nonce 作为回调校验码(防 CSRF)
 *   2. 本地起 http 回环 server, 监听 /callback
 *   3. open 浏览器到 apply 登录页, 用户用华为账号(中国站)登录
 *   4. 华为重定向回 127.0.0.1:<port>/callback?code=<nonce>&tempToken=..&siteId=1
 *   5. tempToken -> temptoken/check 换 jwtToken
 *   6. jwtToken -> jwToken/check 换 accessToken(用于知识检索)
 */

import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  BASE_URL,
  AUTH_PATH,
  TEMP_TOKEN_CHECK_PATH,
  JWT_TOKEN_CHECK_PATH,
  SUCCESS_REDIRECT_PATH,
  FAILED_REDIRECT_PATH,
  APP_ID,
  PREFERRED_PORTS,
  LOGIN_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  ACCESS_TOKEN_TTL_MS,
} from "./config.mjs";
import { authCancelled, createAuthStore } from "./auth-store.mjs";
import { terminateProcessTree } from "../process-tree.mjs";

const STORE_DIR = path.join(os.homedir(), ".deveco-knowledge-mcp");
const AUTH_FILE = path.join(STORE_DIR, "auth.json");
const store = createAuthStore(AUTH_FILE);

let session = new AbortController();
let activeLogin = null;
let activeRefresh = null;

function cancelSession() {
  session.abort(authCancelled());
  session = new AbortController();
}

function watchSession(revision, controller) {
  const check = () => {
    try { if (store.revision() !== revision) controller.abort(authCancelled()); }
    catch (error) { controller.abort(error); }
  };
  check();
  const timer = setInterval(check, 100);
  timer.unref();
  return () => clearInterval(timer);
}

/** 诊断日志一律写 stderr, 绝不污染 stdout(MCP 协议通道) */
function logErr(...args) {
  console.error("[deveco-tool]", ...args);
}

/**
 * 读取本地保存的登录态
 * @returns {Promise<{auth: object|null, revision: string|null}>} 登录态与共享会话版本
 */
async function loadAuth(signal) {
  try {
    return await store.read(signal);
  } catch (error) {
    signal?.throwIfAborted();
    logErr("failed to load encrypted login state:", error.message);
    const wrapped = new Error(`Stored DevEco login state cannot be read: ${error.message}`);
    wrapped.code = "DEVECO_AUTH_STATE_UNREADABLE";
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * 清除本地登录态
 * @returns {void}
 */
export async function clearAuth() {
  cancelSession();
  await store.clear();
}

async function fetchWithDeadline(url, options, operation, signal) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(NETWORK_TIMEOUT_MS)]) });
  } catch (error) {
    signal.throwIfAborted();
    const wrapped = new Error(`${operation} failed: ${error.name === "TimeoutError" ? `network timeout after ${NETWORK_TIMEOUT_MS}ms` : error.message}`);
    wrapped.code = error.name === "TimeoutError" ? "DEVECO_NETWORK_TIMEOUT" : "DEVECO_NETWORK_FAILED";
    throw wrapped;
  }
}

/**
 * 解析 JWT 的 payload 段
 * @param {string} token 三段式 JWT
 * @returns {{ userId: string, userName: string, exp?: number, iat?: number }}
 */
export function parseJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid jwtToken format");
  }
  const base64Url = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const base64 = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const json = Buffer.from(base64, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  return {
    userId: parsed.userId ?? "",
    userName: parsed.userName ?? "",
    exp: parsed.exp,
    iat: parsed.iat,
  };
}

/**
 * 用系统默认浏览器打开 URL
 * @param {string} url 目标地址
 * @returns {Promise<void>}
 */
function openBrowser(url, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const [command, args] = process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    const child = spawn(command, args, {
      stdio: "ignore", windowsHide: true, detached: process.platform !== "win32",
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      terminateProcessTree(child);
      finish(signal.reason);
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      const error = new Error(`${command} did not return after ${NETWORK_TIMEOUT_MS}ms`);
      error.code = "DEVECO_BROWSER_TIMEOUT";
      finish(error);
    }, NETWORK_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * 启动本地回环 server, 等待华为登录回调
 * @param {string} nonce 回调校验码
 * @returns {Promise<{ port: number, waitForTempToken: (timeout: number) => Promise<string>, close: () => Promise<void> }>}
 */
function startLoopbackServer(nonce, signal) {
  return new Promise((resolveServer, rejectServer) => {
    let resolveToken = null;
    let rejectToken = null;
    let timer = null;
    let settled = false;
    let callbackAccepted = false;

    const settleOk = (value) => {
      if (settled) return;
      settled = true;
      callbackAccepted = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolveToken?.(value);
    };
    const settleErr = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      rejectToken?.(err);
    };
    const onAbort = () => {
      settleErr(signal.reason);
      server.close();
      server.closeAllConnections();
    };

    const handleParams = (res, params) => {
      const code = params.get("code");
      const tempToken = params.get("tempToken");
      const siteId = params.get("siteId");
      const quit = params.get("quit");

      // 校验码不符: 忽略(可能是无关请求)
      if (!code || code !== nonce) {
        res.writeHead(204);
        res.end();
        return;
      }
      const redirectFail = () => {
        res.writeHead(302, { Location: `${BASE_URL}/${FAILED_REDIRECT_PATH}` });
        res.end();
      };
      if (quit === "true" || quit === "access_denied") {
        redirectFail();
        settleErr(new Error("Login cancelled by user"));
        return;
      }
      if (!tempToken || !siteId) {
        redirectFail();
        settleErr(new Error("Login failed: missing tempToken/siteId in callback"));
        return;
      }
      if (siteId !== "1") {
        redirectFail();
        settleErr(new Error("Unsupported region: only China-site (cn) Huawei DevEco accounts are supported"));
        return;
      }
      res.writeHead(302, { Location: `${BASE_URL}/${SUCCESS_REDIRECT_PATH}` });
      res.end();
      settleOk(tempToken);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
    if (req.method === "POST") {
      let body = "";
      let tooLarge = false;
      req.on("data", (chunk) => {
        if (tooLarge) return;
        body += chunk.toString();
        if (Buffer.byteLength(body) > 64 * 1024) {
          tooLarge = true;
          res.writeHead(413);
          res.end("Payload Too Large");
        }
      });
      req.on("end", () => {
        if (!tooLarge) handleParams(res, body.trim() ? new URLSearchParams(body) : url.searchParams);
      });
      } else {
        handleParams(res, url.searchParams);
      }
    });

    const ports = [...PREFERRED_PORTS];
    const attempt = () => {
      const port = ports.shift();
      if (port === undefined) {
        rejectServer(new Error("All loopback ports are in use; free up one of " + PREFERRED_PORTS.join(", ")));
        return;
      }
      server.listen(port, "127.0.0.1");
    };

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        attempt();
      } else {
        rejectServer(err);
      }
    });
    server.on("listening", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : PREFERRED_PORTS[0];
      resolveServer({
        port,
        waitForTempToken: (timeout) =>
          new Promise((res, rej) => {
            resolveToken = res;
            rejectToken = rej;
            if (signal.aborted) { onAbort(); return; }
            signal.addEventListener("abort", onAbort, { once: true });
            timer = setTimeout(() => {
              const error = new Error("Login timeout: no callback received");
              error.code = "DEVECO_LOGIN_TIMEOUT";
              settleErr(error);
            }, timeout);
          }),
        close: () => new Promise((done) => {
          settleErr(new Error("Login flow closed before a callback was received"));
          server.close(() => done());
          // Let a successful redirect finish writing; destroying that socket can reset
          // the browser's response even though the token exchange has already succeeded.
          if (!callbackAccepted) server.closeAllConnections();
        }),
      });
    });

    attempt();
  });
}

/**
 * tempToken -> jwtToken
 * @param {string} tempToken 回调拿到的临时 token
 * @returns {Promise<string>} 三段式 jwtToken
 */
async function exchangeTempToken(tempToken, signal) {
  const actual = tempToken.split("&")[0];
  const query = new URLSearchParams({ tempToken: actual, site: "CN", version: "1.0.0", appid: APP_ID });
  const response = await fetchWithDeadline(
    `${BASE_URL}/${TEMP_TOKEN_CHECK_PATH}?${query.toString()}`,
    {},
    "temptoken/check",
    signal,
  );
  if (!response.ok) {
    throw new Error(`temptoken/check failed: HTTP ${response.status}`);
  }
  const jwt = (await response.text()).trim();
  if (jwt.split(".").length !== 3) {
    throw new Error("temptoken/check returned an invalid jwtToken");
  }
  return jwt;
}

/**
 * 校验/刷新 jwtToken, 取回 accessToken
 * @param {string} jwtToken 当前 jwtToken
 * @param {boolean} refresh 是否刷新
 * @returns {Promise<{ status: boolean, userInfo?: { accessToken: string, refreshToken?: string } }>}
 */
async function checkJwtToken(jwtToken, refresh, signal) {
  const response = await fetchWithDeadline(`${BASE_URL}/${JWT_TOKEN_CHECK_PATH}`, {
    headers: { refresh: refresh ? "true" : "false", jwtToken },
  }, "jwToken/check", signal);
  if (!response.ok) {
    throw new Error(`jwToken/check failed: HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * 执行一次完整的浏览器登录
 * @returns {Promise<{ userId: string, userName: string }>}
 */
export function login({ onProgress = () => {} } = {}) {
  if (activeLogin && !activeLogin.signal.aborted) return activeLogin.promise;
  cancelSession();
  const operation = { signal: session.signal, promise: null };
  activeLogin = operation;
  operation.promise = browserLogin(session, onProgress).finally(() => {
    if (activeLogin === operation) activeLogin = null;
  });
  return operation.promise;
}

async function browserLogin(controller, onProgress) {
  const signal = controller.signal;
  const revision = await store.begin(signal);
  const stopWatching = watchSession(revision, controller);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  let server;
  const browser = new AbortController();
  let opening;
  try {
    signal.throwIfAborted();
    server = await startLoopbackServer(nonce, signal);
    signal.throwIfAborted();
    const loginUrl = `${BASE_URL}/${AUTH_PATH}?port=${server.port}&appid=${APP_ID}&code=${nonce}`;
    logErr("opening browser for Huawei DevEco login:", loginUrl);
    const tempTokenPromise = server.waitForTempToken(LOGIN_TIMEOUT_MS);
    tempTokenPromise.catch(() => {});
    onProgress({ login_url: loginUrl, browser_status: "opening" });
    // Opening a browser is only a convenience. Its exit status must not discard a valid
    // callback or close the callback window needed for manual login.
    opening = openBrowser(loginUrl, AbortSignal.any([signal, browser.signal])).then(
      () => onProgress({ browser_status: "opened" }),
      (error) => {
        if (signal.aborted || browser.signal.aborted) return;
        logErr(`Open this URL manually to log in: ${loginUrl}`);
        onProgress({ browser_status: "manual_required", browser_error: error.message });
      },
    );

    const tempToken = await tempTokenPromise;
    const jwtToken = await exchangeTempToken(tempToken, signal);
    const info = await checkJwtToken(jwtToken, false, signal);
    if (!info.status || !info.userInfo || !info.userInfo.accessToken) {
      throw new Error("Login failed: server did not return an accessToken");
    }
    const payload = parseJwt(jwtToken);
    stopWatching();
    await store.save({
      jwtToken,
      accessToken: info.userInfo.accessToken,
      refreshToken: info.userInfo.refreshToken ?? "",
      accessSavedAt: Date.now(),
      userId: payload.userId,
      userName: payload.userName,
    }, signal, revision, true);
    logErr("login success:", payload.userName || payload.userId);
    return { userId: payload.userId, userName: payload.userName };
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    stopWatching();
    browser.abort();
    await server?.close();
    await opening;
  }
}

/**
 * 确保有效 accessToken；登录只能由显式的 deveco_login 发起。
 * @param {{ force?: boolean }} [options] force 强制刷新
 * @returns {Promise<string>} 有效 accessToken
 */
export async function ensureAccessToken(options = {}) {
  if (session.signal.aborted) session = new AbortController();
  const controller = session;
  const signal = session.signal;
  const force = options.force === true;
  if (activeLogin && !activeLogin.signal.aborted) {
    const error = new Error("Browser login is still in progress. Poll deveco_login before searching.");
    error.code = "DEVECO_LOGIN_IN_PROGRESS";
    throw error;
  }
  const { auth, revision } = await loadAuth(signal);
  if (!auth || !auth.jwtToken) {
    const error = new Error("Not logged in. Call the deveco_login tool.");
    error.code = "DEVECO_AUTH_REQUIRED";
    throw error;
  }

  // jwtToken 自身过期 -> 必须重新登录
  let payload = null;
  try {
    payload = parseJwt(auth.jwtToken);
  } catch {
    /* 解析失败交由后续刷新校验 */
  }
  if (payload?.exp && Date.now() >= payload.exp * 1000) {
    const error = new Error("DevEco session expired. Call the deveco_login tool.");
    error.code = "DEVECO_SESSION_EXPIRED";
    throw error;
  }

  const stale = force || !auth.accessToken || Date.now() - (auth.accessSavedAt ?? 0) >= ACCESS_TOKEN_TTL_MS;
  if (!stale) return auth.accessToken;
  if (activeRefresh?.signal === signal) return activeRefresh.promise;

  const operation = { signal, promise: null };
  activeRefresh = operation;
  const stopWatching = watchSession(revision, controller);
  operation.promise = (async () => {
    signal.throwIfAborted();
    const info = await checkJwtToken(auth.jwtToken, true, signal);
    if (!info.status || !info.userInfo?.accessToken) {
      const error = new Error("Token refresh failed. Call the deveco_login tool.");
      error.code = "DEVECO_AUTH_REFRESH_FAILED";
      throw error;
    }
    const updated = {
      ...auth, accessToken: info.userInfo.accessToken,
      refreshToken: info.userInfo.refreshToken ?? auth.refreshToken, accessSavedAt: Date.now(),
    };
    await store.save(updated, signal, revision);
    return updated.accessToken;
  })().catch((error) => {
    signal.throwIfAborted();
    throw error;
  }).finally(() => {
    stopWatching();
    if (activeRefresh === operation) activeRefresh = null;
  });
  return operation.promise;
}

/**
 * 当前登录状态
 * @returns {{ loggedIn: boolean, userName?: string, userId?: string, sessionExpired?: boolean }}
 */
export async function authStatus() {
  const { auth } = await loadAuth();
  if (!auth || !auth.jwtToken) {
    return { loggedIn: false };
  }
  let sessionExpired;
  try {
    const payload = parseJwt(auth.jwtToken);
    sessionExpired = payload.exp ? Date.now() >= payload.exp * 1000 : undefined;
  } catch {
    sessionExpired = undefined;
  }
  return { loggedIn: true, userName: auth.userName, userId: auth.userId, sessionExpired };
}

/**
 * 登出: 清除本地 token
 * @returns {Promise<void>}
 */
export async function logout() {
  await clearAuth();
}

/** Stop pending authentication work on MCP shutdown without deleting a saved session. */
export async function closeAuth() {
  cancelSession();
  await Promise.allSettled([activeLogin?.promise, activeRefresh?.promise, store.flush()]);
}
