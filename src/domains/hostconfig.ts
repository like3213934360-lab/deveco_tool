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
export function defaultSpec(options: { config?: string; groups?: string } = {}): ServerSpec {
  const env: Record<string, string> = {};
  const config = options.config ?? process.env.DEVECO_CONFIG;
  if (config) env.DEVECO_CONFIG = path.resolve(config);
  if (options.groups) env.DEVECO_TOOL_GROUPS = options.groups;
  // Prefer a stable node path: Homebrew's Cellar/<version> path breaks on upgrade, opt/node does not.
  const cellar = /^(.*)\/Cellar\/node(?:@\d+)?\/[^/]+\/bin\/node$/.exec(process.execPath);
  const stable = cellar && fs.existsSync(`${cellar[1]}/bin/node`) ? `${cellar[1]}/bin/node` : process.execPath;
  return { command: stable, args: [path.join(packageRoot, "dist", "cli.js"), "mcp"], env };
}

function readJson(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? (JSON5.parse(text) as Record<string, any>) : {};
}

/* Minimal TOML support for Codex: rewrite only our [mcp_servers.<name>] table(s), keep the rest verbatim. */
const tomlString = (s: string) => JSON.stringify(s);
export function mergeCodexToml(existing: string, name: string, spec: ServerSpec, force: boolean): { text: string; changed: boolean; exists: boolean } {
  const header = new RegExp(`^\\[mcp_servers\\.(?:"${name}"|${name})(?:\\.env)?\\]\\s*$`);
  const lines = existing.split(/\r?\n/);
  const exists = lines.some((l) => header.test(l.trim()));
  if (exists && !force) return { text: existing, changed: false, exists };
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^\[.*\]$/.test(t)) skipping = header.test(t);
    if (!skipping) kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  const block = [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(", ")}]`,
    ...(Object.keys(spec.env).length ? [`[mcp_servers.${name}.env]`, ...Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlString(v)}`)] : []),
  ];
  return { text: [...kept, ...(kept.length ? [""] : []), ...block, ""].join("\n"), changed: true, exists };
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

export function installMcp(host: string, options: { scope?: "user" | "project"; project?: string; force?: boolean; config?: string; groups?: string } = {}) {
  const entry = hosts[host];
  invariant(entry, "INVALID_INPUT", `Unknown host ${host}`, { hosts: Object.keys(hosts) });
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
