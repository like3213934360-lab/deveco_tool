import { temporaryDirectory } from "../support/workspace.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../support/mcp.mjs";
import { promptMetrics } from "../support/prompts.mjs";

const state = temporaryDirectory("deveco-test-");
process.on("exit", () => { try { fs.rmSync(state, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } }); // tests leave nothing behind
const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };

test("handshake, tools/list and schema validation", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  const init = await client.initialize();
  assert.equal(init.result.serverInfo.name, "deveco-mcp");
  assert.match(init.result.instructions, /HarmonyOS/);
  const list = await client.request("tools/list");
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["doctor", "project", "run", "job", "code", "device", "ui", "ui_flow", "diagnose", "knowledge", "skills", "auth", "sign", "emulator", "hot_reload"]);
  for (const tool of list.result.tools) assert.equal(tool.inputSchema.type, "object");
  const logFields = list.result.tools.find(t => t.name === 'device').inputSchema.properties;
  assert.match(logFields.from.description, /5m\/30s\/1h/);
  assert.match(logFields.to.description, /1m/);
  assert.doesNotMatch(logFields.from.description + logFields.to.description, /\dm ago/);
  // The 1.5 schema adds test/verify/scenario contracts without adding tools; cap at 44 KiB. Keep guidance inside the host's default truncation boundary.
  const metrics = promptMetrics(init.result.instructions, list.result.tools);
  assert.ok(metrics.tools_list_bytes <= 44 * 1024, `tools/list: ${metrics.tools_list_bytes} bytes > 44 KB`);
  assert.ok(metrics.instructions_chars <= 2048, `instructions: ${metrics.instructions_chars} characters > 2048`);
  assert.ok(metrics.longest_description_chars <= 2048, `description: ${metrics.longest_description_chars} characters > 2048`);
  assert.doesNotMatch(JSON.stringify(list.result), /9007199254740991/, "no +/-2^53 integer bounds");
  // Over-long sync waits are capped instead of outliving the host's request timeout.
  const capped = await client.call("ui", { action: "assert", timeout_ms: 70000, visible: { text: "x" }, target: "none" });
  assert.ok(capped.data.notes?.some((n) => /timeout_ms=70000 capped at 52000/.test(n)), JSON.stringify(capped.data).slice(0, 200));
  const steps = await client.call("ui", { action: "act", target: "none", steps: [{ op: "click", x: 1, y: 1, timeout_ms: 60000 }, { op: "click", x: 1, y: 1, timeout_ms: 60000 }] });
  assert.ok(steps.data.notes?.some((n) => /2 steps had timeout_ms above 52000/.test(n)), JSON.stringify(steps.data).slice(0, 200));
  // The host is told where the complete content of summarised responses lives.
  assert.match(init.result.instructions, /job action=read artifact_id=<id>/);
  const bad = await client.call("project", { action: "nope" });
  assert.equal(bad.isError, true);
  assert.equal(bad.data.error.code, "INVALID_INPUT");
  assert.equal(bad.data.error.category, "input");
  const unknown = await client.request("tools/call", { name: "missing", arguments: {} });
  assert.equal(unknown.error.code, -32602);
  assert.equal(unknown.result, undefined);
  const ping = await client.request("ping");
  assert.deepEqual(ping.result, {});
});

test("tools/list annotations cover every action and external interaction", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const list = await client.request("tools/list");
  const readOnly = new Set(["doctor", "diagnose"]);
  const closedWorld = new Set(["code", "diagnose"]);
  for (const tool of list.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, readOnly.has(tool.name), `${tool.name}: include optional write actions`);
    assert.equal(tool.annotations.openWorldHint, !closedWorld.has(tool.name), `${tool.name}: include services, devices and other external interactions`);
  }
});

test("arguments: unknown/misplaced parameters are refused, long waits are capped", async () => {
  const client = connect(env);
  await client.initialize();
  const typo = await client.call("job", { action: "list", limit: 1, wiat: 5 });
  assert.equal(typo.data.error.code, "INVALID_INPUT");
  assert.equal(typo.data.error.details.did_you_mean.wiat, "wait");
  const misplaced = await client.call("knowledge", { action: "rollback", version: "1.0.0" });
  assert.equal(misplaced.data.error.code, "INVALID_INPUT");
  assert.deepEqual(misplaced.data.error.details.not_used, ["version"]);
  const device = (await client.request("tools/list")).result.tools.find((t) => t.name === "device");
  assert.equal(Object.hasOwn(device.inputSchema.properties, "shared"), false);
  const retired = await client.call("device", { action: "app", operation: "install", files: ["/owned/app.hap"], shared: ["/owned/system.hsp"] });
  assert.equal(retired.data.error.code, "INVALID_INPUT");
  assert.deepEqual(retired.data.error.details.unknown, ["shared"]);
  const capped = await client.call("job", { action: "list", limit: 1 });
  assert.equal(capped.isError, false);
  // wait above the cap is clamped (not rejected) and noted; job_id missing is the only error here
  const waited = await client.call("job", { action: "wait", job_id: "j_none", wait: 600000 });
  assert.equal(waited.data.error.code, "NOT_FOUND");
  await client.close();
});

test("retired form size selection is absent and rejected before any form job", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const list = await client.request("tools/list");
  const ui = list.result.tools.find((tool) => tool.name === "ui");
  assert.equal(JSON.stringify(ui.inputSchema).includes("form_size"), false, "Retired size selection must be absent from both form schemas");
  for (const input of [
    { action: "form", form_action: "exercise", bundle: "com.example.cards", target: "none", form_index: 0, form_size: "2*2" },
    { action: "form", form_action: "matrix", bundle: "com.example.cards", form_cases: [{ target: "none", form_index: 0, form_size: "2*2" }] },
  ]) {
    const result = await client.call("ui", input);
    assert.equal(result.isError, true);
    assert.equal(result.data.error.code, "INVALID_INPUT");
    assert.equal(result.data.job_id, undefined);
  }
});

test("skills are exposed as tools, resources and prompts", async () => {
  const client = connect(env);
  await client.initialize();
  const skills = await client.call("skills", { action: "list" });
  assert.deepEqual(skills.data.skills.map((s) => s.name).sort(), ["deveco-mcp-workflow", "hmos-arkui-develop-skill", "hmos-runtime-fix-skill"]);
  const card = await client.call("skills", { action: "read", name: "hmos-arkui-develop-skill", reference: "quick-apis/_index.md" });
  assert.match(card.data.content, /ArkUI API/);
  const escape = await client.call("skills", { action: "read", name: "hmos-arkui-develop-skill", reference: "../../../package.json" });
  assert.equal(escape.isError, true);
  const resources = await client.request("resources/list");
  assert.ok(resources.result.resources.some((r) => r.uri === "deveco://skills/hmos-arkui-develop-skill"));
  const read = await client.request("resources/read", { uri: "deveco://skills/hmos-arkui-develop-skill" });
  assert.match(read.result.contents[0].text, /ArkTS/);
  const prompts = await client.request("prompts/list");
  assert.ok(prompts.result.prompts.some((p) => p.name === "fix-build"));
  const prompt = await client.request("prompts/get", { name: "fix-build", arguments: { project: "/p" } });
  assert.match(prompt.result.messages[0].content.text, /\/p/);
  // 1.3 guidance: the build re-checks edited files itself; a startup crash already carries its source.
  assert.doesNotMatch(prompt.result.messages[0].content.text, /then use code action=check/);
  const crash = (await client.request("prompts/get", { name: "debug-crash", arguments: { project: "/p" } })).result.messages[0].content.text;
  assert.match(crash, /crash\.source/);
  assert.match(crash, /diagnose action=crash project=\/p/);
  await client.close();
});

test("documented action boundaries reject cross-action fields before execution", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  for (const [name, args, rejected, accepted] of [
    ["project", { action: "info", project: state, wait: 1000 }, "wait", "product"],
    ["run", { action: "launch", project: state, wait: 1000 }, "wait", "ability"],
    ["run", { action: "stop", project: state, assert: {} }, "assert", "target"],
    ["code", { action: "check", project: state, file: "Index.ets" }, "file", "files"],
    ["ui", { action: "test_step", test_id: "none", assert: { visible: { text: "Hi" } } }, "assert", "visible"],
    ["ui", { action: "review", test_id: "none", visible: { text: "Hi" } }, "visible", "requirement"],
    ["ui", { action: "test_start", plan: "Hello", wait: 1000 }, "wait", "plan"],
    ["ui_flow", { action: "show", project: state, id: "none", variables: {} }, "variables", "id"],
    ["auth", { action: "teams", provider: "developer" }, "provider", undefined],
    ["sign", { action: "verify", file: "missing.hap", wait: 1000 }, "wait", "file"],
  ]) {
    const result = await client.call(name, args);
    assert.equal(result.isError, true, `${name}.${args.action}`);
    assert.equal(result.data.error.code, "INVALID_INPUT");
    assert.deepEqual(result.data.error.details.not_used, [rejected]);
    const allowed = result.data.error.details.accepted_for_action;
    if (accepted) assert.ok(allowed.includes(accepted), `${name}.${args.action}: ${accepted}`);
    else assert.deepEqual(allowed, []);
    assert.match(result.data.error.hint, /Nothing was executed/);
  }
});

test("invalid source and device operations fail before SDK or device resolution", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const mixed = await client.call("code", { action: "check", project: state, files: ["Native.cpp", "Index.ets"] });
  assert.equal(mixed.isError, true);
  assert.equal(mixed.data.error.code, "INVALID_INPUT");
  assert.match(mixed.data.error.message, /separate calls/);
  const sqlite = await client.call("device", { action: "sqlite", target: "missing-device", bundle: "com.example.app", db: "app.db", sql: ".tables" });
  assert.equal(sqlite.isError, true);
  assert.equal(sqlite.data.error.code, "INVALID_INPUT");
  assert.match(sqlite.data.error.hint, /module\.json5/);
  for (const command of ["ifconfig wlan0 down", "date -s 20261015", "mount -o remount,rw /", "hilog -w start"]) {
    const shell = await client.call("device", { action: "shell", target: "missing-device", command });
    assert.equal(shell.isError, true, command);
    assert.equal(shell.data.error.code, "INVALID_INPUT", command);
    assert.match(shell.data.error.message, /Unsupported read-only command form/);
  }
  assert.deepEqual((await client.call("job", { action: "list" })).data.jobs, []);
});

test("assertion combinations fail before device resolution or job creation", async (t) => {
  const client = connect(env);
  t.after(() => client.close());
  await client.initialize();
  const visible = { text: "Ready" }, hidden = { text: "Error" };
  for (const [name, args] of [
    ["run", { action: "build_run", project: state, assert: {} }],
    ["run", { action: "deploy", project: state, assert: { visible, hidden } }],
    ["ui_flow", { action: "stop", project: state, assert: {} }],
    ["ui", { action: "assert", visible, hidden }],
    ["ui", { action: "test_step", test_id: "none", visible, hidden }],
    ["ui", { action: "act", op: "click", x: 1, y: 1, assert: { visible } }],
    ["ui", { action: "act", steps: [{ op: "click", x: 1, y: 1 }], assert: {} }],
  ]) {
    const result = await client.call(name, args);
    assert.equal(result.isError, true, `${name}.${args.action}`);
    assert.equal(result.data.error.code, "INVALID_INPUT");
    assert.match(result.data.error.message, /exactly one visible or hidden|assert\/save_flow require steps/);
  }
  assert.deepEqual((await client.call("job", { action: "list" })).data.jobs, []);
});

test("project info and create errors are structured", async () => {
  const client = connect(env);
  await client.initialize();
  const missing = await client.call("project", { action: "info", project: state });
  assert.equal(missing.isError, true);
  assert.equal(missing.data.error.code, "PROJECT_INVALID");
  assert.ok(missing.data.error.hint);
  await client.close();
});

test("diagnose crash from pasted jscrash text matches the pattern library", async () => {
  const client = connect(env);
  await client.initialize();
  const log = [
    "Module name:com.example.demo",
    "Error name:TypeError",
    "Error message:Cannot read property name of undefined",
    "Stacktrace:",
    "    at onClick (entry/src/main/ets/pages/Index.ets:25:13)",
  ].join("\n");
  const result = await client.call("diagnose", { action: "crash", log });
  assert.equal(result.isError, false, JSON.stringify(result.data));
  const report = result.data.reports[0];
  assert.equal(report.kind, "TypeError");
  assert.equal(report.bundle, "com.example.demo");
  assert.ok(report.app_frames[0].includes("Index.ets"));
  assert.ok(report.candidates.length > 0, "should match Cannot read property pattern");
  await client.close();
});


test("recording receipt tools are offline and preserve legacy bytes", async (t) => {
  const client = connect(env); t.after(() => client.close()); await client.initialize();
  const listed = await client.call("ui", { action: "record_receipts", target: "offline:5555" });
  assert.equal(listed.isError, false); assert.deepEqual(listed.data.pending, []);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(state, "state.db"));
  const raw = JSON.stringify({ name: "legacy.mp4", started: 1, unknown: { keep: true } });
  try {
    // This fixture writes beside the running server's cleanup, using the same bounded lock wait.
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("INSERT INTO kv(key,value) VALUES(?,?)").run("screenrecord:offline:5555", raw);
  } finally { db.close(); }
  const archive = await client.call("ui", { action: "record_archive", target: "offline:5555", name: "legacy.mp4", reason: "old instance" });
  assert.equal(archive.isError, false); assert.equal(archive.data.raw, raw);
  const restored = await client.call("ui", { action: "record_restore", receipt_id: archive.data.receipt_id });
  assert.equal(restored.isError, false); assert.equal(restored.data.restored, true);
  const again = await client.call("ui", { action: "record_receipts", target: "offline:5555" });
  assert.equal(again.data.pending[0].raw, raw);
});

test("entry graph exposes declared main/device scope and callable product-specific handles with declaration locations", async () => {
  const project = path.join(state, "entry-graph"), client = connect(env);
  const write = (file, text) => { const full = path.join(project, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text); };
  write("build-profile.json5", JSON.stringify({ app: { products: [{ name: "default" }, { name: "release" }] }, modules: ["phone", "watch"].map((name) => ({ name, srcPath: name, targets: [{ name: "default", applyToProducts: ["release"] }] })) }));
  write("AppScope/app.json5", JSON.stringify({ app: { bundleName: "com.example.graph" } }));
  write("phone/src/main/module.json5", [
    '{ module: { name: "phone", type: "entry",',
    '  mainElement: "EntryAbility", deviceTypes: ["phone", "tablet", "2in1"],',
    '  // "name": "EntryAbility" is only a comment',
    '  /* name: "EntryAbility" is also a comment */',
    '  description: \'{"name":"EntryAbility"}\',',
    '  abilities: [',
    '    { "name": "EntryAbility", exported: true, metadata: [{name:"ohos.ability.shortcuts",resource:"$profile:cards"}] },',
    '    { name /* property comment */ : \'MatrixAbility\', exported: true }',
    '  ],',
    '  extensionAbilities: [{ name: "CardService", type: "form", metadata: [{ name: "ohos.extension.form", resource: "$profile:cards" }] }]',
    '} }',
  ].join("\r\n"));
  write("watch/src/main/module.json5", [
    "{ module: { name: 'watch', type: 'entry', mainElement: 'WatchAbility', deviceTypes: ['wearable'],",
    "  abilities: [{ 'name':",
    "    'Watch\\u0041bility', exported: true }]",
    "} }",
  ].join("\n"));
  write("phone/src/main/resources/base/profile/cards.json", [
    '{ description: "Tile", forms: [',
    '  { name: "Tile", src: "./ets/Tile.ets", supportDimensions: ["2*2"], defaultDimension: "2*2", formConfigAbility: "ability://EntryAbility" }',
    '], shortcuts: [',
    '  { shortcutId: "open", wants: [{ bundleName: "com.example.graph", abilityName: "EntryAbility" }] }',
    '] }',
  ].join("\n"));
  // The resource path filter must not try to parse unrelated JSON assets.
  write("phone/src/main/resources/rawfile/large.json", "not JSON: forms: ignored");
  try {
    await client.initialize();
    const call = async () => {
      const result = await client.call("project", { action: "entries", project, product: "release" });
      assert.equal(result.isError, false, JSON.stringify(result.data)); return result.data;
    };
    const graph = await call();
    assert.equal(graph.scope, "declared-configuration"); assert.equal(graph.product, "release");
    assert.deepEqual(graph.issues, []); assert.equal(graph.entries.length, 6);
    assert.match(graph.runtime, /not installation or launch receipts/);
    for (const item of graph.entries) {
      assert.equal(item.runtime_verified, false);
      assert.deepEqual(item.device_types, item.module === "phone" ? ["phone", "tablet", "2in1"] : ["wearable"]);
      assert.equal(item.source.precision, "declaration-candidate");
    }
    const find = (name) => graph.entries.find((e) => e.name === name || e.shortcutId === name);
    for (const [name, line, main] of [["EntryAbility", 7, true], ["MatrixAbility", 8, false], ["WatchAbility", 2, true]]) {
      const item = find(name);
      assert.equal(item.main, main); assert.equal(item.source.line, line);
      assert.deepEqual(item.launch, { tool: "run", action: "launch", project, product: "release", module: item.module, ability: name });
    }
    assert.equal(find("CardService").main, false); assert.equal(find("CardService").launch, null);
    assert.equal(find("Tile").source.line, 2); assert.equal(find("Tile").validation, "passed");
    assert.equal(find("Tile").config_ability_resolution.status, "declared-in-module");
    assert.deepEqual(find("Tile").referenced_by, [{ kind: "form", owner: "CardService", resource: "$profile:cards" }]);
    assert.equal(find("open").source.line, 4);
    assert.equal((await client.call("project", { action: "entries", project })).data.entries.length, 0, "The handles must preserve the selected non-default product");
    write("phone/src/main/resources/base/profile/cards.json", JSON.stringify({ forms: [
      { src: "./ets/Tile.ets", supportDimensions: ["2*2"], defaultDimension: "2*2" },
      { name: "BadSize", src: "./ets/Tile.ets", supportDimensions: ["2*2"], defaultDimension: "4*4" },
      { name: "OtherModule", src: "./ets/Tile.ets", supportDimensions: ["2*2"], defaultDimension: "2*2", formConfigAbility: "WatchAbility" },
    ] }));
    const invalid = await call();
    assert.deepEqual(invalid.issues.map((i) => i.problems), [["name/src/supportDimensions missing"], ["defaultDimension is not supported"]]);
    const unnamed = invalid.entries.find((e) => e.kind === "form" && !e.name);
    assert.equal(unnamed.source.line, null); assert.equal(unnamed.source.precision, "unresolved");
    assert.equal(invalid.entries.find((e) => e.name === "OtherModule").config_ability_resolution.status, "unresolved");
    // Orphans, including malformed profiles, must never become entries or fail this graph.
    write("phone/src/main/resources/base/profile/orphan.json", "invalid JSON");
    const manifest = JSON.parse(JSON.stringify({ module: { name: "phone-runtime", type: "entry", deviceTypes: ["phone"], abilities: [
      { name: "Private", exported: false }, { name: "ImplicitPrivate" }, { name: "Public", exported: true },
    ], extensionAbilities: [
      { name: "First", metadata: [{ name: "ohos.extension.form", resource: "$profile:cards" }] },
      { name: "Second", metadata: [{ name: "ohos.extension.form", resource: "$profile:cards" }] },
      { name: "Missing", metadata: [{ name: "ohos.extension.form", resource: "$profile:absent" }] },
    ] } }));
    write("phone/src/main/module.json5", JSON.stringify(manifest));
    const referenced = await call();
    const privateEntry = referenced.entries.find((e) => e.name === "Private"), publicEntry = referenced.entries.find((e) => e.name === "Public");
    assert.equal(referenced.entries.find((e) => e.name === "ImplicitPrivate").launch, null);
    assert.equal(privateEntry.launch, null); assert.equal(privateEntry.external_launch, "restricted");
    assert.equal(publicEntry.launch.ability, "Public"); assert.deepEqual(publicEntry.skills, []);
    assert.equal(publicEntry.module_name, "phone-runtime");
    assert.equal(referenced.entries.find((e) => e.name === "OtherModule").referenced_by.length, 2);
    assert.ok(referenced.issues.some((e) => e.owner === "Missing" && e.resource === "$profile:absent"));
    assert.equal(referenced.entries.some((e) => e.kind === "shortcut"), false, "Shortcut arrays also require metadata references");
  } finally { await client.close(); fs.rmSync(project, { recursive: true, force: true }); }
});

test("entry graph handles independent project layouts, duplicate names and invalid configuration", async (t) => {
  const project = path.join(state, "generic entries"), client = connect(env);
  const write = (file, text) => { const full = path.join(project, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text); };
  write("build-profile.json5", JSON.stringify({ app: { products: [{ name: "tablet" }, { name: "watch" }] }, modules: [
    { name: "client-build", srcPath: "products/平板", targets: [{ name: "preview", applyToProducts: ["tablet"] }] },
    { name: "service-build", srcPath: "features/service", targets: [{ name: "default", applyToProducts: ["tablet"] }] },
    { name: "library", srcPath: "commons/library" },
  ] }));
  write("AppScope/app.json5", '{ app: { bundleName: "com.example.generic" } }');
  const manifestFile = "products/平板/src/main/module.json5";
  const manifest = [
    "{ module: { name: 'installed_module', type: 'entry', deviceTypes: ['tablet'], mainElement: 'Open',",
    "  metadata: [{ name: 'Open', value: 'unrelated' }],",
    "  abilities: [{",
    "    'na\\u006de': 'Open', exported: true, metadata: [{ name: 'Second' }, { name: 'ohos.ability.shortcuts', resource: '$profile:forms' }]",
    "  }, {",
    "    name: 'Second', exported: false",
    "  }], extensionAbilities: [{ name: 'Cards', type: 'form', metadata: [{ name: 'ohos.extension.form', resource: '$profile:forms' }] }]",
    "} }",
  ];
  write("features/service/src/main/module.json5", "{ module: { name: 'service', type: 'feature', mainElement: 'Worker', extensionAbilities: [{ name: 'Worker', type: 'workScheduler', exported: false }] } }");
  write("commons/library/src/main/module.json5", "{ module: { name: 'library', type: 'har', deviceTypes: ['tablet'] } }");
  const profileFile = "products/平板/src/main/resources/base/profile/forms.json";
  const profile = [
    '{ metadata: [{ name: "Tile", shortcutId: "open" }],',
    '  "fo\\u0072ms": [{',
    '    name: "Tile", src: "./ets/Tile.ets", supportDimensions: ["2*2"], defaultDimension: "2*2", formConfigAbility: "ability://Open"',
    '  }], shortcuts: [{',
    '    shortcutId: "open", wants: [{ bundleName: "com.example.generic", moduleName: "installed_module", abilityName: "Open" }]',
    '  }] }',
  ].join("\n");
  write(profileFile, profile);
  write("products/平板/src/main/resources/dark/profile/forms.json", '{ forms: [{ name: "Tile", src: "./ets/DarkTile.ets", supportDimensions: ["2*2"], defaultDimension: "2*2" }] }');
  try {
    await client.initialize();
    const call = (product = "tablet") => client.call("project", { action: "entries", project, product });
    for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR", "\r"], ["JSON5 line separator", "\u2028"]]) await t.test(label, async () => {
      write(manifestFile, manifest.join(newline));
      const result = await call(); assert.equal(result.isError, false, JSON.stringify(result.data));
      const { entries, issues } = result.data;
      assert.deepEqual(issues, []); assert.equal(entries.length, 7);
      assert.equal(entries.some((entry) => entry.module === "library"), false);
      const open = entries.find((entry) => entry.kind === "ability" && entry.name === "Open");
      assert.equal(open.main, true); assert.equal(open.source.line, 4); assert.deepEqual(open.device_types, ["tablet"]);
      assert.deepEqual(open.launch, { tool: "run", action: "launch", project, product: "tablet", module: "client-build", ability: "Open" });
      const second = entries.find((entry) => entry.name === "Second");
      assert.equal(second.main, false); assert.equal(second.exported, false); assert.equal(second.source.line, 6); assert.equal(second.launch, null); assert.equal(second.external_launch, "restricted");
      const worker = entries.find((entry) => entry.name === "Worker");
      assert.equal(worker.main, true); assert.equal(worker.launch, null); assert.deepEqual(worker.device_types, []);
      const forms = entries.filter((entry) => entry.kind === "form");
      assert.equal(forms.length, 2); assert.equal(new Set(forms.map((entry) => entry.source.file)).size, 2);
      assert.equal(forms.find((entry) => entry.source.file === path.normalize(profileFile)).source.line, 3);
      assert.equal(entries.find((entry) => entry.kind === "shortcut").source.line, 5);
      assert.ok(entries.every((entry) => entry.runtime_verified === false));
    });
    await t.test("product selection is explicit and does not leak excluded modules", async () => {
      assert.deepEqual((await call("watch")).data.entries, []);
      assert.equal((await client.call("project", { action: "entries", project })).data.error.code, "PRODUCT_AMBIGUOUS");
      assert.equal((await call("missing")).data.error.code, "PRODUCT_AMBIGUOUS");
    });
    for (const [label, file, data, field] of [
      ["missing module", manifestFile, {}, "module"],
      ["null ability", manifestFile, { module: { abilities: [null] } }, "module.abilities.0"],
      ["object abilities", manifestFile, { module: { abilities: { name: "Bad" } } }, "module.abilities"],
      ["unnamed ability", manifestFile, { module: { abilities: [{}] } }, "module.abilities.0.name"],
      ["null forms", profileFile, { forms: null }, "forms"],
      ["null form", profileFile, { forms: [null] }, "forms.0"],
      ["string dimensions", profileFile, { forms: [{ supportDimensions: "2*2" }] }, "forms.0.supportDimensions"],
      ["object shortcuts", profileFile, { shortcuts: {} }, "shortcuts"],
    ]) await t.test(label, async () => {
      write(manifestFile, manifest.join("\n")); write(profileFile, profile); write(file, JSON.stringify(data));
      const result = await call();
      assert.equal(result.isError, true); assert.equal(result.data.error.code, "PROJECT_INVALID");
      assert.equal(result.data.error.category, "project");
      assert.equal(result.data.error.details.file, path.join(project, file));
      assert.ok(result.data.error.details.issues.some((issue) => issue.path === field));
      assert.match(result.data.error.hint, /configuration fields/);
    });
  } finally { await client.close(); fs.rmSync(project, { recursive: true, force: true }); }
});
