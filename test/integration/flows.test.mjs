import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { workspace } from "../support/workspace.mjs";

const temporary = workspace("flows"), out = temporary.directory;
process.env.DEVECO_STATE_DIR = out;
const bundle = path.join(out, "flows.mjs");
await build({ stdin: { contents: `export * from ${JSON.stringify(path.resolve("src/domains/flows.ts"))};export {closeDatabase} from ${JSON.stringify(path.resolve("src/core/db.ts"))};export {stopCleanup} from ${JSON.stringify(path.resolve("src/core/artifacts.ts"))};`, resolveDir: process.cwd() }, outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const flows = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(async () => { await flows.stopCleanup(); flows.closeDatabase(); temporary.remove(); });

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
  assert.equal(s.text, "登录"); assert.equal(s.exact, true); assert.equal(s.clickable, true); assert.equal(s.bundle, "b");
  assert.deepEqual(flows.toSelector(flows.fromSelector(s)), s);
  const advanced = { xpath: "//Button", regex: { text: "S.*" }, regex_flags: "i", text_match: "prefix", within: "form", index: -1, description: "Save", focused: true };
  assert.deepEqual(flows.toSelector(flows.fromSelector(advanced)), advanced);
  const project = path.join(out, "selectors");
  fs.mkdirSync(project, { recursive: true });
  flows.writeFlow(project, { ...legacy, id: "selectors", steps: [{ id: "s1", action: "tap", selector: flows.fromSelector(advanced) }] });
  assert.deepEqual(flows.toSelector(flows.readFlow(project, "selectors").steps[0].selector), flows.toSelector(advanced));
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
  try {
    assert.equal((await reconnected.showFlow(project, "draft")).status, "draft");
    await assert.rejects(reconnected.stopRecording("offline-target", { project: other, discard: true }), (e) => e.code === "INVALID_INPUT");
    await assert.rejects(reconnected.stopRecording("offline-target", { project }), (e) => e.code === "INVALID_INPUT");
    assert.equal((await reconnected.stopRecording("offline-target", { project, discard: true })).discarded, "draft");
    assert.equal((await flows.listDrafts(project)).length, 0);
  } finally { await reconnected.stopCleanup(); reconnected.closeDatabase(); }
});

test("recorded focus typing uses required secret variables and never stores literal input in a saved flow", () => {
  const flow = structuredClone(legacy), values = {};
  const step = flows.makeStep(flow, values, { action: "type", text: "private-password" });
  assert.equal(step.action, "focusInput");
  const name = step.value.slice(2, -1);
  assert.deepEqual(flow.variables[name], { required: true, secret: true });
  assert.equal(values[name], "private-password");
  assert.doesNotMatch(JSON.stringify({ ...flow, steps: [step] }), /private-password/);
});
