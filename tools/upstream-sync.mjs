// Upstream capability alignment: deveco-code tool registry + deveco-cli commands vs this MCP.
// Each upstream capability maps to { tool, action, params } and is verified against the live
// tools/list JSON Schemas (all tool groups enabled):
//   full    - tool exists, action is in its enum, every key parameter exists in the schema
//   partial - mapped but the tool/action/parameters are missing  -> CI fails
//   host    - provided by the MCP host itself (file ops, shell, web, planning...)
//   cli     - provided as a CLI subcommand (init, serve-lsp, kb-update)
//   UNMAPPED- new upstream capability without a decision            -> CI fails
// Usage: node tools/upstream-sync.mjs [--code <deveco-code>] [--cli <deveco-cli>] [--json]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./mcp-client.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-"));
function checkout(name, given) {
  if (given) return path.resolve(given);
  const dir = path.join(temp, name);
  execFileSync("git", ["clone", "--depth", "1", "--branch", "develop", `https://gitcode.com/openharmony-sig/${name}.git`, dir], { stdio: "ignore" });
  return dir;
}
const code = checkout("deveco-code", arg("--code"));
const cli = checkout("deveco-cli", arg("--cli"));
const rev = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"]).toString().trim();

// deveco-code: tools registered in packages/opencode/src/tool/registry.ts
const registry = fs.readFileSync(path.join(code, "packages/opencode/src/tool/registry.ts"), "utf8");
const codeTools = [...new Set([...registry.matchAll(/(\w+):\s*Tool\.init\(/g)].map((m) => m[1]))];
// deveco-cli: top-level commands and subcommands
const cmdDir = path.join(cli, "packages/cli/src/commands");
const cliCommands = [];
for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
  const text = fs.readFileSync(path.join(cmdDir, file), "utf8");
  const top = /new Command\('([\w-]+)'\)/.exec(text)?.[1] ?? file.replace(/\.ts$/, "");
  const subs = [...text.matchAll(/\.command\('([\w-]+)/g)].map((m) => m[1]);
  cliCommands.push(...(subs.length ? subs.map((s) => `${top} ${s}`) : [top]));
}

const H = "host";
const C = (command) => ({ cli: command });
const T = (tool, action, params = []) => ({ tool, action, params });
// Upstream capability -> this MCP. params = upstream key parameters, expressed as our field names.
const map = {
  // ---- deveco-code agent tools
  invalid: H, shell: H, bash: H, read: H, glob: H, grep: H, edit: H, write: H, apply_patch: H, multiedit: H, ls: H, list: H,
  task: H, webfetch: H, websearch: H, codesearch: H, todowrite: H, todoread: H, todo: H, question: H, plan: H, planwrite: H, planenter: H, batch: H,
  plan_exit: H, plan_write: H, plan_enter: H, debug_exit: H, debugexit: H,
  spec_write: T("prompts", null), specwrite: T("prompts", null),
  skill: T("skills", "read", ["name", "reference"]), skilltool: T("skills", "read", ["name"]),
  lsp: T("code", "lsp", ["op", "file", "symbol", "line", "language"]), lsptool: T("code", "lsp", ["op", "file", "symbol"]),
  switch_cwd: T("project", "info", ["project"]), switchcwd: T("project", "info", ["project"]),
  arkts_check: T("code", "check", ["files", "fix"]), arktscheck: T("code", "check", ["files"]),
  build_project: T("project", "build", ["task", "product", "mode", "modules"]),
  start_app: T("run", "build_run", ["project", "target", "module"]),
  hdc_log: T("device", "log", ["bundle", "grep", "level", "lines", "clear"]),
  verify_ui: T("ui", "test_start", ["plan", "bundle", "fresh_start"]), verifyui: T("ui", "test_start", ["plan"]),
  get_ui_verification_log: T("ui", "test_log", ["test_id", "grep", "max_chars"]), getuilog: T("ui", "test_log", ["test_id"]),
  save_ui_screenshot: T("ui", "test_export", ["test_id", "directory"]), saveuiscreenshot: T("ui", "test_export", ["test_id", "directory"]),
  // ---- deveco-cli commands
  "auth login": T("auth", "login", ["provider", "region"]), "auth logout": T("auth", "logout", ["provider"]), "auth status": T("auth", "status", ["provider"]),
  "auth team": T("auth", "teams"), "auth list": T("auth", "teams"),
  build: T("project", "build", ["task", "product", "mode", "modules", "clean"]), "build clean": T("project", "clean"),
  "build compileNative": T("project", "build", ["task"]),
  check: T("code", "check", ["files"]), "check versions": T("doctor", null, ["project"]),
  create: T("project", "create", ["project", "app_name", "bundle_name", "target_api"]),
  device: T("device", "list"), "device list": T("device", "list"), "device view": T("device", "info", ["target"]),
  "device file": T("device", "send", ["local", "remote"]), "device send": T("device", "send", ["local", "remote"]), "device recv": T("device", "recv", ["local", "remote"]),
  "device sqlite3": T("device", "sqlite", ["db", "sql", "write"]),
  "doc search": T("knowledge", "search", ["query", "source"]), "doc read": T("knowledge", "read"), "doc catalog": T("knowledge", "catalog"),
  emulator: T("emulator", "list"), "emulator download": T("emulator", "install_image"), "emulator remove": T("emulator", "delete"), "emulator list": T("emulator", "list"),
  "emulator view": T("emulator", "list"), "emulator accept": T("emulator", "license"), "emulator start": T("emulator", "start"), "emulator stop": T("emulator", "stop"),
  "emulator create": T("emulator", "create"), "emulator delete": T("emulator", "delete"),
  "emulator shake": T("emulator", "scenario"), "emulator power": T("emulator", "scenario"), "emulator rotate": T("emulator", "scenario"), "emulator volume": T("emulator", "scenario"),
  "emulator fold": T("emulator", "scenario"), "emulator battery": T("emulator", "scenario"), "emulator geolocation": T("emulator", "scenario"),
  "emulator scene": T("emulator", "scenario"), "emulator sensor": T("emulator", "scenario"),
  init: T("skills", "init", ["host", "scope", "project", "force"]), log: T("device", "log", ["bundle", "grep", "level"]),
  run: T("run", "build_run", ["project", "target", "module", "product", "mode"]),
  "serve mcp": H, "serve lsp": C("serve-lsp [--cpp]"), "serve-lsp": C("serve-lsp"), "serve-lsp-cpp": C("serve-lsp --cpp"),
  "signature generate": T("sign", "auto", ["project", "team", "acl"]),
  "skills list": T("skills", "list"), "skills find": T("skills", "search", ["query"]), "skills add": T("skills", "install", ["name", "host", "scope"]),
  "skills remove": T("skills", "uninstall", ["name", "host"]),
  ui: T("ui", "observe"), "ui-input": T("ui", "act", ["op", "selector", "x", "y", "text", "key", "direction"]),
  "ui-layout": T("ui", "tree", ["window", "depth", "bundle"]), "ui-screenshot": T("ui", "screenshot", ["format", "width"]),
  "ui-window": T("ui", "windows", ["all"]), "window list": T("ui", "windows", ["all"]),
  "ui-screenrecord": T("ui", "record_stop", ["discard", "external"]), screenrecord: T("ui", "record_status"),
  screenshot: T("ui", "screenshot"), layout: T("ui", "tree", ["window", "depth"]), click: T("ui", "act", ["op", "selector"]),
  "compat versions": T("code", "api_versions"), fetch: H, search: H, patch: H,
  "update-docs": T("knowledge", "update"), update: T("knowledge", "update"), docs: T("knowledge", "update"),
};

// Live schemas of this server with every tool group enabled.
const client = connect({ DEVECO_TOOL_GROUPS: "core,sign,emulator,hot_reload" });
await client.initialize();
const tools = new Map((await client.request("tools/list")).result.tools.map((t) => [t.name, t.inputSchema]));
const prompts = (await client.request("prompts/list")).result?.prompts ?? [];
await client.close();

function verify(target) {
  if (target === H) return { status: "host" };
  if (target.cli) return { status: "cli", via: `deveco-mcp ${target.cli}` };
  if (target.tool === "prompts") return prompts.length ? { status: "full", via: "MCP prompts" } : { status: "partial", missing: ["prompts"] };
  const schema = tools.get(target.tool);
  if (!schema) return { status: "partial", missing: [`tool ${target.tool}`] };
  const props = schema.properties ?? {};
  const missing = [];
  if (target.action && !(props.action?.enum ?? []).includes(target.action)) missing.push(`action ${target.action}`);
  for (const p of target.params) if (!(p in props)) missing.push(`param ${p}`);
  const via = `${target.tool}${target.action ? ` action=${target.action}` : ""}`;
  return missing.length ? { status: "partial", via, missing } : { status: "full", via };
}

const norm = (s) => s.toLowerCase();
const rows = [...codeTools.map((t) => ["deveco-code", t]), ...cliCommands.map((c) => ["deveco-cli", c])].map(([source, name]) => {
  const key = map[name] !== undefined ? name : Object.keys(map).find((k) => norm(k) === norm(name)) ?? Object.keys(map).find((k) => norm(k) === norm(name.split(" ")[0]));
  if (!key) return { source, upstream: name, status: "UNMAPPED" };
  return { source, upstream: name, ...verify(map[key]) };
});
const count = (s) => rows.filter((r) => r.status === s).length;
const failing = rows.filter((r) => r.status === "partial" || r.status === "UNMAPPED");
const report = {
  upstream: { "deveco-code": rev(code), "deveco-cli": rev(cli) },
  totals: { upstream: rows.length, full: count("full"), cli: count("cli"), host: count("host"), partial: count("partial"), unmapped: count("UNMAPPED") },
  failing, rows,
};
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`deveco-code@${report.upstream["deveco-code"]} deveco-cli@${report.upstream["deveco-cli"]}`);
  console.log(JSON.stringify(report.totals));
  for (const r of failing) console.log(`  ${r.status.padEnd(8)} ${r.source}: ${r.upstream}${r.missing ? ` (missing ${r.missing.join(", ")})` : ""}`);
}
if (!arg("--code") || !arg("--cli")) fs.rmSync(temp, { recursive: true, force: true });
process.exitCode = failing.length ? 1 : 0;
