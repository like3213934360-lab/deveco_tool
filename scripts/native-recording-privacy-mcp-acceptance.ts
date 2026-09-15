import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { flowSchema } from "../src/core/contracts.js";
import { atomicWrite, digest, fileDigest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
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
  "Retain previous evidence and choose a new directory",
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
  results: Record<string, unknown> = {};
// Generated only in this driver process. No fixture source, file, report or
// console contains a canary value. Public MCP inputs are the subject under test.
const canaries = [0, 1, 2].map(
  () => `密钥🙂${randomBytes(18).toString("hex")}`,
);
const needles = canaries.flatMap((value) => [
  Buffer.from(value),
  Buffer.from(JSON.stringify(value).slice(1, -1)),
  Buffer.from(value, "utf16le"),
]);
const file = path.join(root, "evidence.json");
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Public MCP password-field recording, masked UI, missing focus and ambiguous selectors, save/restart/replay and failed final assertion. Canary byte scans cover SQLite/WAL, artifacts, flow files and MCP stderr; screenshots require separate human/model visual review, and byte scans are not OCR. Uses an owned signed app copy and emulator; no user passwords or physical-device coverage.",
      },
      null,
      2,
    ),
  );
function record(key: string, value: unknown) {
  if (
    needles.some((needle) =>
      Buffer.from(JSON.stringify(value)).includes(needle),
    )
  )
    throw new ToolError(
      "ACCEPTANCE_PRIVACY_LEAK",
      "Public response contains a private canary",
      { observation: key },
    );
  results[key] = value;
  save();
}
const mcp = new AcceptanceMcp(root, "recording-privacy-subject"),
  owner = new AcceptanceMcp(ownerRoot, "recording-privacy-owner", { tool_groups: ["core", "emulator-admin"] });
const owned = new OwnedEmulatorAcceptance(mcp, record, owner);
const project = path.join(root, "application"),
  relative = path.join(prepared.module, "src/main/ets/pages/Index.ets"),
  originalHash = fileDigest(path.join(prepared.project_path, relative));
let target: string | undefined,
  recording: string | undefined,
  completed = false,
  closed = false;
const selector = (key: string, text?: string) => ({
  key,
  bundle_name: prepared.bundle_name,
  ...(text === undefined ? {} : { text, textMode: "exact" }),
});
const assertion = (length: number) => ({
  visible: selector("password-length", `输入长度：${length}`),
  timeoutMs: 10000,
});
async function observe(key: string, name: string, input: unknown) {
  const value = await mcp.call(name, input);
  record(key, value);
  return value;
}
async function control(key: string, operation: Record<string, unknown>) {
  return observe(key, "ui_control", { target, operation });
}
async function reject(
  key: string,
  operation: Record<string, unknown>,
  expected: string,
) {
  let rejected = false;
  try {
    await control(key, operation);
  } catch (error) {
    const value = errorResult(error);
    record(key, value);
    assert.equal(value.code, expected);
    rejected = true;
  }
  assert.ok(
    rejected,
    "Invalid focus/scope must not dispatch text or mutate the recording",
  );
  const status = z
    .object({
      recording: z.object({
        step_count: z.number(),
        uncertain_operation: z.unknown().nullable(),
      }),
    })
    .parse(
      await observe(`${key}_status`, "ui_flow", {
        action: "record_status",
        recording_id: recording,
      }),
    );
  assert.equal(status.recording.step_count, 0);
  assert.equal(status.recording.uncertain_operation, null);
}
async function begin(id: string) {
  recording = await owned.submit(`begin_${id}`, "ui_flow", {
    action: "record_start",
    project_path: project,
    target,
    id,
    name: "密码录制边界验收",
    route: { module: prepared.module, ability: prepared.ability },
    mode: "restart",
  });
  await owned.settle(`ready_${id}`, recording, "needs_input");
}
async function input(key: string, value: string) {
  await control(`${key}_focus`, {
    action: "click",
    selector: selector("password-primary"),
  });
  await control(`${key}_type`, {
    action: "text",
    window: { bundle_name: prepared.bundle_name },
    text: value,
  });
  await control(`${key}_hide_keyboard`, { action: "keyEvent", keys: ["Back"] });
  await observe(`${key}_length`, "verify_ui", {
    target,
    assert: assertion(value.length),
  });
  await observe(`${key}_masked_ui`, "ui_inspect", {
    target,
    selector: { bundle_name: prepared.bundle_name },
    screenshot: true,
    limit: 100,
  });
}
function scan(key: string) {
  const files: { file: string; bytes: number; sha256: string }[] = [];
  const visit = (name: string) => {
    if (!fs.existsSync(name)) return;
    const stat = fs.lstatSync(name);
    assert.equal(
      stat.isSymbolicLink(),
      false,
      "Never follow an unexpected artifact symlink",
    );
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(name)) visit(path.join(name, child));
      return;
    }
    assert.ok(stat.isFile());
    const fd = fs.openSync(name, "r");
    let tail = Buffer.alloc(0),
      offset = 0;
    const overlap = Math.max(...needles.map((needle) => needle.length)) - 1;
    try {
      for (;;) {
        const buffer = Buffer.alloc(1024 * 1024),
          count = fs.readSync(fd, buffer, 0, buffer.length, offset);
        if (!count) break;
        offset += count;
        const chunk = Buffer.concat([tail, buffer.subarray(0, count)]);
        if (needles.some((needle) => chunk.includes(needle)))
          throw new ToolError(
            "ACCEPTANCE_PRIVACY_LEAK",
            "A product file contains a private canary",
            { file: path.relative(root, name) },
          );
        tail = chunk.subarray(Math.max(0, chunk.length - overlap));
      }
    } finally {
      fs.closeSync(fd);
    }
    files.push({
      file: path.relative(root, name),
      bytes: stat.size,
      sha256: fileDigest(name),
    });
  };
  for (const entry of [
    "state",
    "mcp.ndjson",
    "application/.arkpilot",
    "application/.deveco-mcp",
  ])
    visit(path.join(root, entry));
  assert.ok(files.some((entry) => entry.file.endsWith("state.sqlite")));
  record(key, {
    files,
    canaries: canaries.length,
    plaintext_matches: 0,
    encodings: ["UTF-8", "JSON string", "UTF-16LE"],
    screenshot_pixels_reviewed: false,
  });
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
    `@Entry
@Component
struct Index {
  @State length: number = 0;
  build() {
    Column({ space: 18 }) {
      Text('密码录制隐私验收').fontSize(28)
      TextInput({ placeholder: '主密码' }).id('password-primary').type(InputType.Password)
        .onChange((value: string) => { this.length = value.length; })
      TextInput({ placeholder: '辅助密码一' }).id('password-secondary-one').type(InputType.Password)
      TextInput({ placeholder: '辅助密码二' }).id('password-secondary-two').type(InputType.Password)
      Text('输入长度：' + this.length).id('password-length').fontSize(24)
    }.width('100%').height('100%').padding(30).backgroundColor('#e5eff9')
  }
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
    app: {
      bundle_name: prepared.bundle_name,
      module: prepared.module,
      ability: prepared.ability,
    },
    assert: assertion(0),
  });
  await begin("password-replay");
  await reject(
    "no_focus",
    {
      action: "text",
      window: { bundle_name: prepared.bundle_name },
      text: canaries[0],
    },
    "UI_FOCUS_AMBIGUOUS",
  );
  await reject(
    "ambiguous_selector",
    {
      action: "click",
      selector: { type: "TextInput", bundle_name: prepared.bundle_name },
    },
    "UI_TARGET_AMBIGUOUS",
  );
  await reject(
    "missing_window",
    {
      action: "text",
      window: { bundle_name: prepared.bundle_name, id: "2147483647" },
      text: canaries[0],
    },
    "UI_WINDOW_AMBIGUOUS",
  );
  await input("recorded", canaries[0]!);
  await observe("stop_recording", "ui_flow", {
    action: "record_stop",
    recording_id: recording,
    assert: assertion(canaries[0]!.length),
  });
  await owned.settle("record_saved", recording!);
  recording = undefined;
  const saved = flowSchema.parse(
    await observe("saved_flow", "ui_flow", {
      action: "read",
      project_path: project,
      id: "password-replay",
    }),
  );
  assert.equal(saved.version, 2);
  assert.deepEqual(
    saved.steps.map((step) => step.action),
    ["tap", "focusInput", "key"],
  );
  const typed = saved.steps[1]!;
  assert.equal(typed.selector?.key, "password-primary");
  assert.equal(typed.selector?.text, undefined);
  assert.ok(typed.alternates?.every((item) => item.text === undefined) ?? true);
  const variable = typed.value!.slice(2, -1);
  assert.equal(saved.variables[variable]?.secret, true);
  scan("scan_before_restart");
  await mcp.close();
  await mcp.connect();
  assert.equal(
    digest(
      await observe("flow_after_restart", "ui_flow", {
        action: "read",
        project_path: project,
        id: "password-replay",
      }),
    ),
    digest(saved),
  );
  await owned.operation("replay", "ui_flow", {
    action: "run",
    project_path: project,
    target,
    id: "password-replay",
    variables: { [variable]: canaries[1] },
  });
  await observe("replay_length", "verify_ui", {
    target,
    assert: assertion(canaries[1]!.length),
  });
  await observe("replay_masked_ui", "ui_inspect", {
    target,
    selector: { bundle_name: prepared.bundle_name },
    screenshot: true,
    limit: 100,
  });
  await begin("password-failed-assertion");
  await input("failed_recording", canaries[2]!);
  await observe("bad_assertion_stop", "ui_flow", {
    action: "record_stop",
    recording_id: recording,
    assert: { visible: selector("never-present"), timeoutMs: 1000 },
  });
  const failed = await owned.settle("failed_assertion", recording!, "failed");
  assert.equal(
    z.object({ code: z.string() }).parse(failed.error).code,
    "VERIFICATION_FAILED",
  );
  await observe("failed_recording_status", "ui_flow", {
    action: "record_status",
    recording_id: recording,
  });
  scan("scan_failure_evidence");
  await observe("cancel_failed_recording", "ui_flow", {
    action: "record_cancel",
    recording_id: recording,
  });
  recording = undefined;
  await mcp.close();
  await mcp.connect();
  scan("scan_after_restart");
  assert.equal(
    fileDigest(path.join(prepared.project_path, relative)),
    originalHash,
  );
  completed = true;
} catch (error) {
  const value = errorResult(error);
  // Defensive redaction is for the driver failure report only; product files
  // are scanned untouched and a detected leak always fails this acceptance.
  let safe = JSON.stringify(value);
  for (const canary of canaries)
    safe = safe.replaceAll(canary, "[private canary withheld]");
  results.error = JSON.parse(safe);
  console.error(safe);
} finally {
  if (recording)
    try {
      record(
        "cancel_cleanup",
        await mcp.call("ui_flow", {
          action: "record_cancel",
          recording_id: recording,
        }),
      );
    } catch (error) {
      results.cleanup_error = { code: errorResult(error).code };
    }
  try {
    await owned.close();
    closed = true;
  } catch (error) {
    results.close_error = { code: errorResult(error).code };
    await mcp.close().catch(() => {});
    await owner.close().catch(() => {});
    await owned.processes.close();
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Recording privacy MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
