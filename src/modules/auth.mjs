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
import fs from "node:fs";
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
  ACCESS_TOKEN_TTL_MS,
} from "./config.mjs";
import { deleteCredential, readCredential, writeCredential } from "./credential-store.mjs";

const STORE_DIR = path.join(os.homedir(), ".deveco-knowledge-mcp");
const AUTH_FILE = path.join(STORE_DIR, "auth.json");

/** 诊断日志一律写 stderr, 绝不污染 stdout(MCP 协议通道) */
function logErr(...args) {
  console.error("[deveco-tool]", ...args);
}

/**
 * 读取本地保存的登录态
 * @returns {object|null} 存储对象或 null
 */
function loadAuth() {
  try {
    return readCredential(AUTH_FILE);
  } catch (error) {
    logErr("failed to load encrypted login state:", error.message);
    return null;
  }
}

/**
 * 落盘登录态(0600 权限)
 * @param {object} data 存储对象
 * @returns {void}
 */
function saveAuth(data) {
  fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  writeCredential(AUTH_FILE, data);
}

/**
 * 清除本地登录态
 * @returns {void}
 */
export function clearAuth() {
  deleteCredential(AUTH_FILE);
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
function openBrowser(url) {
  return new Promise((resolve, reject) => {
    const [command, args] = process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * 启动本地回环 server, 等待华为登录回调
 * @param {string} nonce 回调校验码
 * @returns {Promise<{ port: number, waitForTempToken: (timeout: number) => Promise<string>, close: () => Promise<void> }>}
 */
function startLoopbackServer(nonce) {
  return new Promise((resolveServer, rejectServer) => {
    let resolveToken = null;
    let rejectToken = null;
    let timer = null;
    let settled = false;

    const settleOk = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveToken?.(value);
    };
    const settleErr = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rejectToken?.(err);
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
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => handleParams(res, body.trim() ? new URLSearchParams(body) : url.searchParams));
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
            timer = setTimeout(() => settleErr(new Error("Login timeout: no callback received")), timeout);
          }),
        close: () => new Promise((done) => server.close(() => done())),
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
async function exchangeTempToken(tempToken) {
  const actual = tempToken.split("&")[0];
  const query = new URLSearchParams({ tempToken: actual, site: "CN", version: "1.0.0", appid: APP_ID });
  const response = await fetch(`${BASE_URL}/${TEMP_TOKEN_CHECK_PATH}?${query.toString()}`);
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
async function checkJwtToken(jwtToken, refresh) {
  const response = await fetch(`${BASE_URL}/${JWT_TOKEN_CHECK_PATH}`, {
    headers: { refresh: refresh ? "true" : "false", jwtToken },
  });
  if (!response.ok) {
    throw new Error(`jwToken/check failed: HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * 执行一次完整的浏览器登录
 * @returns {Promise<{ userId: string, userName: string }>}
 */
export async function login() {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const server = await startLoopbackServer(nonce);
  try {
    const loginUrl = `${BASE_URL}/${AUTH_PATH}?port=${server.port}&appid=${APP_ID}&code=${nonce}`;
    logErr("opening browser for Huawei DevEco login:", loginUrl);
    await openBrowser(loginUrl).catch((err) => {
      throw new Error(`Failed to open browser (${err.message}). Open this URL manually to log in: ${loginUrl}`);
    });

    const tempToken = await server.waitForTempToken(LOGIN_TIMEOUT_MS);
    const jwtToken = await exchangeTempToken(tempToken);
    const info = await checkJwtToken(jwtToken, false);
    if (!info.status || !info.userInfo || !info.userInfo.accessToken) {
      throw new Error("Login failed: server did not return an accessToken");
    }
    const payload = parseJwt(jwtToken);
    saveAuth({
      jwtToken,
      accessToken: info.userInfo.accessToken,
      refreshToken: info.userInfo.refreshToken ?? "",
      accessSavedAt: Date.now(),
      userId: payload.userId,
      userName: payload.userName,
    });
    logErr("login success:", payload.userName || payload.userId);
    return { userId: payload.userId, userName: payload.userName };
  } finally {
    await server.close();
  }
}

/**
 * 确保有效 accessToken; 必要时刷新或(交互模式下)重新登录
 * @param {{ interactive?: boolean, force?: boolean }} [options] interactive 默认 true; force 强制刷新
 * @returns {Promise<string>} 有效 accessToken
 */
export async function ensureAccessToken(options = {}) {
  const interactive = options.interactive !== false;
  const force = options.force === true;

  let auth = loadAuth();
  if (!auth || !auth.jwtToken) {
    if (!interactive) {
      throw new Error("Not logged in. Run `node src/index.mjs login`, or call the deveco_login tool.");
    }
    await login();
    auth = loadAuth();
  }

  // jwtToken 自身过期 -> 必须重新登录
  try {
    const payload = parseJwt(auth.jwtToken);
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      if (!interactive) {
        throw new Error("DevEco session expired. Run `node src/index.mjs login`, or call the deveco_login tool.");
      }
      await login();
      auth = loadAuth();
    }
  } catch {
    /* 解析失败交由后续刷新校验 */
  }

  const stale = force || !auth.accessToken || Date.now() - (auth.accessSavedAt ?? 0) >= ACCESS_TOKEN_TTL_MS;
  if (stale) {
    try {
      const info = await checkJwtToken(auth.jwtToken, true);
      if (info.status && info.userInfo && info.userInfo.accessToken) {
        auth = {
          ...auth,
          accessToken: info.userInfo.accessToken,
          refreshToken: info.userInfo.refreshToken ?? auth.refreshToken,
          accessSavedAt: Date.now(),
        };
        saveAuth(auth);
      } else if (interactive) {
        await login();
        auth = loadAuth();
      } else {
        throw new Error("Token refresh failed. Run `node src/index.mjs login`.");
      }
    } catch (err) {
      if (interactive) {
        await login();
        auth = loadAuth();
      } else {
        throw err;
      }
    }
  }

  return auth.accessToken;
}

/**
 * 当前登录状态
 * @returns {{ loggedIn: boolean, userName?: string, userId?: string, sessionExpired?: boolean }}
 */
export function authStatus() {
  const auth = loadAuth();
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
  clearAuth();
}
