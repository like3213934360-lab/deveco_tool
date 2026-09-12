import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";
import { validateSoak } from "./lib/soak-gate.js";
import { SoakMixedLoad } from "./lib/soak-mixed-load.js";

const [root, preparedFile, preflight] = z
  .tuple([z.string(), z.string(), z.literal("--preflight").optional()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Retain prior evidence and choose a new directory",
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
const mcp = new AcceptanceMcp(root, "mixed-soak-preparation"),
  owner = new AcceptanceMcp(ownerRoot, "mixed-soak-emulator-owner");
const tested = evidenceIdentity(),
  results: Record<string, unknown> = {},
  file = path.join(root, "evidence.json");
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope: preflight
          ? "Functional preflight of one mixed SDK/watch/recording/replay/recovery/log workload round on an owned emulator. This short run is not a one-hour soak and cannot satisfy the release soak gate."
          : "One-hour mixed public MCP SDK/LSP/UI/watch/recording/log/recovery workload, then six-minute idle reclamation, on a copied signed canary and independently owned emulator. Original fixture is never edited. This wrapper records ownership and cleanup; soak/evidence.json contains the measured runtime report.",
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
const project = path.join(root, "application"),
  relative = path.join(prepared.module, "src/main/ets/pages/Index.ets");
const originalHash = fileDigest(path.join(prepared.project_path, relative)),
  original = fs.readFileSync(
    path.join(prepared.project_path, relative),
    "utf8",
  );
assert.equal(original.split("确认输入").length, 2);
assert.ok(original.includes("struct Index {"));
let completed = false,
  closed = false;
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
  assert.equal(/aboutToAppear|aboutToDisappear|MCPSOAK:/.test(original), false);
  const source =
    `import { hilog } from '@kit.PerformanceAnalysisKit';\nimport { process } from '@kit.ArkTS';\n` +
    original.replace(".id('mcp-input')", ".id('mcp-input').customKeyboard(this.testKeyboard)").replace(
      "struct Index {",
      `struct Index {
  @Builder testKeyboard() { Column() { Text('测试输入由原生 UI 自动化提供') }.height(48).width('100%') }
  private pulse: number = -1;
  private sequence: number = 0;
  aboutToAppear(): void {
    this.pulse = setInterval(() => {
      this.sequence++;
      hilog.info(0x1234, 'MCPSoak', 'MCPSOAK:%{public}d:%{public}d:中文🙂', process.pid, this.sequence);
    }, 500);
  }
  aboutToDisappear(): void { clearInterval(this.pulse); }
`,
    );
  atomicWrite(path.join(project, relative), source);
  const target = await owned.start();
  const preparation = {
    target,
    project_path: project,
    instance_name: owned.name,
    build_profile_sha256: fileDigest(path.join(project, "build-profile.json5")),
    source_sha256: fileDigest(path.join(project, relative)),
    original_source_sha256: originalHash,
    source_prepared_file: preparedFile,
    provenance:
      "Copied existing signed canary profile, verified exact file bytes; no new configure or authentication transaction is claimed. The owned input uses an app-provided keyboard so a fresh emulator does not open the unrelated input method privacy agreement. Native current-focus input still operates on the real editable field; this fixture does not verify system-keyboard onboarding.",
  };
  record("preparation", preparation);
  atomicWrite(
    path.join(root, "prepared.json"),
    JSON.stringify({ ...prepared, project_path: project }),
  );
  atomicWrite(path.join(root, "preparation.json"), JSON.stringify(preparation));
  if (preflight) {
    const app = {
      bundle_name: prepared.bundle_name,
      module: prepared.module,
      ability: prepared.ability,
    };
    await owned.operation("preflight_watch_start", "hot_reload", {
      action: "start",
      project_path: project,
      target,
      modules: [prepared.module],
      app,
    });
    atomicWrite(
      path.join(project, relative),
      source.replace("确认输入", "混合预检补丁"),
    );
    const patch = await owned.operation("preflight_patch", "hot_reload", {
      action: "apply",
      project_path: project,
      target,
      files: [path.join(project, relative)],
    });
    z.object({
      applied: z.literal(true),
      processPreserved: z.literal(true),
    }).parse(await owned.output(patch.result, "execute_native_operation"));
    const started = performance.now();
    const mixed = new SoakMixedLoad(
      root,
      target,
      project,
      app,
      (name, input) => mcp.call(name, input),
      () => performance.now() - started,
    );
    try {
      await mixed.recordReplayRecover();
      await mixed.startLogs();
      const line = source
        .split("\n")
        .findIndex((value) => value.includes("Text(this.message)"));
      for (let index = 0; index < 6; index++) {
        record(
          `preflight_lsp_${index}`,
          await mcp.call("lsp", {
            action: "hover",
            project_path: project,
            file: path.join(project, relative),
            line,
            character: source.split("\n")[line]!.indexOf("message") + 1,
          }),
        );
        record(
          `preflight_ui_${index}`,
          await mcp.call("ui_snapshot", { target, mode: "tree" }),
        );
        await delay(5000);
      }
      await mixed.finishLogs();
      record("mixed_preflight", {
        rounds: mixed.rounds,
        log_sessions: mixed.logSessions,
      });
    } finally {
      await mixed.cancel();
    }
    await mcp.call("hot_reload", { action: "stop", project_path: project });
    assert.equal(
      fs.readFileSync(path.join(project, relative), "utf8"),
      source.replace("确认输入", "混合预检补丁"),
    );
    atomicWrite(path.join(project, relative), source);
  } else {
    await mcp.close();
    const childFile = fileURLToPath(
      new URL("./native-sdk-soak.js", import.meta.url),
    );
    const args = [childFile, path.join(root, "soak"), "3600", root, target];
    record("child", {
      command: process.execPath,
      args,
      started_at: new Date().toISOString(),
    });
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(path.dirname(childFile)),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = (chunk: Buffer) => {
      fs.appendFileSync(path.join(root, "driver.log"), chunk, { mode: 0o600 });
      process.stdout.write(chunk);
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 90 * 60 * 1000);
    let exit: { code: number | null; signal: NodeJS.Signals | null };
    try {
      exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } finally {
      clearTimeout(timeout);
    }
    record("child_exit", exit);
    assert.equal(
      exit.code,
      0,
      "Retain the failed soak report; do not publish an incomplete run",
    );
    const reportFile = path.join(root, "soak/evidence.json");
    validateSoak(JSON.parse(fs.readFileSync(reportFile, "utf8")), {
      requireMixed: true,
    });
    record("soak", {
      file: "soak/evidence.json",
      sha256: fileDigest(reportFile),
    });
  }
  assert.equal(
    fileDigest(path.join(project, relative)),
    preparation.source_sha256,
    "Soak must restore its owned source",
  );
  completed = true;
} catch (error) {
  record("error", errorResult(error));
} finally {
  try {
    await owned.close();
    assert.equal(
      fileDigest(path.join(prepared.project_path, relative)),
      originalHash,
    );
    closed = true;
  } catch (error) {
    record("cleanup_error", errorResult(error));
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Mixed soak ownership acceptance: ${passed ? "passed" : "failed"}`,
  );
}
