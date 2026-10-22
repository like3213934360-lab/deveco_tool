import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { packageRoot } from "../core/config.js";
import { invariant } from "../core/errors.js";
import { atomicWrite } from "../core/files.js";

/*
 * Register this MCP server in AI hosts' config files (parity with `devecocli init --mcp`).
 * Idempotent merge: other servers are preserved; an existing entry is only replaced with force.
 * Paths follow the upstream deveco-cli table (config/mcp.ts).
 */

export const SERVER_NAME = "deveco";
type Format = "standard" | "opencode" | "codex";
interface Host { global: string; project: string; format: Format }

const appSupport = (...p: string[]) => process.platform === "win32"
  ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), ...p)
  : path.join(os.homedir(), "Library", "Application Support", ...p);

export const hosts: Record<string, Host> = {
  cursor: { global: path.join(os.homedir(), ".cursor", "mcp.json"), project: ".cursor/mcp.json", format: "standard" },
  claude: { global: path.join(os.homedir(), ".claude.json"), project: ".mcp.json", format: "standard" },
  codex: { global: path.join(os.homedir(), ".codex", "config.toml"), project: ".codex/config.toml", format: "codex" },
  opencode: { global: path.join(os.homedir(), ".config", "opencode", "opencode.json"), project: ".opencode/opencode.json", format: "opencode" },
  "trae-cn": { global: path.join(appSupport("Trae CN", "User"), "mcp.json"), project: ".trae/mcp.json", format: "standard" },
  codebuddy: { global: path.join(os.homedir(), ".codebuddy", "mcp.json"), project: ".codebuddy/mcp.json", format: "standard" },
  qoder: { global: path.join(appSupport("Qoder", "SharedClientCache"), "mcp.json"), project: ".mcp.json", format: "standard" },
  pi: { global: path.join(os.homedir(), ".pi", "agent", "mcp.json"), project: ".pi/mcp.json", format: "standard" },
};

export interface ServerSpec { command: string; args: string[]; env: Record<string, string> }

/** How the host should launch this server: current node + this package's CLI. */
export function defaultSpec(options: { config?: string } = {}): ServerSpec {
  const env: Record<string, string> = {};
  const config = options.config ?? process.env.DEVECO_CONFIG;
  if (config) env.DEVECO_CONFIG = path.resolve(config);
  // Prefer a stable node path: Homebrew's Cellar/<version> path breaks on upgrade, opt/node does not.
  const cellar = /^(.*)\/Cellar\/node(?:@\d+)?\/[^/]+\/bin\/node$/.exec(process.execPath);
  const stable = cellar && fs.existsSync(`${cellar[1]}/bin/node`) ? `${cellar[1]}/bin/node` : process.execPath;
  return { command: stable, args: [path.join(packageRoot, "bin", "deveco-mcp.mjs"), "mcp"], env };
}

function readJson(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? (JSON5.parse(text) as Record<string, any>) : {};
}

/* Minimal TOML support for Codex: rewrite only our [mcp_servers.<name>] table(s), keep the rest verbatim. */
const tomlString = (s: string) => JSON.stringify(s);
/** Find table boundaries outside comments, strings and multiline arrays, preserving original lines. */
function tomlTables(lines: string[], name: string) {
  const tables = new Map<number, string[]>();
  let quote = "", depth = 0;
  let context: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!quote && !depth && line.trimStart().startsWith("[")) {
      const header = line.trimStart(), close = header.startsWith("[[") ? "]]" : "]";
      const keys: string[] = [];
      let rest = header.slice(close.length).trimStart();
      for (;;) {
        const key = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*/.exec(rest);
        invariant(key, "INVALID_INPUT", "Cannot safely identify TOML table key", { line: index + 1 });
        const token = key[1]!;
        keys.push(token.startsWith('"') ? JSON.parse(token.replace(/\\(?:U([0-9A-Fa-f]{8})|.)/g, (escape: string, hex?: string) => hex ? JSON.stringify(String.fromCodePoint(parseInt(hex, 16))).slice(1, -1) : escape))
          : token.startsWith("'") ? token.slice(1, -1) : token);
        rest = rest.slice(key[0].length).trimStart();
        if (rest.startsWith(".")) { rest = rest.slice(1).trimStart(); continue; }
        invariant(rest.startsWith(close) && /^\s*(?:#.*)?$/.test(rest.slice(close.length)), "INVALID_INPUT", "Cannot safely identify TOML table boundary", { line: index + 1 });
        break;
      }
      context = keys;
      tables.set(index, keys);
      continue;
    }
    if (!quote && !depth && context.length < 2) {
      const assignment = /^\s*((?:(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*(?:\.\s*)?)+)=/.exec(line);
      if (assignment) {
        const tokens = assignment[1]!.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+/g)!;
        const keys = [...context, ...tokens.map((token) => token.startsWith('"') ? JSON.parse(token) : token.startsWith("'") ? token.slice(1, -1) : token)];
        invariant(keys[0] !== "mcp_servers" || keys.length > 1 && keys[1] !== name, "INVALID_INPUT",
          "Inline or dotted MCP configuration cannot be safely rewritten; use a dedicated server table", { line: index + 1 });
      }
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quote) {
        if (quote[0] === '"' && ch === "\\") { i++; continue; }
        if (line.startsWith(quote, i)) {
          i += quote.length - 1;
          if (quote.length === 3) while (line[i + 1] === quote[0]) i++;
          quote = "";
        }
      } else if (ch === "#") break;
      else if (ch === '"' || ch === "'") { quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch; i += quote.length - 1; }
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
    }
  }
  invariant(!quote && depth === 0, "INVALID_INPUT", "Unterminated TOML value; configuration was not changed");
  return tables;
}
export function mergeCodexToml(existing: string, name: string, spec: ServerSpec, force: boolean): { text: string; changed: boolean; exists: boolean } {
  const lines = existing.split(/\r?\n/);
  const tables = tomlTables(lines, name);
  const ours = (keys: string[]) => keys[0] === "mcp_servers" && keys[1] === name;
  const exists = [...tables.values()].some(ours);
  if (exists && !force) return { text: existing, changed: false, exists };
  const kept: string[] = [];
  let skipping = false;
  for (const [index, line] of lines.entries()) {
    const table = tables.get(index);
    if (table) skipping = ours(table);
    if (!skipping) kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  const block = [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(", ")}]`,
    ...(Object.keys(spec.env).length ? [`[mcp_servers.${name}.env]`, ...Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlString(v)}`)] : []),
  ];
  return { text: [...kept, ...(kept.length ? [""] : []), ...block, ""].join(existing.includes("\r\n") ? "\r\n" : "\n"), changed: true, exists };
}

export function mergeJsonConfig(data: Record<string, any>, format: Format, name: string, spec: ServerSpec, force: boolean) {
  const key = format === "opencode" ? "mcp" : "mcpServers";
  const servers = (data[key] ??= {}) as Record<string, unknown>;
  const exists = name in servers;
  if (exists && !force) return { changed: false, exists };
  servers[name] = format === "opencode"
    ? { type: "local", command: [spec.command, ...spec.args], environment: spec.env, enabled: true }
    : { type: "stdio", command: spec.command, args: spec.args, env: spec.env };
  return { changed: true, exists };
}

export function installMcp(host: string, options: { scope?: "user" | "project"; project?: string; force?: boolean; config?: string } = {}) {
  const entry = hosts[host];
  invariant(entry, "INVALID_INPUT", `MCP registration is not supported for host ${host}`, { hosts: Object.keys(hosts) },
    ["deveco", "atomcode", "dsh"].includes(host)
      ? "This host supports skill export/install only. Register the MCP command manually in its MCP settings, or select a listed host."
      : "Select a supported host from details.hosts");
  const scope = options.scope ?? (options.project ? "project" : "user");
  invariant(scope === "user" || options.project, "INVALID_INPUT", "project is required for scope=project");
  const file = scope === "user" ? entry.global : path.join(path.resolve(options.project!), entry.project);
  const spec = defaultSpec(options);
  if (entry.format === "codex") {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const merged = mergeCodexToml(existing, SERVER_NAME, spec, !!options.force);
    if (merged.changed) atomicWrite(file, merged.text);
    return { host, file, server: SERVER_NAME, written: merged.changed, ...(merged.exists && !merged.changed ? { note: "Entry exists; pass force=true to overwrite" } : {}) };
  }
  const data = readJson(file);
  const merged = mergeJsonConfig(data, entry.format, SERVER_NAME, spec, !!options.force);
  if (merged.changed) atomicWrite(file, JSON.stringify(data, null, 2) + "\n");
  return { host, file, server: SERVER_NAME, written: merged.changed, ...(merged.exists && !merged.changed ? { note: "Entry exists; pass force=true to overwrite" } : {}), restart: "Reload MCP servers in the host to pick it up" };
}
