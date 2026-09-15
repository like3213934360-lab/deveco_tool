import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { PayloadCipher } from "../src/core/crypto.js";
import { digest } from "../src/core/files.js";
import { SkillWorkflowService } from "../src/services/skill-workflow.js";
import { guidedKinds, type GuidedKind } from "../src/services/skill-guidance.js";
import { StorageService } from "../src/services/storage.js";

// Seed the native-7 encrypted representation directly: retired start must never
// create a new lifecycle merely to make an archive fixture for these tests.
function legacy(store: StateStore, kind: GuidedKind = "spec", completed = false, evidence: { run_id: string; workflow: string; result_sha256: string }[] = []) {
  const run = store.create("skill_workflow", { project_path: path.dirname(store.root), kind, objective: "Keep the original request and its historical scope" }).run;
  const content = "# Original requirement\n## Acceptance\nKeep the original business requirement.\n- [ ] Implement and verify the requested behavior";
  const document = { content, content_sha256: digest(content), ...store.artifact(run.id, content, "text/markdown"), validation: ["historical"] };
  const { bytes: _bytes, mime: _mime, ...savedDocument } = document;
  const state = { project_path: path.dirname(store.root), objective: "Keep the original request and its historical scope", kind,
    revision: 7, phase: completed ? "completed" : "verifying", definition_sha256: "a".repeat(64),
    device: { target: "device-a", bundle_name: "com.example.original" },
    documents: { "spec.md": savedDocument }, transitions: [{ phase: "verifying", rationale: "Historical native evidence remains attributable to its original scope", evidence, at: Date.now() }] };
  const cipher = new PayloadCipher(path.join(store.root, "skill-workflow.key"));
  try {
    store.db.prepare("INSERT INTO skill_workflows(run_id,revision,phase,kind,payload,updated) VALUES(?,?,?,?,?,?)").run(run.id, state.revision, state.phase, kind, cipher.seal(run.id, JSON.stringify(state)), Date.now());
  } finally { cipher.close(); }
  for (const item of evidence) store.db.prepare("INSERT INTO run_dependencies(parent_run_id,run_id) VALUES(?,?)").run(run.id, item.run_id);
  store.update(run.id, completed ? "succeeded" : "needs_input", { historical: true });
  return { id: run.id, state, document: savedDocument };
}
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-legacy-guidance-")));
  const store = new StateStore(path.join(root, "state")), service = new SkillWorkflowService(store);
  return { root, store, service, close() { service.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test("all retired guidance mutations reject new execution, synthetic completion and project publication", () => {
  const f = fixture();
  try {
    for (const kind of guidedKinds) assert.throws(() => f.service.call({ action: "start", kind, project_path: path.join(f.root, "new-project"), objective: "Build the requested app" }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    assert.equal(f.store.runCount(), 0);
    const original = legacy(f.store), before = f.service.read(original.id);
    const unrelated = f.store.create("project_build", { project_path: "/different/project", target: "different-device" }).run;
    f.store.update(unrelated.id, "succeeded", { verified: true, fixture: true });
    for (const phase of ["planning", "implementing", "verifying", "completed"]) {
      assert.throws(() => f.service.call({ action: "transition", run_id: original.id, expected_revision: 7, phase, rationale: "A full document and fake native success cannot revive retired guidance", evidence_run_ids: [unrelated.id] }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    }
    assert.throws(() => f.service.call({ action: "write", run_id: original.id, expected_revision: 7, name: "tasks.md", content: "- [x] Everything passed" }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    const output = path.join(f.root, "spec.md");
    assert.throws(() => f.service.call({ action: "publish", run_id: original.id, expected_revision: 7, name: "spec.md", file: output }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    assert.deepEqual(f.service.read(original.id), before);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(path.join(f.root, "new-project")), false);
    assert.deepEqual(f.store.db.prepare("SELECT * FROM run_dependencies").all(), []);
    assert.deepEqual(f.service.call({ action: "catalog" }), { legacy: true, read_only: true, next_tool: "domain_recipe", recipes: guidedKinds });
  } finally { f.close(); }
});

test("legacy read and export preserve encrypted objectives, documents, revisions and provenance across restart", () => {
  const f = fixture();
  const original = legacy(f.store, "repair");
  f.service.close(); f.store.close();
  const store = new StateStore(path.join(f.root, "state")), service = new SkillWorkflowService(store);
  try {
    const read = service.read(original.id);
    assert.equal(read.definition_sha256, "a".repeat(64));
    assert.equal(read.objective, original.state.objective);
    assert.deepEqual(read.documents, original.state.documents);
    assert.deepEqual(read.device, original.state.device);
    assert.equal(read.read_only, true);
    assert.equal(read.verified, false);
    assert.equal(read.assessment_source, "legacy_guidance_archive");
    assert.equal(read.migration.next_tool, "domain_recipe");
    assert.equal(Object.hasOwn(read, "guidance"), false);
    assert.equal(z.array(z.object({ run_id: z.string(), revision: z.number() })).parse(service.call({ action: "list" }))[0]?.revision, 7);
    const exported = z.object({ verified: z.literal(false), archive: z.object({ artifact_id: z.string() }) }).parse(service.call({ action: "export", run_id: original.id }));
    const artifact = store.readArtifact(exported.archive.artifact_id);
    assert.deepEqual(JSON.parse(Buffer.from(artifact.data, "base64").toString()), { format: 1, ...read });
    const encrypted = z.object({ payload: z.string() }).parse(store.db.prepare("SELECT payload FROM skill_workflows WHERE run_id=?").get(original.id)).payload;
    assert.equal(encrypted.includes(original.state.objective), false);
    assert.equal(encrypted.includes(original.document.content), false);
  } finally { service.close(); store.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("archive requires the current revision and an unowned unpinned run; cancellation never claims native success", () => {
  const f = fixture();
  try {
    const original = legacy(f.store, "debug"), before = f.service.read(original.id);
    assert.throws(() => f.service.call({ action: "archive", run_id: original.id, expected_revision: 6 }), { code: "SKILL_WORKFLOW_REVISION_CONFLICT" });
    f.store.claim(original.id);
    assert.throws(() => f.service.call({ action: "archive", run_id: original.id, expected_revision: 7 }), { code: "RUN_BUSY" });
    f.store.update(original.id, "needs_input");
    const pin = randomUUID();
    f.store.db.prepare("INSERT INTO run_pins VALUES(?,?,?,?,?)").run(pin, original.id, f.store.owner, "export", Date.now());
    assert.throws(() => f.service.call({ action: "archive", run_id: original.id, expected_revision: 7 }), { code: "RUN_BUSY" });
    f.store.db.prepare("DELETE FROM run_pins WHERE id=?").run(pin);
    const archived = z.object({ phase: z.literal("cancelled"), revision: z.literal(8), verified: z.literal(false) }).parse(f.service.call({ action: "archive", run_id: original.id, expected_revision: 7 }));
    assert.equal(f.store.get(original.id).status, "cancelled");
    assert.deepEqual(f.service.read(original.id).documents, before.documents);
    assert.equal(f.service.read(original.id).objective, before.objective);
    assert.equal(f.service.read(original.id).transitions.length, before.transitions.length + 1);
    assert.equal(archived.verified, false);
    assert.throws(() => f.service.call({ action: "archive", run_id: original.id, expected_revision: 7 }), { code: "SKILL_WORKFLOW_REVISION_CONFLICT" });
    const unchanged = f.service.read(original.id);
    assert.deepEqual(f.service.call({ action: "archive", run_id: original.id, expected_revision: 8 }), unchanged);
    const compatibility = legacy(f.store, "plan");
    f.service.call({ action: "transition", run_id: compatibility.id, expected_revision: 7, phase: "cancelled", rationale: "Archive the old plan without replacing its original requirements" });
    assert.equal(f.service.read(compatibility.id).phase, "cancelled");
  } finally { f.close(); }
});

test("historical completed guidance remains readable but is never promoted to current verification", () => {
  const f = fixture();
  try {
    for (const kind of guidedKinds) {
      const original = legacy(f.store, kind, true), before = f.service.read(original.id);
      assert.equal(before.phase, "completed");
      assert.equal(before.verified, false);
      assert.match(before.completion_meaning, /not proof/);
      assert.deepEqual(f.service.call({ action: "archive", run_id: original.id, expected_revision: 7 }), before);
      assert.equal(f.store.get(original.id).status, "succeeded");
    }
  } finally { f.close(); }
});

test("legacy native evidence survives archive, stale cleanup, retention and restart and is included in export", async () => {
  const f = fixture();
  let store = f.store, service = f.service;
  try {
    const native = store.create("project_build", { project_path: f.root }).run;
    const artifact = store.artifact(native.id, "native build receipt", "text/plain");
    store.update(native.id, "succeeded", { artifact_id: artifact.artifact_id });
    const storage = new StorageService(store), oldPlan = storage.plan([native.id]);
    const original = legacy(store, "repair", false, [{ run_id: native.id, workflow: "project_build", result_sha256: digest(store.get(native.id).result) }]);
    assert.throws(() => storage.apply([native.id], oldPlan.plan_hash), { code: "RUN_PROTECTED" });
    assert.throws(() => store.discardArtifacts(native.id, [artifact.artifact_id]), { code: "RUN_REFERENCED" });
    service.call({ action: "archive", run_id: original.id, expected_revision: 7 });
    store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(native.id);
    store.prune();
    assert.equal(store.get(native.id).status, "succeeded");
    service.close(); store.close();
    store = new StateStore(path.join(f.root, "state")); service = new SkillWorkflowService(store);
    assert.equal(service.read(original.id).transitions[0]!.evidence[0]!.run_id, native.id);
    const reopened = new StorageService(store);
    assert.throws(() => reopened.plan([native.id]), { code: "RUN_PROTECTED" });
    const receipt = await reopened.export([original.id], path.join(f.root, "export"));
    assert.deepEqual(receipt.run_ids, [original.id, native.id].sort());
    const manifest = JSON.parse(fs.readFileSync(path.join(f.root, "export/manifest.json"), "utf8"));
    assert.deepEqual(manifest.dependencies, [{ parent_run_id: original.id, run_id: native.id }]);
    assert.equal(fs.readFileSync(path.join(f.root, "export", artifact.artifact_id), "utf8"), "native build receipt");
    assert.equal(fs.readFileSync(path.join(f.root, "export", original.document.artifact_id), "utf8"), original.document.content);
    reopened.apply([original.id], reopened.plan([original.id]).plan_hash);
    assert.throws(() => service.read(original.id), { code: "SKILL_WORKFLOW_NOT_FOUND" });
    reopened.apply([native.id], reopened.plan([native.id]).plan_hash);
    assert.deepEqual(store.db.prepare("SELECT COUNT(*) AS count FROM run_dependencies").get(), { count: 0 });
    assert.equal(fs.existsSync(path.join(f.root, "export", artifact.artifact_id)), true);
  } finally { service.close(); store.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});
