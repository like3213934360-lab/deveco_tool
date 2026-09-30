// Upstream alignment gate — fails unless EVERY upstream capability has a verified decision.
//
//   1. tools/upstream/extract.mjs lists every capability item of deveco-code and deveco-cli
//      (tools, parameters, enum values, commands, options, choices, bundled MCP tools, skills...).
//   2. tools/upstream/decisions.json maps each item to full (with a target) / host / skip (with reason).
//   3. Each `full` target is verified against this server's live tools/list JSON Schemas,
//      prompts/list, the skills list, or src/cli.ts.
// Failures: undecided items, unverifiable targets, skips without reasons, stale decision keys.
// It also lists upstream commits since decisions.upstream_rev for behaviour-level review.
//
// Usage: node tools/upstream-sync.mjs [--code <dir>] [--cli <dir>] [--json] [--report <file.md>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./mcp-client.mjs";
import { extract } from "./upstream/extract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-"));
// Always remove the temp clones, including after a failed clone, a thrown error or Ctrl-C.
const removeTemp = () => fs.rmSync(temp, { recursive: true, force: true });
process.on("exit", removeTemp);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => { removeTemp(); process.exit(130); });
function checkout(name, given) {
  if (given) return path.resolve(given);
  const dir = path.join(temp, name);
  execFileSync("git", ["clone", "-q", "--branch", "develop", "--filter=blob:none", `https://gitcode.com/openharmony-sig/${name}.git`, dir], { stdio: "ignore" });
  return dir;
}
const git = (dir, ...a) => { try { return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };

const code = checkout("deveco-code", arg("--code"));
const cli = checkout("deveco-cli", arg("--cli"));
const decisions = JSON.parse(fs.readFileSync(path.join(root, "tools/upstream/decisions.json"), "utf8"));
const items = extract({ code, cli });

/* ---------------------------- live server state ---------------------------- */

const client = connect();
await client.initialize();
const tools = new Map((await client.request("tools/list")).result.tools.map((t) => [t.name, t.inputSchema]));
const prompts = new Set(((await client.request("prompts/list")).result?.prompts ?? []).map((p) => p.name));
const skills = new Set((await client.call("skills", { action: "list" })).data.skills.map((s) => s.name));
await client.close();
const cliSource = fs.readFileSync(path.join(root, "src/cli.ts"), "utf8");

/** Verify one target expression; returns a list of problems (empty = verified). */
export function verifyTarget(to) {
  if (to.startsWith("cli:")) return cliSource.includes(to.slice(4)) ? [] : [`src/cli.ts lacks "${to.slice(4)}"`];
  if (to.startsWith("prompt:")) return prompts.has(to.slice(7)) ? [] : [`prompt ${to.slice(7)} not served`];
  if (to.startsWith("skill:")) return skills.has(to.slice(6)) ? [] : [`skill ${to.slice(6)} not bundled`];
  const [toolName, ...conds] = to.split(/\s+/);
  const schema = tools.get(toolName);
  if (!schema) return [`tool ${toolName} missing`];
  const props = schema.properties ?? {};
  const problems = [];
  for (const c of conds) {
    const [param, value] = c.split("=");
    const prop = props[param];
    if (!prop) { problems.push(`${toolName}.${param} missing`); continue; }
    const values = prop.enum ?? prop.items?.enum;
    if (value !== undefined && values && !values.includes(value)) problems.push(`${toolName}.${param} lacks value ${value}`);
  }
  return problems;
}

const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
const rules = decisions.rules.map((r) => ({ ...r, re: globRe(r.match) }));
function decide(id) {
  if (decisions.items[id]) return { ...decisions.items[id], via: "item" };
  const rule = rules.find((r) => r.re.test(id));
  return rule ? { ...rule, via: `rule ${rule.match}` } : undefined;
}

/* --------------------------------- check --------------------------------- */

const rows = items.map((id) => {
  const d = decide(id);
  if (!d) return { id, status: "UNDECIDED", problems: ["no decision"] };
  if (d.status === "full") {
    const problems = [d.to, d.also].filter(Boolean).flatMap(verifyTarget);
    return { id, status: problems.length ? "PARTIAL" : "full", to: d.to, via: d.via, problems };
  }
  if (!["host", "skip"].includes(d.status)) return { id, status: "INVALID", problems: [`unknown status ${d.status}`] };
  if (!d.reason) return { id, status: "INVALID", problems: ["reason required"] };
  return { id, status: d.status, reason: d.reason, via: d.via };
});
const itemSet = new Set(items);
const stale = Object.keys(decisions.items).filter((k) => !itemSet.has(k));

const revs = { "deveco-code": git(code, "rev-parse", "--short", "HEAD"), "deveco-cli": git(cli, "rev-parse", "--short", "HEAD") };
const newCommits = {};
for (const [name, dir] of [["deveco-code", code], ["deveco-cli", cli]]) {
  const since = decisions.upstream_rev?.[name];
  // Abbreviated hashes differ in length between clones: compare by prefix, and only report real commits.
  if (!since || revs[name].startsWith(since) || since.startsWith(revs[name])) continue;
  const list = git(dir, "log", "--oneline", `${since}..HEAD`).split("\n").filter(Boolean);
  if (list.length) newCommits[name] = list;
  else if (!git(dir, "cat-file", "-t", since)) newCommits[name] = [`(recorded ${since} not found in the clone — re-check and bump upstream_rev)`];
}

const count = (s) => rows.filter((r) => r.status === s).length;
const failing = rows.filter((r) => !["full", "host", "skip"].includes(r.status));
const report = {
  upstream: revs,
  totals: { items: rows.length, full: count("full"), host: count("host"), skip: count("skip"), partial: count("PARTIAL"), undecided: count("UNDECIDED"), invalid: count("INVALID"), stale: stale.length },
  failing, stale, new_commits: newCommits, rows,
};

if (arg("--report")) fs.writeFileSync(arg("--report"), markdown(report));
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`deveco-code@${revs["deveco-code"]} deveco-cli@${revs["deveco-cli"]}`);
  console.log(JSON.stringify(report.totals));
  for (const r of failing) console.log(`  ${r.status.padEnd(9)} ${r.id}${r.to ? ` -> ${r.to}` : ""}: ${r.problems.join("; ")}`);
  for (const k of stale) console.log(`  STALE     ${k} (decision for an item upstream no longer has)`);
  for (const [n, list] of Object.entries(newCommits)) console.log(`  ${n}: ${list.length} new upstream commits since ${decisions.upstream_rev[n]} — review behaviour, then bump upstream_rev`);
}
process.exitCode = failing.length || stale.length || Object.keys(newCommits).length ? 1 : 0;

function markdown(r) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const lines = [
    "# Upstream alignment / 上游对齐清单",
    "",
    `Generated by \`node tools/upstream-sync.mjs --report docs/upstream-alignment.md\`. Upstream: deveco-code@${r.upstream["deveco-code"]}, deveco-cli@${r.upstream["deveco-cli"]}.`,
    "",
    `由脚本生成，是“是否对齐”的唯一依据。共 ${r.totals.items} 项：full ${r.totals.full}，host ${r.totals.host}，skip ${r.totals.skip}，未对齐 ${r.totals.partial + r.totals.undecided + r.totals.invalid}。`,
    "",
    "| Upstream item | Status | deveco-mcp target / reason |",
    "| --- | --- | --- |",
    ...r.rows.map((x) => `| \`${esc(x.id)}\` | ${x.status} | ${esc(x.to ? `\`${x.to}\`` : x.reason)}${x.problems?.length ? ` — ${esc(x.problems.join("; "))}` : ""} |`),
    "",
  ];
  return lines.join("\n");
}
