import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assetRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";

const skillsRoot = () => path.join(assetRoot, "knowledge/skills");
const skillReceipt = ".deveco-mcp-skill.json";

function skillDigest(root: string) {
  const hash = createHash("sha256");
  function scan(relative: string) {
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (!relative && entry.name === skillReceipt) continue;
      const key = path.join(relative, entry.name);
      const file = path.join(root, key);
      const kind = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "link" : "other";
      const value = kind === "file" ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
        : kind === "link" ? fs.readlinkSync(file) : "";
      hash.update(JSON.stringify([key.split(path.sep).join("/"), kind, value]) + "\n");
      if (kind === "dir") scan(key);
    }
  }
  scan("");
  return hash.digest("hex");
}

function protectBundledSkill(target: string) {
  const bundled = fs.realpathSync(skillsRoot()), destination = fs.realpathSync(path.dirname(target));
  const rel = path.relative(bundled, destination);
  invariant(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel), "CONFLICT", "Bundled Skill files belong to the MCP package", { target });
}

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
  atomcode: ".atomcode/skills", dsh: ".dsh/skills",
};

/** Hosts that do not read the shared .agents/skills: project scope uses their own directory (devecocli: projectPath or .<agent>/skills). */
const ownProjectDir: Record<string, string> = { "trae-cn": ".trae-cn/skills", codebuddy: ".codebuddy/skills", pi: ".pi/agent/skills", atomcode: ".atomcode/skills", dsh: ".dsh/skills" };
function sharedProjectDir(host: string) {
  return ownProjectDir[host] ?? ".agents/skills";
}

/** One-step host setup: export skills + register this MCP server (parity with `devecocli init`). */
export async function initHost(host: string, options: { scope?: "user" | "project"; project?: string; force?: boolean; skills?: boolean; mcp?: boolean; dir?: string }) {
  const { installMcp, hosts } = await import("./hostconfig.js");
  const scope = options.scope ?? (options.project ? "project" : "user");
  // Hosts without an MCP config table upstream (deveco, atomcode, dsh) get skills only.
  const mcp = options.mcp !== false && host in hosts;
  return {
    ...(options.skills !== false ? { skills: exportSkills(host, scope, options.project, undefined, options.dir) } : {}),
    ...(mcp ? { mcp: installMcp(host, { scope, project: options.project, force: options.force }) } : {}),
    ...(options.mcp !== false && !mcp ? { mcp: { skipped: `${host} has no MCP configuration file; register the server in its settings manually` } } : {}),
  };
}

/**
 * Where skills go: an explicit directory (`dir`, like devecocli --path), the shared project
 * directory, or the host's user directory.
 */
function skillsDir(host: string | undefined, scope: "user" | "project", project?: string, dir?: string) {
  if (dir) {
    invariant(path.isAbsolute(dir), "INVALID_INPUT", "path must be an absolute directory");
    return dir;
  }
  invariant(host, "INVALID_INPUT", "host is required (or pass path)");
  const relative = hostDirs[host];
  invariant(relative, "INVALID_INPUT", `Unknown host ${host}`, { hosts: Object.keys(hostDirs) });
  return scope === "project"
    ? path.join((invariant(project, "INVALID_INPUT", "project is required for scope=project"), path.resolve(project!)), sharedProjectDir(host))
    : path.join(os.homedir(), relative);
}

/** Export bundled skills as native SKILL.md folders so the host loads them automatically. */
export function exportSkills(host: string | undefined, scope: "user" | "project", project?: string, names?: string[], dir?: string) {
  // Project scope uses the shared .agents/skills directory, read by Codex, Claude Code, Cursor, Qoder,
  // OpenCode and DevEco Code, so one copy serves every tool.
  const target = skillsDir(host, scope, project, dir);
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
export async function marketInstall(name: string, host: string | undefined, scope: "user" | "project", project?: string, dir?: string) {
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name), "INVALID_INPUT", "Invalid skill name");
  const root = skillsDir(host, scope, project, dir);
  const target = path.join(root, name), previous = fs.lstatSync(target, { throwIfNoEntry: false });
  invariant(!previous || previous.isDirectory() && !previous.isSymbolicLink(), "CONFLICT", "Skill destination must be a regular directory", { target });
  const checksum = await marketJson<{ sha256: string; size: number }>(`${market}/registry/skill/${name}/checksum`);
  const response = await fetch(`${market}/registry/skill/${name}/install?format=zip`, { signal: AbortSignal.timeout(60000) });
  invariant(response.ok, "HTTP_ERROR", `Download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  invariant(createHash("sha256").update(bytes).digest("hex").toLowerCase() === checksum.sha256.toLowerCase(), "INTEGRITY_FAILED", "Skill archive checksum mismatch");
  fs.mkdirSync(root, { recursive: true });
  protectBundledSkill(target);
  const work = fs.mkdtempSync(path.join(root, ".skill-")), content = path.join(work, "content"), backup = path.join(work, "previous");
  const zip = path.join(work, "download.zip");
  let preserveBackup = false;
  try {
    fs.writeFileSync(zip, bytes);
    const { extractZip } = await import("../core/unzip.js");
    await extractZip(zip, content);
    const skill = (base: string) => fs.lstatSync(path.join(base, "SKILL.md"), { throwIfNoEntry: false })?.isFile();
    let source = content;
    if (!skill(source)) {
      const candidates = fs.readdirSync(content, { withFileTypes: true }).filter((entry) => entry.isDirectory() && skill(path.join(content, entry.name)));
      invariant(candidates.length === 1, "INVALID_INPUT", "Downloaded archive must contain one unambiguous SKILL.md");
      source = path.join(content, candidates[0]!.name);
    }
    fs.writeFileSync(path.join(source, skillReceipt), JSON.stringify({ name, sha256: skillDigest(source) }), { flag: "wx", mode: 0o600 });
    const current = fs.lstatSync(target, { throwIfNoEntry: false });
    invariant(current?.ino === previous?.ino && current?.dev === previous?.dev && !current?.isSymbolicLink(), "CONFLICT", "Skill destination changed during download", { target });
    if (previous) fs.renameSync(target, backup);
    try { fs.renameSync(source, target); }
    catch (error) {
      if (previous) {
        preserveBackup = true;
        try { fs.renameSync(backup, target); preserveBackup = false; }
        catch (restore) { throw new ToolError("INSTALL_ROLLBACK_FAILED", "Skill installation and restoration failed; original files were retained", { backup, cause: String(error), restore: String(restore) }); }
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) fs.rmSync(work, { recursive: true, force: true });
  }
  return { installed: name, directory: target };
}

export function uninstallSkill(name: string, host: string | undefined, scope: "user" | "project", project?: string, dir?: string, force = false) {
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name), "INVALID_INPUT", "Invalid skill name");
  const target = path.join(skillsDir(host, scope, project, dir), name);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  invariant(stat, "NOT_FOUND", `${name} is not installed in ${path.dirname(target)}`);
  protectBundledSkill(target);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return { removed: name, directory: target, link_only: true };
  }
  invariant(stat.isDirectory() && fs.lstatSync(path.join(target, "SKILL.md"), { throwIfNoEntry: false })?.isFile(),
    "CONFLICT", "Skill removal requires a directory with a regular SKILL.md", { target });
  if (!force) {
    const receipt = path.join(target, skillReceipt);
    let expected: string | undefined;
    const metadata = fs.lstatSync(receipt, { throwIfNoEntry: false });
    if (metadata?.isFile() && metadata.size <= 4096) {
      try {
        const record = JSON.parse(fs.readFileSync(receipt, "utf8"));
        if (record?.name === name && /^[0-9a-f]{64}$/.test(record?.sha256)) expected = record.sha256;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    } else if (!metadata && listSkills().some((skill) => skill.name === name)) {
      expected = skillDigest(path.join(skillsRoot(), name));
    }
    invariant(expected && skillDigest(target) === expected, "CONFLICT", "Skill has local edits or no verified original", { target },
      "Inspect the directory and pass force=true to remove its contents explicitly");
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: name, directory: target };
}
