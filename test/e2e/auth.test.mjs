// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { session, sha, required } from "../support/acceptance.mjs";

test("auth", async (t) => {
  const state = required("DEVECO_STATE_DIR");
  const { call } = await session(t);

  const provider = "codegenie";
  const db = new DatabaseSync(path.join(state, "state.db"), { readOnly: true });
  const credential = (p) => { const row = db.prepare("SELECT data FROM credentials WHERE provider=?").get(p); return row ? sha(row.data) : null; };
  const original = credential("developer");
  const waitLogin = async () => {
    for (let i = 0; i < 300; i++) {
      const d = await call("auth", { action: "status", provider });
      assert.equal(d.error, undefined, JSON.stringify(d));
      if (!d.login_pending && d.logged_in) return d;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.fail("Browser login did not complete within five minutes");
  };
  try {
    await t.test("auth.existing-session-pending-logout-login", async () => {
      assert.equal((await call("auth", { action: "status", provider })).logged_in, true);
      const before = credential(provider);
      const started = await call("auth", { action: "login", provider, open_browser: false });
      assert.equal(started.pending, true);
      const d = await call("auth", { action: "status", provider });
      assert.equal(d.logged_in, true); assert.equal(d.login_pending, true);
      assert.equal((await call("auth", { action: "login", provider, open_browser: false })).login_url, started.login_url);
      assert.equal((await call("auth", { action: "logout", provider })).logged_in, false);
      assert.equal((await call("auth", { action: "status", provider })).logged_in, false);
      assert.equal(credential(provider), null);
      await call("auth", { action: "login", provider, open_browser: true });
      await waitLogin();
      assert.ok(credential(provider)); assert.notEqual(credential(provider), before);
    });
    await t.test("auth.completed-login-restarts-and-old-cleanup-preserves-new", async () => {
      const previous = await call("auth", { action: "status", provider });
      const d = await call("auth", { action: "login", provider, open_browser: false });
      assert.notEqual(d.login_url, previous.login_url);
      assert.equal((await call("auth", { action: "status", provider })).login_pending, true);
      await new Promise((r) => setTimeout(r, 65000));
      const pending = await call("auth", { action: "status", provider });
      assert.equal(pending.login_pending, true); assert.equal(pending.login_url, d.login_url);
      await call("auth", { action: "logout", provider });
      await call("auth", { action: "login", provider, open_browser: true });
      await waitLogin();
    });
    await t.test("auth.other-provider-unchanged", async () => assert.equal(credential("developer"), original));
  } finally { db.close(); }

});
