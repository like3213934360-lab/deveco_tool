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
  } finally {
    knowledge.close();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
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
