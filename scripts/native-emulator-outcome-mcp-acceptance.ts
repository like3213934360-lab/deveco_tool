import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { ProcessService } from "../src/core/process.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { emulatorBinding } from "../src/services/emulator-identity.js";

const [root, preparedProject, osVersion] = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()]).parse(process.argv.slice(2));
assert.equal(fs.existsSync(root), false, "Use a new isolated evidence directory");
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedProject));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const name = `NativeMcp${crypto.randomBytes(4).toString("hex")}`, project = path.join(root, "application");
const tested = evidenceIdentity(), results: Record<string, unknown> = {}, file = path.join(root, "evidence.json");
const client = new AcceptanceMcp(root, "emulator-outcome-acceptance", { tool_groups: ["core", "emulator-admin"] }), processes = new ProcessService();
const app = { bundle_name: "com.deveco.mcpacceptance.sensorsdev22", module: "entry", ability: "EntryAbility" };
let target: string | undefined, created = false, running = false, completed = false, closed = false;
const save = () => atomicWrite(file, JSON.stringify({ instance: name, target, results,
  scope: "Candidate public MCP controls an owned fresh phone emulator and copied sensor app. SensorServiceKit light callbacks and batteryInfo values are asserted in the app; accepted scene receipts remain distinct from UI evidence. Native humidity/temperature probing is explicitly separate from MCP execution. No user devices or business apps are modified." }, null, 2));
const instanceSchema = z.object({ name: z.string(), isRunning: z.boolean(), instancePath: z.string().optional() });
async function inventory() { return z.object({ instances: z.array(instanceSchema) }).parse(await client.call("emulator_manage", { action: "list" })).instances; }
async function settle(key: string, run: string, expected = "succeeded") {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const status = z.object({ status: z.string(), result: z.unknown(), error: z.unknown().optional() }).parse(await client.call("workflow_run", { action: "status", detail: "full", run_id: run, wait_ms: 1000 }));
    results[key] = { run_id: run, ...status }; save();
    if (["queued", "running", "cancelling"].includes(status.status)) continue;
    assert.equal(status.status, expected, JSON.stringify(status.error)); console.log(`${key}: ${expected}`); return status;
  }
  throw new ToolError("ACCEPTANCE_TIMEOUT", "Inspect the recorded task before any repeated effect");
}
async function operation(key: string, tool: string, input: Record<string, unknown>, expected = "succeeded") {
  const request_key = `emulator-outcome:${name}:${key}`;
  results[key] = { request_key, status: "submitting" }; save();
  const run = z.object({ run_id: z.string() }).parse(await client.call(tool, { ...input, request_key }));
  results[key] = run; save(); return settle(key, run.run_id, expected);
}
async function workflow(key: string, workflow: string, input: unknown) {
  const request_key = `emulator-outcome:${name}:${key}`;
  results[key] = { request_key, status: "submitting" }; save();
  const run = z.object({ run_id: z.string() }).parse(await client.call("workflow_run", { action: "start", workflow, input, request_key }));
  results[key] = run; save(); return settle(key, run.run_id);
}
async function output(result: unknown, key: string): Promise<unknown> {
  const item = z.record(z.string(), z.unknown()).parse(result)[key];
  const ref = z.object({ result_artifact: z.object({ artifact_id: z.string(), bytes: z.number().max(8 * 1024 * 1024) }) }).safeParse(item);
  if (!ref.success) return item;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < ref.data.result_artifact.bytes;) {
    const page = z.object({ data: z.string(), next_offset: z.number() }).parse(await client.call("workflow_run", { action: "read_artifact", artifact_id: ref.data.result_artifact.artifact_id, offset, limit: 65536 }));
    assert.ok(page.next_offset > offset); chunks.push(Buffer.from(page.data, "base64")); offset = page.next_offset;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const contract = (key: string, text: string) => ({ bundle_name: app.bundle_name, assert: { visible: { key, text, textMode: "exact" }, timeoutMs: 15000 } });
let initial: z.infer<typeof instanceSchema>[] = [];
try {
  const originalSource = path.join(preparedProject, "entry/src/main/ets/pages/Index.ets"), originalHash = fileDigest(originalSource);
  fs.cpSync(preparedProject, project, { recursive: true, filter: source => !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(path.basename(source)) });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  const source = path.join(project, "entry/src/main/ets/pages/Index.ets");
  atomicWrite(source, `import { sensor } from '@kit.SensorServiceKit';
import { batteryInfo } from '@kit.BasicServicesKit';
@Entry
@Component
struct Index {
  @State light: string = 'pending';
  @State battery: number = -1;
  private timer: number = -1;
  aboutToAppear(): void {
    try { sensor.on(sensor.SensorId.AMBIENT_LIGHT, (value: sensor.LightResponse) => { this.light = value.intensity.toFixed(2); }); }
    catch (error) { this.light = 'unavailable'; }
    this.timer = setInterval(() => { this.battery = batteryInfo.batterySOC; }, 250);
  }
  aboutToDisappear(): void { sensor.off(sensor.SensorId.AMBIENT_LIGHT); clearInterval(this.timer); }
  build() {
    Column({ space: 24 }) {
      Text('模拟器效果验收').fontSize(28)
      Text('Light: ' + this.light).id('LightValue').fontSize(24)
      Text('Battery: ' + this.battery).id('BatteryValue').fontSize(24)
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
`);
  results.fixture = { project, source_sha256: fileDigest(source), original_source_sha256: originalHash };
  await client.connect(); initial = await inventory(); results.initial_inventory = initial;
  const images = z.object({ images: z.array(z.object({ deviceType: z.string(), osVersion: z.string() })) }).parse(await client.call("emulator_admin", { action: "images", downloaded: true, device_type: "phone" }));
  const image = osVersion ? images.images.find(candidate => candidate.osVersion === osVersion) : images.images[0]; assert.ok(image);
  results.image = image; results.doctor = await client.call("deveco_doctor", {}); save();
  await operation("create", "emulator_admin", { action: "create", name, device_type: image.deviceType, os_version: image.osVersion }); created = true;
  await operation("start", "emulator_manage", { action: "start", name }); running = true;
  const deadline = Date.now() + 120000;
  while (!target && Date.now() < deadline) {
    const instance = (await inventory()).find(item => item.name === name); assert.ok(instance?.isRunning);
    const targets = z.object({ targets: z.array(z.string()) }).parse(await client.call("device_info", { list: true })).targets;
    const matches = await Promise.allSettled(targets.filter(id => /^(127\.0\.0\.1|localhost|\[::1\]):/.test(id)).map(id => emulatorBinding(name, instance.instancePath, id, async () => {
      const response = await processes.run(toolCommand(discoverToolchain(), "hdc", ["-t", id, "shell", "param", "get", "ohos.qemu.hvd.name"]), { timeoutMs: 10000 });
      assert.equal(response.truncated, false); return response.stdout.trim();
    })));
    const matched = matches.filter(item => item.status === "fulfilled"); assert.ok(matched.length <= 1);
    if (matched[0]) { target = matched[0].value.target; results.binding = matched[0].value; save(); }
    else await delay(1000);
  }
  assert.ok(target, "Owned emulator did not expose a verified HDC endpoint");
  await workflow("sync", "project_sync", { project_path: project });
  const built = await workflow("build", "project_build", { project_path: project, modules: ["entry"] });
  const build = z.object({ artifacts: z.array(z.object({ path: z.string() })) }).parse(await output(built.result, "build_project"));
  const packages = build.artifacts.filter(item => item.path.endsWith(".hap")); assert.equal(packages.length, 1);
  await workflow("deploy", "app_deploy", { target, packages, app });
  for (const [key, action, field, value, node, text] of [
    ["light_first", "sensor", "light", 1234.3, "LightValue", "Light: 1234.30"],
    ["light_second", "sensor", "light", 4321.2, "LightValue", "Light: 4321.20"],
    ["battery_first", "battery", null, 31, "BatteryValue", "Battery: 31"],
    ["battery_second", "battery", null, 80, "BatteryValue", "Battery: 80"],
  ] as const) {
    const status = await operation(key, "emulator_scenario", { name, target, action, ...(field ? { key: field } : {}), value, verify: contract(node, text) });
    const accepted = z.object({ commandAccepted: z.literal(true), stateVerified: z.literal(false) }).parse(await output(status.result, "execute_native_operation"));
    const verified = z.object({ verified: z.literal(true), report_artifact: z.object({ artifact_id: z.string(), sha256: z.string().optional() }) }).parse(await output(status.result, "verify_native_outcome"));
    results[`${key}_checked`] = { accepted, verified }; save();
  }
  const negative = await operation("assertion_failure", "emulator_scenario", { name, target, action: "sensor", key: "light", value: 22, verify: contract("LightValue", "Light: 9999.00") }, "failed");
  z.object({ code: z.literal("VERIFICATION_FAILED"), details: z.object({ command_accepted: z.literal(true), verified: z.literal(false) }) }).parse(negative.error);
  for (const key of ["humidity", "temperature"]) {
    results[`native_${key}_probe`] = await processes.run(toolCommand(discoverToolchain(), "emulator", ["-instance", name, "-sensor", `-${key}`, "20"]), { allowFailure: true, timeoutMs: 30000, limitBytes: 32768 }); save();
  }
  async function queryProcesses() {
    const response = await processes.run(toolCommand(discoverToolchain(), "hdc", ["-t", target!, "shell", "ps", "-A", "-o", "PID,PPID,NAME"]), { timeoutMs: 5000, limitBytes: 65536 });
    assert.equal(response.truncated, false);
    return response.stdout.split(/\r?\n/).filter(line => /PID|uitest|snapshot_display/.test(line));
  }
  results.after_assertion_query_processes = await queryProcesses(); save();
  try {
    results.final_ui = await client.call("ui_inspect", { target, selector: { key: "LightValue", bundle_name: app.bundle_name }, screenshot: true });
  } catch (error) {
    results.failed_inspection_query_processes = await queryProcesses(); save(); throw error;
  }
  assert.equal(fileDigest(originalSource), originalHash); completed = true;
} catch (error) { results.error = errorResult(error); console.error(JSON.stringify(errorResult(error))); }
finally {
  try {
    if (running && target) { await operation("stop", "emulator_manage", { action: "stop", name, target }); running = false; }
    await client.close(); // Also closes a known owned launcher if binding failed.
    await client.connect();
    if (created) {
      const instance = (await inventory()).find(item => item.name === name); assert.ok(instance && !instance.isRunning);
      await operation("delete", "emulator_admin", { action: "delete", name }); created = false;
    }
    results.final_inventory = await inventory(); assert.deepEqual(results.final_inventory, initial);
    await client.close(); assert.equal(processes.size, 0); closed = true;
  } catch (error) { results.close_error = errorResult(error); await client.close().catch(() => {}); }
  save(); const passed = finishAcceptance(file, tested, completed && !created, closed);
  console.log(`Public emulator outcome acceptance: ${passed ? "passed" : "failed"}`);
}
