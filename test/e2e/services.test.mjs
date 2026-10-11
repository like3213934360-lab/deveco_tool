// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../support/acceptance.mjs";

test("host", async (t) => {
  const { call, target, project, info } = await app(t);

  await t.test("doctor", async () => assert.equal((await call("doctor", { project, target })).ok, true));
  await t.test("device.list-info", async () => {
    assert.ok((await call("device", { action: "list" })).devices.some((d) => d.target === target));
    assert.ok(info.api_level >= 26 && info.screen.width > 0);
  });
  await t.test("knowledge.local-search-read", async () => {
    const d = await call("knowledge", { action: "search", query: "Scroll", kind: "docs", limit: 5 });
    assert.ok(d.results.length > 0);
    const read = await call("knowledge", { action: "read", id: d.results[0].id });
    assert.ok(read.content.length > 100);
  });
  await t.test("knowledge.catalog-status-update-check", async () => {
    const catalog = await call("knowledge", { action: "catalog" });
    assert.ok(JSON.stringify(catalog).includes("harmonyos-guides"));
    const state = await call("knowledge", { action: "status", check: false });
    assert.ok(state.installed.version);
    const update = await call("knowledge", { action: "update", check: true });
    assert.ok(update);
    assert.equal((await call("knowledge", { action: "status", check: false })).installed.version, state.installed.version);
  });
  await t.test("knowledge.cloud-search", async () => {
    const d = await call("knowledge", { action: "search", source: "cloud", query: "HarmonyOS ArkUI Scroll 滚动容器", limit: 3 });
    assert.ok(d.full_artifact);
    const text = await call("job", { action: "read", artifact_id: d.full_artifact, limit: 30 });
    assert.ok(text.content.length > 50);
  });
  await t.test("auth.status-teams", async () => {
    const status = await call("auth", { action: "status" });
    assert.ok(JSON.stringify(status).includes('"logged_in":true'));
    assert.ok((await call("auth", { action: "teams" })).teams.length > 0);
  });
  await t.test("skills.list-read-search", async () => {
    assert.ok((await call("skills", { action: "list" })).skills.length >= 3);
    assert.match((await call("skills", { action: "read", name: "deveco-mcp-workflow" })).content, /action/);
    const found = await call("skills", { action: "search", query: "harmony", limit: 5 });
    assert.ok(found.skills.length > 0);
  });
  await t.test("emulator.readonly-inventory", async () => {
    assert.ok((await call("emulator", { action: "list" })).emulators.length > 0);
    const images = await call("emulator", { action: "images" }); assert.ok(images);
    const license = await call("emulator", { action: "license_view" }); assert.ok(JSON.stringify(license).length > 100);
  });

});
