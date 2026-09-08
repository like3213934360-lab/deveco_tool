import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { AuthService, developerTeams } from "../src/services/auth.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";

test("developer team inventory validates the provider envelope and excludes unrelated remote fields", () => {
  assert.deepEqual(
    developerTeams({
      ret: { code: 0 },
      teams: [{ id: 42, name: "Example", arbitrary: "untrusted" }],
      secret: "unrelated",
    }),
    { teams: [{ id: "42", name: "Example" }] },
  );
  assert.deepEqual(developerTeams({ teams: [] }), { teams: [] });
  assert.throws(() => developerTeams({ ret: { code: 7 }, teams: [] }), {
    code: "TEAM_LIST_REJECTED",
  });
  for (const raw of [
    null,
    {},
    { teams: [{ id: "", name: "Example" }] },
    { teams: [{}] },
    { teams: "invalid" },
  ])
    assert.throws(() => developerTeams(raw), { code: "TEAM_LIST_INVALID" });
});

const sessionToken = () =>
  `header.${Buffer.from(JSON.stringify({ userId: "fixture-user", userName: "Fixture", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
function callback(url: string, nonce?: string) {
  const entry = new URL(url),
    endpoint = new URL(
      `http://127.0.0.1:${entry.searchParams.get("port")}/callback`,
    );
  endpoint.search = new URLSearchParams({
    code: nonce ?? entry.searchParams.get("code")!,
    siteId: "1",
    tempToken: "fixture-temporary-token",
  }).toString();
  return new Promise<number>((resolve, reject) => {
    const request = http.get(endpoint, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode!));
    });
    request.setTimeout(2000, () =>
      request.destroy(new Error("Callback timeout")),
    );
    request.once("error", reject);
  });
}
function formCallback(
  url: string,
  values: Record<string, string> = {},
  options: {
    host?: string;
    contentType?: string;
    suffix?: string;
    chunked?: boolean;
  } = {},
) {
  const entry = new URL(url),
    port = entry.searchParams.get("port")!;
  const body =
    new URLSearchParams({
      code: entry.searchParams.get("code")!,
      siteId: "1",
      tempToken: "fixture-temporary-token",
      ...values,
    }).toString() + (options.suffix ?? "");
  return new Promise<number>((resolve, reject) => {
    const request = http.request(
      `http://127.0.0.1:${port}/callback`,
      {
        method: "POST",
        headers: {
          host: options.host ?? `localhost:${port}`,
          "content-type":
            options.contentType ??
            "application/x-www-form-urlencoded; charset=UTF-8",
          ...(options.chunked
            ? {}
            : { "content-length": String(Buffer.byteLength(body)) }),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          try {
            assert.equal(
              response.headers["content-type"],
              "text/html; charset=utf-8",
            );
            assert.equal(response.headers["cache-control"], "no-store");
            assert.equal(response.headers["referrer-policy"], "no-referrer");
            resolve(response.statusCode!);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(2000, () =>
      request.destroy(new Error("Callback timeout")),
    );
    request.once("error", reject);
    if (options.chunked) {
      request.write(body.slice(0, 100));
      request.end(body.slice(100));
    } else request.end(body);
  });
}

test("current browser form POST authenticates, rejects ambiguous and oversized callbacks, and exchanges only once", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-form-"));
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  const exchange = Promise.withResolvers<void>();
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("/temptoken/check")) {
      exchanges++;
      await exchange.promise;
      return new Response(sessionToken());
    }
    return Response.json({
      status: true,
      userInfo: { accessToken: "fixture-access-secret" },
    });
  });
  try {
    const login = await auth.login("developer", false);
    assert.equal(
      await formCallback(login.login_url, {}, { host: "attacker.example" }),
      400,
    );
    assert.equal(await formCallback(login.login_url, { code: "wrong" }), 400);
    assert.equal(
      await formCallback(
        login.login_url,
        {},
        { contentType: "application/json" },
      ),
      415,
    );
    assert.equal(
      await formCallback(login.login_url, {}, { suffix: "&code=duplicate" }),
      400,
    );
    assert.equal(
      await formCallback(login.login_url, { tempToken: "x".repeat(65537) }),
      413,
    );
    assert.equal(
      await formCallback(
        login.login_url,
        { tempToken: "x".repeat(65537) },
        { chunked: true },
      ),
      413,
    );
    assert.equal(auth.status("developer").login_pending, true);
    assert.equal(exchanges, 0);
    assert.equal(
      await formCallback(login.login_url, {}, { chunked: true }),
      200,
    );
    assert.equal(await formCallback(login.login_url), 409);
    assert.equal(exchanges, 1);
    exchange.resolve();
    const deadline = performance.now() + 2000;
    while (!auth.status("developer").logged_in) {
      assert.ok(performance.now() < deadline);
      await delay(5);
    }
    assert.deepEqual(auth.status("developer").callback, {
      received: 8,
      rejected: 7,
      accepted: true,
      last_rejection: "CALLBACK_ALREADY_FINISHED",
    });
    const visible = JSON.stringify(auth.status("developer"));
    for (const secret of [
      "fixture-temporary-token",
      "fixture-access-secret",
      new URL(login.login_url).searchParams.get("code")!,
    ])
      assert.equal(visible.includes(secret), false);
  } finally {
    exchange.resolve();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("browser authorization cancellation ends login without waiting for timeout or storing credentials", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-cancel-"));
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  const remote = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Cancellation must not contact cloud");
  });
  try {
    const login = await auth.login("developer", false);
    assert.equal(
      await formCallback(login.login_url, {
        quit: "access_denied",
        tempToken: "",
        siteId: "",
      }),
      200,
    );
    const deadline = performance.now() + 2000;
    while (auth.status("developer").login_pending) {
      assert.ok(performance.now() < deadline);
      await delay(5);
    }
    assert.equal(auth.status("developer").error?.code, "LOGIN_CANCELLED");
    assert.equal(auth.status("developer").logged_in, false);
    assert.equal(remote.mock.callCount(), 0);
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
async function loggedIn(auth: AuthService) {
  const login = await auth.login("developer", false);
  assert.equal(await callback(login.login_url, "wrong-nonce"), 400);
  assert.equal(auth.status("developer").logged_in, false);
  assert.equal(await callback(login.login_url), 200);
  const deadline = performance.now() + 2000;
  while (!auth.status("developer").logged_in) {
    assert.equal(auth.status("developer").error, undefined);
    assert.ok(performance.now() < deadline, "Expected completed login");
    await delay(5);
  }
}

test("browser callback authenticates one provider, encrypts credentials and survives a runtime restart", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-")),
    store = new StateStore(root),
    processes = new ProcessService();
  const auth = new AuthService(store, processes),
    jwt = sessionToken();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/temptoken/check")) return new Response(jwt);
    if (url.includes("/jwToken/check"))
      return Response.json({
        status: true,
        userInfo: { accessToken: "fixture-access-secret" },
      });
    throw new Error("Unexpected remote endpoint");
  });
  try {
    await loggedIn(auth);
    assert.equal(auth.status("codegenie").logged_in, false);
    await assert.rejects(auth.credentials("codegenie"), {
      code: "AUTH_REQUIRED",
    });
    const row = store.db
      .prepare("SELECT ciphertext FROM credentials WHERE provider=?")
      .get("developer") as { ciphertext: Buffer };
    assert.equal(row.ciphertext.includes(Buffer.from(jwt)), false);
    assert.equal(
      row.ciphertext.includes(Buffer.from("fixture-access-secret")),
      false,
    );
    await auth.close();
    const restarted = new AuthService(store, processes);
    try {
      assert.equal(restarted.status("developer").logged_in, true);
      await restarted.logout("developer");
      await assert.rejects(restarted.credentials("developer"), {
        code: "AUTH_REQUIRED",
      });
    } finally {
      await restarted.close();
    }
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a peer logout prevents an in-flight refresh from restoring credentials", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-race-")),
    store = new StateStore(root),
    peer = new StateStore(root),
    processes = new ProcessService();
  const auth = new AuthService(store, processes),
    other = new AuthService(peer, processes),
    refresh = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  let refreshing = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("/temptoken/check"))
      return new Response(sessionToken());
    if (refreshing) {
      entered.resolve();
      await refresh.promise;
    }
    return Response.json({
      status: true,
      userInfo: { accessToken: "fixture-access-secret" },
    });
  });
  try {
    await loggedIn(auth);
    refreshing = true;
    const request = auth.credentials("developer", undefined, true);
    const rejected = assert.rejects(request, { code: "AUTH_CANCELLED" });
    await entered.promise;
    await other.logout("developer");
    refresh.resolve();
    await rejected;
    assert.equal(auth.status("developer").logged_in, false);
    assert.equal(other.status("developer").logged_in, false);
  } finally {
    refresh.resolve();
    await auth.close();
    await other.close();
    await processes.close();
    peer.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("closing an unfinished login cancels its callback listener without saving a credential", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-close-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  try {
    const login = await auth.login("developer", false);
    await auth.close();
    await assert.rejects(callback(login.login_url));
    assert.equal(
      (
        store.db
          .prepare("SELECT ciphertext FROM credentials WHERE provider=?")
          .get("developer") as { ciphertext: Buffer | null }
      ).ciphertext,
      null,
    );
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
