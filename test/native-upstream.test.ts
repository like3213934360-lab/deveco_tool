import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, digest } from "../src/core/files.js";
import {
  candidate,
  changes,
  classify,
  git,
  lockSchema,
  mappingSchema,
  revision,
  tree,
  type Mapping,
  type Source,
} from "../scripts/lib/upstream.js";
import { packageRoot } from "../src/core/config.js";

function configuration() {
  return {
    lock: lockSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(packageRoot, "provenance/upstream-lock.json"),
          "utf8",
        ),
      ) as unknown,
    ),
    mapping: mappingSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(packageRoot, "provenance/upstream-mapping.json"),
          "utf8",
        ),
      ) as unknown,
    ),
  };
}
test("every adaptation mapping has existing replacement and validation targets, while new official skills remain unmapped", () => {
  const { lock, mapping } = configuration();
  const ids = new Set<string>();
  for (const rule of mapping.rules) {
    assert.equal(ids.has(rule.id), false, `Duplicate mapping ${rule.id}`);
    ids.add(rule.id);
    assert.ok(lock.sources.some((source) => source.id === rule.source));
    if (rule.disposition === "adapt") {
      assert.ok(rule.targets.length && rule.tests.length, rule.id);
      for (const file of [...rule.targets, ...rule.tests])
        assert.ok(fs.existsSync(path.join(packageRoot, file)), file);
    }
  }
  assert.equal(
    classify(
      mapping,
      "deveco-code",
      "packages/opencode/resources/skills/new-official-workflow/SKILL.md",
    )?.disposition,
    "unmapped",
  );
  assert.equal(
    classify(
      mapping,
      "deveco-code",
      "packages/opencode/resources/skills/deveco-create-project/SKILL.md",
    )?.disposition,
    "adapt",
  );
  assert.equal(
    classify(
      mapping,
      "deveco-code",
      "packages/opencode/resources/skills/customize-deveco/SKILL.md",
    )?.disposition,
    "exclude",
  );
});

test("deleted files, mode changes and unknown paths cannot disappear from an upgrade report", () => {
  const { lock, mapping } = configuration(),
    source = lock.sources[0]!;
  const file =
    "packages/opencode/resources/skills/deveco-create-project/SKILL.md";
  const a = { path: file, oid: "a".repeat(40), mode: "100644", type: "blob" };
  assert.equal(
    changes(source, [a], [], mapping, packageRoot)[0]?.status,
    "deleted",
  );
  assert.equal(
    changes(source, [a], [{ ...a, mode: "120000" }], mapping, packageRoot)[0]
      ?.disposition,
    "unmapped",
  );
  assert.equal(
    changes(
      source,
      [],
      [{ ...a, path: "new-workflow-root/test.ts" }],
      mapping,
      packageRoot,
    )[0]?.disposition,
    "unmapped",
  );
  assert.throws(
    () =>
      classify(
        { rules: [...mapping.rules, mapping.rules[0]!], format: 1 },
        source.id,
        "packages/opencode/resources/skills/deveco-create-project/SKILL.md",
      ),
    { code: "UPSTREAM_MAPPING_AMBIGUOUS" },
  );
});

test("Git candidates lock their base tree and origin, preserve Unicode paths and require review before changing source locks", async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-upstream-")),
  );
  try {
    await git(root, ["-c", "init.templateDir=", "init", "--quiet"]);
    await git(root, [
      "remote",
      "add",
      "origin",
      "https://example.invalid/upstream.git",
    ]);
    const file = "rules/中文 flow.md";
    atomicWrite(path.join(root, file), "first rule\n");
    const commit = async (message: string) => {
      await git(root, ["add", "--all"]);
      await git(root, [
        "-c",
        "user.name=Native Upstream Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        `core.hooksPath=${path.join(root, "no-hooks")}`,
        "commit",
        "--quiet",
        "-m",
        message,
      ]);
    };
    await commit("baseline");
    const base = await revision(root, "HEAD");
    const source: Source = {
      id: "fixture",
      url: "https://example.invalid/upstream.git",
      ref: "refs/heads/main",
      ...base,
      version: "fixture",
      role: "resource_source",
      acceptance: "pending",
    };
    const mapping: Mapping = {
      format: 1,
      rules: [
        {
          id: "rule",
          source: "fixture",
          path: "rules/",
          prefix: true,
          disposition: "adapt",
          reason: "Review rule semantics",
          targets: ["src/services/checker.ts"],
          tests: ["test/native-runtime.test.ts"],
        },
      ],
    };
    atomicWrite(path.join(root, file), "changed rule\n");
    await commit("candidate");
    const report = await candidate(source, root, "HEAD", mapping, packageRoot);
    assert.equal(report.gate, "requires_adapter_review");
    assert.equal(report.changes[0]?.path, file);
    const { sha256, ...payload } = report;
    assert.equal(sha256, digest(payload));
    assert.equal((await tree(root, base.commit))[0]?.path, file);
    assert.equal(source.commit, base.commit);
    await assert.rejects(
      candidate(
        { ...source, tree: "f".repeat(40) },
        root,
        "HEAD",
        mapping,
        packageRoot,
      ),
      { code: "UPSTREAM_BASE_MISMATCH" },
    );
    await assert.rejects(
      candidate(
        { ...source, url: "https://example.invalid/another.git" },
        root,
        "HEAD",
        mapping,
        packageRoot,
      ),
      { code: "UPSTREAM_ORIGIN_MISMATCH" },
    );
    atomicWrite(path.join(root, "unknown-rule.md"), "must block\n");
    await commit("unmapped addition");
    assert.equal(
      (await candidate(source, root, "HEAD", mapping, packageRoot)).gate,
      "blocked_unmapped",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
