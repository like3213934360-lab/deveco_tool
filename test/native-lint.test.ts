import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { parseLintReport } from "../src/services/lint-report.js";
import { DiagnosticService } from "../src/services/diagnostics.js";
import type { Project } from "../src/services/project.js";
import {
  ProcessService,
  type Command,
  type ProcessOptions,
} from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { CpuPool } from "../src/core/cpu-pool.js";
import { atomicWrite } from "../src/core/files.js";
import { ToolError } from "../src/core/errors.js";
import { lintInput } from "../src/services/lint-input.js";

const issue = {
  line: 3,
  column: 4,
  severity: "error",
  message: "缺陷🙂",
  rule: "fixture/rule",
};
const encode = (messages: unknown[]) =>
  JSON.stringify([{ filePath: "entry/测试.ets", messages }]);

test("linter previews retain full counts, severity distinctions and original ordering under byte and row budgets", () => {
  const content = encode([
    issue,
    ...["warn", "warning", "suggestion", "new-level"].map((severity) => ({
      ...issue,
      severity,
    })),
  ]);
  const result = parseLintReport(content, 2);
  assert.deepEqual(result.summary, {
    files_reported: 1,
    issues: 5,
    errors: 1,
    warnings: 2,
    suggestions: 1,
    other: 1,
  });
  assert.equal(result.report.length, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.report[1]?.severity, "warn");
  const huge = parseLintReport(
    encode(
      Array.from({ length: 100 }, (_, i) => ({
        ...issue,
        line: i,
        message: "测🙂".repeat(3000),
      })),
    ),
    200,
  );
  assert.equal(huge.summary.issues, 100);
  assert.ok(huge.report.length > 0 && huge.report.length < 100);
  assert.ok(Buffer.byteLength(JSON.stringify(huge.report)) <= 24 * 1024);
  assert.ok(
    huge.report.every(
      (row, i) => row.truncated && row.message.isWellFormed() && row.line === i,
    ),
  );
  assert.equal(parseLintReport("[]").truncated, false);
});

test("linter rejects malformed trailing records, unbounded inputs and unrelated historical report shapes", () => {
  for (const content of [
    "{",
    "{}",
    encode([issue, { ...issue, line: -1 }]),
    encode([issue, { ...issue, severity: 2 }]),
    '[{"path":"entry.ets","issues":[]}]',
  ])
    assert.throws(() => parseLintReport(content, 1), {
      code: "LINT_REPORT_INVALID",
    });
  assert.throws(() => parseLintReport("[]", 0), { code: "LINT_LIMIT_INVALID" });
  assert.throws(() => parseLintReport(" ".repeat(16 * 1024 * 1024 + 1)), {
    code: "LINT_REPORT_TOO_LARGE",
  });
  assert.throws(
    () =>
      parseLintReport(
        JSON.stringify([
          { filePath: "a.ets", messages: Array(60000).fill(issue) },
          { filePath: "b.ets", messages: Array(40001).fill(issue) },
        ]),
      ),
    { code: "LINT_REPORT_TOO_LARGE" },
  );
});

test("native lint uses bounded parsing, literal scope/config arguments and retained evidence; failed SDK runs cannot pass with partial findings", async (t) => {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lint-中文 空格-")),
    ),
    oldConfig = process.env.DEVECO_CONFIG,
    clt = path.join(root, "clt"),
    config = path.join(root, "config.json"),
    processes = new ProcessService(),
    store = new StateStore(path.join(root, "state")),
    cpu = new CpuPool({ workers: 1 }),
    service = new DiagnosticService(processes, store, cpu),
    commands: Command[] = [];
  const project: Project = {
    root,
    product: {
      name: "phone",
      compatibleSdkVersion: 26,
      runtimeOS: "HarmonyOS",
    },
    modules: [],
    fingerprint: "fixture",
  };
  let content: string | undefined = encode([issue]),
    exitCode = 0,
    nativeError = false;
  atomicWrite(config, JSON.stringify({ clt }));
  atomicWrite(
    path.join(root, "lint config.json5"),
    "{ files: ['**/*.ets'], rules: {} }",
  );
  atomicWrite(path.join(root, "code-linter.json5"), "{}");
  atomicWrite(
    path.join(root, "entry/测试 path;file.ets"),
    "export const value = 1;\n",
  );
  atomicWrite(
    path.join(
      clt,
      process.platform === "win32"
        ? "tool/node/node.exe"
        : "tool/node/bin/node",
    ),
    "node",
  );
  atomicWrite(path.join(clt, "codelinter/run/index.js"), "linter");
  process.env.DEVECO_CONFIG = config;
  t.mock.method(
    processes,
    "run",
    async (command: Command, options?: ProcessOptions) => {
      commands.push(command);
      if (command.executable !== "git") {
        const report = command.args[command.args.indexOf("--output") + 1];
        assert.ok(report);
        assert.equal(command.env?.TMPDIR, path.dirname(report));
        assert.equal(command.env?.TMP, path.dirname(report));
        assert.equal(command.env?.TEMP, path.dirname(report));
        assert.equal(
          command.env?.logPath,
          path.join(path.dirname(report), "codelinter.log"),
        );
        fs.writeFileSync(command.env.logPath, Buffer.alloc(70000, "n"));
        if (content !== undefined) fs.writeFileSync(report, content);
        if (nativeError) {
          options?.onOutput?.("stdout", Buffer.from("\u001b[3"));
          options?.onOutput?.("stdout", Buffer.from("1mSDK error\u001b[0m"));
          options?.onOutput?.("stdout", Buffer.alloc(400000, "x"));
        }
      }
      return {
        exitCode,
        signal: null,
        stdout: "",
        stderr: "",
        truncated: nativeError,
        elapsedMs: 1,
        pid: null,
      };
    },
  );
  try {
    for (const input of [
      { path: "absent.ets" },
      { config_path: "absent.json5" },
    ])
      await assert.rejects(
        service.lint(project, { ...input, fix: true, incremental: true }),
      );
    assert.equal(
      commands.length,
      0,
      "Invalid inputs do not launch Git or the SDK",
    );
    const result = await service.lint(project, {
      path: "entry/测试 path;file.ets",
      config_path: "lint config.json5",
      fix: true,
      incremental: true,
      limit: 1,
    });
    assert.equal(result.summary.errors, 1);
    assert.equal(result.compilationVerified, false);
    assert.equal(result.ruleCoverageVerified, false);
    assert.equal(result.native_logs[0]?.original_bytes, 70000);
    assert.equal(result.native_logs[0]?.truncated, true);
    assert.equal(
      store.readArtifact(result.native_logs[0]!.artifact.artifact_id).bytes,
      65536,
    );
    assert.equal(cpu.metrics.spawned, 0, "Small report avoids a parser thread");
    assert.equal(commands[0]?.executable, "git");
    const lint = commands[1]!;
    assert.ok(
      lint.args.includes("--fix") && lint.args.includes("--incremental"),
    );
    assert.equal(lint.args.at(-1), path.join(root, "entry/测试 path;file.ets"));
    assert.equal(
      lint.args[lint.args.indexOf("--config") + 1],
      path.join(root, "lint config.json5"),
    );
    assert.equal(lint.env?.isPlugin, "false");
    assert.equal(
      Buffer.from(
        store.readArtifact(result.artifact.artifact_id).data,
        "base64",
      ).toString(),
      content,
    );
    content = encode(Array.from({ length: 5000 }, () => issue));
    const large = await service.lint(project, { limit: 3 });
    assert.equal(large.summary.issues, 5000);
    assert.equal(large.report.length, 3);
    assert.equal(cpu.metrics.spawned, 1);
    for (const code of [1, 2, 255]) {
      exitCode = code;
      await assert.rejects(service.lint(project, {}), (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, "LINT_TOOL_FAILED");
        const details = z
          .object({
            exit_code: z.number(),
            artifact: z.object({ artifact_id: z.string() }),
          })
          .parse(error.details);
        assert.equal(details.exit_code, code);
        assert.ok(store.readArtifact(details.artifact.artifact_id).bytes > 0);
        return true;
      });
    }
    exitCode = 0;
    content = "[]";
    nativeError = true;
    await assert.rejects(service.lint(project, {}), {
      code: "LINT_TOOL_FAILED",
    });
    nativeError = false;
    content = "{";
    await assert.rejects(service.lint(project, {}), {
      code: "LINT_REPORT_INVALID",
    });
    content = undefined;
    await assert.rejects(service.lint(project, {}), {
      code: "LINT_NOT_EXECUTED",
    });
    assert.equal(
      z
        .object({ n: z.number() })
        .parse(
          store.db
            .prepare("SELECT count(*) AS n FROM native_directories")
            .get(),
        ).n,
      0,
    );
  } finally {
    await service.lsp.close();
    await cpu.close();
    await processes.close();
    store.close();
    if (oldConfig === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = oldConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("linter rejects broken configs and escaped real paths before execution without rejecting external read-only configs", async () => {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lint-input-")),
    ),
    project = path.join(root, "project"),
    config = path.join(project, "code-linter.json5");
  fs.mkdirSync(project);
  try {
    for (const text of [
      "{ invalid: [",
      "null",
      "[]",
      "{files:'*.ets'}",
      "{rules:[]}",
      "{overrides:[null]}",
      " ".repeat(1024 * 1024 + 1),
    ]) {
      atomicWrite(config, text);
      await assert.rejects(lintInput(project, {}), {
        code: "LINT_CONFIG_INVALID",
      });
    }
    atomicWrite(
      config,
      "{ rules: { 'prefer-const': ['error', {foo: true}] }, overrides: [{files:['*.ets'],rules:{}}] }",
    );
    assert.equal((await lintInput(project, {})).target, project);
    atomicWrite(path.join(root, "external.ets"), "export const value = 1;");
    await assert.rejects(lintInput(project, { path: "../external.ets" }), {
      code: "LINT_PATH_INVALID",
    });
    // Windows directory junctions do not require symlink privileges in CI.
    const external = path.join(root, "external");
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(project, "escape"), "junction");
    await assert.rejects(lintInput(project, { path: "escape" }), {
      code: "LINT_PATH_INVALID",
    });
    atomicWrite(
      path.join(root, "shared.json5"),
      "{files:['**/*.ets'], ruleSet:[]}",
    );
    assert.equal(
      (await lintInput(project, { config_path: "../shared.json5" })).config,
      path.join(root, "shared.json5"),
    );
    await assert.rejects(lintInput(project, {}, AbortSignal.abort()), {
      name: "AbortError",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
