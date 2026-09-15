import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { z } from "zod";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

const [root, preparedFile, osVersion] = z
  .tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Use a new evidence directory; retain failed attempts unchanged",
);
const prepared = z
  .object({
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
  })
  .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity(),
  results: Record<string, unknown> = {};
const file = path.join(root, "evidence.json");
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Actual public MCP workflows on a fresh owned phone emulator and a signed owned fixture copy. Startup contracts are separate from business assertions. No physical-phone or release-package claim.",
      },
      null,
      2,
    ),
  );
const record = (key: string, value: unknown) => {
  results[key] = value;
  save();
};
const mcp = new AcceptanceMcp(root, "native-startup-fault-acceptance");
// Keep the emulator's process owner alive while the subject MCP is restarted.
const ownerRoot = path.join(root, "emulator-owner");
fs.mkdirSync(ownerRoot, { mode: 0o700 });
atomicWrite(path.join(ownerRoot, "config.json"), "{}\n");
const ownerMcp = new AcceptanceMcp(ownerRoot, "native-startup-emulator-owner", { tool_groups: ["core", "emulator-admin"] });
const owned = new OwnedEmulatorAcceptance(mcp, record, ownerMcp);
let completed = false,
  closed = false;
const relativeSources = [
  "src/main/ets/pages/Index.ets",
  "src/main/ets/entryability/EntryAbility.ets",
];
const originals = relativeSources.map((relative) => ({
  file: path.join(prepared.project_path, prepared.module, relative),
  sha256: fileDigest(
    path.join(prepared.project_path, prepared.module, relative),
  ),
}));
const startup = z.object({
  status: z.enum(["passed", "failed", "inconclusive", "cancelled"]),
  process: z.string(),
  screen: z.string(),
  business_outcome_verified: z.literal(false),
  process_samples: z
    .array(z.object({ pids: z.array(z.string()).optional() }))
    .min(1),
  frames: z.array(
    z.object({
      frame: z
        .object({ uniform: z.boolean(), artifact_id: z.string().uuid() })
        .optional(),
      code: z.string().optional(),
    }),
  ),
});
const failed = z.object({
  code: z.string(),
  details: z.object({
    commandAccepted: z.literal(true),
    startupVerified: z.literal(false),
    outcomeVerified: z.literal(false),
    report: startup,
    evidence: z.object({ artifact_id: z.string().uuid() }),
  }),
});

try {
  await mcp.connect();
  await ownerMcp.connect();
  record(
    "arkts_rules",
    await mcp.call("harmony_knowledge", {
      action: "read",
      kind: "rules",
      id: "arkts-grammar-standards/recipes-core",
    }),
  );
  const project = path.join(root, "application");
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  const entry = path.join(project, prepared.module, relativeSources[1]!);
  const originalEntry = fs.readFileSync(entry, "utf8");
  assert.equal(
    originalEntry.split(
      "onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {",
    ).length,
    2,
  );
  assert.equal(
    originalEntry.split("windowStage.loadContent('pages/Index', (err) => {")
      .length,
    2,
  );
  atomicWrite(
    entry,
    originalEntry
      .replace(
        "onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {",
        `onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const requestedMode = want.parameters?.startupMode;
    AppStorage.setOrCreate('startupMode', typeof requestedMode === 'string' ? requestedMode : 'normal');`,
      )
      .replace(
        "windowStage.loadContent('pages/Index', (err) => {",
        `const mainWindow = windowStage.getMainWindowSync();
    mainWindow.setWindowLayoutFullScreen(true).catch(() => { hilog.error(DOMAIN, 'testTag', 'Full screen configuration failed'); });
    mainWindow.setWindowSystemBarEnable([]).catch(() => { hilog.error(DOMAIN, 'testTag', 'System bar configuration failed'); });
    windowStage.loadContent('pages/Index', (err) => {`,
      ),
  );
  const page = path.join(project, prepared.module, relativeSources[0]!);
  atomicWrite(
    page,
    `import { process } from '@kit.ArkTS';
@Entry
@Component
struct Index {
  @StorageLink('startupMode') mode: string = 'normal';
  @State ready: boolean = false;
  private timer: number = 0;
  aboutToAppear(): void {
    this.ready = this.mode !== 'slow' && this.mode !== 'white' && this.mode !== 'dark';
    if (this.mode === 'slow') this.timer = setTimeout(() => { this.ready = true; }, 4000);
    if (this.mode === 'crash') this.timer = setTimeout(() => { process.abort(); }, 2500);
  }
  aboutToDisappear(): void { clearTimeout(this.timer); }
  build() {
    Column({ space: 24 }) {
      if (this.ready) {
        Text('Startup: ' + this.mode).id('startup-status').fontSize(32).fontColor('#ffffff')
        Row().width('80%').height(100).backgroundColor('#25b8a4')
        Text('启动后独立业务断言').fontSize(24).fontColor('#ffffff')
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
      .backgroundColor(this.mode === 'dark' ? '#000000' : (this.ready ? '#152a4b' : '#ffffff'))
  }
}
`,
  );
  record("fixture", {
    project,
    originals,
    sources: [entry, page].map((file) => ({ file, sha256: fileDigest(file) })),
  });
  const target = await owned.start(osVersion);
  record("doctor", await mcp.call("deveco_doctor", {}));
  await owned.workflow("sync", "project_sync", { project_path: project });
  const built = await owned.workflow("build", "project_build", {
    project_path: project,
    modules: [prepared.module],
  });
  const packages = z
    .object({ artifacts: z.array(z.object({ path: z.string() })) })
    .parse(await owned.output(built.result, "build_project"))
    .artifacts.filter((item) => item.path.endsWith(".hap"))
    .map((item) => ({ ...item, sha256: fileDigest(item.path) }));
  assert.equal(packages.length, 1);
  const input = (mode: string, policy: Record<string, unknown> = {}) => ({
    target,
    packages,
    app: {
      bundle_name: prepared.bundle_name,
      module: prepared.module,
      ability: prepared.ability,
      parameters: { startupMode: mode },
      startup_check: policy,
    },
  });
  async function successful(
    key: string,
    mode: string,
    policy: Record<string, unknown> = {},
  ) {
    const state = await owned.workflow(key, "app_deploy", input(mode, policy));
    const launched = z
      .object({
        commandAccepted: z.literal(true),
        processVerified: z.literal(true),
        startupVerified: z.literal(true),
        outcomeVerified: z.literal(false),
        startup_check: startup.extend({
          evidence: z.object({ artifact_id: z.string().uuid() }),
        }),
      })
      .parse(await owned.output(state.result, "launch_application"));
    assert.equal(launched.startup_check.status, "passed");
    assert.equal(launched.startup_check.process, "stable");
    assert.ok(launched.startup_check.process_samples.length >= 2);
    record(`${key}_checked`, launched);
    record(
      `${key}_evidence`,
      await mcp.call("workflow_run", {
        action: "read_artifact",
        artifact_id: launched.startup_check.evidence.artifact_id,
      }),
    );
    if (mode !== "white" && mode !== "dark") {
      assert.equal(launched.startup_check.screen, "nonuniform");
      const assertion = await mcp.call("verify_ui", {
        target,
        assert: {
          visible: {
            key: "startup-status",
            bundle_name: prepared.bundle_name,
            text: `Startup: ${mode}`,
            textMode: "exact",
          },
          timeoutMs: 10000,
        },
      });
      z.object({ verified: z.literal(true) }).parse(assertion);
      record(`${key}_business_assertion`, assertion);
    } else assert.equal(launched.startup_check.screen, "uniform");
    return launched;
  }
  async function negative(
    key: string,
    mode: string,
    policy: Record<string, unknown> = {},
  ) {
    const state = await owned.workflow(
      key,
      "app_deploy",
      input(mode, policy),
      "failed",
    );
    const error = failed.parse(state.error);
    record(
      `${key}_evidence`,
      await mcp.call("workflow_run", {
        action: "read_artifact",
        artifact_id: error.details.evidence.artifact_id,
      }),
    );
    return { state, error, report: error.details.report };
  }
  await successful("normal", "normal");
  const slow = await successful("slow", "slow", { timeout_ms: 15000 });
  assert.ok(
    slow.startup_check.frames.some((item) => item.frame?.uniform === true),
    "Slow fixture must expose a real blank first frame",
  );
  assert.equal(slow.startup_check.frames.at(-1)?.frame?.uniform, false);
  for (const mode of ["white", "dark"]) {
    const value = await negative(`${mode}_unverified`, mode);
    assert.ok(
      ["STARTUP_TIMEOUT", "STARTUP_UNVERIFIED"].includes(value.error.code),
    );
    assert.equal(value.report.status, "inconclusive");
    assert.equal(value.report.screen, "uniform");
    assert.ok(value.report.frames.some((item) => item.frame?.uniform));
    assert.ok(
      value.report.frames.every((item) => !item.frame || item.frame.uniform),
    );
    await successful(`${mode}_explicit_contract`, mode, {
      allow_uniform: true,
    });
  }
  const crash = await negative("crash", "crash", {
    stable_ms: 5000,
    timeout_ms: 10000,
  });
  assert.equal(crash.error.code, "STARTUP_PROCESS_FAILED");
  assert.equal(crash.report.status, "failed");
  assert.equal(crash.report.process, "exited");
  assert.ok(crash.report.process_samples.some((item) => item.pids?.length));
  assert.deepEqual(crash.report.process_samples.at(-1)?.pids, []);
  const query = await negative("invalid_display", "normal", {
    display_id: 2147483647,
    timeout_ms: 6000,
  });
  assert.equal(query.report.status, "inconclusive");
  assert.equal(query.report.screen, "unavailable");
  assert.ok(
    query.report.frames.some(
      (item) => item.code === "STARTUP_SCREEN_SCOPE_UNAVAILABLE",
    ),
  );
  const cancelId = await owned.submit("cancel", "workflow_run", {
    action: "start",
    workflow: "app_deploy",
    input: input("white", { timeout_ms: 30000 }),
  });
  const db = new Database(path.join(root, "state/state.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  let accepted = false;
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const receipt = db
        .prepare(
          "SELECT status FROM operations WHERE run_id=? AND node='launch_application:device:launch'",
        )
        .get(cancelId);
      if (z.object({ status: z.literal("done") }).safeParse(receipt).success) {
        accepted = true;
        record("cancel_after_launch_receipt", { run_id: cancelId, receipt });
        break;
      }
      await delay(50);
    }
  } finally {
    db.close();
  }
  assert.ok(
    accepted,
    "Never cancel before the actual durable launch acknowledgement",
  );
  record(
    "cancel_request",
    await mcp.call("workflow_run", { action: "cancel", run_id: cancelId }),
  );
  const cancelled = await owned.settle("cancel", cancelId, "cancelled");
  const cancelError = failed
    .extend({
      details: failed.shape.details.extend({
        report: startup
          .omit({ process_samples: true })
          .extend({ process_samples: z.array(z.unknown()) }),
      }),
    })
    .parse(cancelled.error);
  assert.equal(cancelError.code, "CANCELLED");
  assert.equal(cancelError.details.report.status, "cancelled");
  record(
    "cancel_evidence",
    await mcp.call("workflow_run", {
      action: "read_artifact",
      artifact_id: cancelError.details.evidence.artifact_id,
    }),
  );
  await mcp.close();
  await mcp.connect();
  for (const state of [crash.state, query.state, cancelled]) {
    const preserved = z
      .object({
        run_id: z.string(),
        workflow: z.string(),
        status: z.string(),
        result: z.unknown(),
        error: z.unknown(),
      })
      .parse(
        await mcp.call("workflow_run", {
          action: "status", detail: "full",
          run_id: state.run_id,
        }),
      );
    assert.deepEqual(preserved, {
      run_id: state.run_id,
      workflow: "app_deploy",
      status: state.status,
      result: state.result,
      error: state.error,
    });
    record(`preserved_${state.run_id}`, preserved);
  }
  await successful("after_restart", "normal");
  for (const item of originals)
    assert.equal(fileDigest(item.file), item.sha256);
  completed = true;
} catch (error) {
  record("error", errorResult(error));
  console.error(JSON.stringify(errorResult(error)));
} finally {
  try {
    await owned.close();
    closed = true;
  } catch (error) {
    record("close_error", errorResult(error));
    await mcp.close().catch(() => {});
    await ownerMcp.close().catch(() => {});
    await owned.processes.close();
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Real startup fault MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
