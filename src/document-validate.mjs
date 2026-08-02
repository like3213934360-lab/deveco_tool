/**
 * SDD artifact section validation.
 *
 * Ported from DevEco Code `packages/opencode/src/tool/document-validation/` (six files, MIT).
 * The rule table, the bilingual alias table, the code-fence-aware parser and the four checks are
 * carried over unchanged; only the Effect wrapper around them is replaced by a plain function.
 *
 * Upstream runs this inside `spec_write`, right after the write, and appends the report to the
 * tool result. This pack replaced `spec_write` with the host's own write tool, so the check is
 * exposed as a standalone tool that the SDD commands call once the artifact is on disk.
 */

import fs from "node:fs";
import path from "node:path";
import { getProjectPath } from "./project-context.mjs";

/**
 * Required/allowed section tables, verbatim from upstream `config.ts`.
 * The `ruleId` / `message` / `suggestion` fields are dead metadata upstream (the report formatter
 * never reads them); this port surfaces them in the structured result instead.
 */
const FORMAT_RULES = {
  spec: {
    requiredSections: [
      { level: 1, standardTitle: "Feature Specification:", ruleId: "SPEC-TITLE", message: "Missing '# Feature Specification: ...' title", suggestion: "Add '# Feature Specification: <feature name>'" },
      { level: 2, standardTitle: "Overview", ruleId: "SPEC-SEC-0", message: "Missing '## Overview'", suggestion: "Add '## Overview'" },
      { level: 2, standardTitle: "User Scenarios & Testing", ruleId: "SPEC-SEC-1", message: "Missing '## User Scenarios & Testing'", suggestion: "Add '## User Scenarios & Testing'" },
      { level: 2, standardTitle: "Requirements", ruleId: "SPEC-SEC-2", message: "Missing '## Requirements'", suggestion: "Add '## Requirements'" },
      { level: 2, standardTitle: "Success Criteria", ruleId: "SPEC-SEC-3", message: "Missing '## Success Criteria'", suggestion: "Add '## Success Criteria'" },
      { level: 2, standardTitle: "Assumptions", ruleId: "SPEC-SEC-4", message: "Missing '## Assumptions'", suggestion: "Add '## Assumptions'" },
      { level: 2, standardTitle: "Open Questions", ruleId: "SPEC-SEC-5", message: "Missing '## Open Questions'", suggestion: "Add '## Open Questions'" },
    ],
    allowedSections: [
      "Feature Specification:",
      "Overview",
      "User Scenarios & Testing",
      "Requirements",
      "Success Criteria",
      "Assumptions",
      "Open Questions",
    ],
    maxSectionLevel2: 6,
  },
  design: {
    requiredSections: [
      { level: 1, standardTitle: "Implementation Plan:", ruleId: "DES-TITLE", message: "Missing '# Implementation Plan: ...' title", suggestion: "Add '# Implementation Plan: <feature name>'" },
      { level: 2, standardTitle: "Summary", ruleId: "DES-SEC-1", message: "Missing '## Summary'", suggestion: "Add '## Summary'" },
      { level: 2, standardTitle: "Technical Context", ruleId: "DES-SEC-2", message: "Missing '## Technical Context'", suggestion: "Add '## Technical Context'" },
      { level: 2, standardTitle: "Project Structure", ruleId: "DES-SEC-3", message: "Missing '## Project Structure'", suggestion: "Add '## Project Structure'" },
      { level: 2, standardTitle: "Research & Decisions", ruleId: "DES-SEC-4", message: "Missing '## Research & Decisions'", suggestion: "Add '## Research & Decisions'" },
      { level: 2, standardTitle: "Data Model", ruleId: "DES-SEC-5", message: "Missing '## Data Model'", suggestion: "Add '## Data Model'" },
      { level: 2, standardTitle: "Contracts & Interfaces", ruleId: "DES-SEC-6", message: "Missing '## Contracts & Interfaces'", suggestion: "Add '## Contracts & Interfaces'" },
    ],
    allowedSections: [
      "Implementation Plan:",
      "Summary",
      "Technical Context",
      "Project Structure",
      "Complexity Tracking",
      "Research & Decisions",
      "Data Model",
      "Contracts & Interfaces",
      "Quickstart",
      "Changelog",
    ],
    maxSectionLevel2: 10,
  },
  tasks: {
    requiredSections: [
      { level: 1, standardTitle: "Tasks:", ruleId: "TSK-TITLE", message: "Missing '# Tasks: ...' title", suggestion: "Add '# Tasks: <feature name>'" },
      { level: 2, standardTitle: "Format", ruleId: "TSK-SEC-1", message: "Missing '## Format'", suggestion: "Add '## Format'" },
      { level: 2, standardTitle: "Path Conventions", ruleId: "TSK-SEC-2", message: "Missing '## Path Conventions'", suggestion: "Add '## Path Conventions'" },
      { level: 2, standardTitle: "Dependencies & Execution Order", ruleId: "TSK-SEC-3", message: "Missing '## Dependencies & Execution Order'", suggestion: "Add '## Dependencies & Execution Order'" },
      { level: 2, standardTitle: "Parallel Example", ruleId: "TSK-SEC-4", message: "Missing '## Parallel Example'", suggestion: "Add '## Parallel Example'" },
      { level: 2, standardTitle: "Implementation Strategy", ruleId: "TSK-SEC-5", message: "Missing '## Implementation Strategy'", suggestion: "Add '## Implementation Strategy'" },
      { level: 2, standardTitle: "Notes", ruleId: "TSK-SEC-6", message: "Missing '## Notes'", suggestion: "Add '## Notes'" },
    ],
    allowedSections: [
      "Tasks:",
      "Format",
      "Path Conventions",
      "Dependencies & Execution Order",
      "Parallel Example",
      "Implementation Strategy",
      "Notes",
      "Dependency Graph",
      "Parallel Execution Guide",
      "Summary Report",
    ],
    maxSectionLevel2: 50,
  },
};

/**
 * Bilingual section aliases, verbatim from upstream.
 * Load-bearing: the SDD commands mandate that output follows the user's language, so a Chinese
 * spec.md reaches this validator with Chinese headings. Drop this table and every rule fails.
 */
const SECTION_ALIASES = {
  "Feature Specification:": ["功能规格:", "特性规格:", "Feature Specification"],
  Overview: ["概述", "概览"],
  "User Scenarios & Testing": ["User Scenarios and Testing", "用户场景与测试", "用户场景和测试", "用户场景与测试 (必填)"],
  Requirements: ["需求", "Requirements (mandatory)", "需求 (必填)"],
  "Success Criteria": ["成功标准", "验收标准", "Success Criteria (mandatory)", "成功标准 (必填)"],
  Assumptions: ["假设"],
  "Open Questions": ["开放问题", "待解决问题"],
  "Implementation Plan:": ["实现计划:", "实施计划:", "Implementation Plan"],
  Summary: ["摘要", "总结"],
  "Technical Context": ["技术背景", "技术上下文"],
  "Project Structure": ["项目结构"],
  "Complexity Tracking": ["复杂度追踪", "复杂性跟踪"],
  "Research & Decisions": ["研究与决策", "调研与决策", "Research and Decisions"],
  "Data Model": ["数据模型"],
  "Contracts & Interfaces": ["契约与接口", "接口与契约", "Contracts and Interfaces"],
  Quickstart: ["快速开始", "快速入门"],
  Changelog: ["变更日志", "更新日志"],
  "Tasks:": ["任务:", "任务列表:", "Tasks"],
  Format: ["格式", "Format: `[ID] [P?] [Story] Description`"],
  "Path Conventions": ["路径约定", "路径规范"],
  "Dependencies & Execution Order": ["📊 Dependencies & Execution Order", "依赖与执行顺序", "依赖和执行顺序", "Dependencies and Execution Order"],
  "Parallel Example": ["并行示例", "Parallel Example:", "Parallel Examples"],
  "Dependency Graph": ["📊 Dependency Graph", "依赖图"],
  "Parallel Execution Guide": ["⚡ Parallel Execution Guide", "并行执行指南"],
  "Implementation Strategy": ["实现策略", "实施策略"],
  Notes: ["备注", "注释"],
};

/** Basenames upstream maps to a document type. Note `plan.md` validates against the `design` rules. */
const DOC_TYPE_BY_BASENAME = {
  "spec.md": "spec",
  "plan.md": "design",
  "tasks.md": "tasks",
};

/**
 * Strip markdown emphasis, full-width punctuation and inline annotations from a heading.
 * @param {string} title Raw heading text.
 * @returns {string} Comparable title.
 */
function normalizeSectionTitle(title) {
  return title
    .replace(/\*\*/g, "")
    .replace(/[　]/g, " ")
    .replace(/[：]/g, ":")
    .replace(/\s*\*\([^)]+\)\*/g, "")
    .replace(/[\s]+/g, " ")
    .trim();
}

/**
 * Code-fence-aware markdown heading parser producing a section tree.
 * Headings inside fenced blocks are masked out, so a `# ` line in a shell example is not a section.
 */
class SddMarkdownParser {
  /** @param {string} content Full markdown document. */
  constructor(content) {
    const normalized = content.replace(/\r\n?/g, "\n");
    this.lines = normalized.split("\n");
    this.codeFenceMask = this.buildCodeFenceMask(this.lines);
  }

  parseFenceOpener(line) {
    const match = line.match(/^\s*(```+|~~~+)/);
    return match ? { marker: match[1][0], length: match[1].length } : undefined;
  }

  isFenceCloser(line, fence) {
    return new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`).test(line);
  }

  buildCodeFenceMask(lines) {
    const mask = new Array(lines.length).fill(false);
    let activeFence;
    for (let i = 0; i < lines.length; i += 1) {
      if (!activeFence) {
        activeFence = this.parseFenceOpener(lines[i]);
        if (activeFence) mask[i] = true;
        continue;
      }
      mask[i] = true;
      if (this.isFenceCloser(lines[i], activeFence)) activeFence = undefined;
    }
    return mask;
  }

  /** @returns {Array<object>} Top-level sections, each carrying nested `children`. */
  parseSections() {
    const sections = [];
    const stack = [];
    for (let i = 0; i < this.lines.length; i += 1) {
      if (this.codeFenceMask[i]) continue;
      const match = this.lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (!match) continue;
      const level = match[1].length;
      const title = match[2].trim();
      const section = {
        level,
        title,
        normalizedTitle: normalizeSectionTitle(title),
        children: [],
        lineNumber: i + 1,
      };
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length === 0) sections.push(section);
      else stack[stack.length - 1].children.push(section);
      stack.push(section);
    }
    return sections;
  }
}

function flattenSections(sections) {
  return sections.flatMap((s) => [s, ...flattenSections(s.children)]);
}

function exactMatch(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function prefixMatch(title, prefix, level) {
  if (level !== 1 && level !== 2) return false;
  const lower = title.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  return prefixLower.endsWith(":") && lower.startsWith(prefixLower);
}

function matchesSectionTitle(sectionTitle, standardTitle, level) {
  if (exactMatch(sectionTitle, standardTitle)) return true;
  if (prefixMatch(sectionTitle, standardTitle, level)) return true;
  for (const alias of SECTION_ALIASES[standardTitle] ?? []) {
    if (exactMatch(sectionTitle, alias)) return true;
    if (prefixMatch(sectionTitle, alias, level)) return true;
  }
  return false;
}

/** Duplicate detection spans every heading level, and is not driven by the rule table. */
function findDuplicateSections(sections) {
  const counts = new Map();
  for (const s of sections) {
    const key = `${s.level}|${s.normalizedTitle.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { count: 1, originalTitle: s.title });
  }
  return [...counts.entries()]
    .filter(([, value]) => value.count > 1)
    .map(([key, value]) => ({
      title: value.originalTitle,
      level: Number.parseInt(key.split("|", 2)[0], 10),
      count: value.count,
    }));
}

function isAllowedLevel2Section(title, documentType, allowedSections) {
  // `tasks` carries a Phase heading per implementation stage, so those are allowed dynamically.
  if (documentType === "tasks" && /^Phase /.test(title)) return true;
  return allowedSections.some((allowed) => matchesSectionTitle(title, allowed, 2));
}

function findMissingSections(allSections, rules) {
  return rules.requiredSections
    .filter((req) => !allSections.some(
      (s) => s.level === req.level && matchesSectionTitle(s.normalizedTitle, req.standardTitle, req.level),
    ))
    .map((req) => ({
      title: req.standardTitle,
      level: req.level,
      ruleId: req.ruleId,
      message: req.message,
      suggestion: req.suggestion,
    }));
}

/** Only level-2 headings are constrained; levels 3-6 are free-form. */
function findExtraSections(allSections, documentType, rules) {
  return allSections
    .filter((s) => s.level === 2 && !isAllowedLevel2Section(s.normalizedTitle, documentType, rules.allowedSections))
    .map((s) => ({ title: s.title, level: 2, lineNumber: s.lineNumber }));
}

function findTooManyLevel2Sections(allSections, max) {
  const level2Count = allSections.filter((s) => s.level === 2).length;
  return level2Count > max ? { title: "## sections", count: level2Count, max } : undefined;
}

function formatReportLine(title, level) {
  return `  - ${level === 1 ? "# " : "## "}${title}\n`;
}

/**
 * Render the upstream report block so a host can append it to its own write result verbatim.
 *
 * LOCAL PATCH, two upstream reporting defects:
 *   - missing sections were always rendered with a level-1 `#` prefix; the required level is used.
 *   - the "too many level-2" line printed the observed count where it says "max", so the ceiling
 *     never appeared. Both numbers are now reported.
 * @returns {string} Empty string when the document is valid, otherwise the report block.
 */
function formatValidationReport(missing, extra, duplicates, tooManyLevel2) {
  if (missing.length === 0 && extra.length === 0 && duplicates.length === 0 && !tooManyLevel2) return "";
  let result = "\n\n--- Document Section Validation ---\n";
  if (missing.length > 0) {
    result += "Missing required sections:\n";
    for (const m of missing) result += formatReportLine(m.title, m.level);
  }
  if (duplicates.length > 0) {
    result += "Duplicate sections (not allowed):\n";
    for (const d of duplicates) result += formatReportLine(`${d.title} (appears ${d.count} times)`, d.level);
  }
  if (extra.length > 0) {
    result += "Extra sections (not allowed):\n";
    for (const e of extra) result += formatReportLine(e.title, 2);
  }
  if (tooManyLevel2) {
    result += `Too many level-2 sections (found ${tooManyLevel2.count}, max ${tooManyLevel2.max} allowed):\n`;
    result += `  - ${tooManyLevel2.title}: ${tooManyLevel2.count}\n`;
  }
  result += "-----------------------------------\n";
  return result;
}

/**
 * Resolve the document type from an explicit value or the file's basename.
 * Upstream silently skips validation for an unmapped basename; a standalone tool must not, or a
 * caller would read "valid" out of a document that was never checked.
 */
function resolveDocumentType(explicit, file) {
  if (explicit) {
    if (!FORMAT_RULES[explicit]) {
      const error = new Error(`Unknown documentType: ${explicit}. Expected spec, design, or tasks.`);
      error.code = "DOCUMENT_TYPE_INVALID";
      throw error;
    }
    return explicit;
  }
  const inferred = file ? DOC_TYPE_BY_BASENAME[path.basename(file).toLowerCase()] : undefined;
  if (!inferred) {
    const error = new Error("documentType could not be inferred and was not provided.");
    error.code = "DOCUMENT_TYPE_REQUIRED";
    error.hint = "传 documentType(spec / design / tasks),或把文件命名为 spec.md / plan.md / tasks.md。";
    throw error;
  }
  return inferred;
}

/**
 * Validate an SDD artifact's section structure.
 * @param {{file?: string, content?: string, documentType?: string}} input Document source. `content`
 *   wins when both are given; `file` still supplies the type inference and the reported path.
 * @returns {{file: string|null, documentType: string, valid: boolean, issues: object, report: string}}
 *   `valid` is advisory: upstream never blocks the write on it, and neither does this tool.
 */
export function validateDocument(input = {}) {
  const { file, content, documentType } = input;
  if (!file && content === undefined) {
    const error = new Error("Provide either file or content.");
    error.code = "DOCUMENT_INPUT_REQUIRED";
    throw error;
  }

  const type = resolveDocumentType(documentType, file);
  let absolute = null;
  let text = content;

  if (file) {
    const base = getProjectPath() || process.cwd();
    absolute = path.isAbsolute(file) ? file : path.resolve(base, file);
    if (text === undefined) {
      if (!fs.existsSync(absolute)) {
        const error = new Error(`Document does not exist: ${absolute}`);
        error.code = "DOCUMENT_NOT_FOUND";
        throw error;
      }
      text = fs.readFileSync(absolute, "utf8");
    }
  }

  const rules = FORMAT_RULES[type];
  const allSections = flattenSections(new SddMarkdownParser(text).parseSections());
  const missing = findMissingSections(allSections, rules);
  const extra = findExtraSections(allSections, type, rules);
  const duplicates = findDuplicateSections(allSections);
  const tooManyLevel2 = findTooManyLevel2Sections(allSections, rules.maxSectionLevel2);
  const report = formatValidationReport(missing, extra, duplicates, tooManyLevel2);

  return {
    file: absolute,
    documentType: type,
    valid: report === "",
    sectionCount: allSections.length,
    issues: { missing, duplicates, extra, tooManyLevel2: tooManyLevel2 ?? null },
    report,
  };
}
