// All auto-signing here is simulated: real runner/domain + loopback AGC, fake SDK/keytool.
// No user credentials, home signing material, device, or real AGC endpoint is used.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auto-"));
const home = path.join(work, "home"); fs.mkdirSync(home);
process.env.DEVECO_STATE_DIR = path.join(work, "state");
const pem = fs.readFileSync(path.join(root, "test/fixtures/audit-public-cert.pem"), "utf8");
const fixture = globalThis.__devecoSignFixture = { home, pem, fault: null, config: null };
let mode = "ok", certs = [], creates = 0, profiles = 0, deletes = [], hold, mutated;
const server = http.createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (value) => res.end(JSON.stringify(value));
  if (req.url.endsWith("/cert/list")) return send({ certList: certs });
  if (req.url.endsWith("/cert/add")) {
    creates++;
    if (mode === "quota") return send({ ret: { code: 205389872, msg: "quota" } });
    if (mode === "http") { res.statusCode = 500; return send({}); }
    certs.push({ id: `new-${creates}`, certName: body.certName, certType: 1, certObjectId: "cert-object" });
    if (mode === "crash-cert") { mutated?.(); return; }
    if (mode === "lost-cert") return res.destroy();
    return send({ ret: { code: 0 } });
  }
  if (req.url.endsWith("/cert/delete")) {
    deletes.push(...body.certIds); certs = certs.filter((c) => !body.certIds.includes(c.id));
    return send({ ret: { code: 0 } });
  }
  if (req.url.startsWith("/api/cps/device-manage/")) {
    if (mode === "cancel") { hold?.(); return; }
    return send({ list: [{ id: "device-1", udid: "FIXTURE-UDID", deviceName: "test" }], totalCount: 1 });
  }
  if (req.url.endsWith("/ide/test/provision/add")) {
    profiles++;
    if (mode === "profile-reject") return send({ ret: { code: 205389938, msg: "profile quota" } });
    if (mode === "lost-profile") return res.destroy();
    return send({ provisionFileUrl: "profile-object" });
  }
  if (req.url.endsWith("/objects/url/reapply")) {
    const data = bytes(body.sourceUrls);
    return send({ urlsInfo: [{ newUrl: `${url}/file/${body.sourceUrls}`, sha256: mode === "checksum" ? "bad" : digest(data) }] });
  }
  if (req.url.startsWith("/file/")) {
    if (mode === "download") { res.statusCode = 503; return res.end(); }
    return res.end(bytes(req.url.slice(6)));
  }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
process.env.DEVECO_AGC_URL = url;
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
function bytes(object) {
  if (object === "cert-object") return Buffer.from(mode === "bad-cert" ? "invalid" : pem);
  return Buffer.from(JSON.stringify({ "version-name": "2.0", type: "debug", "bundle-info": { "bundle-name": mode === "wrong-bundle" ? "com.wrong" : "com.test.audit", "development-certificate": pem },
    "debug-info": { "device-ids": [mode === "wrong-device" ? "FOREIGN" : "FIXTURE-UDID"] }, validity: { "not-before": 1, "not-after": 4102444800 } }));
}
const bundle = path.join(root, "node_modules/.cache/deveco-auto-harness.mjs");
await build({ stdin: { contents: `import ${JSON.stringify(path.join(root, "src/jobs.ts"))}; export * from ${JSON.stringify(path.join(root, "src/core/jobs.ts"))}; export * from ${JSON.stringify(path.join(root, "src/core/db.ts"))};`, resolveDir: root },
  outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "error",
  plugins: [{ name: "isolated-sdk", setup(b) {
    b.onResolve({ filter: /^node:os$/ }, (a) => /sign-auto\.ts$/.test(a.importer) ? { path: "os", namespace: "fixture" } : undefined);
    b.onResolve({ filter: /^node:fs$/ }, (a) => /(?:sign-auto|files)\.ts$/.test(a.importer) ? { path: "fs", namespace: "fixture" } : undefined);
    b.onResolve({ filter: /(?:auth|device|project|proc|toolchain)\.js$/ }, (a) => {
      if (!/sign(?:-auto)?\.ts$/.test(a.importer)) return;
      return { path: path.basename(a.path, ".js"), namespace: "fixture" };
    });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => {
      const modules = {
        os: `import os from 'node:os'; export default {...os,homedir:()=>globalThis.__devecoSignFixture.home};`,
        fs: `import fs from 'node:fs'; export default {...fs, renameSync:(a,b)=>{const f=globalThis.__devecoSignFixture;if(f.fault==='config'&&b===f.config)throw new Error('injected config rename'); fs.renameSync(a,b); if(f.fault==='crash-commit'&&b===f.config)process.exit(91);}};`,
        auth: `export async function credentials(){return {access:'fake',userId:'offline'}}; export async function teams(){return {teams:[]}};`,
        device: `export async function listTargets(){return []}; export async function shell(){throw new Error('unexpected device')};`,
        project: `export function inspectProject(root,product='default'){return {root,product,bundleName:'com.test.audit',modules:[]}};`,
        toolchain: `export function toolchain(){return {components:{java:'/fake/bin/java'}}}; export function toolCommand(_name,args){return {file:'fake',args}};`,
        proc: `import fs from 'node:fs'; export async function run(cmd){ const f=globalThis.__devecoSignFixture;
          if(cmd.args[0]==='generate-keypair'){if(f.fault==='files')throw new Error('injected keypair failure');fs.writeFileSync(cmd.args[cmd.args.indexOf('-keystoreFile')+1],'isolated P12');}
          if(cmd.args[0]==='generate-csr')fs.writeFileSync(cmd.args[cmd.args.indexOf('-outFile')+1],'isolated CSR');
          if(cmd.args[0]==='verify-profile'&&f.fault==='verify')return {code:1,stdout:'ERROR: invalid signature',stderr:''};
          return {code:0,stdout:cmd.args[0]==='-list'?f.pem:'SUCCESS',stderr:''}; };`,
      };
      return { contents: modules[a.path], loader: "js" };
    });
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(async () => { await m.shutdownJobs(); m.closeDatabase(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(bundle, { force: true }); delete globalThis.__devecoSignFixture; });

function setup(existing = true) {
  mode = "ok"; fixture.fault = null; creates = 0; profiles = 0; deletes = []; certs = [{ id: "old-cert", certName: "business", certType: 1, certObjectId: "old" }];
  const project = fs.mkdtempSync(path.join(work, "project-"));
  const material = Object.fromEntries(["p12", "cer", "p7b", "csr"].map((ext) => {
    const f = path.join(project, `old.${ext}`); fs.writeFileSync(f, `original-${ext}`); return [ext, f];
  }));
  const config = path.join(project, "build-profile.json5"); fixture.config = config;
  fs.writeFileSync(config, JSON.stringify({ app: { products: [{ name: "default", ...(existing ? { signingConfig: "old" } : {}) }], signingConfigs: existing ? [{ name: "old", material: { storeFile: material.p12, certpath: material.cer, profile: material.p7b } }] : [] } }));
  const hashes = Object.fromEntries([config, ...Object.values(material)].map((f) => [f, digest(fs.readFileSync(f))]));
  return { project, config, material, hashes };
}
const unchanged = (p) => { for (const [file, hash] of Object.entries(p.hashes)) assert.equal(digest(fs.readFileSync(file)), hash, file); assert.ok(certs.some((c) => c.id === "old-cert")); assert.ok(!deletes.includes("old-cert")); };
async function run(p, force = true) { const { job_id } = await m.startJob("auto_sign", { project: p.project, team: "offline-team", force }); await m.waitJob(job_id, 5000); return m.jobStatus(job_id, true); }

test("first sign, repeat refusal, force replacement retain all prior signing material", async () => {
  const p = setup(false); const first = await run(p, false);
  assert.equal(first.status, "succeeded", JSON.stringify(first));
  const original = { ...p, hashes: { ...p.hashes, [p.config]: digest(fs.readFileSync(p.config)) } };
  const repeat = await run(p, false); assert.equal(repeat.error.code, "SIGN_CONFIGURED"); assert.equal(creates, 1); unchanged(original);
  const prior = Object.values(first.result.files).map((f) => [f, digest(fs.readFileSync(f))]);
  const forced = await run(p); assert.equal(forced.status, "succeeded", JSON.stringify(forced)); assert.equal(creates, 2);
  for (const [file, hash] of prior) assert.equal(digest(fs.readFileSync(file)), hash);
  for (const [file, hash] of Object.entries(p.hashes)) if (file !== p.config) assert.equal(digest(fs.readFileSync(file)), hash);
  assert.equal(certs.length, 3); assert.deepEqual(deletes, []);
});

test("quota failure leaves old config/files/cloud intact and closes only staging", async () => {
  const p = setup(); mode = "quota"; const s = await run(p);
  assert.equal(s.status, "failed"); assert.equal(s.error.code, "SIGN_CLOUD_REJECTED"); unchanged(p);
  assert.equal(certs.length, 1); assert.deepEqual(deletes, []); assert.equal(s.outputs.compensation.closed, true);
  assert.equal(fs.existsSync(s.outputs.prepare.dir), false);
});

test("definite profile/download/integrity/key/config failures compensate only the receipted new certificate", async () => {
  for (const failure of ["profile-reject", "download", "checksum", "bad-cert", "wrong-bundle", "wrong-device", "verify", "config", "files"]) {
    const p = setup(); if (["verify", "config", "files"].includes(failure)) fixture.fault = failure; else mode = failure;
    const s = await run(p); assert.equal(s.status, "failed", `${failure}: ${JSON.stringify(s)}`); unchanged(p);
    assert.equal(certs.length, 1, failure); assert.equal(deletes.length, failure === "files" ? 0 : 1, failure);
    assert.equal(fs.readdirSync(path.join(home, ".ohos/config")).filter((f) => f.endsWith(".lock")).length, 0);
  }
});

test("lost certificate reply reconciles by exclusive name without another POST, even with force", async () => {
  const p = setup(); mode = "lost-cert"; const s = await run(p);
  assert.equal(s.status, "needs_input"); unchanged(p); assert.equal(creates, 1); assert.deepEqual(deletes, []);
  mode = "ok"; await m.resumeJob(s.job_id, true); const resumed = await m.waitJob(s.job_id, 5000);
  assert.equal(resumed.status, "succeeded", JSON.stringify(resumed)); assert.equal(creates, 1); assert.equal(certs.length, 2);
});

test("HTTP failure/unknown profile outcome never blindly repeat remote creation", async () => {
  for (const failure of ["http", "lost-profile"]) {
    const p = setup(); mode = failure; const s = await run(p);
    assert.equal(s.status, "needs_input"); unchanged(p);
    const count = [creates, profiles]; mode = "ok";
    await m.resumeJob(s.job_id, true); const resumed = await m.waitJob(s.job_id, 5000);
    assert.equal(resumed.status, "needs_input"); assert.deepEqual([creates, profiles], count); unchanged(p);
    // This test-owned uncertain attempt is intentionally inspected then removed by test teardown.
  }
});

test("cancellation after certificate receipt performs bounded owned compensation", async () => {
  const p = setup(); mode = "cancel";
  const blocked = new Promise((r) => { hold = r; });
  const { job_id } = await m.startJob("auto_sign", { project: p.project, team: "offline-team", force: true });
  await blocked; const s = await m.cancelJob(job_id); hold = undefined;
  assert.equal(s.status, "cancelled", JSON.stringify(s)); unchanged(p); assert.equal(certs.length, 1); assert.equal(deletes.length, 1);
});

test("a killed signing process reconciles certificate and atomic-config intents on restart", async () => {
  for (const stage of ["certificate", "commit"]) {
    const p = setup(); mode = stage === "certificate" ? "crash-cert" : "ok";
    const accepted = new Promise((r) => { mutated = r; });
    const code = `globalThis.__devecoSignFixture=${JSON.stringify({ home, pem, config: p.config, fault: stage === "commit" ? "crash-commit" : null })};
      const m=await import(${JSON.stringify(pathToFileURL(bundle).href)});
      const j=await m.startJob('auto_sign',${JSON.stringify({ project: p.project, team: "offline-team", force: true })});
      console.log(j.job_id); await m.waitJob(j.job_id,5000);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: process.env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; }); child.stderr.on("data", (c) => { stderr += c; });
    const exited = once(child, "exit");
    if (stage === "certificate") { await accepted; child.kill("SIGKILL"); }
    const [exit] = await exited;
    if (stage === "commit") assert.equal(exit, 91, stderr);
    const id = /j_\w+/.exec(stdout)?.[0]; assert.ok(id, stderr);
    const interrupted = await m.jobStatus(id, true); assert.equal(interrupted.status, "interrupted");
    if (stage === "certificate") unchanged(p);
    mode = "ok"; mutated = undefined;
    await m.resumeJob(id, true); const recovered = await m.waitJob(id, 5000);
    assert.equal(recovered.status, "succeeded", JSON.stringify(recovered));
    assert.equal(creates, 1); assert.equal(profiles, 1); assert.equal(certs.length, 2); assert.deepEqual(deletes, []);
    for (const [file, hash] of Object.entries(p.hashes)) if (file !== p.config) assert.equal(digest(fs.readFileSync(file)), hash);
  }
});
