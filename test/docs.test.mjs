import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PACK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MANIFEST = JSON.parse(await fs.readFile(path.join(PACK_ROOT, "manifest.json"), "utf8"));

/**
 * Every counted claim the prose makes about the pack's size. These numbers used to be scattered
 * across four documents with nothing checking them, so they drifted every time the pack grew.
 * The manifest is the single source of truth; these patterns assert the prose agrees with it.
 */
const DOCS = ["README.md", "PACK.md", "provenance/INVENTORY.md", "skills/INDEX.md"];

// provenance/INVENTORY.md is a per-source breakdown, so a count like "10 个 Skill from 0.2.0" is
// correct there and must not be compared against the pack total. It is still checked for tool and
// script counts, which have no legitimate subset phrasing.
const TOTAL_COUNT_DOCS = DOCS.filter((doc) => doc !== "provenance/INVENTORY.md");

test("prose skill counts agree with the manifest", async () => {
  const expected = MANIFEST.skills.length;
  const core = MANIFEST.skills.filter((skill) => skill.tier === "core").length;
  const extended = expected - core;

  for (const doc of TOTAL_COUNT_DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    // "第 5 个 Skill" is an ordinal, not a count.
    for (const match of text.matchAll(/(?<!第\s?)(\d+)\s*个\s*Skill/gi)) {
      const claimed = Number(match[1]);
      assert.ok(
        [expected, core, extended].includes(claimed),
        `${doc} claims "${match[0]}" but the manifest has ${expected} skills (${core} core / ${extended} extended)`,
      );
    }
  }
});

test("prose tool counts agree with the manifest", async () => {
  const expected = MANIFEST.mcp.toolCount;
  const advertised = MANIFEST.mcp.toolGroups.flatMap((group) => group.tools).length;
  assert.equal(advertised, expected, "toolGroups and toolCount disagree inside the manifest itself");

  for (const doc of DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    for (const match of text.matchAll(/(\d+)\s*个工具/g)) {
      assert.equal(
        Number(match[1]),
        expected,
        `${doc} claims "${match[0]}" but the manifest advertises ${expected} tools`,
      );
    }
  }
});

test("prose script counts agree with the registry", async () => {
  const { listScripts } = await import("../src/script-registry.mjs");
  const expected = listScripts().length;

  for (const doc of DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    for (const match of text.matchAll(/(\d+)\s*个(?:可调用)?脚本/g)) {
      assert.equal(
        Number(match[1]),
        expected,
        `${doc} claims "${match[0]}" but the registry has ${expected} scripts`,
      );
    }
  }
});

test("every provenance source file referenced by the docs exists", async () => {
  for (const file of ["provenance/SOURCES.md", "provenance/INVENTORY.md", "NOTICE.deveco-code",
    "NOTICE.harmonyos-agent-skills", "provenance/deveco-code-v0.1.5.commit",
    "provenance/harmonyos-agent-skills-v0.0.2.commit", "skills/INDEX.md"]) {
    await fs.access(path.join(PACK_ROOT, file));
  }
});
