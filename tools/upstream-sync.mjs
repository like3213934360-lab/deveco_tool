// Upstream alignment report: compares deveco-code tool registry + deveco-cli commands
// against the capabilities this MCP exposes. Usage:
//   node tools/upstream-sync.mjs [--code <deveco-code checkout>] [--cli <deveco-cli checkout>]
// Without paths it shallow-clones both develop branches into a temp dir.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

// Mapping upstream capability -> this MCP (tool action). "host" = provided by the MCP host itself.
const map = {
  // deveco-code agent tools
  invalid: "host", shell: "host", bash: "host", read: "host", glob: "host", grep: "host", edit: "host", write: "host", apply_patch: "host",
  task: "host", webfetch: "host", websearch: "host", todowrite: "host", todo: "host", question: "host", plan: "host", planwrite: "host", planenter: "host",
  plan_exit: "host", plan_write: "host", plan_enter: "host", spec_write: "prompts implement-feature", specwrite: "prompts implement-feature", debug_exit: "host", debugexit: "host",
  skill: "skills list/read + resources", skilltool: "skills list/read + resources",
  lsp: "code lsp", lsptool: "code lsp",
  switch_cwd: "explicit project param", switchcwd: "explicit project param",
  arkts_check: "code check", arktscheck: "code check",
  build_project: "project build", start_app: "run launch/build_run",
  hdc_log: "device log", verify_ui: "ui assert + ui_flow", verifyui: "ui assert + ui_flow",
  get_ui_verification_log: "job read", getuilog: "job read", save_ui_screenshot: "ui screenshot", saveuiscreenshot: "ui screenshot",
  // deveco-cli commands
  "auth login": "auth login", "auth logout": "auth logout", "auth status": "auth status", "auth team": "auth teams", "auth list": "auth teams",
  build: "project build", "build clean": "project clean", check: "code check", "check versions": "doctor",
  create: "project create", device: "device list", "device list": "device list", "device view": "device info", "device file": "device send/recv",
  "device send": "device send", "device recv": "device recv", "device sqlite3": "device shell (read-only)",
  "doc search": "knowledge search", "doc read": "knowledge read", "doc catalog": "knowledge catalog",
  emulator: "emulator", "emulator download": "emulator install_image", "emulator remove": "emulator delete", "emulator list": "emulator list",
  "emulator view": "emulator list", "emulator accept": "emulator license", "emulator shake": "emulator scenario", "emulator power": "emulator scenario",
  "emulator rotate": "emulator scenario", "emulator volume": "emulator scenario", "emulator fold": "emulator scenario", "emulator battery": "emulator scenario",
  "emulator geolocation": "emulator scenario gps", "emulator scene": "emulator scenario", "emulator sensor": "emulator scenario", "emulator start": "emulator start",
  "emulator stop": "emulator stop", "emulator create": "emulator create", "emulator delete": "emulator delete",
  init: "skills export", log: "device log", run: "run build_run (+hot_reload)", "serve mcp": "this server", "serve lsp": "code lsp",
  "signature generate": "sign auto", "skills list": "skills search", "skills find": "skills search", "skills add": "skills install", "skills remove": "skills uninstall",
  ui: "ui", "ui-input": "ui act", "ui-layout": "ui tree/find", "ui-screenshot": "ui screenshot", "ui-window": "ui tree", "window list": "ui tree",
  "ui-screenrecord": "ui record_start/record_stop", screenrecord: "ui record_start/record_stop", screenshot: "ui screenshot", layout: "ui tree/find", click: "ui act",
  "compat versions": "code api_scan / doctor", fetch: "host (webfetch)", search: "host (websearch)", patch: "host (apply_patch)",
  "update-docs": "knowledge update", update: "knowledge update", docs: "knowledge update",
  "serve-lsp": "code lsp", "serve-lsp-cpp": "code lsp language=cpp",
};
const norm = (s) => s.toLowerCase();
const rows = [...codeTools.map((t) => ["deveco-code", t]), ...cliCommands.map((c) => ["deveco-cli", c])].map(([src, name]) => {
  const key = Object.keys(map).find((k) => norm(k) === norm(name) || norm(k) === norm(name.split(" ")[0]) && !map[name]);
  const target = map[name] ?? (key ? map[key] : undefined);
  return { source: src, upstream: name, mapped: target ?? "UNMAPPED" };
});
const unmapped = rows.filter((r) => r.mapped === "UNMAPPED");
const gaps = rows.filter((r) => r.mapped.startsWith("gap"));
console.log(JSON.stringify({
  upstream: { "deveco-code": rev(code), "deveco-cli": rev(cli) },
  totals: { upstream: rows.length, covered: rows.length - unmapped.length - gaps.length, host: rows.filter((r) => r.mapped === "host").length, gaps: gaps.length, unmapped: unmapped.length },
  unmapped, gaps, rows,
}, null, 2));
if (!arg("--code") || !arg("--cli")) fs.rmSync(temp, { recursive: true, force: true });
process.exitCode = unmapped.length ? 1 : 0;
