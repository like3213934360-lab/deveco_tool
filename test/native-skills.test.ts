import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { SkillService, skillManageSchema } from "../src/services/skills.js";
import { SkillWorkflowService } from "../src/services/skill-workflow.js";
import { domainRecipeCall, domainRecipeCatalog, hostCapabilityNames } from "../src/services/domain-recipes.js";
import { DomainContentService } from "../src/services/domain-content.js";
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
        assert.equal(result.reference_read.file, file.path);
        assert.equal(result.files.find(item => item.path === file.path)!.read.file, file.path);
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
test("domain recipes expose source-linked methods on demand without creating guidance runs or host files", () => {
  const f = fixture(), content = new DomainContentService();
  const recipeSchema = z.object({
    id: z.enum(guidedKinds), creates_run: z.literal(false), completion_claim: z.literal("guidance_only"),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    references: z.object({ skills: z.array(z.object({ name: z.string(), uri: z.string(), files: z.array(z.object({ path: z.string(), sha256: z.string() })) })),
      knowledge: z.array(z.object({ id: z.string(), uri: z.string(), sha256: z.string() })),
      source_assets: z.array(z.object({ path: z.string(), uri: z.string(), sha256: z.string() })) }),
    host_boundary: z.object({ capability_status: z.string(), missing: z.array(z.string()), alternative: z.string().nullable() }),
  });
  try {
    const catalog = domainRecipeCatalog();
    assert.deepEqual(catalog.recipes.map(recipe => recipe.id), guidedKinds);
    assert.equal(catalog.creates_run, false);
    const names = new Set<string>();
    for (const id of guidedKinds) {
      const recipe = recipeSchema.parse(domainRecipeCall({ action: "read", id }));
      assert.equal(recipe.host_boundary.capability_status, "not_declared");
      assert.deepEqual(domainRecipeCall({ action: "read", id }), domainRecipeCall({ action: "read", id }));
      for (const skill of recipe.references.skills) {
        names.add(skill.name);
        for (const file of skill.files) {
          const read = content.read(`deveco://skill/${skill.name}/${file.path}`);
          assert.equal(read.sha256, file.sha256);
          assert.ok(read.text.length);
        }
      }
      for (const knowledge of recipe.references.knowledge) {
        const read = content.read(knowledge.uri);
        assert.equal(read.sha256, knowledge.sha256);
        assert.ok(read.text.length);
      }
      for (const source of recipe.references.source_assets)
        assert.equal(content.read(source.uri).sha256, source.sha256);
      if (id === "spec") {
        assert.equal(recipe.references.source_assets.filter(source => source.path.includes("/spec/commands/")).length, 5);
        assert.equal(recipe.references.source_assets.filter(source => source.path.includes("/spec/templates/")).length, 3);
      }
      if (["arkts", "repair", "create", "spec"].includes(id))
        assert.equal(recipe.references.knowledge[0]?.id, "arkts-grammar-standards/recipes-core");
      const missing = recipeSchema.parse(domainRecipeCall({ action: "read", id, host_capabilities: [] }));
      assert.equal(missing.host_boundary.capability_status, "missing");
      assert.ok(missing.host_boundary.missing.length);
      assert.match(missing.host_boundary.alternative!, /host or human/);
      const available = recipeSchema.parse(domainRecipeCall({ action: "read", id, host_capabilities: hostCapabilityNames }));
      assert.equal(available.host_boundary.capability_status, "declared");
      assert.deepEqual(available.host_boundary.missing, []);
    }
    assert.equal(names.size, 6);
    assert.equal(f.store.runCount(), 0);
    assert.deepEqual(fs.readdirSync(f.root), ["state"]);
    const customize = z.object({ upstream_adaptation: z.object({ equivalent_to_full_DevEco_Code_customization: z.literal(false), host_responsibilities: z.array(z.string()) }) }).parse(domainRecipeCall({ action: "read", id: "customize" }));
    assert.ok(customize.upstream_adaptation.host_responsibilities.includes("models"));
  } finally { f.close(); }
});

test("retired guidance creation never creates a destination, run, document or host configuration", () => {
  const f = fixture(), service = new SkillWorkflowService(f.store);
  try {
    const destination = path.join(f.root, "new-project");
    for (const kind of guidedKinds)
      assert.throws(() => service.call({ action: "start", kind, project_path: destination, objective: "Keep the original requested change" }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    assert.equal(fs.existsSync(destination), false);
    assert.equal(f.store.runCount(), 0);
    assert.deepEqual(service.call({ action: "list" }), []);
    assert.deepEqual(fs.readdirSync(f.root), ["state"]);
  } finally { service.close(); f.close(); }
});
