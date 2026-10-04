import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-flows-"));
process.on("exit", () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
process.env.DEVECO_STATE_DIR = out;
const bundle = path.resolve("node_modules/.cache/deveco-flows-harness.mjs");
await build({ entryPoints: [path.resolve("src/domains/flows.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const flows = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);

// A v0.x (version 2) flow as written by the previous implementation.
const legacy = {
  version: 2,
  id: "login-flow",
  name: "Login",
  app: { bundleName: "com.example.app", module: "entry", ability: "EntryAbility" },
  start: { mode: "restart" },
  variables: { user: { required: true, secret: false }, password: { required: true, secret: true } },
  steps: [
    { id: "s1", action: "tap", timeoutMs: 30000, selector: { text: "登录", textMode: "exact", clickableOnly: true, onScreenOnly: true, limit: 20 } },
    { id: "s2", action: "input", selector: { key: "username" }, value: "${user}" },
    { id: "s3", action: "input", selector: { key: "password" }, value: "${password}", fragile: false },
    { id: "s4", action: "dircFling", direction: 3, velocity: 600, scope: { display_id: 0, window_type: "app" } },
    { id: "s5", action: "waitVisible", selector: { text: "欢迎" } },
  ],
  assert: { visible: { text: "首页", textMode: "contains" }, timeoutMs: 5000 },
};

test("v0.x flow files load, list and round-trip", () => {
  const project = fs.mkdtempSync(path.join(out, "proj-"));
  fs.mkdirSync(path.join(project, ".arkpilot/flows"), { recursive: true });
  fs.writeFileSync(path.join(project, ".arkpilot/flows/login-flow.json"), JSON.stringify(legacy));
  fs.writeFileSync(path.join(project, ".arkpilot/flows/broken.json"), "{not json");
  const list = flows.listFlows(project);
  const login = list.find((f) => f.id === "login-flow");
  assert.equal(login.steps, 5);
  assert.deepEqual(login.variables, ["user", "password"]);
  assert.equal(login.has_assert, true);
  assert.ok(list.find((f) => f.id === "broken").invalid);
  const flow = flows.readFlow(project, "login-flow");
  flows.writeFlow(project, flow);
  const again = JSON.parse(fs.readFileSync(path.join(project, ".arkpilot/flows/login-flow.json"), "utf8"));
  assert.equal(again.steps[3].scope.window_type, "app", "unknown fields are preserved");
  assert.equal(again.steps[0].selector.onScreenOnly, true);
});

test("selector conversion keeps meaning", () => {
  const s = flows.toSelector({ text: "登录", textMode: "exact", clickableOnly: true, key: "k", bundle_name: "b" });
  assert.deepEqual(s, { text: "登录", exact: true, key: "k", type: undefined, id: undefined, bundle: "b", checked: undefined, selected: undefined, enabled: undefined, clickable: true });
  assert.deepEqual(flows.fromSelector(s), { text: "登录", textMode: "exact", key: "k", bundle_name: "b", clickableOnly: true });
});

test("draft discovery survives reconnect, isolates project/target and hides input secrets", async () => {
  const project = path.join(out, "draft-project"), other = path.join(out, "other-project");
  const app = legacy.app;
  await flows.startRecording(project, "offline-target", "draft", "Draft", app);
  await flows.recordStep("offline-target", { action: "input", x: 10, y: 10, text: "secret-input" }, { id: "field" }, { w: 100, h: 100 });
  assert.equal((await flows.listDrafts(other)).length, 0);
  const list = await flows.listDrafts(project); assert.equal(list[0].target, "offline-target");
  const shown = await flows.showFlow(project, "draft"); assert.equal(shown.status, "draft"); assert.doesNotMatch(JSON.stringify(shown), /secret-input/);
  // A newly loaded domain reads the persisted draft instead of an in-memory singleton.
  const reconnected = await import(`${pathToFileURL(bundle).href}?reconnect=1`);
  assert.equal((await reconnected.showFlow(project, "draft")).status, "draft");
  await assert.rejects(reconnected.stopRecording("offline-target", { project: other, discard: true }), (e) => e.code === "INVALID_INPUT");
  await assert.rejects(reconnected.stopRecording("offline-target", { project }), (e) => e.code === "INVALID_INPUT");
  assert.equal((await reconnected.stopRecording("offline-target", { project, discard: true })).discarded, "draft");
  assert.equal((await flows.listDrafts(project)).length, 0);
});
