import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DomainContentService } from "../src/services/domain-content.js";
import { readContentFile } from "../src/services/content-file.js";
import { packageRoot, resourceRoot } from "../src/core/config.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { KnowledgeService } from "../src/services/knowledge.js";
import { tools } from "../src/core/contracts.js";
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(packageRoot, file), "utf8"));

test("content catalogs are bounded and every returned Skill, knowledge, recipe and source has the exact advertised content hash", () => {
  const service = new DomainContentService();
  for (const kind of ["skill", "knowledge", "recipe", "source"] as const) {
    let offset = 0; const seen = new Set<string>();
    for (;;) {
      const page = service.catalog({ kind, offset, limit: 17 });
      assert.ok(page.entries.length <= 17);
      for (const entry of page.entries) {
        assert.equal(seen.has(entry.uri), false); seen.add(entry.uri);
        const value = service.read(entry.uri);
        const { tool, ...input } = entry.read;
        assert.ok(tools[tool as keyof typeof tools].schema.safeParse(input).success);
        assert.equal(input.uri, entry.uri);
        assert.equal(value.sha256, hash(value.text), entry.uri);
        assert.equal(value.sha256, entry.sha256, entry.uri);
        assert.equal(value.uri, entry.uri);
        if (kind === "recipe") assert.match(JSON.parse(value.text).content_sha256, /^[a-f0-9]{64}$/);
      }
      if (page.next_offset === page.total) { assert.equal(seen.size, page.total); break; }
      assert.ok(page.next_offset > offset); offset = page.next_offset;
    }
    if (kind === "knowledge") assert.equal(seen.size, 79);
    if (kind === "recipe") assert.equal(seen.size, 8);
  }
  assert.throws(() => service.catalog({ limit: 101 }));
  assert.deepEqual(service.catalog({ query: "there-is-no-such-domain-asset" }).entries, []);
  for (const uri of ["https://example.invalid/source", "deveco://source/not-found", "deveco://skill/../knowledge.json", "deveco://knowledge/docs:not-bundled-as-rule"]) assert.throws(() => service.read(uri));
});

test("knowledge Markdown and related-ID references form a closed graph, retaining all fifty migrated links and explaining the absent upstream document", async () => {
  const service = new DomainContentService(), entries = readJson("resources/knowledge.json") as { id: string; file: string; sha256: string; related_ids: string[] }[];
  const ids = new Set(entries.map((entry) => entry.id));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-knowledge-uri-")), store = new StateStore(root), processes = new ProcessService(), auth = new AuthService(store, processes), knowledge = new KnowledgeService(store, auth);
  try {
    let links = 0;
    for (const entry of entries) {
      const resource = service.read(`deveco://knowledge/${entry.id}`), tool = knowledge.read(entry.id, 0, 1024 * 1024), uriTool = knowledge.read(resource.uri, 0, 1024 * 1024);
      assert.equal(tool.content, resource.text); assert.equal(uriTool.content, tool.content); assert.equal(uriTool.uri, resource.uri);
      for (const id of entry.related_ids) assert.ok(ids.has(id), `${entry.id} -> ${id}`);
      for (const match of resource.text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        const target = match[1]!;
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        assert.ok(target.startsWith("deveco://knowledge/"), `${entry.id}: unresolved ${target}`);
        assert.ok(service.read(target).text.length > 0); links++;
      }
    }
    assert.ok(links >= 50);
    const migration = readJson("provenance/knowledge-reference-migration.json");
    assert.equal(migration.entries.filter((item: { previous: string }) => item.previous.startsWith("../assets/")).length, 50);
    assert.match(service.read("deveco://knowledge/arkts-error-fixes/decorator_state_errors").text, /上游锁定提交中缺少 state_migration\.md/);
    assert.equal(knowledge.catalog(0, 1, "docs").total, 14683);
    for (const kind of ["rules", "docs"] as const) {
      const results = knowledge.search("ArkUI", 2, kind);
      for (const entry of [...results.rules, ...results.documents]) {
        const { tool, ...input } = entry.read;
        assert.ok(tools[tool as keyof typeof tools].schema.safeParse(input).success);
        assert.ok(knowledge.read(input.id).content.length > 0);
      }
    }
  } finally { knowledge.close(); await auth.close(); await processes.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("source content covers every product Skill, SDD item, host command and classified development fixture without claiming runtime acceptance", () => {
  const service = new DomainContentService(), manifest = readJson("resources/domain-sources.json"), product = readJson("provenance/upstream-product-assets.json"), discovery = readJson("provenance/upstream-discovery.json");
  assert.equal(manifest.entries.length, discovery.assets.length);
  assert.equal(product.product_skills.length, 100);
  assert.equal(product.product_skills.filter((item: { historical_direct_mapping: boolean }) => item.historical_direct_mapping).length, 85);
  assert.equal(product.product_skills.filter((item: { historical_direct_mapping: boolean }) => !item.historical_direct_mapping).length, 15);
  for (const entry of manifest.entries) {
    const upstream = discovery.assets.find((item: { id: string }) => item.id === entry.id);
    assert.equal(entry.sha256, upstream.sha256); assert.equal(entry.path, upstream.path);
    assert.equal(entry.commit, discovery.source.commit);
    assert.ok(!/verified/.test(entry.evidence));
    if (!entry.local_file) { assert.throws(() => service.read(`deveco://source/${entry.id}`), { code: "SOURCE_NOT_BUNDLED" }); continue; }
    const content = service.read(`deveco://source/${entry.id}`);
    assert.equal(content.sha256, entry.sha256);
    if (entry.local_file.startsWith("upstream/")) assert.ok(entry.local_file.endsWith(".source.txt"));
    if ("references" in content) for (const reference of content.references) if (reference.uri) assert.equal(service.read(reference.uri).sha256, reference.sha256);
  }
  for (const entry of product.product_skills) assert.ok(service.read(entry.source_uri).text.length > 0);
  assert.equal(product.agents.length, 11); assert.equal(product.sdd.length, 8); assert.equal(product.builtin_commands.length, 3); assert.equal(product.non_product_skills.length, 4);
  assert.equal(product.non_product_skills.filter((item: { classification: string }) => item.classification === "repository-development").length, 2);
  assert.equal(product.non_product_skills.filter((item: { classification: string }) => item.classification === "test-fixture").length, 2);
});

test("all shared content paths reject traversal, links, oversized files, directories and changed bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-content-read-"));
  try {
    fs.writeFileSync(path.join(root, "plain.txt"), "original");
    assert.deepEqual(readContentFile(root, "plain.txt", hash("original")), { text: "original", sha256: hash("original") });
    assert.throws(() => readContentFile(root, "../outside"), { code: "PATH_OUTSIDE_ROOT" });
    assert.throws(() => readContentFile(root, "plain.txt", hash("changed")), { code: "CONTENT_INTEGRITY" });
    assert.throws(() => readContentFile(root, "plain.txt", undefined, 3), { code: "CONTENT_FILE_INVALID" });
    fs.mkdirSync(path.join(root, "folder"));
    assert.throws(() => readContentFile(root, "folder"), { code: "CONTENT_FILE_INVALID" });
    fs.symlinkSync(path.join(root, "plain.txt"), path.join(root, "linked.txt"));
    assert.throws(() => readContentFile(root, "linked.txt"), { code: "CONTENT_FILE_INVALID" });
    fs.symlinkSync(root, path.join(root, "linked-parent"));
    assert.throws(() => readContentFile(root, "linked-parent/plain.txt"), { code: "CONTENT_PATH_INVALID" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.ok(readContentFile(resourceRoot, "domain-sources.json", undefined, 4 * 1024 * 1024).text.length > 0);
});
