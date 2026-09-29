// Cloud flows against local mocks (no real account is touched): browser login callback,
// AppGallery Connect certificate / device / profile management, token refresh and error mapping.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-cloud-"));
const UDID = "A".repeat(32) + "0123456789ABCDEF0123456789ABCDEF";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "none" })}.${b64({ userId: "u42", userName: "mock", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

// ------------------------------- mock services -------------------------------
const agc = { certs: [], devices: [], profiles: [], files: new Map(), calls: [], fail401: 0, deviceLimit: false, refreshes: 0 };
let server, base, client;

function handle(req, res, body) {
  const url = new URL(req.url, base);
  const json = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  const ok = (extra = {}) => json({ ret: { code: 0 }, ...extra });
  // login portal
  if (url.pathname === "/authrouter/auth/api/temptoken/check") return res.end(url.searchParams.get("tempToken") === "tmp-ok" ? JWT : "bad");
  if (url.pathname === "/authrouter/auth/api/jwToken/check") {
    if (req.headers.refresh === "true") agc.refreshes++;
    return json(req.headers.jwttoken === JWT ? { status: true, userInfo: { accessToken: `acc-${agc.refreshes}` } } : { status: false });
  }
  if (url.pathname.startsWith("/file/")) return res.end(agc.files.get(url.pathname.slice(6)));
  // AGC: every call must carry the account headers
  agc.calls.push(`${req.method} ${url.pathname}`);
  if (req.headers.uid !== "u42" || !req.headers.oauth2token) return json({}, 401);
  if (agc.fail401 > 0) { agc.fail401--; return json({}, 401); }
  const data = body ? JSON.parse(body) : {};
  const file = (name, content) => { agc.files.set(name, content); return { newUrl: `${base}/file/${name}`, sha256: crypto.createHash("sha256").update(content).digest("hex") }; };
  switch (`${req.method} ${url.pathname}`) {
    case "GET /api/ups/user-permission-service/v1/user-team-list": return json({ teams: [{ id: 7, name: "Team", userType: 1 }] });
    case "POST /api/cps/harmony-cert-manage/v1/cert/list": return ok({ certList: agc.certs });
    case "POST /api/cps/harmony-cert-manage/v1/cert/add": {
      assert.match(data.csr, /BEGIN NEW CERTIFICATE REQUEST|CSR/);
      const id = `c${agc.certs.length + 1}`;
      agc.certs.push({ id, certName: data.certName, certType: Number(data.certType), certObjectId: `obj-${id}` });
      agc.files.set(`obj-${id}`, `CERT ${data.certName}`);
      return ok();
    }
    case "DELETE /api/cps/harmony-cert-manage/v1/cert/delete":
      agc.certs = agc.certs.filter((c) => !data.certIds.includes(c.id));
      return ok();
    case "GET /api/cps/device-manage/v1/device/list": return ok({ list: agc.devices, totalCount: agc.devices.length });
    case "POST /api/cps/device-manage/v1/device/add":
      if (agc.deviceLimit) return json({ ret: { code: 205389859, msg: "device number exceeds limit" } });
      agc.devices.push({ id: `d${agc.devices.length + 1}`, udid: data.udid, deviceName: data.deviceName, deviceType: data.deviceType });
      return ok();
    case "POST /api/cps/provision-manage/v1/ide/test/provision/add":
    case "POST /api/cps/provision-manage/v1/ide/real/provision/add": {
      const id = `p${agc.profiles.length + 1}`;
      agc.profiles.push({ id, ...data, kind: url.pathname.includes("/test/") ? "debug" : "release" });
      agc.files.set(`prov-${id}`, `PROFILE ${data.packageName}`);
      return ok({ id, provisionFileUrl: `prov-${id}` });
    }
    case "DELETE /api/cps/provision-manage/v1/provision/delete":
      agc.profiles = agc.profiles.filter((p) => p.id !== url.searchParams.get("id"));
      return ok();
    case "POST /api/amis/app-manage/v1/objects/url/reapply": return json({ urlsInfo: [file(data.sourceUrls, agc.files.get(data.sourceUrls))] });
  }
  return json({ ret: { code: 1, msg: `unmocked ${req.method} ${url.pathname}` } });
}

/** Fake DevEco layout: only an hdc script that reports one phone. */
function fakeStudio() {
  const studio = path.join(work, "studio");
  const tc = path.join(studio, "Contents/sdk/default/openharmony/toolchains");
  fs.mkdirSync(tc, { recursive: true });
  fs.writeFileSync(path.join(tc, "hdc"), `#!/bin/sh
case "$*" in
  "list targets") echo FAKEPHONE ;;
  *"bm get -u"*) echo "udid of current device is :"; echo "${UDID}" ;;
  *"const.product.devicetype"*) echo phone ;;
esac
`, { mode: 0o755 });
  return studio;
}

before(async () => {
  server = http.createServer((req, res) => { let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => handle(req, res, body)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const config = path.join(work, "config.json");
  fs.writeFileSync(config, JSON.stringify({ studio: fakeStudio() }));
  client = connect({ DEVECO_STATE_DIR: path.join(work, "state"), DEVECO_CONFIG: config, DEVECO_AGC_URL: base, DEVECO_LOGIN_URL: base });
  await client.initialize();
});
after(async () => { await client?.close(); server?.close(); });

const call = async (tool, args) => {
  const r = await client.call(tool, args);
  assert.equal(r.isError, false, `${tool} ${JSON.stringify(args)} -> ${JSON.stringify(r.data).slice(0, 600)}`);
  return r.data;
};
const waitLogin = async (provider) => {
  for (let i = 0; i < 50; i++) {
    const s = await call("auth", { action: "status", provider });
    if (s.logged_in || s.error) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("login did not finish");
};

// The fake hdc is a shell script; Windows only runs hdc.exe, so device-dependent parts are POSIX-only.
const posix = process.platform !== "win32";

// ------------------------------------ tests ------------------------------------
test("browser login: forged callbacks are rejected, cancel and success are handled", async () => {
  const started = await call("auth", { action: "login", provider: "developer", open_browser: false });
  assert.equal(started.pending, true);
  const url = new URL(started.login_url);
  assert.equal(url.origin, base);
  const callback = `http://127.0.0.1:${url.searchParams.get("port")}/callback`;
  const code = url.searchParams.get("code");
  // Wrong nonce and a foreign site are refused; the login stays pending.
  assert.equal((await fetch(`${callback}?code=wrong&tempToken=tmp-ok`)).status, 400);
  assert.equal((await fetch(`${callback}?code=${code}&tempToken=tmp-ok&siteId=5`)).status, 400);
  assert.equal((await call("auth", { action: "login", provider: "developer", open_browser: false })).login_url, started.login_url, "second login reuses the pending one");
  // Real callback (POST form, like the portal).
  const done = await fetch(callback, { method: "POST", body: new URLSearchParams({ code, tempToken: "tmp-ok", siteId: "1" }) });
  assert.equal(done.status, 200);
  const status = await waitLogin("developer");
  assert.equal(status.logged_in, true, JSON.stringify(status));
  assert.equal(status.user, "mock");

  // Cancelled in the browser: not logged in, error reported.
  const other = await call("auth", { action: "login", provider: "codegenie", open_browser: false });
  const u2 = new URL(other.login_url);
  await fetch(`http://127.0.0.1:${u2.searchParams.get("port")}/callback?code=${u2.searchParams.get("code")}&quit=true`);
  const cancelled = await waitLogin("codegenie");
  assert.equal(cancelled.logged_in, false);
  assert.match(cancelled.error, /cancel/i);
});

test("teams and token refresh on 401", async () => {
  assert.deepEqual((await call("auth", { action: "teams" })).teams, [{ id: "7", name: "Team", role: 1 }]);
  agc.fail401 = 1;
  const before = agc.refreshes;
  assert.deepEqual((await call("sign", { action: "certificates" })).certificates, []);
  assert.equal(agc.refreshes, before + 1, "a 401 refreshes the token once and retries");
});

test("register_device is idempotent and maps the device type", { skip: !posix && "fake hdc is a shell script" }, async () => {
  const first = await call("sign", { action: "register_device" });
  assert.equal(first.registered, true);
  assert.equal(first.udid, UDID);
  assert.equal(agc.devices[0].deviceType, "4");
  const again = await call("sign", { action: "register_device" });
  assert.equal(again.already, true);
  assert.equal(agc.devices.length, 1);
  assert.equal((await call("sign", { action: "devices" })).devices.length, 1);
});

test("itemized chain: certificate_create -> profile_create (debug/release) -> profile_delete -> delete_certificate", async () => {
  const dir = path.join(work, "material");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "k.csr"), "-----BEGIN NEW CERTIFICATE REQUEST-----\nMOCK\n-----END NEW CERTIFICATE REQUEST-----\n");
  if (!agc.devices.length) agc.devices.push({ id: "d1", udid: UDID, deviceName: "seeded", deviceType: "4" }); // Windows: register_device skipped
  const cert = await call("sign", { action: "certificate_create", csr: path.join(dir, "k.csr"), name: "mcp-test", out: path.join(dir, "k.cer") });
  assert.equal(cert.type, "debug");
  assert.equal(fs.readFileSync(cert.file, "utf8"), "CERT mcp-test");
  // Existing output files are never overwritten.
  const conflict = await client.call("sign", { action: "certificate_create", csr: path.join(dir, "k.csr"), name: "mcp-test2", out: path.join(dir, "k.cer") });
  assert.equal(conflict.data.error.code, "CONFLICT");

  const debug = await call("sign", { action: "profile_create", id: cert.certificate, bundle: "com.example.mock", out: path.join(dir, "d.p7b") });
  assert.equal(debug.devices, 1);
  assert.equal(fs.readFileSync(debug.file, "utf8"), "PROFILE com.example.mock");
  assert.deepEqual(agc.profiles.at(-1).deviceList, ["d1"]);
  const release = await call("sign", { action: "profile_create", id: cert.certificate, bundle: "com.example.mock", type: "release", out: path.join(dir, "r.p7b") });
  assert.equal(agc.profiles.at(-1).kind, "release");
  assert.equal(agc.profiles.at(-1).deviceList, undefined, "release profiles are not bound to devices");

  await call("sign", { action: "profile_delete", id: release.profile });
  await call("sign", { action: "profile_delete", id: debug.profile });
  assert.equal(agc.profiles.length, 0);
  await call("sign", { action: "delete_certificate", id: cert.certificate });
  assert.equal(agc.certs.length, 0);
});

test("AGC rejections carry a code and an actionable hint; missing inputs are refused", async () => {
  agc.devices = [];
  if (posix) {
    agc.deviceLimit = true;
    const r = await client.call("sign", { action: "register_device" });
    assert.equal(r.data.error.code, "SIGN_CLOUD_REJECTED");
    assert.match(r.data.error.hint, /Device limit/);
    agc.deviceLimit = false;
  }
  const noDevices = await client.call("sign", { action: "profile_create", id: "c1", bundle: "com.example.mock", out: path.join(work, "x.p7b") });
  assert.equal(noDevices.data.error.code, "DEVICE_UNAVAILABLE");
  for (const args of [{ action: "delete_certificate" }, { action: "profile_delete" }, { action: "certificate_create", name: "x" }]) {
    assert.equal((await client.call("sign", args)).data.error.code, "INVALID_INPUT", JSON.stringify(args));
  }
});

test("logout clears credentials", async () => {
  await call("auth", { action: "logout", provider: "developer" });
  assert.equal((await call("auth", { action: "status", provider: "developer" })).logged_in, false);
  assert.equal((await client.call("sign", { action: "certificates" })).data.error.code, "AUTH_REQUIRED");
});
