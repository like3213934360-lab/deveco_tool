import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDocument } from "../src/document-validate.mjs";

const PACK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** A spec that satisfies every rule, used as the base for the negative cases. */
const VALID_SPEC = `# Feature Specification: Demo

## Overview

text

## User Scenarios & Testing

text

## Requirements

text

## Success Criteria

text

## Assumptions

text

## Open Questions

text
`;

test("the bundled templates satisfy the section rules they are validated against", async () => {
  // This pins both ends at once: the ported rule table and the three templates this pack ships.
  // If either drifts, the SDD commands would start reporting problems in their own scaffolding.
  const cases = [
    ["templates/spec-template.md", "spec"],
    ["templates/plan-template.md", "design"],
    ["templates/tasks-template.md", "tasks"],
  ];
  for (const [relative, documentType] of cases) {
    const content = await fs.readFile(path.join(PACK_ROOT, relative), "utf8");
    const result = validateDocument({ content, documentType });
    assert.equal(result.valid, true, `${relative} failed validation:\n${result.report}`);
    assert.equal(result.report, "");
  }
});

test("a missing required section is reported at its own heading level", () => {
  const result = validateDocument({
    content: VALID_SPEC.replace("## Open Questions\n\ntext\n", ""),
    documentType: "spec",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.missing.map((m) => m.title), ["Open Questions"]);
  assert.equal(result.issues.missing[0].ruleId, "SPEC-SEC-5");
  assert.ok(result.issues.missing[0].suggestion.length > 0);
  // Upstream rendered every missing section with a level-1 prefix; a level-2 requirement must not
  // be reported as `# Open Questions`.
  assert.match(result.report, /^ {2}- ## Open Questions$/m);
});

test("a disallowed level-2 section is reported as extra", () => {
  const result = validateDocument({
    content: `${VALID_SPEC}\n## Rollout Plan\n\ntext\n`,
    documentType: "spec",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.extra.map((e) => e.title), ["Rollout Plan"]);
  assert.match(result.report, /Extra sections \(not allowed\)/);
});

test("duplicate headings are detected at every level, not just level 2", () => {
  const result = validateDocument({
    content: `${VALID_SPEC}\n### Detail\n\na\n\n### Detail\n\nb\n`,
    documentType: "spec",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.duplicates.map((d) => [d.title, d.level, d.count]), [["Detail", 3, 2]]);
});

test("the level-2 ceiling reports both the observed count and the limit", () => {
  // spec allows 6 level-2 sections and the valid document already uses all 6.
  const result = validateDocument({
    content: `${VALID_SPEC}\n## Overview Two\n\ntext\n`,
    documentType: "spec",
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues.tooManyLevel2.count, 7);
  assert.equal(result.issues.tooManyLevel2.max, 6);
  // Upstream printed the observed count where the message says "max", so the ceiling never showed.
  assert.match(result.report, /Too many level-2 sections \(found 7, max 6 allowed\)/);
});

test("Chinese headings pass through the alias table", () => {
  const chineseSpec = `# 功能规格: 演示

## 概述

内容

## 用户场景与测试

内容

## 需求

内容

## 成功标准

内容

## 假设

内容

## 开放问题

内容
`;
  const result = validateDocument({ content: chineseSpec, documentType: "spec" });
  assert.equal(result.valid, true, result.report);
});

test("headings inside code fences are not treated as sections", () => {
  const result = validateDocument({
    content: `${VALID_SPEC}\n\`\`\`bash\n# Not A Section\n## Also Not A Section\n\`\`\`\n`,
    documentType: "spec",
  });
  assert.equal(result.valid, true, result.report);
});

test("the document type is inferred from the basename, and refused when it cannot be", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-docval-"));
  try {
    const specFile = path.join(directory, "spec.md");
    await fs.writeFile(specFile, VALID_SPEC);
    assert.equal(validateDocument({ file: specFile }).documentType, "spec");

    // plan.md is validated against the design rules, matching the upstream mapping.
    const planFile = path.join(directory, "plan.md");
    await fs.writeFile(planFile, "# Implementation Plan: Demo\n");
    assert.equal(validateDocument({ file: planFile }).documentType, "design");

    const strayFile = path.join(directory, "notes.md");
    await fs.writeFile(strayFile, VALID_SPEC);
    // Upstream silently skipped validation here, which reads as a pass; refuse instead.
    assert.throws(() => validateDocument({ file: strayFile }), (error) => error.code === "DOCUMENT_TYPE_REQUIRED");
    assert.equal(validateDocument({ file: strayFile, documentType: "spec" }).valid, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("file and content inputs produce the same verdict", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-docval-"));
  try {
    const file = path.join(directory, "spec.md");
    await fs.writeFile(file, VALID_SPEC);
    const fromFile = validateDocument({ file });
    const fromContent = validateDocument({ content: VALID_SPEC, documentType: "spec" });
    assert.equal(fromFile.valid, fromContent.valid);
    assert.equal(fromFile.report, fromContent.report);
    assert.equal(fromFile.sectionCount, fromContent.sectionCount);

    // content wins when both are supplied, so a caller can validate before writing.
    const pending = validateDocument({ file, content: "# Feature Specification: Demo\n" });
    assert.equal(pending.valid, false);
    assert.equal(pending.file, file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bad input is refused with a structured code", () => {
  assert.throws(() => validateDocument({}), (error) => error.code === "DOCUMENT_INPUT_REQUIRED");
  assert.throws(
    () => validateDocument({ content: "# x", documentType: "proposal" }),
    (error) => error.code === "DOCUMENT_TYPE_INVALID",
  );
  assert.throws(
    () => validateDocument({ file: "/nope/spec.md" }),
    (error) => error.code === "DOCUMENT_NOT_FOUND",
  );
});
