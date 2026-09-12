import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { atomicWrite, digest, fileDigest, inside } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { CapabilityReceipts } from "./lib/capability-receipts.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";

/** Real host-guided UI acceptance. At the visual-review checkpoint the script
 * waits for a host-authored assessment of the actual delivered image. It never
 * manufactures a visual pass from a control assertion or screenshot hash. */
const [root, preparedFile] = z
  .tuple([z.string(), z.string()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Retain prior runs; use a new evidence directory",
);
const prepared = z
  .object({
    project_path: z.string(),
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
    module: z.string(),
    ability: z.string(),
    product: z.string().optional(),
  })
  .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const ownerRoot = path.join(root, "emulator-owner");
fs.mkdirSync(ownerRoot, { mode: 0o700 });
atomicWrite(path.join(ownerRoot, "config.json"), "{}\n");
const mcp = new AcceptanceMcp(root, "capability-ui-acceptance"),
  owner = new AcceptanceMcp(ownerRoot, "capability-ui-owner");
const tested = evidenceIdentity(),
  receipts = new CapabilityReceipts(root, tested),
  results: Record<string, unknown> = {};
const file = path.join(root, "evidence.json"),
  project = path.join(root, "application"),
  relative = path.join(prepared.module, "src/main/ets/pages/Index.ets");
const originalFile = path.join(prepared.project_path, relative),
  originalHash = fileDigest(originalFile),
  original = fs.readFileSync(originalFile, "utf8");
const app = {
  bundle_name: prepared.bundle_name,
  module: prepared.module,
  ability: prepared.ability,
};
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Owned emulator and signed isolated canary: public project selection, launch, bounded logs, durable UI plan/actions, real host image assessment, restart, cancellation, exports and debug completion. Client tool boundaries are delivery contracts, not native implementations or all-client compatibility claims.",
      },
      null,
      2,
    ),
  );
const record = (key: string, value: unknown) => {
  results[key] = value;
  save();
};
const owned = new OwnedEmulatorAcceptance(mcp, record, owner);
let completed = false,
  closed = false,
  test: string | undefined;
async function call(key: string, name: string, input: unknown) {
  try {
    const result = await mcp.call(name, input);
    record(key, result);
    return result;
  } catch (error) {
    record(`${key}_error`, errorResult(error));
    throw error;
  }
}
const selector = (key: string, text?: string) => ({
  key,
  bundle_name: app.bundle_name,
  ...(text === undefined ? {} : { text, textMode: "exact" }),
});
const uiState = z
  .object({
    test_id: z.string().uuid(),
    status: z.string(),
    verified: z.boolean(),
    initialized: z.boolean(),
    test_plan: z.string(),
    action_count: z.number(),
    actions: z.array(z.unknown()),
    steps: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        check: z
          .object({ review_id: z.string().nullable().optional() })
          .passthrough()
          .nullable(),
      }),
    ),
  })
  .passthrough();
const skillState = z
  .object({
    run_id: z.string().uuid(),
    revision: z.number(),
    phase: z.string(),
    status: z.string(),
    verified: z.literal(false),
  })
  .passthrough();
async function transition(
  run_id: string,
  phase: string,
  evidence_run_ids: string[] = [],
) {
  const current = skillState.parse(
    await mcp.call("skill_workflow", { action: "read", run_id }),
  );
  return call(`debug_${phase}_${evidence_run_ids.length}`, "skill_workflow", {
    action: "transition",
    run_id,
    expected_revision: current.revision,
    phase,
    evidence_run_ids,
    rationale:
      "Compare the original owned canary input symptom with the retained successful UI control and actual host visual assessment; cancelled evidence must not close this debug task.",
  });
}
async function pid() {
  assert.ok(owned.target);
  const result = await owned.processes.run(
    toolCommand(discoverToolchain(), "hdc", [
      "-t",
      owned.target,
      "shell",
      "pidof",
      app.bundle_name,
    ]),
    { timeoutMs: 10000, limitBytes: 4096 },
  );
  assert.equal(result.truncated, false);
  assert.match(result.stdout.trim(), /^\d+$/);
  return result.stdout.trim();
}
async function inspectImage(review_id: string) {
  const review = z
    .object({
      artifact_id: z.string().uuid(),
      sha256: z.string(),
      requirement: z.string(),
      verified: z.literal(false),
    })
    .parse(
      await call("visual_required", "ui_review", {
        action: "status",
        review_id,
      }),
    );
  const response = await mcp.callResponse("workflow_run", {
    action: "read_artifact",
    artifact_id: review.artifact_id,
    as: "image",
  });
  const data = z
    .object({
      artifact_id: z.literal(review.artifact_id),
      sha256: z.literal(review.sha256),
      bytes: z.number(),
      review_reads: z.array(
        z.object({ review_id: z.string(), read_token: z.string().uuid() }),
      ),
    })
    .parse(response.structuredContent!.data);
  const token = data.review_reads.find((item) => item.review_id === review_id);
  assert.ok(token);
  const images = response.content.filter((item) => item.type === "image");
  assert.equal(images.length, 1);
  const image = z
    .object({ data: z.string(), mimeType: z.enum(["image/png", "image/jpeg"]) })
    .parse(images[0]);
  const bytes = Buffer.from(image.data, "base64");
  assert.equal(bytes.length, data.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), review.sha256);
  const image_file = path.join(
    root,
    image.mimeType === "image/png" ? "review-image.png" : "review-image.jpg",
  );
  atomicWrite(image_file, bytes, false);
  const expected = {
    review_id,
    artifact_id: review.artifact_id,
    sha256: review.sha256,
    read_token: token.read_token,
  };
  atomicWrite(
    path.join(root, "pending-review.json"),
    JSON.stringify(
      {
        ...expected,
        image_file,
        requirement: review.requirement,
        instruction:
          "The GPT-6 host must actually view this MCP-delivered image and write review-assessment.json with these exact identifiers and assessment:{outcome,observations}. The script does not choose an outcome.",
      },
      null,
      2,
    ),
    false,
  );
  console.log(
    `VISUAL_REVIEW_REQUIRED ${path.join(root, "pending-review.json")}`,
  );
  const deadline = Date.now() + 20 * 60 * 1000,
    assessmentFile = path.join(root, "review-assessment.json");
  while (!fs.existsSync(assessmentFile) && Date.now() < deadline)
    await delay(1000);
  assert.ok(
    fs.existsSync(assessmentFile),
    "Host visual assessment did not arrive; this run cannot claim visual verification",
  );
  assert.equal(fs.lstatSync(assessmentFile).isSymbolicLink(), false);
  assert.ok(fs.statSync(assessmentFile).size < 16384);
  const assessment = z
    .strictObject({
      ...Object.fromEntries(
        Object.entries(expected).map(([key, value]) => [key, z.literal(value)]),
      ),
      assessment: z.strictObject({
        outcome: z.enum(["passed", "failed", "insufficient"]),
        observations: z.string().min(10).max(8192),
      }),
    })
    .parse(JSON.parse(fs.readFileSync(assessmentFile, "utf8")));
  record("host_visual_assessment", assessment);
  const assessed = await call("visual_complete", "ui_review", {
    action: "complete",
    ...expected,
    assessment: assessment.assessment,
  });
  z.object({
    verified: z.literal(true),
    status: z.literal("passed"),
    assessment_source: z.literal("host_visual_assessment"),
  }).parse(assessed);
  return {
    delivery: data,
    assessed,
    assessment_sha256: fileDigest(assessmentFile),
  };
}
async function exportTest(id: string, name: string) {
  const directory = path.join(root, name),
    exported = z
      .object({ manifest_sha256: z.string(), artifact_count: z.number() })
      .parse(
        await call(name, "ui_test", {
          action: "export",
          test_id: id,
          directory,
        }),
      );
  const manifestFile = path.join(directory, "manifest.json");
  assert.equal(fileDigest(manifestFile), exported.manifest_sha256);
  const entry = z.object({
    file: z.string(),
    bytes: z.number(),
    sha256: z.string(),
  });
  const manifest = z
    .object({
      complete: z.literal(true),
      events: entry,
      artifacts: z.array(entry.extend({ mime: z.string() })),
    })
    .parse(JSON.parse(fs.readFileSync(manifestFile, "utf8")));
  for (const item of [manifest.events, ...manifest.artifacts]) {
    const artifact = inside(directory, path.join(directory, item.file));
    assert.equal(fs.lstatSync(artifact).isFile(), true);
    assert.equal(fs.statSync(artifact).size, item.bytes);
    assert.equal(fileDigest(artifact), item.sha256);
  }
  assert.equal(manifest.artifacts.length, exported.artifact_count);
  return {
    ...exported,
    images: manifest.artifacts.filter((item) => item.mime.startsWith("image/"))
      .length,
    files_verified: manifest.artifacts.length + 2,
  };
}
try {
  await mcp.connect();
  await owner.connect();
  await call("arkts_rules", "harmony_knowledge", {
    action: "read",
    kind: "rules",
    id: "arkts-grammar-standards/recipes-core",
  });
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  assert.ok(
    original.includes("struct Index {") &&
      original.includes(".id('mcp-input')"),
  );
  assert.equal(/aboutToAppear|aboutToDisappear|MCPCAP:/.test(original), false);
  atomicWrite(
    path.join(project, relative),
    `import { hilog } from '@kit.PerformanceAnalysisKit';\n` +
      original
        .replace(
          ".id('mcp-input')",
          ".id('mcp-input').customKeyboard(this.testKeyboard)",
        )
        .replace(
          "struct Index {",
          `struct Index {
  @Builder testKeyboard() { Column() { Text('测试输入由原生 UI 自动化提供') }.height(48).width('100%') }
  private pulse: number = -1;
  private sequence: number = 0;
  aboutToAppear(): void { this.pulse = setInterval(() => { this.sequence++; hilog.info(0x1234, 'MCPCapability', 'MCPCAP:%{public}d:中文🙂', this.sequence); }, 500); }
  aboutToDisappear(): void { clearInterval(this.pulse); }
`,
        ),
  );
  const target = await owned.start();
  const catalog = await mcp.listTools();
  record("public_tool_catalog", catalog);
  const required = [
    "skill_manage",
    "skill_workflow",
    "ui_test",
    "ui_review",
    "workflow_run",
    "switch_cwd",
    "hdc_log",
  ];
  for (const name of required)
    assert.ok(catalog.tools.some((tool) => tool.name === name));
  const clientTools = [
    "invalid",
    "shell",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "task",
    "webfetch",
    "websearch",
    "apply_patch",
    "question",
  ];
  for (const name of clientTools) {
    assert.equal(
      catalog.tools.some((tool) => tool.name === name),
      false,
    );
    receipts.add(
      `${name}.execute`,
      [
        "The reviewed product contract assigns generic reasoning, file editing, search, questions and delegation to the connected host client.",
        "The actual MCP catalog exposes domain tools and guided completion gates; this boundary observation does not claim native implementation or successful execution by every AI client.",
      ],
      {
        tool: name,
        catalog: catalog.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      },
      { boundary: "client_required" },
    );
  }
  const skills = z
    .object({
      skills: z
        .array(
          z.object({
            delivery: z.literal("mcp"),
            client_installation_required: z.literal(false),
          }),
        )
        .length(6),
    })
    .parse(
      await call("skills_delivery", "skill_manage", { action: "catalog" }),
    );
  for (const action of ["install", "uninstall"] as const) {
    await assert.rejects(mcp.call("skill_manage", { action }));
    receipts.add(
      `skill.${action}`,
      [
        "The owner requires Skills and references to remain built into MCP, without client Skill installation or uninstall flows.",
        "All six current catalog entries declare MCP delivery and no client installation; the excluded installer action is rejected and is not counted as a functional success.",
      ],
      skills,
      { boundary: "explicitly_excluded" },
    );
  }
  const selected = z
    .object({ project_path: z.literal(fs.realpathSync(project)) })
    .parse(
      await call("select_project", "switch_cwd", { project_path: project }),
    );
  const routes = await call("selected_project_routes", "ui_flow", {
    action: "routes",
  });
  assert.match(JSON.stringify(routes), new RegExp(app.ability));
  receipts.add(
    "switch_cwd.execute",
    [
      "Public switch_cwd selects the isolated project; a subsequent routes request without project_path resolves its actual launch ability.",
    ],
    { selected, routes },
  );
  const devices = z
    .object({ targets: z.array(z.string()) })
    .parse(await call("list_devices", "device_info", { list: true }));
  assert.ok(devices.targets.includes(target));
  receipts.add(
    "hdc_log.list_devices",
    [
      "Public device_info inventory contains the exact endpoint independently bound to the owned emulator before log operations.",
    ],
    devices,
  );
  const cleared = z
    .object({
      cleared: z.literal(true),
      scope: z.literal("device_hilog_app_core_buffers"),
      concurrent_new_logs_possible: z.literal(true),
    })
    .parse(
      await call("clear_owned_logs", "hdc_log", { action: "clear", target }),
    );
  receipts.add(
    "hdc_log.clear",
    [
      "Public clear receives native acknowledgement on the owned emulator only; its scope is device app/core buffers and concurrent new logs remain possible.",
    ],
    cleared,
  );
  await owned.workflow("sync", "project_sync", { project_path: project });
  const built = await owned.workflow("build", "project_build", {
    project_path: project,
    modules: [prepared.module],
  });
  const build = z
    .object({ artifacts: z.array(z.object({ path: z.string() })) })
    .parse(await owned.output(built.result, "build_project"));
  const packages = build.artifacts.filter((item) => item.path.endsWith(".hap"));
  assert.equal(packages.length, 1);
  const deployed = await owned.workflow("deploy", "app_deploy", {
    target,
    packages,
    app,
  });
  const launch = z
    .object({
      commandAccepted: z.literal(true),
      processVerified: z.literal(true),
      startupVerified: z.literal(true),
      outcomeVerified: z.literal(false),
    })
    .passthrough()
    .parse(await owned.output(deployed.result, "launch_application"));
  receipts.add(
    "start_app.execute",
    [
      "Public app_deploy installs the freshly built signed canary and launches its captured module/Ability on the owned endpoint.",
      "Launch verifies delayed process stability and basic screen startup while outcomeVerified remains false until a separate application assertion.",
    ],
    launch,
  );
  await delay(1500);
  const collected = await call("collect_canary_logs", "hdc_log", {
    action: "collect",
    target,
    bundle_name: app.bundle_name,
    contains: "MCPCAP:",
    lines: 50,
  });
  assert.match(JSON.stringify(collected), /MCPCAP:/);
  receipts.add(
    "hdc_log.collect",
    [
      "Public bounded Hilog collection for the owned app PID returns its actual MCPCAP heartbeat; literal filtering is requested and retained truncation metadata remains available.",
    ],
    collected,
  );
  const debug = skillState.parse(
    await call("debug_start", "skill_workflow", {
      action: "start",
      kind: "debug",
      project_path: project,
      device: { target, bundle_name: app.bundle_name },
      objective:
        "Verify that native Chinese input reaches the canary status after confirmation, remains visually readable, and can only close with successful matching UI evidence.",
    }),
  );
  await call("debug_notes", "skill_workflow", {
    action: "write",
    run_id: debug.run_id,
    expected_revision: debug.revision,
    name: "notes.md",
    content:
      "The owned launch page initially shows its default message. Reproduce native field input, replace existing content explicitly, press confirmation, then compare the status and mirrored text. Inspect the actual screenshot. Cancelled tests must not complete the debug workflow.",
  });
  await transition(debug.run_id, "implementing");
  await transition(debug.run_id, "verifying");
  const cancelPlan =
    "取消此独立 UI 测试并验证重启后仍为取消状态，不能当作业务成功。";
  test = uiState.parse(
    await call("cancel_start", "ui_test", {
      action: "start",
      target,
      app,
      test_plan: cancelPlan,
      steps: [
        {
          id: "cancel-observation",
          goal: "Canary visible",
          assert: { visible: selector("mcp-confirm"), timeoutMs: 5000 },
        },
      ],
    }),
  ).test_id;
  await call("cancel_initialize", "ui_test", {
    action: "resume",
    test_id: test,
  });
  const cancelled = z
    .object({
      test_id: z.literal(test),
      status: z.literal("cancelled"),
      verified: z.literal(false),
    })
    .parse(
      await call("cancel_test", "ui_test", { action: "cancel", test_id: test }),
    );
  await mcp.close();
  await mcp.connect();
  const cancelledAfter = uiState.parse(
    await call("cancel_after_restart", "ui_test", {
      action: "status",
      test_id: test,
    }),
  );
  assert.equal(cancelledAfter.status, "cancelled");
  assert.equal(cancelledAfter.action_count, 0);
  assert.equal(cancelledAfter.verified, false);
  receipts.add(
    "verify_ui.cancel",
    [
      "An initialized public UI test is cancelled, survives a full MCP reconnect as cancelled with zero actions, and never claims verification.",
    ],
    { cancelled, after: cancelledAfter },
  );
  await assert.rejects(transition(debug.run_id, "completed", [test]), {
    code: "SKILL_WORKFLOW_EVIDENCE_INCOMPLETE",
  });
  const cancelledId = test;
  test = undefined;
  await exportTest(cancelledId, "cancelled-export");
  const test_plan =
    "在独立验收应用中输入‘能力验收中文🙂’，隐藏输入区域并点击确认输入。状态和镜像文字均应显示同样内容；读取真实截图核对文字和按钮，不能仅凭控件断言认定视觉通过。";
  const value = "能力验收中文🙂",
    requirement =
      "检查独立验收应用：顶部状态与下方镜像文字均为‘能力验收中文🙂’，输入框中保留同样内容，‘确认输入’按钮清楚可见，文字没有明显遮挡。";
  const beforePid = await pid();
  const started = uiState.parse(
    await call("test_start", "ui_test", {
      action: "start",
      target,
      app,
      fresh_start: true,
      test_plan,
    }),
  );
  test = started.test_id;
  assert.equal(started.initialized, false);
  const steps = [
    {
      id: "confirm-chinese",
      goal: test_plan,
      assert: { visible: selector("mcp-status", value), timeoutMs: 10000 },
      review: { requirement },
    },
  ];
  const planned = uiState.parse(
    await call("test_plan", "ui_test", {
      action: "plan",
      test_id: test,
      steps,
    }),
  );
  assert.equal(planned.test_plan, test_plan);
  assert.equal(planned.steps[0]!.id, steps[0]!.id);
  receipts.add(
    "verify_ui.testPlan",
    [
      "The original Chinese test plan is captured verbatim; public plan assigns an ordered step with a fixed exact-text assertion and an independent visual requirement.",
    ],
    { started, planned },
  );
  const initialized = uiState.parse(
    await call("test_fresh_start", "ui_test", {
      action: "resume",
      test_id: test,
    }),
  );
  assert.equal(initialized.initialized, true);
  const afterPid = await pid();
  assert.notEqual(beforePid, afterPid);
  receipts.add(
    "verify_ui.freshStart",
    [
      "Public fresh-start initialization stops and relaunches the owned app; initialized changes from false to true and the actual sampled PID changes.",
    ],
    { beforePid, afterPid, initialized },
  );
  const operations = [
    { action: "click", selector: selector("mcp-input") },
    { action: "keyEvent", keys: ["2072", "2017"] },
    { action: "text", window: { bundle_name: app.bundle_name }, text: value },
    { action: "keyEvent", keys: ["Back"] },
    { action: "click", selector: selector("mcp-confirm") },
  ];
  for (const [index, operation] of operations.entries()) {
    const attempt_id = randomUUID();
    const acted = uiState.parse(
      await call(`act_${index}`, "ui_test", {
        action: "act",
        test_id: test,
        step_id: steps[0]!.id,
        attempt_id,
        operation,
      }),
    );
    assert.equal(acted.action_count, index + 1);
    assert.equal(acted.verified, false);
    if (index === 2) {
      await mcp.close();
      await mcp.connect();
      const recovered = uiState.parse(
        await call("test_resume_after_restart", "ui_test", {
          action: "resume",
          test_id: test,
        }),
      );
      assert.equal(recovered.test_plan, test_plan);
      assert.deepEqual(recovered.actions, acted.actions);
      assert.equal(recovered.action_count, 3);
      const deduplicated = uiState.parse(
        await call("duplicate_accepted_action", "ui_test", {
          action: "act",
          test_id: test,
          step_id: steps[0]!.id,
          attempt_id,
          operation,
        }),
      );
      assert.equal(deduplicated.action_count, 3);
      assert.deepEqual(deduplicated.actions, recovered.actions);
      receipts.add(
        "verify_ui.resume",
        [
          "After three accepted native actions, full MCP reconnect and public resume preserve the exact plan and action receipts without replay.",
          "Resubmitting the same accepted attempt ID and operation returns the same three receipts; it does not inject the input again.",
        ],
        { before: acted, recovered, deduplicated },
      );
    }
  }
  const checked = uiState.parse(
    await call("test_check", "ui_test", { action: "check", test_id: test }),
  );
  const review_id = checked.steps[0]!.check?.review_id;
  assert.ok(review_id);
  assert.equal(checked.verified, false);
  await assert.rejects(
    mcp.call("ui_test", { action: "finish", test_id: test }),
    { code: "UI_TEST_INCOMPLETE" },
  );
  const visual = await inspectImage(review_id);
  const finished = uiState.parse(
    await call("test_finish", "ui_test", { action: "finish", test_id: test }),
  );
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.verified, true);
  assert.equal(finished.action_count, 5);
  receipts.add(
    "verify_ui.step_execution",
    [
      "Five real scoped UI actions click, select all, insert Chinese and emoji, hide the keyboard, and confirm; only the final control and host visual checks allow completion.",
    ],
    { checked, finished },
  );
  receipts.add(
    "verify_ui.visual_review",
    [
      "Public finish rejects an incomplete visual review despite the control check; the host reads the exact public MCP image and supplies matching artifact, SHA and read token with actual observations.",
      "Only a passed host assessment and the original native assertion permit the successful UI test finish.",
    ],
    visual,
  );
  const chunks: {
    id: number;
    source?: string;
    artifact_id: string;
    sha256?: string;
  }[] = [];
  for (let offset = 0; ;) {
    const page = z
      .object({
        chunks: z.array(
          z.object({
            id: z.number(),
            source: z.string().optional(),
            artifact_id: z.string(),
            sha256: z.string().optional(),
          }),
        ),
        next_chunk_offset: z.number().nullable(),
      })
      .parse(
        await call(`logs_list_${offset}`, "ui_test", {
          action: "logs",
          test_id: test,
          chunk_offset: offset,
          chunk_limit: 100,
        }),
      );
    chunks.push(...page.chunks);
    if (page.next_chunk_offset === null) break;
    assert.ok(page.next_chunk_offset > offset);
    offset = page.next_chunk_offset;
  }
  const continuous = chunks.filter((chunk) => chunk.source === "continuous");
  assert.ok(continuous.length > 0);
  let matching = 0;
  const pages: unknown[] = [];
  for (const chunk of continuous) {
    const plain = z
      .object({ content: z.string() })
      .parse(
        await call(`logs_read_${chunk.id}`, "ui_test", {
          action: "logs",
          test_id: test,
          chunk_id: chunk.id,
          limit: 65536,
        }),
      );
    assert.ok(Buffer.byteLength(plain.content) <= 65536);
    for (let offset = 0; ;) {
      const page = z
        .object({ content: z.string(), next_offset: z.number().nullable() })
        .parse(
          await call(`logs_search_${chunk.id}_${offset}`, "ui_test", {
            action: "logs",
            test_id: test,
            chunk_id: chunk.id,
            search_keywords: ["MCPCAP:"],
            offset,
            limit: 512,
          }),
        );
      assert.ok(Buffer.byteLength(page.content) <= 512);
      pages.push(page);
      matching += [...page.content.matchAll(/MCPCAP:\d+:中文🙂/g)].length;
      if (page.next_offset === null) break;
      assert.ok(page.next_offset > offset);
      offset = page.next_offset;
    }
  }
  assert.ok(matching >= 2);
  receipts.add(
    "get_ui_verification_log.read",
    [
      "Public UI log listing paginates retained continuous chunks; reading an actual owned app chunk obeys the requested UTF-8 byte limit and leaves gap metadata explicit.",
    ],
    { chunks, matching },
  );
  receipts.add(
    "get_ui_verification_log.search",
    [
      "Public literal-keyword search paginates actual Chinese/emoji heartbeat lines with a 512-byte limit; this does not claim capture outside recorded bounded intervals.",
    ],
    pages,
  );
  const exported = await exportTest(test, "completed-export");
  assert.ok(exported.images >= 2);
  receipts.add(
    "save_ui_screenshot.export_steps",
    [
      "Public completed-test export contains multiple real screenshots; manifest, events and every artifact byte count and SHA are independently verified from the exported files.",
    ],
    exported,
  );
  const debugComplete = skillState.parse(
    await transition(debug.run_id, "completed", [test]),
  );
  assert.equal(debugComplete.phase, "completed");
  assert.equal(debugComplete.status, "succeeded");
  assert.equal(debugComplete.verified, false);
  receipts.add(
    "debug_exit.execute",
    [
      "The builtin debug workflow rejects cancelled evidence and completes only with a fresh successful UI test matching its captured app and target.",
      "The retained client assessment and native UI evidence stay distinct; debug workflow completion does not claim arbitrary prose verification or alter host system mode.",
    ],
    debugComplete,
  );
  test = undefined;
  assert.equal(fileDigest(originalFile), originalHash);
  completed = true;
} catch (error) {
  record("error", errorResult(error));
  console.error(JSON.stringify(errorResult(error)));
} finally {
  if (test)
    try {
      await mcp.call("ui_test", { action: "cancel", test_id: test });
    } catch (error) {
      record("cancel_cleanup_error", errorResult(error));
    }
  try {
    await owned.close();
    closed = true;
  } catch (error) {
    record("close_error", errorResult(error));
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  receipts.finish(passed);
  console.log(`Capability UI acceptance: ${passed ? "passed" : "failed"}`);
}
