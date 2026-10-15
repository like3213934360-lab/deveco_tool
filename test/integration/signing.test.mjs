// Local signing configuration and the real process runner; no SDK, home material or AGC access.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-signing-"));
const bundle = path.join(root, "node_modules/.cache/deveco-signing.mjs"), cli = path.join(work, "signer.cjs");
fs.writeFileSync(cli, `const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('-outFile')+1],JSON.stringify(args));`);
await build({ stdin: { contents: `export * from ${JSON.stringify(path.join(root, "src/domains/sign.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "local-signer", setup(b) {
    b.onResolve({ filter: /toolchain\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/sign.ts") ? { path: "toolchain", namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export function toolCommand(_,args){return {file:process.execPath,args:[${JSON.stringify(cli)},...args]}};export function toolchain(){throw new Error('unexpected SDK lookup')}` }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); });

function project(products = [{ name: "phone", signingConfig: "debug" }], configs) {
  const dir = fs.mkdtempSync(path.join(work, "project-")), keystore = path.join(dir, "debug.p12");
  fs.writeFileSync(keystore, "fixture key");
  const password = m.encryptPassword("isolated password", keystore);
  const material = { storeFile: "debug.p12", storePassword: password, keyAlias: "debugKey", keyPassword: password, certpath: "debug.cer", profile: "debug.p7b" };
  const profile = { app: { products, signingConfigs: configs ?? [{ name: "debug", material }] } };
  fs.writeFileSync(path.join(dir, "build-profile.json5"), JSON.stringify(profile));
  return { dir, profile, material };
}
const input = (p, extra = {}) => ({ project: p.dir, file: path.join(p.dir, "unsigned.hap"), out: path.join(p.dir, "signed.hap"), ...extra });
function readArgs(file) {
  const args = JSON.parse(fs.readFileSync(file, "utf8")), values = {};
  for (let i = 1; i < args.length; i += 2) values[args[i]] = args[i + 1];
  return values;
}
const unchanged = (p, original) => { assert.equal(fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8"), original); assert.equal(fs.existsSync(path.join(p.dir, "signed.hap")), false); };

test("local signing follows the selected product reference, including a sole non-default product", async () => {
  const p = project(), original = fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8");
  assert.deepEqual(m.existingSigning(p.dir), { source: "build-profile.json5", config: "debug" });
  const result = await m.signPackage(input(p));
  const args = readArgs(result.signed);
  assert.equal(args["-keyAlias"], "debugKey"); assert.equal(args["-keystorePwd"], "isolated password"); assert.equal(args["-keyPwd"], "isolated password");
  assert.equal(args["-keystoreFile"], path.join(p.dir, "debug.p12")); assert.equal(args["-appCertFile"], path.join(p.dir, "debug.cer")); assert.equal(args["-profileFile"], path.join(p.dir, "debug.p7b"));
  assert.equal(fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8"), original);
});

test("default and explicit products use their references; ambiguous or unknown products fail before signing", async () => {
  const p = project([{ name: "phone", signingConfig: "debug" }, { name: "watch", signingConfig: "wearable" }]);
  p.profile.app.signingConfigs.push({ name: "wearable", material: { ...p.material, keyAlias: "watchKey" } });
  const write = () => fs.writeFileSync(path.join(p.dir, "build-profile.json5"), JSON.stringify(p.profile)); write();
  const original = fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8");
  for (const product of [undefined, "missing"]) await assert.rejects(m.signPackage(input(p, { product })), { code: "PRODUCT_AMBIGUOUS" });
  unchanged(p, original);
  const chosen = await m.signPackage(input(p, { product: "watch" })); assert.equal(readArgs(chosen.signed)["-keyAlias"], "watchKey");
  p.profile.app.products.push({ name: "default", signingConfig: "wearable" }); write();
  assert.deepEqual(m.existingSigning(p.dir), { source: "build-profile.json5", config: "wearable" });
  const selected = await m.signPackage(input(p, { out: path.join(p.dir, "default.hap") })); assert.equal(readArgs(selected.signed)["-keyAlias"], "watchKey");
});

test("missing reference and incomplete material report their source without creating or replacing signing", async () => {
  for (const configs of [[], [{ name: "phone", material: {} }], [{ name: "debug" }], [{ name: "debug", material: { keyAlias: "only-alias" } }]]) {
    const p = project(undefined, configs), original = fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8");
    await assert.rejects(m.signPackage(input(p)), (e) => {
      assert.ok(["SIGN_CONFIG_MISSING", "SIGN_MATERIAL_INVALID"].includes(e.code));
      assert.equal(e.details.product, "phone"); assert.equal(e.details.signing_config, "debug"); assert.equal(e.details.source, "build-profile.json5");
      assert.match(e.hint, /explicit/); assert.doesNotMatch(JSON.stringify(e), /isolated password/); return true;
    });
    unchanged(p, original);
  }
});

test("explicit material works without project configuration and partial explicit input is never silently ignored", async () => {
  const p = project(undefined, []), original = fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8");
  await assert.rejects(m.signPackage(input(p, { key_alias: "override" })), { code: "INVALID_INPUT" }); unchanged(p, original);
  const result = await m.signPackage(input(p, { keystore: path.join(p.dir, "explicit.p12"), keystore_password: "explicit password", key_alias: "explicitKey", key_password: "explicit key password", cert: "explicit.cer", profile: "explicit.p7b" }));
  const args = readArgs(result.signed); assert.equal(args["-keyAlias"], "explicitKey"); assert.equal(args["-keystorePwd"], "explicit password"); assert.equal(args["-keyPwd"], "explicit key password");
  assert.equal(fs.readFileSync(path.join(p.dir, "build-profile.json5"), "utf8"), original);
});

test("decrypting missing or corrupt DevEco material cannot generate replacement material", async () => {
  const p = project(), store = path.join(p.dir, "debug.p12"), encryption = path.join(p.dir, "material");
  fs.rmSync(encryption, { recursive: true });
  await assert.rejects(m.signPackage(input(p)), { code: "SIGN_MATERIAL_INVALID" }); assert.equal(fs.existsSync(encryption), false);
  assert.throws(() => m.decryptPassword("bad", store), { code: "SIGN_MATERIAL_INVALID" }); assert.equal(fs.existsSync(encryption), false);
  m.encryptPassword("isolated password", store);
  assert.throws(() => m.decryptPassword("bad", store), { code: "SIGN_MATERIAL_INVALID" }); assert.equal(fs.existsSync(path.join(p.dir, "signed.hap")), false);
});
