// Builds docs/audit/FINDINGS.md (full table, last verdict per id) from docs/audit/findings.jsonl.
import fs from "node:fs";
import { findingsFile, repo } from "./lib.mjs";
const rows = fs.readFileSync(findingsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const last = new Map(); for (const r of rows) last.set(r.id, r);
const all = [...last.values()].sort((a, b) => a.id.localeCompare(b.id));
const count = (v) => all.filter((r) => r.verdict === v).length;
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = `# 审计结论明细（自动生成）\n\n由 \`node test/audit/report.mjs\` 从 \`docs/audit/findings.jsonl\` 生成；同一编号以最后一次记录为准。\n\n`;
md += `共 ${all.length} 项：VERIFIED ${count("VERIFIED")}，DEFECT ${count("DEFECT")}，UNVERIFIED ${count("UNVERIFIED")}，INFERRED ${count("INFERRED")}。\n\n`;
for (const v of ["DEFECT", "UNVERIFIED", "INFERRED", "VERIFIED"]) {
  md += `## ${v}\n\n| 编号 | 结论摘要 | 证据 |\n| --- | --- | --- |\n`;
  for (const r of all.filter((x) => x.verdict === v)) md += `| ${r.id} | ${esc(r.summary)} | ${r.evidence.map((e) => `\`${e}\``).join("<br>")} |\n`;
  md += "\n";
}
fs.writeFileSync(`${repo}/docs/audit/FINDINGS.md`, md);
console.log(`${all.length} ids -> docs/audit/FINDINGS.md`);
