import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import {
  AuthService,
  developerTeams,
  type Provider,
} from "../src/services/auth.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { ToolError } from "../src/core/errors.js";

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
async function loggedIn(auth: AuthService, provider: Provider = "developer") {
  const login = await auth.login(provider, false);
  assert.equal(await callback(login.login_url, "wrong-nonce"), 400);
  assert.equal(auth.status(provider).logged_in, false);
  assert.equal(await callback(login.login_url), 200);
  const deadline = performance.now() + 2000;
  while (!auth.status(provider).logged_in) {
    assert.equal(auth.status(provider).error, undefined);
    assert.ok(performance.now() < deadline, "Expected completed login");
    await delay(5);
  }
}

for (const provider of ["developer", "codegenie"] as const)
  test(`${provider} refreshes aged credentials but rejects expired JWTs without a network request`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-expiry-"));
    const store = new StateStore(root), processes = new ProcessService();
    const auth = new AuthService(store, processes);
    let checks = 0, rejectRefresh = false;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      if (String(input).includes("/temptoken/check")) return new Response(sessionToken());
      checks++;
      return Response.json(rejectRefresh ? { status: false } : {
        status: true, userInfo: { accessToken: `fixture-access-${checks}` },
      });
    });
    try {
      await loggedIn(auth, provider);
      const start = Date.now();
      let now = start;
      t.mock.method(Date, "now", () => now);
      assert.equal((await auth.credentials(provider)).access, "fixture-access-1");
      assert.equal(checks, 1);
      now = start + 31 * 60 * 1000;
      assert.equal((await auth.credentials(provider)).access, "fixture-access-2");
      rejectRefresh = true;
      await assert.rejects(auth.credentials(provider, undefined, true), { code: "AUTH_REQUIRED" });
      assert.equal((await auth.credentials(provider)).access, "fixture-access-2", "Rejected refresh must not replace the stored credential");
      assert.equal(checks, 3);
      now = start + 61 * 60 * 1000;
      assert.equal(auth.status(provider).logged_in, false);
      await assert.rejects(auth.credentials(provider), { code: "AUTH_REQUIRED" });
      assert.equal(checks, 3, "Expired JWT must require explicit login before any cloud call");
    } finally {
      await auth.close();
      await processes.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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

for (const provider of ["developer", "codegenie"] as const)
  for (const remoteLogout of [false, true])
    test(`${provider} ${remoteLogout ? "peer" : "local"} logout aborts refresh and rejects a late cloud response`, async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-race-")),
        store = new StateStore(root),
        peer = new StateStore(root),
        processes = new ProcessService();
      const auth = new AuthService(store, processes),
        other = new AuthService(peer, processes),
        refresh = Promise.withResolvers<void>(),
        entered = Promise.withResolvers<void>();
      let refreshing = false;
      let refreshSignal: AbortSignal | undefined;
      t.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, options?: RequestInit) => {
          if (String(input).includes("/temptoken/check"))
            return new Response(sessionToken());
          if (refreshing) {
            refreshSignal = options?.signal ?? undefined;
            entered.resolve();
            await refresh.promise;
          }
          return Response.json({
            status: true,
            userInfo: { accessToken: "fixture-access-secret" },
          });
        },
      );
      try {
        await loggedIn(auth, provider);
        refreshing = true;
        const request = auth.credentials(provider, undefined, true);
        const rejected = assert.rejects(request, { code: "AUTH_CANCELLED" });
        await entered.promise;
        await (remoteLogout ? other : auth).logout(provider);
        const deadline = performance.now() + 2000;
        while (!refreshSignal?.aborted && remoteLogout) {
          assert.ok(
            performance.now() < deadline,
            "Peer logout must cancel the active HTTP request",
          );
          await delay(5);
        }
        assert.equal(refreshSignal?.aborted, true);
        refresh.resolve();
        await rejected;
        assert.equal(auth.status(provider).logged_in, false);
        assert.equal(other.status(provider).logged_in, false);
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

for (const provider of ["developer", "codegenie"] as const)
  test(`${provider} concurrent forced refreshes share a result across stores and queued cancellation stays isolated`, async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "deveco-auth-shared-refresh-"),
      ),
      store = new StateStore(root),
      peer = new StateStore(root),
      processes = new ProcessService(),
      auth = new AuthService(store, processes),
      other = new AuthService(peer, processes),
      entered = Promise.withResolvers<void>(),
      response = Promise.withResolvers<void>();
    let refreshing = false,
      requests = 0;
    let activeSignal: AbortSignal | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, options?: RequestInit) => {
        if (String(input).includes("/temptoken/check"))
          return new Response(sessionToken());
        if (refreshing) {
          requests++;
          activeSignal = options?.signal ?? undefined;
          entered.resolve();
          await response.promise;
        }
        return Response.json({
          status: true,
          userInfo: {
            accessToken: refreshing ? "refreshed-access" : "initial-access",
          },
        });
      },
    );
    try {
      await loggedIn(auth, provider);
      refreshing = true;
      const first = auth.credentials(provider, undefined, true);
      await entered.promise;
      const second = other.credentials(provider, undefined, true);
      const cancellation = new AbortController();
      const cancelled = assert.rejects(
        other.credentials(provider, cancellation.signal, true),
        { name: "AbortError" },
      );
      cancellation.abort();
      await cancelled;
      assert.equal(activeSignal?.aborted, false);
      response.resolve();
      assert.deepEqual(
        (await Promise.all([first, second])).map((value) => value.access),
        ["refreshed-access", "refreshed-access"],
      );
      assert.equal(requests, 1);
      // A later explicit forced request must still contact the service.
      await auth.credentials(provider, undefined, true);
      assert.equal(requests, 2);
    } finally {
      response.resolve();
      await auth.close();
      await other.close();
      await processes.close();
      peer.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test("closing authentication aborts refresh and waits for its cleanup before discarding the key", async (t) => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-auth-refresh-close-"),
    ),
    store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes),
    entered = Promise.withResolvers<void>(),
    response = Promise.withResolvers<void>();
  let refreshing = false,
    activeSignal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).includes("/temptoken/check"))
        return new Response(sessionToken());
      if (refreshing) {
        activeSignal = options?.signal ?? undefined;
        entered.resolve();
        await response.promise;
      }
      return Response.json({
        status: true,
        userInfo: { accessToken: "fixture-access" },
      });
    },
  );
  try {
    await loggedIn(auth);
    refreshing = true;
    const rejected = assert.rejects(
      auth.credentials("developer", undefined, true),
      { code: "AUTH_CANCELLED" },
    );
    await entered.promise;
    let closed = false;
    const closing = auth.close().then(() => {
      closed = true;
    });
    await delay(5);
    assert.equal(activeSignal?.aborted, true);
    assert.equal(closed, false);
    response.resolve();
    await rejected;
    await closing;
    await assert.rejects(auth.credentials("developer"), {
      code: "AUTH_CLOSED",
    });
    await assert.rejects(auth.login("developer", false), {
      code: "AUTH_CLOSED",
    });
  } finally {
    response.resolve();
    await auth.close();
    await processes.close();
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

for (const provider of ["developer", "codegenie"] as const)
  test(`${provider} concurrent login requests share one callback and a later login can restart`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-login-start-")),
      store = new StateStore(root),
      processes = new ProcessService(),
      auth = new AuthService(store, processes);
    try {
      const logins = await Promise.all(
        Array.from({ length: 10 }, () => auth.login(provider, false)),
      );
      assert.equal(new Set(logins.map((login) => login.login_url)).size, 1);
      await auth.logout(provider);
      await assert.rejects(callback(logins[0]!.login_url));
      const next = await auth.login(provider, false);
      assert.notEqual(next.login_url, logins[0]!.login_url);
      await auth.close();
      await assert.rejects(callback(next.login_url));
    } finally {
      await auth.close();
      await processes.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

for (const action of ["logout", "close"] as const)
  test(`${action} during login startup cancels all callers before returning`, async () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "deveco-login-cancel-start-"),
      ),
      store = new StateStore(root),
      processes = new ProcessService(),
      auth = new AuthService(store, processes);
    try {
      const first = assert.rejects(auth.login("developer", false), {
        code: "AUTH_CANCELLED",
      });
      const second = assert.rejects(auth.login("developer", false), {
        code: "AUTH_CANCELLED",
      });
      if (action === "logout") await auth.logout("developer");
      else await auth.close();
      await Promise.all([first, second]);
      assert.equal(auth.status("developer").login_pending, false);
      assert.equal(auth.status("developer").logged_in, false);
      if (action === "logout") {
        const next = await auth.login("developer", false);
        assert.equal(next.pending, true);
        await auth.logout("developer");
        await assert.rejects(callback(next.login_url));
      } else
        await assert.rejects(auth.login("developer", false), {
          code: "AUTH_CLOSED",
        });
    } finally {
      await auth.close();
      await processes.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test("browser launch failure exposes a usable manual URL without ending the callback window", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-browser-failed-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  t.mock.method(processes, "run", async () => {
    throw new ToolError("PROCESS_SPAWN_FAILED", "Browser launcher unavailable");
  });
  try {
    const login = await auth.login("codegenie");
    const deadline = performance.now() + 2000;
    while (auth.status("codegenie").browser_status !== "manual_required") {
      assert.ok(performance.now() < deadline);
      await delay(5);
    }
    const status = auth.status("codegenie");
    assert.equal(status.login_pending, true);
    assert.equal(status.login_url, login.login_url);
    assert.equal(status.browser_error, "PROCESS_SPAWN_FAILED");
    assert.equal(await callback(login.login_url, "wrong-nonce"), 400);
    assert.equal(auth.status("codegenie").login_pending, true);
    await auth.logout("codegenie");
    assert.equal(auth.status("codegenie").login_url, undefined);
    await assert.rejects(callback(login.login_url));
  } finally {
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
