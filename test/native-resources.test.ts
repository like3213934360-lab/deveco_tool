import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { verifyResources } from "../scripts/lib/resources.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { KnowledgeService } from "../src/services/knowledge.js";
import { docCatalogNames } from "../src/core/doc-catalog.js";
import { tools } from "../src/core/contracts.js";
test("local document lookup opens release resources without extracting a per-version database into user state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-docs-"));
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes),
    knowledge = new KnowledgeService(store, auth);
  try {
    const before = fs.readdirSync(root);
    const docs = knowledge.catalog(0, 2, "docs");
    assert.ok(docs.total > 2);
    assert.equal(docs.entries.length, 2);
    const content = knowledge.read(docs.entries[0]!.id, 0, 200);
    assert.ok(content.content.length > 0 && content.content.length <= 200);
    assert.deepEqual(fs.readdirSync(root), before);
    assert.equal(fs.existsSync(path.join(root, "docs")), false);
    assert.ok(docs.catalogs);
    assert.deepEqual(
      docs.catalogs.map((catalog) => catalog.name),
      docCatalogNames,
    );
    assert.equal(
      docs.catalogs.reduce((sum, catalog) => sum + catalog.total, 0),
      docs.total,
    );
    for (const catalog of docCatalogNames) {
      const first = knowledge.catalog(0, 4, "docs", catalog),
        second = knowledge.catalog(2, 2, "docs", catalog);
      assert.deepEqual(first.entries.slice(2), second.entries);
      assert.equal(
        first.total,
        docs.catalogs.find((item) => item.name === catalog)!.total,
      );
      assert.ok(
        first.entries.every(
          (entry) => "catalog" in entry && entry.catalog === catalog,
        ),
      );
      const empty = knowledge.catalog(first.total, 2, "docs", catalog);
      assert.deepEqual(empty.entries, []);
      assert.equal(empty.next_offset, first.total);
      const document = first.entries[0]!;
      const full = knowledge.read(document.id, 0, 500),
        page1 = knowledge.read(document.id, 0, 73),
        page2 = knowledge.read(document.id, page1.next_offset, 427);
      assert.equal(page1.content + page2.content, full.content);
    }
    const found = knowledge.search("Text", 6, "docs", "harmonyos-references"),
      foundPage = knowledge.search(
        "Text",
        3,
        "docs",
        "harmonyos-references",
        3,
      );
    assert.ok(found.total > 6);
    assert.equal(found.total, foundPage.total);
    assert.deepEqual(found.documents.slice(3), foundPage.documents);
    assert.ok(
      found.documents.every((doc) => doc.catalog === "harmonyos-references"),
    );
    const chinese = knowledge.search("模拟器", 3, "docs", "harmonyos-faqs");
    assert.ok(chinese.total > 3);
    assert.ok(
      chinese.documents.every((doc) => doc.catalog === "harmonyos-faqs"),
    );
    for (const query of [
      '" NOT sqlite_injection',
      '"; DROP TABLE documents; --',
    ]) {
      assert.doesNotThrow(() => knowledge.search(query, 2, "docs"));
      assert.equal(knowledge.catalog(0, 2, "docs").total, docs.total);
    }
    assert.deepEqual(
      knowledge.search("not-a-real-token-%_\\", 2, "docs").documents,
      [],
    );
    assert.throws(() => knowledge.search(" ", 2, "docs"), {
      code: "QUERY_REQUIRED",
    });
    assert.throws(
      () => knowledge.search(Array(13).fill("Text").join(" "), 2, "docs"),
      { code: "QUERY_TOO_COMPLEX" },
    );
    const rules = knowledge.search("ArkTS", 4),
      rulePage = knowledge.search("ArkTS", 2, "rules", "all", 2);
    assert.deepEqual(rules.rules.slice(2), rulePage.rules);
    assert.throws(() => knowledge.read("docs:missing"), {
      code: "KNOWLEDGE_NOT_FOUND",
    });
  } finally {
    knowledge.close();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("documentation filters cannot be silently ignored for cloud, rules, reads or unknown catalogs", () => {
  const input = {
    action: "search",
    kind: "docs",
    query: "Text",
    catalog: "harmonyos-references",
    offset: 3,
    limit: 2,
  };
  assert.equal(
    tools.harmony_knowledge.schema.parse(input).catalog,
    "harmonyos-references",
  );
  for (const extra of [
    { catalog: "absent" },
    { kind: "rules" },
    { source: "cloud" },
    { action: "read", id: "docs:example" },
  ])
    assert.throws(() =>
      tools.harmony_knowledge.schema.parse({ ...input, ...extra }),
    );
});
test("packaged resources have exact origins, licenses and a closed knowledge index", () => {
  const result = verifyResources(packageRoot);
  assert.ok(result.knowledge > 0 && result.resources > result.knowledge);
});
test("unreviewed resource bytes fail integrity validation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-resource-check-"));
  try {
    fs.mkdirSync(path.join(root, "provenance"));
    fs.mkdirSync(path.join(root, "resources"));
    fs.writeFileSync(path.join(root, "LICENSE"), "test fixture");
    fs.writeFileSync(path.join(root, "resources/value.txt"), "changed");
    fs.writeFileSync(
      path.join(root, "provenance/resources.json"),
      JSON.stringify({
        format: 1,
        sources: [
          {
            id: "test",
            version: "1",
            url: "fixture",
            integrity: "fixture",
            license: "LICENSE",
          },
        ],
        files: [
          {
            file: "resources/value.txt",
            sha256: "a".repeat(64),
            source: "test",
            source_path: "value.txt",
            source_sha256: "a".repeat(64),
            transformation: "unchanged",
          },
        ],
      }),
    );
    assert.throws(() => verifyResources(root), {
      code: "RESOURCE_DIGEST_MISMATCH",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
