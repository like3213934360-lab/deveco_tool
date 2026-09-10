import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { SkillWorkflowService } from "../src/services/skill-workflow.js";
import { fileDigest } from "../src/core/files.js";
import { StorageService } from "../src/services/storage.js";
const result = z.object({
  run_id: z.string(),
  revision: z.number(),
  phase: z.string(),
  verified: z.literal(false),
});
test("debug exit requires a native reproduction result and customization never claims a host mode or verified app change", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-builtin-debug-")),
    store = new StateStore(path.join(root, "state")),
    service = new SkillWorkflowService(store);
  try {
    for (const scenario of ["debug", "debug_flow", "customize"] as const) {
      const kind = scenario === "debug_flow" ? "debug" : scenario;
      const { run_id: id } = result.parse(
        service.call({
          action: "start",
          kind,
          project_path: root,
          objective: "Record the requested investigation or host customization",
          device: { target: "test-device", bundle_name: "com.example.test" },
        }),
      );
      service.call({
        action: "write",
        run_id: id,
        expected_revision: 1,
        name: "notes.md",
        content:
          "Original objective, observed result, minimal changes, verification and rollback are recorded here.",
      });
      const transition = (phase: string, evidence_run_ids: string[] = []) =>
        service.call({
          action: "transition",
          run_id: id,
          expected_revision: service.read(id).revision,
          phase,
          evidence_run_ids,
          rationale:
            "The native result was reviewed against this investigation's original objective.",
        });
      transition("implementing");
      transition("verifying");
      const evidence =
        scenario === "debug_flow"
          ? store.create("ui_flow", {
              project_path: fs.realpathSync.native(root),
              target: "test-device",
              parameters: { kind: "flow", variables: {} },
              flow: {
                app: {
                  bundleName: "com.example.test",
                  module: "entry",
                  ability: "EntryAbility",
                },
              },
            }).run
          : store.create("ui_test", {
              target: "test-device",
              app: { bundle_name: "com.example.test" },
            }).run;
      store.update(evidence.id, "succeeded", { verified: true, fixture: true });
      if (kind === "debug")
        assert.throws(() => transition("completed"), {
          code: "SKILL_WORKFLOW_EVIDENCE_REQUIRED",
        });
      transition("completed", kind === "debug" ? [evidence.id] : []);
      assert.equal(service.read(id).phase, "completed");
      assert.equal(service.read(id).verified, false);
      assert.equal(service.read(id).guidance.delivery, "builtin_mcp");
    }
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("builtin plans preserve revisions and project scope, publish without overwrite and survive service restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-builtin-plan-")),
    store = new StateStore(path.join(root, "state"));
  let service = new SkillWorkflowService(store);
  try {
    const request = {
      action: "start",
      kind: "plan",
      project_path: root,
      objective: "Implement a scoped feature",
      request_key: "plan-request",
    };
    const initial = result.parse(service.call(request));
    assert.equal(result.parse(service.call(request)).run_id, initial.run_id);
    const write = {
      action: "write",
      run_id: initial.run_id,
      expected_revision: initial.revision,
      name: "plan.md",
      content:
        "# Feature\n## Technical Context\nArkUI native project\n## Project Structure\nentry contains the page",
    };
    const changed = result.parse(service.call(write));
    assert.throws(() => service.call(write), {
      code: "SKILL_WORKFLOW_REVISION_CONFLICT",
    });
    const file = path.join(root, "plan.md"),
      published = z.object({ content_sha256: z.string() }).parse(
        service.call({
          action: "publish",
          run_id: initial.run_id,
          expected_revision: changed.revision,
          name: "plan.md",
          file,
        }),
      );
    assert.equal(fileDigest(file), published.content_sha256);
    assert.throws(() =>
      service.call({
        action: "publish",
        run_id: initial.run_id,
        expected_revision: changed.revision,
        name: "plan.md",
        file,
      }),
    );
    service.close();
    service = new SkillWorkflowService(store);
    assert.equal(
      service.read(initial.run_id).documents["plan.md"]!.content,
      write.content,
    );
    const transition = (phase: string) =>
      service.call({
        action: "transition",
        run_id: initial.run_id,
        expected_revision: service.read(initial.run_id).revision,
        phase,
        rationale:
          "The original user request authorizes this implementation and its validation.",
      });
    transition("implementing");
    transition("verifying");
    const complete = result.parse(transition("completed"));
    assert.equal(complete.verified, false);
    assert.equal(store.get(initial.run_id).status, "succeeded");
    const storage = new StorageService(store),
      plan = storage.plan([initial.run_id]);
    storage.apply([initial.run_id], plan.plan_hash);
    assert.throws(() => service.read(initial.run_id), {
      code: "SKILL_WORKFLOW_NOT_FOUND",
    });
    assert.equal(fileDigest(file), published.content_sha256);
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("spec completion requires native evidence while incomplete specifications cannot enter implementation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-builtin-spec-")),
    store = new StateStore(path.join(root, "state")),
    service = new SkillWorkflowService(store);
  try {
    const initial = result.parse(
        service.call({
          action: "start",
          kind: "spec",
          project_path: root,
          objective: "Make a verifiable feature",
        }),
      ),
      id = initial.run_id;
    const write = (name: string, content: string) =>
      service.call({
        action: "write",
        run_id: id,
        expected_revision: service.read(id).revision,
        name,
        content,
      });
    const phase = (phase: string, evidence_run_ids: string[] = []) =>
      service.call({
        action: "transition",
        run_id: id,
        expected_revision: service.read(id).revision,
        phase,
        evidence_run_ids,
        rationale:
          "Review the original feature against the captured native result.",
      });
    write(
      "spec.md",
      "# 功能规格\n## 需求\n显示已完成\n## 用户场景\n点击后显示\n## 验收标准\n控件断言通过",
    );
    assert.throws(() => phase("implementing"), {
      code: "SKILL_WORKFLOW_SPEC_INCOMPLETE",
    });
    write("plan.md", "# Plan\n## 技术背景\nArkUI\n## 项目结构\nentry");
    write("tasks.md", "- [ ] Implement and verify the feature");
    phase("implementing");
    phase("verifying");
    assert.throws(() => phase("completed"), {
      code: "SKILL_WORKFLOW_EVIDENCE_REQUIRED",
    });
    const native = store.create("project_build", {
      project_path: fs.realpathSync.native(root),
    }).run;
    store.update(native.id, "failed");
    assert.throws(() => phase("completed", [native.id]), {
      code: "SKILL_WORKFLOW_EVIDENCE_INCOMPLETE",
    });
    store.claim(native.id);
    store.update(native.id, "succeeded", { verified: true, fixture: true });
    assert.throws(() => phase("completed", [native.id]), {
      code: "SKILL_WORKFLOW_TASKS_INCOMPLETE",
    });
    write("tasks.md", "- [x] Implement and verify the feature");
    phase("completed", [native.id]);
    const completed = service.read(id);
    assert.equal(completed.phase, "completed");
    assert.equal(completed.guidance.delivery, "builtin_mcp");
    assert.equal(completed.verified, false);
    assert.equal(completed.transitions.at(-1)!.evidence[0]!.run_id, native.id);
    assert.throws(() => write("notes.md", "replace completed evidence"), {
      code: "SKILL_WORKFLOW_SETTLED",
    });
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("builtin completion rejects unrelated projects, devices and evidence predating the latest implementation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-builtin-scope-")),
    project = fs.realpathSync.native(root),
    store = new StateStore(path.join(root, "state")),
    service = new SkillWorkflowService(store);
  try {
    for (const kind of ["repair", "ui_test"] as const) {
      const initial = service.call({
        action: "start",
        kind,
        project_path: project,
        objective: "Verify only the original project and application",
        ...(kind === "ui_test"
          ? {
              device: {
                target: "device-a",
                bundle_name: "com.example.original",
              },
            }
          : {}),
      }) as ReturnType<SkillWorkflowService["read"]>;
      const id = initial.run_id;
      service.call({
        action: "write",
        run_id: id,
        expected_revision: 1,
        name: "notes.md",
        content: "Implement and verify the captured original requirement.",
      });
      const phase = (phase: string, evidence_run_ids: string[] = []) =>
        service.call({
          action: "transition",
          run_id: id,
          expected_revision: service.read(id).revision,
          phase,
          evidence_run_ids,
          rationale:
            "Compare native observations with the original fixed acceptance criteria.",
        });
      phase("implementing");
      phase("verifying");
      const workflow = kind === "repair" ? "project_build" : "ui_test";
      const matching =
        kind === "repair"
          ? { project_path: project }
          : {
              target: "device-a",
              app: { bundle_name: "com.example.original" },
            };
      const completeNative = (input: unknown) => {
        const run = store.create(workflow, input).run;
        store.update(run.id, "succeeded", { verified: true, fixture: true });
        return run.id;
      };
      const badInputs =
        kind === "repair"
          ? [{ project_path: path.join(project, "other") }, {}]
          : [
              {
                target: "device-b",
                app: { bundle_name: "com.example.original" },
              },
              { target: "device-a", app: { bundle_name: "com.example.other" } },
              {},
            ];
      for (const input of badInputs) {
        assert.throws(() => phase("completed", [completeNative(input)]), {
          code: "SKILL_WORKFLOW_EVIDENCE_SCOPE_MISMATCH",
        });
        assert.equal(service.read(id).phase, "verifying");
      }
      const stale = completeNative(matching);
      store.db
        .prepare("UPDATE runs SET created=? WHERE id=?")
        .run(store.get(id).created - 1, stale);
      assert.throws(() => phase("completed", [stale]), {
        code: "SKILL_WORKFLOW_EVIDENCE_STALE",
      });
      const current = completeNative(matching);
      phase("completed", [current]);
      assert.equal(service.read(id).phase, "completed");
      assert.deepEqual(
        store.db
          .prepare("SELECT run_id FROM run_dependencies WHERE parent_run_id=?")
          .all(id),
        [{ run_id: current }],
      );
    }
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("referenced native evidence survives cleanup, retention and restart and is included in a parent export", async () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-builtin-evidence-"),
    ),
    project = fs.realpathSync.native(root);
  let store = new StateStore(path.join(root, "state")),
    service = new SkillWorkflowService(store);
  try {
    const initial = service.call({
        action: "start",
        kind: "repair",
        project_path: project,
        objective:
          "Retain the actual native result throughout the workflow lifetime",
      }) as ReturnType<SkillWorkflowService["read"]>,
      id = initial.run_id;
    service.call({
      action: "write",
      run_id: id,
      expected_revision: 1,
      name: "notes.md",
      content: "Repair, then run a fresh build and retain its evidence.",
    });
    const phase = (phase: string, evidence_run_ids: string[] = []) =>
      service.call({
        action: "transition",
        run_id: id,
        expected_revision: service.read(id).revision,
        phase,
        evidence_run_ids,
        rationale:
          "The native result is reviewed against the original repair requirement.",
      });
    phase("implementing");
    const native = store.create("project_build", { project_path: project }).run;
    const artifact = store.artifact(
      native.id,
      "native build receipt",
      "text/plain",
    );
    store.update(native.id, "succeeded", { artifact_id: artifact.artifact_id });
    const storage = new StorageService(store),
      oldPlan = storage.plan([native.id]);
    phase("verifying", [native.id]);
    assert.throws(() => storage.apply([native.id], oldPlan.plan_hash), {
      code: "RUN_PROTECTED",
    });
    assert.throws(
      () => store.discardArtifacts(native.id, [artifact.artifact_id]),
      { code: "RUN_REFERENCED" },
    );
    phase("completed", [native.id]);
    store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(native.id);
    store.prune();
    assert.equal(store.get(native.id).status, "succeeded");
    service.close();
    store.close();
    store = new StateStore(path.join(root, "state"));
    service = new SkillWorkflowService(store);
    const reopened = new StorageService(store);
    assert.throws(() => reopened.plan([native.id]), { code: "RUN_PROTECTED" });
    const receipt = await reopened.export([id], path.join(root, "export"));
    assert.deepEqual(receipt.run_ids, [id, native.id].sort());
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "export/manifest.json"), "utf8"),
    );
    assert.deepEqual(manifest.dependencies, [
      { parent_run_id: id, run_id: native.id },
    ]);
    assert.equal(
      fs.readFileSync(path.join(root, "export", artifact.artifact_id), "utf8"),
      "native build receipt",
    );
    reopened.apply([id], reopened.plan([id]).plan_hash);
    reopened.apply([native.id], reopened.plan([native.id]).plan_hash);
    assert.deepEqual(
      store.db.prepare("SELECT COUNT(*) AS count FROM run_dependencies").get(),
      { count: 0 },
    );
    assert.equal(
      fs.existsSync(path.join(root, "export", artifact.artifact_id)),
      true,
    );
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
