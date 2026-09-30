// v0.x credential migration: same AES-256-GCM layout (iv|tag|ciphertext, provider as AAD).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

test("imports v0.x credentials and reports login status", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-"));
  process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
  const legacy = path.join(work, "legacy");
  fs.mkdirSync(legacy);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(legacy, "credential.key"), key);
  const db = new DatabaseSync(path.join(legacy, "state.sqlite"));
  db.exec("CREATE TABLE credentials (provider TEXT PRIMARY KEY, revision TEXT NOT NULL, ciphertext BLOB)");
  const seal = (provider, value) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(provider));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const creds = { jwt: "a.b.c", access: "tok", saved: Date.now(), userId: "u1", userName: "tester", expires: Math.floor(Date.now() / 1000) + 3600 };
  db.prepare("INSERT INTO credentials VALUES (?,?,?)").run("codegenie", "r1", seal("codegenie", creds));
  db.prepare("INSERT INTO credentials VALUES (?,?,NULL)").run("developer", "r2");
  db.close();

  const client = connect({ DEVECO_STATE_DIR: path.join(work, "state"), DEVECO_CONFIG: path.join(work, "none.json") });
  await client.initialize();
  const imported = await client.call("auth", { action: "import", legacy_state_dir: legacy });
  assert.deepEqual(imported.data.imported, ["codegenie"]);
  const status = await client.call("auth", { action: "status", provider: "codegenie" });
  assert.equal(status.data.logged_in, true);
  assert.equal(status.data.user, "tester");
  const dev = await client.call("auth", { action: "status", provider: "developer" });
  assert.equal(dev.data.logged_in, false);
  const out = await client.call("auth", { action: "logout", provider: "codegenie" });
  assert.equal(out.data.logged_in, false);
  const needLogin = await client.call("knowledge", { action: "search", query: "x", source: "cloud" });
  assert.equal(needLogin.isError, true);
  assert.equal(needLogin.data.error.code, "AUTH_REQUIRED");
  await client.close();
});
