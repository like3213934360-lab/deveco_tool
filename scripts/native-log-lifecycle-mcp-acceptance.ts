import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";

const [root, preparedFile, osVersion] = z
  .tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Keep earlier attempts and choose a fresh evidence directory",
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
const ownerRoot = path.join(root, "emulator-owner");
fs.mkdirSync(ownerRoot, { mode: 0o700 });
atomicWrite(path.join(ownerRoot, "config.json"), "{}\n");
const tested = evidenceIdentity(),
  results: Record<string, unknown> = {},
  mcp = new AcceptanceMcp(root, "log-lifecycle-subject"),
  owner = new AcceptanceMcp(ownerRoot, "log-lifecycle-emulator-owner", { tool_groups: ["core", "emulator-admin"] }),
  file = path.join(root, "evidence.json");
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Public MCP continuous logs on an owned emulator and signed app copy. Target-bound HDC force-stop/start and reboot are explicit external fault stimuli, not product workflow capabilities. Verify PID generations, observed offline gap, recovery, step attribution, MCP restart, cancellation, hashes and cleanup. Short-lived child/PID reuse/clock/budget fault cases have separate deterministic tests; no physical-device or system-wide lossless claim.",
      },
      null,
      2,
    ),
  );
const record = (key: string, value: unknown) => {
  results[key] = value;
  save();
};
const owned = new OwnedEmulatorAcceptance(mcp, record, owner),
  project = path.join(root, "application"),
  relative = path.join(prepared.module, "src/main/ets/pages/Index.ets"),
  originalHash = fileDigest(path.join(prepared.project_path, relative)),
  app = {
    bundle_name: prepared.bundle_name,
    module: prepared.module,
    ability: prepared.ability,
  },
  selector = {
    key: "mcp-life-status",
    text: "生命周期日志运行中",
    textMode: "exact",
    bundle_name: prepared.bundle_name,
  };
let testId: string | undefined,
  target: string | undefined,
  completed = false,
  closed = false,
  cancelled = false;
const continuousSchema = z
  .object({
    state: z.string(),
    chunk_count: z.number(),
    complete: z.literal(false),
    system_delivery: z.literal("unknown"),
    current_ready_at: z.number().optional(),
    stop_reason: z.string().optional(),
    gaps: z
      .array(z.object({ code: z.string(), occurrences: z.number() }))
      .default([]),
  })
  .passthrough();
async function status(key: string) {
  const result = await mcp.call("ui_test", {
    action: "status",
    test_id: testId,
  });
  record(key, result);
  return continuousSchema.parse(
    z.object({ continuous_logs: z.unknown() }).parse(result).continuous_logs,
  );
}
async function until(
  key: string,
  predicate: () => Promise<boolean>,
  timeout = 30000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(500);
  }
  throw new ToolError(
    "ACCEPTANCE_TIMEOUT",
    `${key} did not reach its asserted state; retain the current evidence`,
  );
}
async function hdc(key: string, args: string[], allowFailure = false) {
  assert.ok(target);
  record(`${key}_dispatch`, {
    target,
    args,
    purpose: "owned-target external fault stimulus or observation",
  });
  const value = await owned.processes.run(
    toolCommand(discoverToolchain(), "hdc", ["-t", target, ...args]),
    { timeoutMs: 10000, allowFailure },
  );
  record(key, value);
  assert.equal(value.truncated, false);
  if (!allowFailure) {
    assert.equal(value.exitCode, 0);
    assert.equal(value.stderr.trim(), "");
  }
  return value;
}
async function assertBinding(key: string) {
  const response = await hdc(key, [
    "shell",
    "param",
    "get",
    "ohos.qemu.hvd.name",
  ]);
  assert.equal(response.stdout.trim(), owned.name);
}
async function launch(key: string) {
  await assertBinding(`${key}_binding`);
  const result = await hdc(key, [
    "shell",
    "aa",
    "start",
    "-b",
    prepared.bundle_name,
    "-a",
    prepared.ability,
    "-m",
    prepared.module,
  ]);
  assert.match(result.stdout, /success/i);
  await mcp.call("verify_ui", {
    target,
    assert: { visible: selector, timeoutMs: 15000 },
  });
}
const chunkSchema = z
  .object({
    id: z.number(),
    source: z.string().optional(),
    artifact_id: z.string(),
    sha256: z.string().optional(),
    processes: z.record(z.string(), z.string()).optional(),
    step_id: z.string(),
    uid: z.string().optional(),
  })
  .passthrough();
async function inspect(key: string) {
  const chunks: z.infer<typeof chunkSchema>[] = [];
  let offset = 0;
  for (;;) {
    const page = z
      .object({
        chunks: z.array(chunkSchema),
        next_chunk_offset: z.number().nullable(),
      })
      .parse(
        await mcp.call("ui_test", {
          action: "logs",
          test_id: testId,
          chunk_offset: offset,
          chunk_limit: 7,
        }),
      );
    chunks.push(...page.chunks);
    if (page.next_chunk_offset === null) break;
    assert.ok(page.next_chunk_offset > offset);
    offset = page.next_chunk_offset;
  }
  const lines: {
    pid: string;
    sequence: number;
    step: string;
    generation: string;
    uid: string | undefined;
  }[] = [];
  for (const chunk of chunks.filter((item) => item.source === "continuous")) {
    let offset = 0;
    for (;;) {
      const page = z
        .object({ content: z.string(), next_offset: z.number().nullable() })
        .parse(
          await mcp.call("ui_test", {
            action: "logs",
            test_id: testId,
            chunk_id: chunk.id,
            search_keywords: ["MCPLIFE:"],
            offset,
            limit: 4096,
          }),
        );
      for (const match of page.content.matchAll(
        /MCPLIFE:(\d+):(\d+):中文🙂/g,
      )) {
        const generation = chunk.processes?.[match[1]!];
        assert.ok(
          generation,
          "Payload PID must belong to the verified chunk generation",
        );
        lines.push({
          pid: match[1]!,
          sequence: Number(match[2]),
          step: chunk.step_id,
          generation,
          uid: chunk.uid,
        });
      }
      if (page.next_offset === null) break;
      assert.ok(page.next_offset > offset);
      offset = page.next_offset;
    }
  }
  assert.equal(
    new Set(
      lines.map((item) => `${item.pid}:${item.generation}:${item.sequence}`),
    ).size,
    lines.length,
    "No retained sequence may be duplicated within its verified generation",
  );
  record(key, { chunks, lines });
  return { chunks, lines };
}
try {
  await mcp.connect();
  await owner.connect();
  record(
    "arkts_rules",
    await mcp.call("harmony_knowledge", {
      action: "read",
      kind: "rules",
      id: "arkts-grammar-standards/recipes-core",
    }),
  );
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  atomicWrite(
    path.join(project, relative),
    `import { hilog } from '@kit.PerformanceAnalysisKit';
import { process } from '@kit.ArkTS';
@Entry
@Component
struct Index {
  private pulse: number = -1;
  private count: number = 0;
  aboutToAppear(): void {
    this.pulse = setInterval(() => {
      this.count++;
      hilog.info(0x1234, 'MCPLifecycle', 'MCPLIFE:%{public}d:%{public}d:中文🙂', process.pid, this.count);
    }, 250);
  }
  aboutToDisappear(): void { clearInterval(this.pulse); }
  build() { Column() { Text('生命周期日志运行中').id('mcp-life-status').fontSize(28) }.width('100%').height('100%').padding(30) }
}
`,
  );
  record("fixture", {
    project,
    original_sha256: originalHash,
    source_sha256: fileDigest(path.join(project, relative)),
  });
  target = await owned.start(osVersion);
  await owned.workflow("deploy", "build_deploy_verify", {
    project_path: project,
    modules: [prepared.module],
    target,
    app,
    assert: { visible: selector, timeoutMs: 15000 },
  });
  const start = z.object({ test_id: z.string() }).parse(
    await mcp.call("ui_test", {
      action: "start",
      target,
      app,
      test_plan:
        "Observe application lifecycle and a device outage without replaying UI effects; intentionally cancel after recovery.",
      steps: [
        {
          id: "before",
          goal: "Initial app visible",
          assert: { visible: selector, timeoutMs: 10000 },
        },
        {
          id: "after",
          goal: "Recovery capture remains attributable",
          assert: { visible: selector, timeoutMs: 10000 },
        },
      ],
    }),
  );
  testId = start.test_id;
  record("test", start);
  record(
    "resume",
    await mcp.call("ui_test", { action: "resume", test_id: testId }),
  );
  await until(
    "first captured generation",
    async () => (await status("first_ready")).chunk_count >= 2,
  );
  const baseline = await inspect("baseline");
  assert.ok(baseline.lines.length >= 2);
  const oldPid = baseline.lines.at(-1)!.pid;
  record(
    "first_step",
    await mcp.call("ui_test", { action: "check", test_id: testId }),
  );
  record(
    "next_step",
    await mcp.call("ui_test", { action: "resume", test_id: testId }),
  );
  await assertBinding("before_stop_binding");
  assert.match(
    (
      await hdc("force_stop", [
        "shell",
        "aa",
        "force-stop",
        prepared.bundle_name,
      ])
    ).stdout,
    /success/i,
  );
  await until("app absence gap", async () =>
    (await status("app_absent")).gaps.some(
      (gap) => gap.code === "application_not_running",
    ),
  );
  await launch("app_restart");
  const restartedPid = (
    await hdc("restarted_pid", ["shell", "pidof", prepared.bundle_name])
  ).stdout.trim();
  assert.match(restartedPid, /^\d+$/);
  assert.notEqual(restartedPid, oldPid);
  await until("new PID captured", async () =>
    (await inspect("after_app_restart")).lines.some(
      (item) => item.pid === restartedPid && item.step === "after",
    ),
  );
  const beforeOutage = await status("before_outage"),
    previousCount = beforeOutage.chunk_count;
  await assertBinding("before_reboot_binding");
  record(
    "reboot_help",
    await owned.processes.run(
      toolCommand(discoverToolchain(), "hdc", ["help"]),
      { timeoutMs: 5000 },
    ),
  );
  await hdc("reboot", ["target", "boot"], true);
  await until("actual offline observation", async () => {
    const observed = await hdc(
      "offline_observation",
      ["shell", "param", "get", "ohos.qemu.hvd.name"],
      true,
    );
    return observed.exitCode !== 0 || observed.stdout.trim() !== owned.name;
  });
  await until("transport gap", async () => {
    const current = await status("during_outage");
    return current.gaps.some(
      (gap) =>
        /^UI_LOG_(UID_UNAVAILABLE|STREAM_ENDED|IDENTITY_UNAVAILABLE)$|^DEVICE_|^PROCESS_/.test(
          gap.code,
        ) &&
        gap.occurrences >
          (beforeOutage.gaps.find((old) => old.code === gap.code)
            ?.occurrences ?? 0),
    );
  });
  await until(
    "same owned emulator reconnected",
    async () => {
      const value = await hdc(
        "reconnect_observation",
        ["shell", "param", "get", "ohos.qemu.hvd.name"],
        true,
      );
      return value.exitCode === 0 && value.stdout.trim() === owned.name;
    },
    90000,
  );
  await launch("after_reboot_launch");
  record(
    "resume_after_outage",
    await mcp.call("ui_test", { action: "resume", test_id: testId }),
  );
  await until(
    "capture after outage",
    async () => (await status("after_outage")).chunk_count >= previousCount + 2,
  );
  const live = await inspect("before_mcp_restart");
  assert.ok(live.lines.some((item) => item.pid === oldPid));
  assert.ok(live.lines.some((item) => item.pid === restartedPid));
  assert.ok(live.lines.every((item) => item.uid === baseline.lines[0]!.uid));
  await mcp.close();
  await mcp.connect();
  const retained = await inspect("after_mcp_restart");
  assert.deepEqual(retained.chunks.slice(0, live.chunks.length), live.chunks);
  record(
    "last_resume",
    await mcp.call("ui_test", { action: "resume", test_id: testId }),
  );
  await until(
    "current readiness after MCP restart",
    async () => (await status("resumed_ready")).current_ready_at !== undefined,
  );
  record(
    "cancel",
    await mcp.call("ui_test", { action: "cancel", test_id: testId }),
  );
  cancelled = true;
  const final = await status("cancelled");
  assert.equal(final.state, "stopped");
  assert.equal(final.stop_reason, "test_cancelled");
  const db = new Database(path.join(root, "state/state.sqlite"), {
    readonly: true,
  });
  try {
    const active = db
      .prepare(
        "SELECT id,pid,status FROM managed_processes WHERE run_id=? AND status<>'exited'",
      )
      .all(testId);
    const leases = db
      .prepare("SELECT resource FROM leases WHERE resource IN (?,?)")
      .all(`ui-log:${testId}`, `ui-test:${testId}`);
    record("cancelled_resources", { active, leases });
    assert.deepEqual(active, []);
    assert.deepEqual(leases, []);
  } finally {
    db.close();
  }
  record(
    "export",
    await mcp.call("ui_test", {
      action: "export",
      test_id: testId,
      directory: path.join(root, "export"),
    }),
  );
  const manifest = z
    .object({
      artifacts: z.array(z.object({ file: z.string(), sha256: z.string() })),
    })
    .parse(
      JSON.parse(
        fs.readFileSync(path.join(root, "export/manifest.json"), "utf8"),
      ),
    );
  for (const artifact of manifest.artifacts)
    assert.equal(
      fileDigest(path.join(root, "export", artifact.file)),
      artifact.sha256,
    );
  record("export_hashes_verified", manifest.artifacts.length);
  assert.equal(
    fileDigest(path.join(prepared.project_path, relative)),
    originalHash,
  );
  completed = true;
} catch (error) {
  record("error", errorResult(error));
  console.error(JSON.stringify(errorResult(error)));
} finally {
  if (testId && !cancelled)
    try {
      record(
        "cancel_cleanup",
        await mcp.call("ui_test", { action: "cancel", test_id: testId }),
      );
    } catch (error) {
      record("cancel_cleanup_error", errorResult(error));
    }
  try {
    await owned.close();
    closed = true;
  } catch (error) {
    record("close_error", errorResult(error));
    await mcp.close().catch(() => {});
    await owner.close().catch(() => {});
    await owned.processes.close();
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Real log lifecycle MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
