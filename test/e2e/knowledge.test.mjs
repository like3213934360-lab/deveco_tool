// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { session, hashes, required } from "../support/acceptance.mjs";

test("knowledge", async (t) => {
  const state = required("DEVECO_STATE_DIR");
  const { call, job, defer, receipt } = await session(t);

  const root = path.join(state, "kb"), pointer = path.join(root, "current.json");
  const before = JSON.parse(fs.readFileSync(pointer, "utf8"));
  const original = path.join(root, before.directory ?? before.version), content = hashes(original);
  const installed = (await call("knowledge", { action: "status", check: false })).installed;
  defer(async () => {
    const current = JSON.parse(fs.readFileSync(pointer, "utf8"));
    if (current.directory !== (before.directory ?? before.version)) {
      assert.equal(current.previous, before.directory ?? before.version, "Refuse to roll back an unrelated knowledge update");
      await call("knowledge", { action: "rollback" });
    }
    assert.deepEqual(hashes(original), content);
  });
  await t.test("knowledge.check-and-default-update", async () => {
    const checked = await call("knowledge", { action: "update", file: "upstream", check: true });
    assert.equal(checked.source, "upstream");
    assert.equal(checked.compatibility.selected_compatible, true);
    receipt("remote-check.json", checked);
    const d = await job("knowledge", { action: "update", file: "upstream" });
    assert.equal(d.result.available_version, checked.available_version);
    if (checked.update_available || checked.local_content.state !== "unchanged") {
      assert.equal(d.result.updated, true);
      assert.equal(JSON.parse(fs.readFileSync(pointer, "utf8")).previous, before.directory ?? before.version);
      await call("knowledge", { action: "rollback" });
    } else {
      assert.equal(d.result.updated, false);
      assert.deepEqual(JSON.parse(fs.readFileSync(pointer, "utf8")), before);
    }
    assert.deepEqual(hashes(original), content);
  });
  await t.test("knowledge.update-upstream-and-rollback", async () => {
    const d = await job("knowledge", { action: "update", file: "upstream", force: true });
    assert.equal(d.status, "succeeded", JSON.stringify(d)); assert.equal(d.result.updated, true);
    const next = JSON.parse(fs.readFileSync(pointer, "utf8"));
    assert.notEqual(next.directory, before.directory ?? before.version); assert.equal(next.previous, before.directory ?? before.version);
    const found = await call("knowledge", { action: "search", query: "@Local", limit: 1 });
    assert.equal(found.pack, d.result.version); assert.ok(found.results.length > 0);
    assert.ok((await call("knowledge", { action: "read", id: found.results[0].id })).content.length > 100);
    assert.equal((await call("knowledge", { action: "rollback" })).rolled_back_to, `${installed.version} (${installed.origin})`);
    assert.deepEqual((await call("knowledge", { action: "status", check: false })).installed, installed);
    assert.equal(JSON.parse(fs.readFileSync(pointer, "utf8")).directory, before.directory ?? before.version);
    assert.deepEqual(hashes(original), content);
    assert.equal((await call("knowledge", { action: "search", query: "@Local", limit: 1 })).pack, installed.version);
  });

});
