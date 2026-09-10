import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { SkillService, skillManageSchema } from "../src/services/skills.js";
import { SkillWorkflowService } from "../src/services/skill-workflow.js";
import { guidedKinds } from "../src/services/skill-guidance.js";
import { resourceRoot } from "../src/core/config.js";
import { z } from "zod";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-builtin-skills-")),
    store = new StateStore(path.join(root, "state"));
  return {
    root,
    store,
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("all bundled Skills and their references are served through MCP without a client directory or installer", () => {
  const f = fixture(),
    service = new SkillService(f.store);
  try {
    const catalog = z
      .object({
        skills: z.array(
          z.object({
            name: z.string(),
            files: z.array(z.object({ path: z.string() })),
            package_sha256: z.string(),
          }),
        ),
      })
      .parse(service.call({ action: "catalog" }));
    assert.equal(catalog.skills.length, 6);
    for (const skill of catalog.skills)
      for (const file of skill.files) {
        const result = service.read(skill.name, file.path);
        assert.equal(result.package_sha256, skill.package_sha256);
        assert.equal(result.delivery, "mcp");
        assert.equal(result.client_installation_required, false);
        assert.ok(result.content.length);
        assert.equal(result.reference_read.tool, "skill_manage");
      }
    assert.ok(
      z
        .object({ total: z.number() })
        .parse(service.call({ action: "catalog", query: "ArkTS" })).total > 0,
    );
    for (const action of ["install", "installed", "uninstall"]) {
      assert.equal(
        skillManageSchema.safeParse({
          action,
          name: catalog.skills[0]!.name,
          directory: path.join(f.root, ".agents/skills"),
        }).success,
        false,
      );
      assert.throws(() => service.call({ action }));
    }
    assert.deepEqual(fs.readdirSync(f.root), ["state"]);
  } finally {
    f.close();
  }
});
test("bundled Skill reads reject traversal, unlisted references, changed bytes and symbolic links", () => {
  const f = fixture(),
    resources = path.join(f.root, "resources");
  fs.mkdirSync(resources);
  fs.copyFileSync(
    path.join(resourceRoot, "skills.json"),
    path.join(resources, "skills.json"),
  );
  fs.cpSync(path.join(resourceRoot, "skills"), path.join(resources, "skills"), {
    recursive: true,
  });
  const service = new SkillService(f.store, resources);
  try {
    assert.throws(() =>
      service.call({
        action: "read",
        name: "deveco-arkts-standards",
        file: "../skills.json",
      }),
    );
    assert.throws(() => service.read("deveco-arkts-standards", "unlisted.md"), {
      code: "SKILL_FILE_NOT_FOUND",
    });
    const file = path.join(resources, "skills/deveco-arkts-standards/SKILL.md");
    fs.appendFileSync(file, "\nChanged");
    assert.throws(() => service.read("deveco-arkts-standards"), {
      code: "SKILL_INTEGRITY",
    });
    fs.unlinkSync(file);
    fs.symlinkSync(
      path.join(resourceRoot, "skills/deveco-arkts-standards/SKILL.md"),
      file,
    );
    assert.throws(() => service.read("deveco-arkts-standards"), {
      code: "SKILL_FILE_INVALID",
    });
  } finally {
    f.close();
  }
});
test("builtin workflows supply full Skill content and knowledge, pin their definitions and recover after database reopen without a client loader", () => {
  const f = fixture();
  let service = new SkillWorkflowService(f.store);
  const saved: { id: string; digest: string; names: string[] }[] = [];
  try {
    for (const kind of guidedKinds) {
      const state = service.call({
        action: "start",
        kind,
        project_path: f.root,
        objective: `Execute ${kind} using builtin MCP instructions`,
        ...(kind === "ui_test"
          ? {
              device: {
                target: "test-device",
                bundle_name: "com.example.test",
              },
            }
          : {}),
      }) as ReturnType<SkillWorkflowService["read"]>;
      assert.equal(state.definition_current, true);
      assert.equal(state.guidance.delivery, "builtin_mcp");
      assert.equal(state.guidance.client_skill_installation, false);
      assert.ok(
        state.guidance.skills?.every((skill) =>
          skill.content.startsWith("---\nname:"),
        ),
      );
      saved.push({
        id: state.run_id,
        digest: state.definition_sha256,
        names: state.guidance.skills!.map((skill) => skill.name),
      });
      if (["arkts", "repair", "create", "spec"].includes(kind)) {
        assert.equal(
          state.guidance.knowledge?.[0]?.id,
          "arkts-grammar-standards/recipes-core",
        );
        assert.ok(state.guidance.knowledge![0]!.content.length);
      }
    }
    assert.equal(new Set(saved.flatMap((item) => item.names)).size, 6);
    service.close();
    f.store.close();
    const reopened = new StateStore(path.join(f.root, "state"));
    service = new SkillWorkflowService(reopened);
    try {
      for (const item of saved) {
        const state = service.read(item.id);
        assert.equal(state.definition_sha256, item.digest);
        assert.deepEqual(
          state.guidance.skills?.map((skill) => skill.name),
          item.names,
        );
      }
    } finally {
      service.close();
      reopened.close();
    }
    assert.deepEqual(fs.readdirSync(f.root), ["state"]);
  } finally {
    if (f.store.db.open) {
      service.close();
      f.store.close();
    }
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("project creation accepts a new destination and a changed bundled definition blocks continuation but allows cancellation", () => {
  const f = fixture(),
    resources = path.join(f.root, "resources");
  fs.mkdirSync(resources);
  fs.copyFileSync(
    path.join(resourceRoot, "skills.json"),
    path.join(resources, "skills.json"),
  );
  fs.cpSync(path.join(resourceRoot, "skills"), path.join(resources, "skills"), {
    recursive: true,
  });
  let service = new SkillWorkflowService(f.store);
  try {
    const destination = path.join(f.root, "new-project");
    const created = service.call({
      action: "start",
      kind: "create",
      project_path: destination,
      objective: "Create an SDK project at the captured new destination",
    }) as ReturnType<SkillWorkflowService["read"]>;
    assert.equal(
      created.project_path,
      path.join(fs.realpathSync.native(f.root), "new-project"),
    );
    assert.equal(fs.existsSync(destination), false);
    const planned = service.call({
      action: "start",
      kind: "plan",
      project_path: f.root,
      objective: "Recover with the exact bundled workflow definition",
    }) as ReturnType<SkillWorkflowService["read"]>;
    service.close();
    const catalogFile = path.join(resources, "skills.json"),
      catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    catalog.skills.find(
      (item: { name: string }) => item.name === "deveco-native-tools",
    ).version = "changed-release";
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    service = new SkillWorkflowService(
      f.store,
      new SkillService(f.store, resources),
    );
    const changed = service.read(planned.run_id);
    assert.equal(changed.definition_current, false);
    assert.equal(changed.guidance.blocked, "SKILL_WORKFLOW_DEFINITION_CHANGED");
    assert.deepEqual(changed.guidance.skills, []);
    assert.throws(
      () =>
        service.call({
          action: "write",
          run_id: planned.run_id,
          expected_revision: 1,
          name: "notes.md",
          content: "Continue with different packaged instructions",
        }),
      { code: "SKILL_WORKFLOW_DEFINITION_CHANGED" },
    );
    service.call({
      action: "transition",
      run_id: planned.run_id,
      expected_revision: 1,
      phase: "cancelled",
      rationale:
        "Start a fresh workflow after the packaged definition changed.",
    });
    assert.equal(f.store.get(planned.run_id).status, "cancelled");
  } finally {
    service.close();
    f.close();
  }
});
