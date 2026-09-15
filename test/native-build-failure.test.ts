import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { KnowledgeService } from "../src/services/knowledge.js";
import { enrichBuildFailure } from "../src/services/build-failure.js";
import { WorkflowResponses } from "../src/services/workflow-response.js";
import { buildPreflight } from "../src/services/build-preflight.js";
import {
  SettledEffectError,
  ToolError,
  errorResult,
} from "../src/core/errors.js";
import { BuildDiagnostics } from "../src/core/build-diagnostics.js";
import { tools } from "../src/core/contracts.js";

async function fixture(
  task: (store: StateStore, knowledge: KnowledgeService) => Promise<void>,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-build-failure-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes),
    knowledge = new KnowledgeService(store, auth);
  try {
    await task(store, knowledge);
  } finally {
    knowledge.close();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("failed preflight retains coordinates and full report, with directly readable candidate cases and no second collection", async () =>
  fixture(async (store, knowledge) => {
    const run = store.create("project_build", { parameters: {} }).run,
      issue = {
        file: "/app/entry/src/main/ets/Index.ets",
        line: 17,
        column: 6,
        severity: "error",
        message: "any is forbidden (arkts-no-any-unknown)",
        rule: "arkts-no-any-unknown",
      },
      diagnostics = Array.from({ length: 50 }, (_, i) => ({
        ...issue,
        line: i + 17,
      })),
      artifact = store.artifact(
        run.id,
        JSON.stringify(diagnostics),
        "application/json",
      );
    let checks = 0;
    await assert.rejects(
      async () => {
        try {
          await buildPreflight(
            store,
            { mode: "check" },
            async () => {
              checks++;
              return {
                success: false,
                checked_file_count: 3,
                summary: { errorCount: 80, warnCount: 0 },
                diagnostics,
                truncated: true,
                artifact,
              };
            },
            () => "stable",
          );
        } catch (error) {
          const enriched = enrichBuildFailure(error, store, knowledge);
          assert.equal((enriched as ToolError).code, (error as ToolError).code);
          store.update(run.id, "failed", undefined, errorResult(enriched));
          throw enriched;
        }
      },
      { code: "BUILD_CHECK_BLOCKED" },
    );
    const result = new WorkflowResponses(
        store,
        () => "Compiler build must succeed",
      ).present(store.get(run.id)),
      diagnosis = result.error!.diagnosis!;
    assert.equal(checks, 1);
    assert.equal(diagnosis.compiler_started, false);
    assert.equal(diagnosis.compilationVerified, false);
    assert.equal(diagnosis.diagnostics[0]!.file, issue.file);
    assert.equal(diagnosis.diagnostics[0]!.line, issue.line);
    assert.equal(diagnosis.truncated, true);
    assert.deepEqual(diagnosis.report_read, {
      tool: "workflow_run",
      action: "read_artifact",
      artifact_id: artifact.artifact_id,
    });
    assert.ok(diagnosis.knowledge.references.length > 0);
    for (const item of diagnosis.knowledge.references) {
      const { tool, ...input } = item.read as {
        tool: keyof typeof tools;
        action: string;
        id: string;
      };
      assert.ok(tools[tool].schema.safeParse(input).success);
      assert.ok(knowledge.read(input.id).content.length > 0);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 16000);
    const stored = JSON.parse(store.get(run.id).error!);
    assert.equal(stored.details.diagnostics.length, 50);
    assert.equal(stored.details.diagnosis.knowledge.root_cause_verified, false);
  }));

test("native compiler failure unwraps retained command bytes while preserving its settled effect, exit code and full log", async () =>
  fixture(async (store, knowledge) => {
    const run = store.create("project_build", { parameters: {} }).run,
      log = store.artifact(run.id, "full compiler log"),
      execution = store.artifact(
        run.id,
        JSON.stringify({
          exitCode: 23,
          signal: null,
          truncated: true,
          log,
          stdout: "tail".repeat(10000),
        }),
        "application/json",
      ),
      collector = new BuildDiagnostics();
    collector.push(
      "stderr",
      Buffer.from(
        "ArkTS:ERROR File: /app/entry/src/main/ets/Index.ets:12:3\nError Message: forbidden type (arkts-no-any-unknown)\n",
      ),
    );
    const error = new SettledEffectError(
      "PROJECT_BUILD_FAILED",
      "Native compiler/build failed",
      {
        execution: { execution: { reference: execution } },
        diagnostics: collector.finish(),
      },
    );
    const enriched = enrichBuildFailure(error, store, knowledge);
    assert.ok(enriched instanceof SettledEffectError);
    store.update(run.id, "failed", undefined, errorResult(enriched));
    const result = new WorkflowResponses(store, () => "build").present(
      store.get(run.id),
    );
    assert.equal((result.error as Record<string, unknown>).exitCode, 23);
    assert.equal(result.error!.diagnosis!.compiler_started, true);
    assert.equal(result.error!.diagnosis!.diagnostics[0]!.line, 12);
    assert.equal(result.error!.diagnosis!.diagnostics[0]!.column, 3);
    assert.deepEqual(result.error!.diagnosis!.log_read, {
      tool: "workflow_run",
      action: "read_artifact",
      artifact_id: log.artifact_id,
    });
    assert.equal(result.recovery!.new_run_required, true);
  }));

test("unavailable knowledge or command receipt cannot replace a compiler error or settle an unknown effect", async () =>
  fixture(async (store, knowledge) => {
    const unavailable = {
        search: (() => {
          throw new ToolError(
            "KNOWLEDGE_DIGEST_MISMATCH",
            "changed bundled case",
          );
        }) as typeof knowledge.search,
      },
      error = new SettledEffectError("PROJECT_BUILD_FAILED", "original", {
        execution: { reference: { artifact_id: "missing", bytes: 20 } },
        diagnostics: { examples: [] },
      });
    const enriched = enrichBuildFailure(error, store, unavailable);
    assert.ok(enriched instanceof SettledEffectError);
    const details = enriched.details as {
      diagnosis: {
        knowledge_unavailable: { code: string };
        execution_unavailable: { code: string };
      };
    };
    assert.equal(
      details.diagnosis.knowledge_unavailable.code,
      "KNOWLEDGE_DIGEST_MISMATCH",
    );
    assert.ok(details.diagnosis.execution_unavailable.code);
    assert.equal(error.code, "PROJECT_BUILD_FAILED");
    const uncertain = new ToolError("EFFECT_UNCERTAIN", "recheck only", {
      cause: "lost receipt",
    });
    assert.strictEqual(
      enrichBuildFailure(uncertain, store, unavailable),
      uncertain,
    );
    assert.deepEqual(uncertain.details, { cause: "lost receipt" });
  }));
