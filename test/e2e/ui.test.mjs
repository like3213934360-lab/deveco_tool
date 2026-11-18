// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import JSON5 from "json5";
import { app, required, session, sha } from "../support/acceptance.mjs";
import { connect, waitJob } from "../support/mcp.mjs";

test("UI display inventory on an explicitly selected device", async (t) => {
  const { call } = await session(t), target = required("E2E_TARGET");
  const summary = await call("ui", { action: "displays", target });
  const details = await call("ui", { action: "displays", target, all: true });
  const { screen } = await call("device", { action: "info", target });
  assert.equal(summary.target, target);
  assert.ok(screen && summary.displays.some(({ width, height }) => width === screen.width && height === screen.height));
  assert.deepEqual(details.displays.map(({ id, width, height }) => ({ id, width, height })), summary.displays);
  assert.ok(details.displays.some(({ screen_id, refresh_rate, vpr, rotation }) => screen_id !== null && refresh_rate > 0 && vpr > 0 && [0, 90, 180, 270].includes(rotation)));
});

test("UI extended display keeps input in the selected application window", async (t) => {
  const { ui, raw, job, project, target, bundle, file, defer } = await app(t, true, "emulator");
  const secondary = Number(required("E2E_DISPLAY"));
  assert.ok(Number.isSafeInteger(secondary) && secondary > 0);
  assert.ok((await ui({ action: "displays" })).displays.some(d => d.id === secondary), "Add the requested extended screen to the emulator");
  const page = path.join(project, file), manifest = path.join(project, "entry/src/main/module.json5");
  const originals = [page, manifest].map(f => [f, fs.readFileSync(f)]);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { for (const [f, bytes] of originals) fs.writeFileSync(f, bytes); await deploy(); });
  const profile = JSON5.parse(fs.readFileSync(manifest, "utf8")), ability = profile.module.mainElement;
  profile.module.abilities.find(item => item.name === ability).launchType = "multiton";
  fs.writeFileSync(manifest, JSON.stringify(profile, null, 2));
  fs.writeFileSync(page, `import { common } from '@kit.AbilityKit';
@Entry
@Component
struct Index {
  @State count: number = 0;
  build() {
    Column() {
      Button('Open second screen').id('OpenSecond').onClick(() => {
        const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
        ctx.startAbility({ bundleName: ${JSON.stringify(bundle)}, abilityName: ${JSON.stringify(ability)} }, { displayId: ${secondary} })
          .catch((err: Error) => { console.error(err.message); });
      })
      Button('Count ' + this.count).id('ScreenCounter').onClick(() => { this.count++; })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}`);
  await deploy();
  const assertCount = async (display, count) => assert.equal((await ui({ action: "assert", display, bundle, visible: { text: "Count " + count, exact: true }, timeout_ms: 5000 })).passed, true, "screen " + display);
  await assertCount(0, 0);
  const primary = (await ui({ action: "windows" })).windows.find(w => w.display === 0 && w.focused && w.type === 1);
  assert.ok(primary);
  await ui({ action: "act", op: "click", window: primary.id, display: 0, selector: { key: "OpenSecond" } });
  await assertCount(secondary, 0);
  const other = (await ui({ action: "windows" })).windows.find(w => w.display === secondary && w.pid === primary.pid && w.type === 1 && w.visible);
  assert.ok(other && other.id !== primary.id);
  const tap = { action: "act", op: "click", window: other.id, selector: { key: "ScreenCounter" } };
  assert.equal((await raw("ui", { ...tap, target, display: 0 })).data.error.code, "CONFLICT");
  await ui({ ...tap, display: secondary });
  await assertCount(secondary, 1);
  await assertCount(0, 0);
  await ui({ ...tap, window: primary.id, display: 0 });
  await assertCount(0, 1);
  await assertCount(secondary, 1);
});

test("UI query selectors on an explicitly selected app", async (t) => {
  const { call, raw } = await session(t);
  const target = required("E2E_TARGET"), bundle = required("E2E_BUNDLE"), ability = required("E2E_ABILITY");
  await call("device", { action: "app", operation: "start", target, bundle, ability, ...(process.env.E2E_MODULE ? { module: process.env.E2E_MODULE } : {}) });
  const visible = await call("ui", { action: "find", target, bundle, selector: { regex: { text: "\\S" } }, timeout_ms: 5000, limit: 20 });
  assert.ok(visible.matches.length > 0, "The selected app must expose text in its visible UI tree");
  const node = visible.matches[0], pattern = node.text.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const expected = await call("ui", { action: "find", target, bundle, selector: { text: node.text, exact: true } });
  const matched = await call("ui", { action: "find", target, bundle, selector: { xpath: "//*[@text]", regex: { text: "^" + pattern + "$" } } });
  assert.ok(matched.count > 0); assert.equal(matched.count, expected.count);
  const assertion = await call("ui", { action: "assert", target, bundle, visible: { xpath: "//*[@text]", regex: { text: "^" + pattern + "$" } }, timeout_ms: 1000 });
  assert.equal(assertion.passed, true);
  const batch = await call("ui", { action: "act", target, steps: [{ op: "wait", selector: { xpath: "//*[@text]", regex: { text: "^" + pattern + "$" }, bundle }, timeout_ms: 1000 }], assert: { visible: { regex: { text: "^" + pattern + "$" }, bundle }, timeout_ms: 1000 } });
  assert.equal(batch.passed, true);
  for (const selector of [{ xpath: "count(//*)" }, { regex: { text: "[" } }]) {
    const invalid = await raw("ui", { action: "find", target, bundle, selector });
    assert.equal(invalid.isError, true); assert.equal(invalid.data.error.code, "INVALID_INPUT");
  }
});

test("ArkTS debugger binds a source breakpoint and inspects the paused process", async (t) => {
  const { call, raw, job, project, bundle, target, file, visible, defer, client, directory } = await app(t, true, "emulator");
  const page = path.join(project, file), original = fs.readFileSync(page);
  const manifestFile = path.join(project, "entry/src/main/module.json5"), manifest = fs.readFileSync(manifestFile);
  const moduleProfile = JSON5.parse(manifest.toString("utf8")), ability = "DebugEntryProbe";
  assert.ok(!moduleProfile.module.abilities.some((entry) => entry.name === ability));
  const { name, srcEntry, icon, label, startWindowIcon, startWindowBackground } = moduleProfile.module.abilities.find((entry) => entry.name === moduleProfile.module.mainElement);
  assert.notEqual(name, ability);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { fs.writeFileSync(page, original); fs.writeFileSync(manifestFile, manifest); await deploy(); });
  const edited = `interface DebugProbe { value: number; label: string }
@Entry
@Component
struct Index {
  @State result: string = 'Debug fixture ready';
  build() {
    Column() {
      Button(this.result).id('DebugFixture').onClick(() => {
        const probe: DebugProbe = { value: 41, label: 'test' };
        let number: number = probe.value;
        number += 1;
        this.result = (probe.label === 'test' ? 'Result ' : 'Unexpected ') + number;
      });
    }.width('100%').height('100%');
  }
}`;
  fs.writeFileSync(page, edited);
  moduleProfile.module.abilities.push({ name: ability, srcEntry, icon, label, startWindowIcon, startWindowBackground, exported: true });
  fs.writeFileSync(manifestFile, JSON.stringify(moduleProfile));
  const { result: deployed } = await deploy();
  await visible("Debug fixture ready");
  const attach = { action: "debug", op: "attach", project, target, bundle, module: "entry" };
  assert.equal((await raw("code", { ...attach, pid: 2147483647 })).data.error.code, "CONFLICT");
  const logFile = path.join(directory, "live.ndjson"), existing = path.join(directory, "existing.ndjson");
  fs.writeFileSync(existing, "Keep original contents");
  assert.equal((await raw("code", { ...attach, output_path: existing })).data.error.code, "CONFLICT");
  assert.equal(fs.readFileSync(existing, "utf8"), "Keep original contents");
  const { session_id, state, pid } = await call("code", { ...attach, pid: deployed.launch.pid, output_path: logFile });
  assert.equal(pid, deployed.launch.pid);
  assert.equal(state, "running");
  const debug = (op, fields = {}) => call("code", { action: "debug", op, session_id, ...fields });
  let stopped = false;
  defer(async () => { if (!stopped) await debug("stop"); });
  const line = edited.split("\n").findIndex((text) => text.includes("number += 1")) + 1;
  const click = () => call("ui", { action: "act", op: "click", target, selector: { key: "DebugFixture" }, diff: false });
  const invalidCondition = await raw("code", { action: "debug", op: "break_add", session_id, file, line, query: "probe.run()" });
  assert.equal(invalidCondition.data.error.code, "INVALID_INPUT");
  const skipped = await debug("break_add", { file, line, query: "(probe.label !== 'test' && missing.property) || number > 90", text: "Unexpected log" });
  await click();
  const skipEvents = await debug("events", { limit: 100 });
  assert.ok(skipEvents.events.some(({ event }) => event === "Debugger.resumed"), JSON.stringify(skipEvents));
  assert.equal(skipEvents.events.some(({ event }) => event === "Debugger.logpoint" || event === "Debugger.breakpointError"), false, JSON.stringify(skipEvents));
  await visible("Result 42");
  await debug("break_remove", { query: skipped.breakpointId });
  const bp = await debug("break_add", { file, line, column: 9, query: "number + 1 === probe.value * 2 - 40 && (probe.label === 'test' ? true : missing.property)" });
  assert.ok(bp.locations.length > 0, JSON.stringify(bp));
  await click();
  for (let i = 0; i < 10 && (await debug("status")).state !== "paused"; i++) await delay(100);
  assert.equal((await debug("status")).state, "paused");
  assert.match((await debug("stack")).frames[0].source.file, /Index\.ets$/);
  assert.equal((await debug("stack")).frames[0].source.line, line);
  assert.ok((await debug("vars")).variables.some((scope) => scope.properties.some((p) => p.name === "number")));
  const named = await debug("vars", { symbol: "probe", limit: 1 });
  assert.equal(named.properties.length, 1); assert.ok(named.omitted >= 1);
  const field = (await debug("vars", { symbol: "probe.label" })).value;
  assert.equal(field.value ?? field.unserializableValue, "test");
  assert.match(JSON.stringify((await debug("eval", { frame: 0, query: "number" })).value), /41/);
  await debug("break_remove", { query: bp.breakpointId });
  assert.deepEqual((await debug("break_list")).breakpoints, []);
  const step = await debug("step_over");
  assert.equal(step.state, "paused"); assert.equal(step.confirmed, true);
  assert.match(JSON.stringify((await debug("eval", { query: "number" })).value), /42/);
  assert.equal((await debug("resume")).state, "running");
  await visible("Result 42");
  assert.ok((await debug("events", { limit: 100 })).events.some(({ event, detail }) => event === "Debugger.paused" && detail.hitBreakpoints?.some((hit) => hit.endsWith(`:${bp.url}`))));
  const logpoint = await debug("break_add", { file, line, text: "Logpoint reached with {number}", log_level: "warn", hit_count: "=2", disabled: true });
  await click();
  assert.equal((await debug("break_list")).breakpoints[0].hits, 0);
  assert.equal((await debug("break_enable", { query: logpoint.breakpointId })).enabled, true);
  const { cursor } = await debug("events", { limit: 100 });
  const watching = debug("events", { line: cursor, query: "Debugger.logpoint", wait: 8000 });
  await click();
  await debug("status");
  await click();
  const logged = await watching;
  assert.deepEqual(logged.events.map(({ detail }) => detail.text), ["Logpoint reached with 41"]);
  assert.equal(logged.events[0].detail.level, "warn");
  assert.equal((await debug("status")).state, "running");
  assert.equal((await debug("break_list")).breakpoints[0].hits, 2);
  assert.equal((await debug("break_disable", { query: logpoint.breakpointId })).enabled, false);
  const plainLine = line + 1;
  const plain = await debug("break_add", { file, line: plainLine, disabled: true });
  assert.deepEqual((await debug("break_list", { break_kind: "logpoint" })).breakpoints.map((entry) => entry.breakpointId), [logpoint.breakpointId]);
  assert.equal((await debug("break_enable", { file: page, line: plainLine })).breakpointId, plain.breakpointId);
  assert.equal((await raw("code", { action: "debug", op: "break_remove", session_id, query: plain.breakpointId, all: true })).data.error.code, "INVALID_INPUT");
  const enabled = await debug("break_enable", { all: true });
  assert.deepEqual(enabled.changed.map((entry) => entry.enabled), [true, true]);
  const disabled = await debug("break_disable", { all: true });
  assert.deepEqual(disabled.changed.map((entry) => entry.enabled), [false, false]);
  assert.deepEqual((await debug("break_remove", { all: true, break_kind: "logpoint" })).changed, [{ removed: logpoint.breakpointId }]);
  await debug("break_remove", { file, line: plainLine });
  assert.deepEqual((await debug("break_list")).breakpoints, []);
  const expression = await debug("break_add", { file, line, log_expression: "'Value=' + (number + probe.value)", log_level: "debug" });
  const previous = (await debug("events", { limit: 100 })).cursor;
  await click();
  const loggedExpression = await debug("events", { line: previous, query: "Debugger.logpoint", wait: 1000 });
  assert.equal(loggedExpression.events[0].detail.text, "Value=82");
  assert.equal((await debug("status")).state, "running");
  await debug("break_remove", { query: expression.breakpointId });
  await assert.rejects(client.call("code", { action: "debug", op: "events", session_id, query: "Debugger.neverEmitted", wait: 5000 }, 300), /timed out/);
  assert.equal((await debug("status")).state, "running");
  const stoppedDebug = await debug("stop");
  assert.equal(stoppedDebug.stopped, true); stopped = true;
  const log = fs.readFileSync(logFile, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(stoppedDebug.event_log.complete, true);
  assert.equal(stoppedDebug.event_log.events_written, log.length);
  assert.ok(log.every((entry) => entry.session_id === session_id && entry.thread === 0));
  assert.ok(log.some((entry) => entry.event === "Debugger.logpoint" && entry.detail.text === "Logpoint reached with 41"));
  assert.equal((await raw("code", { action: "debug", op: "status", session_id })).data.error.code, "NOT_FOUND");
  const launch = { action: "debug", op: "start", project, target, bundle, module: "entry", ability, wait: 0 };
  const invalid = await call("code", { ...launch, ability: "UndeclaredDebugAbility" });
  assert.equal((await waitJob(call, invalid)).error.code, "INVALID_INPUT");
  const startupLog = path.join(directory, "startup.ndjson");
  const launched = await job("code", { ...launch, stop_at_entry: true, output_path: startupLog });
  const launchId = launched.result.session_id;
  let launchStopped = false;
  defer(async () => { if (!launchStopped) await call("code", { action: "debug", op: "stop", session_id: launchId }); });
  assert.equal(launched.result.state, "paused");
  const entry = await call("code", { action: "debug", op: "stack", session_id: launchId });
  assert.ok(entry.frames.length);
  const stoppedLaunch = await call("code", { action: "debug", op: "stop", session_id: launchId });
  assert.equal(stoppedLaunch.stopped, true);
  assert.equal(stoppedLaunch.event_log.complete, true);
  assert.match(fs.readFileSync(startupLog, "utf8"), /"event":"Debugger.paused"/);
  launchStopped = true;
  const restarted = await job("code", { ...launch, skip_build: true });
  const restartId = restarted.result.session_id;
  let restartStopped = false;
  defer(async () => { if (!restartStopped) await call("code", { action: "debug", op: "stop", session_id: restartId }); });
  assert.equal(restarted.result.state, "running");
  await visible("Debug fixture ready");
  assert.ok((await call("device", { action: "app", operation: "foreground", target })).applications.some((entry) => entry.bundle === bundle && entry.ability === ability));
  assert.equal((await call("code", { action: "debug", op: "stop", session_id: restartId })).stopped, true);
  restartStopped = true;
  const originalLog = fs.readFileSync(logFile);
  const runtime = await call("code", { action: "debug", op: "attach", bundle, pid: restarted.result.pid, target, output_path: logFile });
  defer(async () => { if ((await call("code", { action: "debug", op: "status" })).sessions.some((entry) => entry.session_id === runtime.session_id))
    await call("code", { action: "debug", op: "stop", session_id: runtime.session_id }); });
  assert.equal(runtime.pid, restarted.result.pid);
  const stoppedRuntime = await call("code", { action: "debug", op: "stop", session_id: runtime.session_id });
  assert.equal(stoppedRuntime.event_log.complete, true);
  const appended = fs.readFileSync(logFile);
  assert.deepEqual(appended.subarray(0, originalLog.length), originalLog);
  assert.ok(appended.subarray(originalLog.length).toString("utf8").trimEnd().split("\n").some((row) => JSON.parse(row).session_id === runtime.session_id));
  const pending = await call("code", { action: "debug", op: "start", project, target, stop_at_entry: true, wait: 0 });
  assert.ok(["queued", "running"].includes(pending.status));
  const cancelled = await waitJob(call, await call("job", { action: "cancel", job_id: pending.job_id }));
  assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
  assert.deepEqual((await call("code", { action: "debug", op: "status" })).sessions, []);
});

test("ArkTS debugger keeps Worker breakpoints and frame reads in their own thread", async (t) => {
  const { call, job, project, target, file, visible, defer, directory: evidence } = await app(t, true, "emulator");
  const hdc = required("E2E_HDC"); assert.ok(path.isAbsolute(hdc) && fs.statSync(hdc).isFile());
  const page = path.join(project, file), profile = path.join(project, "entry/build-profile.json5");
  const original = [page, profile].map((name) => [name, fs.readFileSync(name)]);
  const workerPath = "entry/src/main/ets/workers/MCPDebugWorker.ets", worker = path.join(project, workerPath), directory = path.dirname(worker);
  assert.ok(!fs.existsSync(worker), "Use a dedicated acceptance project without the fixture worker");
  const removeDirectory = !fs.existsSync(directory), deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { for (const [name, bytes] of original) fs.writeFileSync(name, bytes); fs.rmSync(worker, { force: true });
    if (removeDirectory && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    await deploy(); });
  const config = JSON5.parse(original[1][1].toString("utf8"));
  const options = config.buildOption ??= {}, source = options.sourceOption ??= {};
  source.workers = [...(source.workers ?? []), `./${workerPath.slice("entry/".length)}`];
  fs.writeFileSync(profile, JSON.stringify(config, null, 2));
  fs.mkdirSync(directory, { recursive: true });
  const workerSource = `import { MessageEvents, ThreadWorkerGlobalScope, worker } from '@kit.ArkTS';
const port: ThreadWorkerGlobalScope = worker.workerPort;
function increment(value: number): number {
  return value + 1;
}
port.onmessage = (event: MessageEvents): void => {
  if (event.data === 'busy') {
    const until: number = Date.now() + 6500;
    let iterations: number = 0;
    while (Date.now() < until) { iterations++; }
    port.postMessage(iterations > 0 ? 'completed' : 'idle');
    return;
  }
  let answer: number = 41;
  const next: number = increment(answer);
  port.postMessage(next);
};`;
  fs.writeFileSync(worker, workerSource);
  fs.writeFileSync(page, `import { MessageEvents, worker } from '@kit.ArkTS';
@Entry
@Component
struct Index {
  @State message: string = 'Worker ready';
  private thread?: worker.ThreadWorker;
  build() {
    Column() {
      Button(this.message).id('WorkerAction').onClick(() => {
        if (!this.thread) {
          this.thread = new worker.ThreadWorker('entry/ets/workers/MCPDebugWorker.ets');
          this.thread.onmessage = (event: MessageEvents): void => { this.message = 'Worker result ' + event.data; };
        }
        this.thread.postMessage('go');
      });
      Button('Start worker task').id('WorkerBusy').onClick(() => {
        this.thread?.postMessage('busy');
      });
    }.width('100%').height('100%');
  }
}`);
  await deploy();
  const debugClient = connect(); defer(() => debugClient.close());
  await debugClient.initialize();
  const request = async (op, fields = {}) => {
    const result = await debugClient.call("code", { action: "debug", op, ...fields });
    assert.equal(result.isError, false, JSON.stringify(result.data)); return result.data;
  };
  const log = path.join(evidence, "worker.ndjson");
  const { session_id, pid } = await request("attach", { project, target, output_path: log });
  const debug = (op, fields = {}) => request(op, { session_id, ...fields });
  assert.deepEqual((await debug("threads")).threads.map(({ thread }) => thread), [0]);
  const click = () => call("ui", { action: "act", target, op: "click", selector: { key: "WorkerAction" }, diff: false });
  await click();
  await visible("Worker result 42");
  const threads = (await debug("threads")).threads;
  const workerThread = threads.find(({ thread }) => thread > 0);
  assert.equal(workerThread?.state, "running", JSON.stringify(threads));
  const { thread } = workerThread;
  const line = workerSource.split("\n").findIndex((source) => source.includes("increment(answer)")) + 1;
  const bp = await debug("break_add", { thread, file: workerPath, line });
  await click();
  for (let i = 0; i < 10 && (await debug("status", { thread })).state !== "paused"; i++) await delay(100);
  assert.equal((await debug("status", { thread })).state, "paused");
  assert.equal((await debug("status", { thread: 0 })).state, "running");
  assert.equal((await debug("stack", { thread })).frames[0].source.file, workerPath);
  assert.ok((await debug("vars", { thread, frame: 0 })).variables.some((scope) => scope.properties.some(({ name }) => name === "answer")));
  assert.equal((await debug("eval", { thread, query: "answer" })).value.unserializableValue, "41");
  const write = await debug("set", { thread, symbol: "answer", query: "80" });
  assert.deepEqual([write.applied, write.before, write.value], [true, 41, 80]);
  assert.equal((await debug("eval", { thread, query: "answer" })).value.unserializableValue, "80");
  await debug("break_remove", { thread, query: bp.breakpointId });
  const into = await debug("step_into", { thread });
  assert.equal(into.confirmed, true);
  assert.equal((await debug("stack", { thread })).frames[0].function, "increment");
  const out = await debug("step_out", { thread });
  assert.equal(out.confirmed, true);
  assert.notEqual((await debug("stack", { thread })).frames[0].function, "increment");
  assert.equal((await debug("resume", { thread })).state, "running");
  await visible("Worker result 81");
  await call("ui", { action: "act", target, op: "click", selector: { key: "WorkerBusy" }, diff: false });
  const paused = await debug("pause", { thread });
  assert.equal(paused.confirmed, true, JSON.stringify(paused));
  assert.equal(paused.state, "paused");
  assert.equal((await debug("status", { thread: 0 })).state, "running");
  assert.equal((await debug("resume", { thread })).state, "running");
  assert.equal((await call("ui", { action: "assert", target, visible: { text: "Worker result completed", exact: true }, timeout_ms: 10000 })).passed, true);
  const forwards = () => execFileSync(hdc, ["-t", target, "fport", "ls"], { encoding: "utf8", timeout: 15000 })
    .split(/\r?\n/).filter((row) => row.includes(`ark:${pid}@`));
  assert.equal(forwards().length, 3);
  await debugClient.close();
  assert.deepEqual(forwards(), []);
  const events = fs.readFileSync(log, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.some((entry) => entry.thread === 0 && entry.event === "Debugger.scriptParsed"));
  assert.ok(events.some((entry) => entry.thread === thread && entry.event === "Debugger.paused"));
});

test("UI test sessions resolve a registered deep link on cold and warm starts", async (t) => {
  const { call, raw, job, project, target, bundle, file, visible, defer, directory, ui } = await app(t, true, "emulator");
  const page = path.join(project, file), manifest = path.join(project, "entry/src/main/module.json5"), ability = path.join(project, "entry/src/main/ets/entryability/EntryAbility.ets");
  const original = [page, manifest, ability].map((name) => [name, fs.readFileSync(name)]);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { for (const [name, bytes] of original) fs.writeFileSync(name, bytes); await deploy(); });
  const module = JSON5.parse(original[1][1].toString("utf8"));
  module.module.abilities[0].skills.push({ actions: ["ohos.want.action.viewData"], uris: [{ scheme: "mcpverify", host: "test", path: "open" }] });
  const entry = original[2][1].toString("utf8"), onCreate = "onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {";
  assert.ok(entry.includes(onCreate));
  const routeAbility = entry.replace(onCreate, `readProbe(want: Want): void {
    if (want.uri === 'mcpverify://test/open?mode=cold') AppStorage.setOrCreate('ProbeRoute', 'Cold URI');
    if (want.uri === 'mcpverify://test/open?mode=warm') AppStorage.setOrCreate('ProbeRoute', 'Warm URI');
  }
  onNewWant(want: Want): void { this.readProbe(want); }
  ${onCreate}
    this.readProbe(want);`);
  const routePage = `@Entry
@Component
struct Index {
  @StorageLink('ProbeRoute') route: string = 'Normal startup';
  build() { Column() { Text(this.route) }.width('100%').height('100%') }
}`;
  await deploy();
  const initial = await ui({ action: "find", selector: { key: "HelloWorld" }, timeout_ms: 2000 });
  assert.equal(initial.count, 1);
  const changed = [routePage, JSON.stringify(module, null, 2), routeAbility];
  const edits = original.map(([name, bytes], i) => ({ file: path.relative(project, name), before_sha256: sha(bytes), content: changed[i] }));
  for (const expected of ["Warm URI", "A route assertion that must fail"]) {
    const baseline = await job("run", { action: "build_run", project, target, run_mode: "full", debug_line: true, wait: 0 });
    const artifacts = baseline.result.installed.package_files.map(({ path, sha256 }) => [path, sha256]);
    const positive = expected === "Warm URI", suffix = positive ? "success" : "failure";
    const plan = path.join(directory, `deeplink-${suffix}.json`), output = path.join(directory, `check-${suffix}`);
    fs.writeFileSync(plan, JSON.stringify({ schema: 1, checks: [{ id: "route", type: "deeplink", options: {
      baseline_job: baseline.job_id, edits, cases: [{ uri: "mcpverify://test/open?mode=warm", visible: { text: expected, exact: true }, timeout_ms: 2000 }],
    } }] }));
    const verify = await job("project", { action: "verify", project, target, plan, output, wait: 0 });
    const reportText = fs.readFileSync(path.join(output, "report.json"), "utf8"), evidence = JSON.parse(reportText);
    assert.equal(verify.result.verdict, positive ? "passed" : "failed", JSON.stringify(evidence.results));
    const result = evidence.results.find((check) => check.id === "route");
    assert.equal(result.detail.samples[0].restored, true);
    assert.equal(evidence.results.find((check) => check.id === "source-integrity").verdict, "passed");
    assert.doesNotMatch(reportText, /mcpverify:\/\//);
    for (const [name, bytes] of original) assert.deepEqual(fs.readFileSync(name), bytes);
    for (const [name, digest] of artifacts) assert.equal(sha(fs.readFileSync(name)), digest);
    await visible(initial.matches[0].text);
  }
  for (const [i, [name]] of original.entries()) fs.writeFileSync(name, changed[i]);
  await deploy();
  await visible("Normal startup");
  const { test_id } = await call("ui", { action: "test_start", target, bundle, plan: "1. Open the cold URI\n2. Open the warm URI" });
  const act = (args) => call("ui", { action: "test_step", test_id, ...args });
  const bad = await raw("ui", { action: "test_step", test_id, uri: "https://test/open" });
  assert.equal(bad.data.error.code, "INVALID_INPUT");
  await call("device", { action: "app", operation: "stop", target, bundle });
  for (const [checklist_item, mode, text] of [[1, "cold", "Cold URI"], [2, "warm", "Warm URI"]]) {
    const result = await act({ checklist_item, uri: `mcpverify://test/open?mode=${mode}`, visible: { text, exact: true } });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.ok(result.after_screenshot);
  }
  assert.equal((await call("ui", { action: "test_finish", test_id })).status, "passed");
  const failed = await call("ui", { action: "test_start", target, bundle, plan: "Open an unregistered path" });
  defer(async () => {
    const selector = { xpath: '//*[@key="advanced_dialog_button_0" and ancestor::*[contains(@key,"AppSelectorExtensionAbility")]]' };
    const dialog = await call("ui", { action: "find", target, selector });
    if (dialog.count) await call("ui", { action: "act", target, op: "click", selector });
  });
  const rejected = await call("ui", { action: "test_step", test_id: failed.test_id, uri: "mcpverify://test/unregistered?mode=opaque" });
  assert.equal(rejected.passed, false);
  assert.equal(rejected.detail.error.code, "LAUNCH_FAILED");
  assert.equal((await call("ui", { action: "test_finish", test_id: failed.test_id })).status, "failed");
  const log = await call("ui", { action: "test_log", test_id: failed.test_id });
  assert.doesNotMatch(JSON.stringify(log), /unregistered\?mode=opaque/);
});

test("two-finger gestures change the selected surface", async (t) => {
  const { ui, raw, job, project, target, file, visible, defer } = await app(t, true, "emulator");
  const page = path.join(project, file), original = fs.readFileSync(page);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { fs.writeFileSync(page, original); await deploy(); });
  fs.copyFileSync(new URL("../fixtures/two-finger-page.ets", import.meta.url), page);
  await deploy();
  const pinch = { key: "PinchSurface" }, rotate = { key: "RotateSurface" };
  for (const [args, code] of [
    [{ op: "pinch", selector: pinch, touch: { scale: 1 } }, "INVALID_INPUT"],
    [{ op: "rotate", selector: rotate, touch: { degrees: 90, radius: 2000 } }, "UI_NO_BOUNDS"],
    [{ op: "pinch", selector: { key: "not-present" }, touch: { scale: 2 } }, "UI_NOT_FOUND"],
  ]) {
    const refused = await raw("ui", { action: "act", target, ...args });
    assert.equal(refused.isError, true); assert.equal(refused.data.error.code, code);
  }
  await visible("pinch:idle"); await visible("rotation:idle");
  assert.equal((await ui({ action: "act", op: "pinch", selector: pinch, touch: { scale: 2 } })).performed, "pinch");
  await visible("pinch:larger");
  const { matches } = await ui({ action: "find", selector: rotate });
  assert.equal(matches.length, 1);
  const [left, top, right, bottom] = matches[0].bounds;
  const point = { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  await ui({ action: "act", op: "rotate", ...point, touch: { degrees: 90, radius: 100 } });
  await visible("rotation:clockwise");
  const batch = await ui({ action: "act", steps: [
    { op: "pinch", selector: pinch, touch: { scale: 0.5 } },
    { op: "rotate", selector: rotate, touch: { degrees: -90 } },
  ], assert: { visible: { text: "rotation:counterclockwise", exact: true } } });
  assert.equal(batch.passed, true);
  await visible("pinch:smaller");
});

test("timed long press holds and releases the touchscreen", async (t) => {
  const { ui, call, raw, job, project, target, file, visible, defer } = await app(t, true, "emulator");
  const page = path.join(project, file), original = fs.readFileSync(page);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { fs.writeFileSync(page, original); await deploy(); });
  fs.copyFileSync(new URL("../fixtures/timed-press-page.ets", import.meta.url), page);
  await deploy();
  const press = { action: "act", op: "long_click", selector: { key: "HoldTarget" }, diff: false };
  const receipt = async (count, min, max) => {
    const { matches } = await ui({ action: "find", selector: { key: "HoldReceipt" } });
    const duration = Number(matches[0]?.text.match(new RegExp(`^released:${count}:(\\d+)$`))?.[1]);
    assert.ok(duration >= min && duration <= max, JSON.stringify(matches));
  };
  const invalid = await raw("ui", { target, ...press, duration_ms: 499 });
  assert.equal(invalid.isError, true); assert.equal(invalid.data.error.code, "INVALID_INPUT");
  await visible("idle");
  const short = await ui({ ...press, duration_ms: 500 });
  assert.equal(short.duration_ms, 500);
  await receipt(1, 475, 1200);
  const batch = await ui({ action: "act", steps: [{ op: press.op, selector: press.selector, duration_ms: 1600 }] });
  assert.equal(batch.passed, true);
  await receipt(2, 1550, 2600);

  const long = await ui({ ...press, duration_ms: 60000, wait: 0, request_key: `hold-${crypto.randomUUID()}` });
  assert.ok(long.job_id);
  await delay(3200);
  const state = await call("job", { action: "cancel", job_id: long.job_id });
  const cancelled = await waitJob(call, state);
  assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
  await receipt(3, 600, 5500);
  await ui({ ...press, duration_ms: 500 });
  await receipt(4, 475, 1200);
  const completed = await job("ui", { ...press, target, duration_ms: 60000, wait: 0 });
  assert.equal(completed.result.duration_ms, 60000);
  await receipt(5, 59750, 63000);
});

test("native container scroll reaches both ends and finds a hidden row", async (t) => {
  const { ui, raw, job, project, target, file, visible, defer } = await app(t, true, "emulator");
  const page = path.join(project, file), original = fs.readFileSync(page);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => { fs.writeFileSync(page, original); await deploy(); });
  fs.copyFileSync(new URL("../fixtures/scroll-page.ets", import.meta.url), page);
  await deploy();
  const selector = { key: "Rows" };
  await visible("row 0");
  assert.equal((await ui({ action: "find", selector: { key: "row59" } })).count, 0);
  await ui({ action: "act", op: "scroll_end", selector, speed: 3000, timeout_ms: 22000 }); await visible("row 59");
  await ui({ action: "act", op: "scroll_start", selector, speed: 3000, timeout_ms: 22000 }); await visible("row 0");
  const result = await ui({ action: "act", steps: [{ op: "scroll_find", selector, to: { text: "row 42", exact: true } }],
    assert: { visible: { key: "row42" } } });
  assert.equal(result.passed, true); await visible("Unchanged footer");
  const tiles = { key: "Tiles" }, tile = { key: "tile18", text: "tile 18", exact: true, type: "Text", description: "tile description 18", clickable: false, enabled: true };
  const horizontal = { op: "scroll_find", selector: tiles, direction: "right", to: tile };
  assert.equal((await ui({ action: "find", selector: tile })).count, 0);
  const invalidOffset = await raw("ui", { action: "act", target, ...horizontal, scroll_offset: 9000 });
  assert.equal(invalidOffset.isError, true); assert.equal(invalidOffset.data.error.code, "UI_NO_BOUNDS");
  assert.equal((await ui({ action: "find", selector: tile })).count, 0);
  const queued = await job("ui", { action: "act", target, ...horizontal, scroll_offset: 80, timeout_ms: 3600000, wait: 0 });
  assert.equal(queued.kind, "ui_scroll"); assert.equal(queued.result.performed, "scroll_find");
  await visible("tile 18");
  const xpath = { xpath: '//Text[@key="tile4"]', regex: { description: ' 4$' } };
  assert.equal((await ui({ action: "find", selector: xpath })).count, 0);
  const reverse = await ui({ action: "act", op: "scroll_find", selector: tiles, direction: "left", to: xpath });
  assert.equal(reverse.method, "uitest-layout");
  assert.equal(reverse.scroll_match.key, "tile4");
  await visible("tile 4");
  await ui({ action: "act", op: "scroll_start", selector, speed: 3000, timeout_ms: 22000 });
  const row = { regex: { text: "^ROW 49$" }, within: "Rows" };
  assert.equal((await ui({ action: "find", selector: row })).count, 0);
  const scanned = await ui({ action: "act", steps: [{ op: "scroll_find", selector, to: row }], assert: { visible: { key: "row49" } } });
  assert.equal(scanned.passed, true);
  const invalidXPath = await raw("ui", { action: "act", target, ...horizontal, to: { xpath: "//Text[" } });
  assert.equal(invalidXPath.data.error.code, "INVALID_INPUT");
  await visible("tile 4");
  const otherPane = await raw("ui", { action: "act", target, ...horizontal, selector: { key: "ShortList" }, to: { regex: { text: "Unchanged footer" } } });
  assert.equal(otherPane.data.error.code, "UI_NOT_FOUND");
  assert.ok(otherPane.data.error.details.gestures >= 1);
  const missing = await raw("ui", { action: "act", target, ...horizontal, selector: { key: "ShortList" } });
  assert.equal(missing.data.error.code, "UI_NOT_FOUND");
  const deadline = await raw("ui", { action: "act", target, op: "scroll_find", selector, to: { text: "missing row", exact: true }, timeout_ms: 2600 });
  assert.equal(deadline.isError, true); assert.equal(deadline.data.error.code, "TIMEOUT");
  assert.equal(deadline.data.error.details.timeout_ms, 2600);
  assert.equal(deadline.data.error.details.action_completed, false);
  assert.equal(deadline.data.error.details.gesture_attempted, true);
});

test("window scoped gestures target exposed windows and use their own selectors", async (t) => {
  const { call, ui, raw, job, project, target, file, defer } = await app(t, true, "emulator");
  const main = path.join(project, file), child = path.join(path.dirname(main), "ScopedProbe.ets");
  const ability = path.join(project, "entry/src/main/ets/entryability/EntryAbility.ets");
  const pages = path.join(project, "entry/src/main/resources/base/profile/main_pages.json");
  assert.ok(!fs.existsSync(child));
  const originals = [main, ability, pages].map((file) => [file, fs.readFileSync(file)]);
  const deploy = () => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0 });
  defer(async () => {
    for (const [file, bytes] of originals) fs.writeFileSync(file, bytes);
    fs.rmSync(child, { force: true });
    await deploy();
  });
  const page = fs.readFileSync(new URL("../fixtures/gesture-page.ets", import.meta.url), "utf8");
  fs.writeFileSync(main, page.replace("Hello World", "Primary window").replace("typed: string = ''", "typed: string = 'main-only'"));
  const popupPage = page.replace("struct Index", "struct ScopedProbe").replace("Hello World", "Secondary window")
    .replace("typed: string = ''", "typed: string = 'child-only'")
    .replace(".id('Echo')", `.id('Echo').onClick(() => {
        window.findWindow('MCPScopedProbe').destroyWindow().catch((err: Error) => { console.error(err.message); });
      })`);
  fs.writeFileSync(child, "import { window } from '@kit.ArkUI';\n" + popupPage);
  fs.writeFileSync(pages, JSON.stringify({ src: ["pages/Index", "pages/ScopedProbe"] }));
  fs.writeFileSync(ability, `import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(stage: window.WindowStage): void {
    this.showProbe(stage).catch((err: Error) => { hilog.error(0, 'probe', '%{public}s', err.message); });
  }

  async showProbe(stage: window.WindowStage): Promise<void> {
    await stage.loadContent('pages/Index');
    const child = await stage.createSubWindow('MCPScopedProbe');
    await child.resize(1120, 1800);
    await child.moveWindowTo(80, 130);
    await child.setUIContent('pages/ScopedProbe');
    await child.showWindow();
  }
}
`);
  await deploy();
  const { windows } = await ui({ action: "windows" });
  const popup = windows.find((w) => w.focused && w.name === "MCPScopedProbe");
  const background = windows.find((w) => w.visible && w.type === 1 && w.pid === popup?.pid && !w.focused);
  assert.ok(popup && background, JSON.stringify(windows));
  const window = popup.id;
  const check = async (id, text) => assert.equal((await ui({ action: "assert", window: id, visible: { text, exact: true }, timeout_ms: 3000 })).passed, true, text);
  await check(window, "Secondary window");
  assert.equal((await ui({ action: "assert", window, display: popup.display, visible: { text: "Secondary window", exact: true } })).passed, true);
  const wrongDisplay = await raw("ui", { action: "act", op: "click", target, window, display: popup.display + 1, selector: { key: "Echo" } });
  assert.equal(wrongDisplay.data.error.code, "CONFLICT");

  const clear = { action: "act", op: "clear_text", selector: { key: "Field" } };
  const wrong = await raw("ui", { ...clear, target, window: background.id, display: background.display + 1 });
  assert.equal(wrong.data.error.code, "CONFLICT");
  const missed = await raw("ui", { ...clear, target, window: Math.max(...windows.map((w) => w.id)) + 1000 });
  assert.equal(missed.data.error.code, "UI_NOT_FOUND");
  const outside = await raw("ui", { action: "act", target, window, op: "swipe", x: 0, y: 0, to: { key: "SwipeRight" } });
  assert.equal(outside.data.error.code, "UI_NO_BOUNDS");
  await check(window, "typed:child-only");

  await ui({ action: "act", op: "click", window: background.id, selector: { key: "TapBox" } });
  assert.equal((await ui({ action: "windows" })).windows.find(w => w.focused)?.id, background.id);
  await check(background.id, "taps:1");
  await check(window, "taps:0");
  await ui({ action: "act", window, op: "swipe", selector: { key: "SwipeRight" }, to: { key: "SwipeLeft" } });
  await check(window, "swipe:left");
  await ui({ action: "act", window, op: "drag", selector: { key: "DragBox" }, to: { key: "DoubleBox" } });
  await check(window, "dragged:1");
  assert.equal((await call("ui", { ...clear, target, window })).performed, "clear_text");
  await check(window, "typed:");
  await ui({ action: "act", op: "click", window, selector: { key: "Echo" } });
  await check(background.id, "Primary window");
  await check(background.id, "typed:main-only");
});

test("UI failure boundaries and stability", async (t) => {
  const { raw, job, target, project, bundle, ui, launch, visible, run, defer, info } = await app(t);
  await launch(); await visible("Hello World");
  await t.test("invalid batches and keys are rejected", async () => {
    for (const args of [
      { steps: Array.from({ length: 31 }, () => ({ op: "wait", ms: 0 })) },
      { op: "click", x: 1, y: 1, steps: [{ op: "wait", ms: 0 }] },
      { steps: [{ op: "wait", ms: 0 }], save_flow: { project, id: run } },
      { op: "key", key: "not-a-key" },
    ]) assert.equal((await raw("ui", { action: "act", target, ...args })).isError, true);
  });
  await t.test("missing controls respect the original timeout budget", async () => {
    const started = performance.now();
    const missing = await ui({ action: "act", steps: [{ op: "click", selector: { text: "missing-test-element" }, timeout_ms: 3000 }] });
    assert.equal(missing.passed, false); assert.equal(missing.error.code, "UI_NOT_FOUND");
    assert.ok(performance.now() - started < 5500);
  });
  const tap = { op: "click", selector: { key: "TapBox" } }, hello = { op: "click", selector: { key: "HelloWorld" } };
  await t.test("flow suggestions require the same repeated sequence", async () => {
    const suggestions = [];
    for (const steps of [[tap, hello], [hello, tap], [tap, hello]]) {
      await launch(); suggestions.push((await ui({ action: "act", steps })).suggest);
    }
    assert.ok(!suggestions[0] && !suggestions[1] && suggestions[2]);
  });
  await t.test("chained actions retain the original output and latency budgets", async (t) => {
    await launch();
    const actStart = performance.now(), acted = await ui({ action: "act", ...hello });
    assert.ok(JSON.stringify(acted.after).length <= 1024);
    // Warm before-tree cache, so this measures a chained action, as in the original regression.
    const warmStart = performance.now();
    const chained = await ui({ action: "act", ...tap });
    assert.ok(chained.after); assert.ok(performance.now() - warmStart < 2500);
    t.diagnostic(`First act: ${Math.round(warmStart - actStart)} ms`);
  });
  const newVisualBaseline = async (label) => {
    const name = `ui-${label}-${crypto.randomUUID()}`, state = path.join(fs.realpathSync(project), ".arkpilot");
    if (fs.existsSync(state)) assert.equal(fs.realpathSync(state), state);
    const model = info.model ?? info.name ?? target;
    assert.equal(typeof model, "string"); assert.ok(model.length > 0);
    const file = path.join(state, "baselines", `${name}@${model.replace(/[^\w.-]+/g, "_")}.png`);
    const files = [file, `${file}.json`], parent = path.dirname(file);
    if (fs.existsSync(parent)) assert.equal(fs.realpathSync(parent), parent);
    for (const owned of files) assert.equal(fs.lstatSync(owned, { throwIfNoEntry: false }), undefined, `Refusing to overwrite ${owned}`);
    for (const owned of files) defer(() => {
      const stat = fs.lstatSync(owned, { throwIfNoEntry: false });
      if (!stat) return;
      assert.equal(fs.realpathSync(parent), parent, "Baseline directory changed; retain for inspection");
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Not an owned baseline file: ${owned}`);
      assert.equal(fs.realpathSync(owned), owned);
      fs.rmSync(owned);
    });
    const baseline = await ui({ action: "visual", project, name });
    assert.equal(baseline.baseline, "created"); assert.equal(fs.realpathSync(baseline.file), file);
    return { name, file };
  };
  await t.test("visual comparison stays stable and detects verified row motion", async () => {
    await launch(); await visible("row 0");
    const { name } = await newVisualBaseline("stable");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      assert.equal((await ui({ action: "visual", project, name })).changed_ratio, 0);
    }
    const rowLines = (tree) => {
      assert.equal(tree.truncated, false);
      const rows = tree.tree.split("\n").filter((line) => /"row \d+"/.test(line)).map((line) => line.replace(/^\s*#\d+\s+/, "").trim());
      assert.ok(rows.length > 0, "Rows subtree must expose actual row text and bounds");
      return rows;
    };
    const before = rowLines(await ui({ action: "tree", node: "Rows", interactive: false }));
    assert.ok(before.some((line) => /"row 0"/.test(line)), "Start at the first row before the preselected gesture");
    // Direction describes the finger: swipe up to reveal later rows from the list's initial position.
    const moved = await ui({ action: "act", op: "scroll", selector: { key: "Rows" }, direction: "up" });
    assert.equal(moved.motion?.status, "changed"); assert.equal(moved.after?.changed, true);
    const after = rowLines(await ui({ action: "tree", node: "Rows", interactive: false }));
    assert.notDeepEqual(after, before, "Visible row text or bounds must change, not just action status/node numbers");
    assert.ok((await ui({ action: "visual", project, name })).changed_ratio > 0);
  });
  await t.test("visual comparison rejects an independently owned corrupt baseline", async () => {
    await launch(); await visible("Hello World");
    const { name, file } = await newVisualBaseline("corrupt");
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(fs.realpathSync(file), file);
    fs.writeFileSync(file, "not a png");
    const corrupt = await raw("ui", { action: "visual", target, project, name });
    assert.equal(corrupt.isError, true); assert.equal(corrupt.data.error.code, "VISUAL_BASELINE_INVALID");
    assert.match(corrupt.data.error.hint, /update=true/);
  });
  await t.test("scroll performance remains repeatable and idle samples stay inconclusive", async () => {
    const rates = [];
    for (let i = 0; i < 3; i++) {
      const perf = await ui({ action: "perf", bundle }); assert.equal(perf.source, "composer"); rates.push(perf.avg_fps);
    }
    assert.ok(Math.max(...rates) - Math.min(...rates) < 10);
    const still = await ui({ action: "perf", steps: [{ op: "swipe", x: 30, y: 300, x2: 31, y2: 301 }] });
    assert.ok(!still.verdict || still.note || still.frames < 30);
  });
  await t.test("unsupported performance, layout and screenshot inputs are rejected", async () => {
    for (const args of [{ action: "perf", steps: [{ op: "click", x: 1, y: 1 }] }, { action: "layout", project, forms: ["tablet"] }, { action: "screenshot", display: 99 }]) {
      assert.equal((await raw("ui", { target, ...args })).isError, true);
    }
  });
  await t.test("failed flows remain failed and missing variables fail before deployment", async () => {
    const flowDir = path.join(project, ".arkpilot/flows"); fs.mkdirSync(flowDir, { recursive: true });
    const fixture = { version: 2, id: run, name: run, app: { bundleName: bundle, module: "entry", ability: "EntryAbility" }, start: { mode: "restart" }, variables: {}, steps: [{ id: "s1", action: "tap", timeoutMs: 3000, selector: { text: "missing-test-element", textMode: "exact" } }] };
    const file = path.join(flowDir, `${run}.json`); defer(() => fs.rmSync(file));
    fs.writeFileSync(file, JSON.stringify(fixture));
    const deploy = await job("run", { action: "build_run", project, target, then_flow: run, wait: 0 });
    assert.equal(deploy.result.flow.passed, false); assert.ok(deploy.result.flow.hint);
    fixture.variables = { input1: { required: true, secret: true } }; fixture.steps = [{ id: "s1", action: "focusInput", value: "${input1}" }];
    fs.writeFileSync(file, JSON.stringify(fixture));
    const before = performance.now();
    assert.equal((await raw("run", { action: "build_run", project, target, then_flow: run })).isError, true);
    assert.ok(performance.now() - before < 3000);
  });
});
