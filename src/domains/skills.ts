import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";

const skillsRoot = () => path.join(packageRoot, "knowledge/skills");

function frontMatter(text: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return fields;
}

const refDir = (dir: string) => ["references", "reference"].map((d) => path.join(dir, d)).find((d) => fs.existsSync(d));

/** Reference files relative to the skill's references/ directory (nested folders allowed). */
function listReferences(dir: string) {
  const root = refDir(dir);
  if (!root) return [];
  return (fs.readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".md") && fs.statSync(path.join(root, f)).isFile())
    .map((f) => f.split(path.sep).join("/")).sort();
}

export function listSkills() {
  const root = skillsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, "SKILL.md"))).map((name) => {
    const meta = frontMatter(fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8"));
    return { name, description: meta.description ?? "", references: listReferences(path.join(root, name)) };
  });
}

export function readSkill(name: string, reference?: string) {
  invariant(/^[a-z0-9-]+$/.test(name), "INVALID_INPUT", "Invalid skill name");
  const dir = path.join(skillsRoot(), name);
  invariant(fs.existsSync(dir), "NOT_FOUND", `Skill ${name} not found`, { available: listSkills().map((s) => s.name) });
  let file = path.join(dir, "SKILL.md");
  if (reference) {
    const rel = reference.replace(/^\.?\/?(references?\/)?/, "");
    invariant(/^[\w.-]+(\/[\w.-]+)*\.md$/.test(rel) && !rel.split("/").includes(".."), "INVALID_INPUT", "reference must be a .md path under references/");
    file = path.join(refDir(dir) ?? path.join(dir, "references"), rel);
    invariant(fs.existsSync(file), "NOT_FOUND", `${reference} not found in ${name}`, { references: listReferences(dir) });
  }
  return { name, file: path.relative(skillsRoot(), file).split(path.sep).join("/"), content: fs.readFileSync(file, "utf8") };
}

/** Host-native user-level skill directories (same list the upstream CLI installs into). */
const hostDirs: Record<string, string> = {
  cursor: ".cursor/skills", claude: ".claude/skills", codex: ".codex/skills", opencode: ".config/opencode/skills",
  deveco: ".config/deveco/skills", "trae-cn": ".trae-cn/skills", codebuddy: ".codebuddy/skills", qoder: ".qoder/skills", pi: ".pi/agent/skills",
};

const noSharedDir = new Set(["trae-cn", "codebuddy", "pi"]);
function sharedProjectDir(host: string) {
  return noSharedDir.has(host) ? hostDirs[host]! : ".agents/skills";
}

/** One-step host setup: export skills + register this MCP server (parity with `devecocli init`). */
export async function initHost(host: string, options: { scope?: "user" | "project"; project?: string; force?: boolean; skills?: boolean; mcp?: boolean }) {
  const { installMcp } = await import("./hostconfig.js");
  const scope = options.scope ?? (options.project ? "project" : "user");
  return {
    ...(options.skills !== false ? { skills: exportSkills(host, scope, options.project) } : {}),
    ...(options.mcp !== false ? { mcp: installMcp(host, { scope, project: options.project, force: options.force }) } : {}),
  };
}

/** Export bundled skills as native SKILL.md folders so the host loads them automatically. */
export function exportSkills(host: string, scope: "user" | "project", project?: string, names?: string[]) {
  const relative = hostDirs[host];
  invariant(relative, "INVALID_INPUT", `Unknown host ${host}`, { hosts: Object.keys(hostDirs) });
  // Project scope uses the shared .agents/skills directory, read by Codex, Claude Code, Cursor, Qoder,
  // OpenCode and DevEco Code, so one copy serves every tool.
  const target = scope === "project"
    ? path.join((invariant(project, "INVALID_INPUT", "project is required for scope=project"), path.resolve(project!)), sharedProjectDir(host))
    : path.join(os.homedir(), relative);
  const exported: string[] = [];
  for (const skill of listSkills()) {
    if (names && !names.includes(skill.name)) continue;
    fs.cpSync(path.join(skillsRoot(), skill.name), path.join(target, skill.name), { recursive: true, force: true });
    exported.push(skill.name);
  }
  return { host, directory: target, exported };
}

/* ------------------------- OpenHarmony skill market ------------------------- */

const market = "https://matrix.openharmony.cn/api";

async function marketJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  invariant(response.ok, "HTTP_ERROR", `Skill market returned HTTP ${response.status}`);
  const data = (await response.json()) as { code: string; message?: string; data: T };
  invariant(data.code === "20000", "HTTP_ERROR", `Skill market error ${data.code}: ${data.message ?? ""}`);
  return data.data;
}

/** HarmonyOS skills live under the "HMOS" tag (the upstream CLI excludes its own "DevEco" tag). */
async function hmosTags() {
  const data = await marketJson<{ skill: { id: string; name: string }[] }>(`${market}/model_base/model/tags?serviceType=skill`);
  const tags = data.skill.filter((t) => t.name === "HMOS").map((t) => t.id);
  invariant(tags.length, "NOT_FOUND", "Skill market has no HMOS tag");
  return tags;
}

export async function marketSearch(keyword: string, limit = 20) {
  const tags = await hmosTags();
  const list = await marketJson<{ list: { id: string; name: string; enName: string; description: string; download: number; tags?: { name: string }[]; owner?: { name?: string } }[] }>(
    `${market}/registry/skill/skills`, { pageNum: 1, pageSize: Math.min(limit, 50), keyword, tagIds: tags });
  const skills = list.list.filter((s) => !s.tags?.some((t) => t.name === "DevEco"));
  return {
    total: skills.length,
    skills: skills.slice(0, limit).map((s) => ({ name: s.enName, title: s.name, description: s.description?.slice(0, 200), downloads: s.download, owner: s.owner?.name })),
    next: skills.length ? { tool: "skills", action: "install", name: skills[0]!.enName } : null,
  };
}

/** Install a market skill (zip verified by sha256 checksum) into a host skill directory. */
export async function marketInstall(name: string, host: string, scope: "user" | "project", project?: string) {
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name), "INVALID_INPUT", "Invalid skill name");
  const relative = hostDirs[host];
  invariant(relative, "INVALID_INPUT", `Unknown host ${host}`, { hosts: Object.keys(hostDirs) });
  const checksum = await marketJson<{ sha256: string; size: number }>(`${market}/registry/skill/${name}/checksum`);
  const response = await fetch(`${market}/registry/skill/${name}/install?format=zip`, { signal: AbortSignal.timeout(60000) });
  invariant(response.ok, "HTTP_ERROR", `Download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const { createHash } = await import("node:crypto");
  invariant(createHash("sha256").update(bytes).digest("hex").toLowerCase() === checksum.sha256.toLowerCase(), "INTEGRITY_FAILED", "Skill archive checksum mismatch");
  const base = scope === "project" ? (invariant(project, "INVALID_INPUT", "project is required for scope=project"), path.resolve(project)) : os.homedir();
  const target = path.join(base, relative, name);
  fs.mkdirSync(target, { recursive: true });
  const zip = path.join(target, ".download.zip");
  fs.writeFileSync(zip, bytes);
  try {
    const { extractZip } = await import("../core/unzip.js");
    await extractZip(zip, target);
  } finally {
    fs.rmSync(zip, { force: true });
  }
  // Some archives wrap files in a top folder; flatten when SKILL.md is one level down.
  if (!fs.existsSync(path.join(target, "SKILL.md"))) {
    const inner = fs.readdirSync(target).find((d) => fs.existsSync(path.join(target, d, "SKILL.md")));
    if (inner) for (const entry of fs.readdirSync(path.join(target, inner))) fs.renameSync(path.join(target, inner, entry), path.join(target, entry));
  }
  invariant(fs.existsSync(path.join(target, "SKILL.md")), "INVALID_INPUT", "Downloaded archive has no SKILL.md");
  return { installed: name, directory: target };
}

export function uninstallSkill(name: string, host: string, scope: "user" | "project", project?: string) {
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name), "INVALID_INPUT", "Invalid skill name");
  const relative = hostDirs[host];
  invariant(relative, "INVALID_INPUT", `Unknown host ${host}`, { hosts: Object.keys(hostDirs) });
  const base = scope === "project" ? path.resolve(project ?? ".") : os.homedir();
  const target = path.join(base, relative, name);
  if (!fs.existsSync(target)) throw new ToolError("NOT_FOUND", `${name} is not installed for ${host}`);
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: name, directory: target };
}
