import { z } from "zod";
import { createHash } from "node:crypto";
import { resourceRoot } from "../core/config.js";
import { invariant } from "../core/errors.js";
import { skillCatalogSchema } from "./skills.js";
import { knowledgeEntrySchema } from "./knowledge.js";
import { domainRecipeCall } from "./domain-recipes.js";
import { readContentFile } from "./content-file.js";

const sourceSchema = z.object({ id: z.string(), path: z.string(), sha256: z.string(), source: z.string(), commit: z.string(), url: z.string(), kind: z.string(), local_file: z.string().nullable(), classification: z.string(), reason: z.string(), references: z.array(z.object({ target: z.string(), resolved: z.string().nullable(), kind: z.string() })).default([]) }).passthrough();
const textHash = (text: string) => createHash("sha256").update(text).digest("hex");
type ContentEntry = { uri: string; name: string; description: string; mimeType: string; sha256: string; source?: unknown };
export class DomainContentService {
  constructor(readonly resources = resourceRoot) {}
  private skills() { return skillCatalogSchema.parse(JSON.parse(readContentFile(this.resources, "skills.json").text)).skills; }
  private knowledge() { return z.array(knowledgeEntrySchema).parse(JSON.parse(readContentFile(this.resources, "knowledge.json", undefined, 1024 * 1024).text)); }
  private sources() { return z.object({ entries: z.array(sourceSchema) }).parse(JSON.parse(readContentFile(this.resources, "domain-sources.json", undefined, 4 * 1024 * 1024).text)).entries; }
  catalog(raw: { kind?: "skill" | "knowledge" | "recipe" | "source"; query?: string; offset?: number; limit?: number } = {}) {
    const input = z.object({ kind: z.enum(["skill", "knowledge", "recipe", "source"]).optional(), query: z.string().max(256).default(""), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) }).parse(raw);
    const entries: ContentEntry[] = [];
    if (!input.kind || input.kind === "skill") for (const skill of this.skills()) for (const file of skill.files) entries.push({ uri: `deveco://skill/${skill.name}/${file.path}`, name: `${skill.name}/${file.path}`, description: skill.description, mimeType: "text/markdown", sha256: file.sha256, source: skill.upstream });
    if (!input.kind || input.kind === "recipe") {
      const catalog = domainRecipeCall({ action: "catalog" }, this.resources) as { recipes: { id: string; description: string; uri: string }[] };
      for (const item of catalog.recipes) { const recipe = domainRecipeCall({ action: "read", id: item.id }, this.resources) as { content_sha256: string }; entries.push({ uri: `deveco://recipe/${item.id}`, name: item.id, description: item.description, mimeType: "application/json", sha256: textHash(JSON.stringify(recipe, null, 2)) }); }
    }
    if (!input.kind || input.kind === "knowledge") for (const entry of this.knowledge()) entries.push({ uri: `deveco://knowledge/${entry.id}`, name: entry.title, description: entry.summary, mimeType: entry.kind === "example" ? "text/plain" : "text/markdown", sha256: entry.sha256, source: { id: entry.source, commit: entry.commit, path: entry.source_path } });
    if (!input.kind || input.kind === "source") for (const entry of this.sources()) if (entry.local_file) entries.push({ uri: `deveco://source/${entry.id}`, name: entry.path, description: `${entry.classification}: ${entry.reason}`, mimeType: /\.(?:md|txt)$/.test(entry.path) ? "text/markdown" : "text/plain", sha256: entry.sha256, source: { id: entry.source, commit: entry.commit, path: entry.path, url: entry.url } });
    const query = input.query.toLocaleLowerCase(), matches = entries.filter((entry) => `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query));
    return { total: matches.length, offset: input.offset, next_offset: Math.min(matches.length, input.offset + input.limit), entries: matches.slice(input.offset, input.offset + input.limit).map(entry => ({ ...entry, read: { tool: "domain_content", action: "read", uri: entry.uri } })) };
  }
  read(uri: string) {
    invariant(uri.length <= 2048 && !/[\x00-\x20]/.test(uri), "CONTENT_URI_INVALID", "Use a content URI returned by the catalog");
    const match = /^deveco:\/\/(skill|knowledge|recipe|source)\/(.+)$/.exec(uri);
    invariant(match, "CONTENT_URI_INVALID", "Use a deveco content URI returned by the catalog");
    const kind = match[1]!, id = decodeURIComponent(match[2]!);
    if (kind === "recipe") {
      const recipe = domainRecipeCall({ action: "read", id }, this.resources) as { content_sha256: string };
      return { uri, mimeType: "application/json", text: JSON.stringify(recipe, null, 2), sha256: textHash(JSON.stringify(recipe, null, 2)), source: { type: "native_domain_recipe" }, tool_read: { tool: "domain_recipe", action: "read", id } };
    }
    if (kind === "skill") {
      const slash = id.indexOf("/"), name = id.slice(0, slash), relative = id.slice(slash + 1), skill = this.skills().find((item) => item.name === name), file = skill?.files.find((file) => file.path === relative);
      invariant(skill && file && slash > 0, "CONTENT_NOT_FOUND", "Unknown skill content URI");
      return { uri, mimeType: "text/markdown", ...readContentFile(this.resources, `skills/${name}/${file.path}`, file.sha256), source: skill.upstream, tool_read: { tool: "skill_manage", action: "read", name, file: file.path } };
    }
    if (kind === "knowledge") {
      const entry = this.knowledge().find((entry) => entry.id === id);
      invariant(entry, "CONTENT_NOT_FOUND", "Unknown knowledge URI; use harmony_knowledge for documentation IDs");
      return { uri, mimeType: entry.kind === "example" ? "text/plain" : "text/markdown", ...readContentFile(this.resources, entry.file, entry.sha256, 1024 * 1024), source: { id: entry.source, commit: entry.commit, path: entry.source_path }, tool_read: { tool: "harmony_knowledge", action: "read", id } };
    }
    const sourceEntries = this.sources(), entry = sourceEntries.find((entry) => entry.id === id);
    invariant(entry, "CONTENT_NOT_FOUND", "Unknown source content URI");
    invariant(entry.local_file, "SOURCE_NOT_BUNDLED", `The fixed source is tracked but not copied; read ${entry.url}`);
    return { uri, mimeType: /\.(?:md|txt)$/.test(entry.path) ? "text/markdown" : "text/plain", ...readContentFile(this.resources, entry.local_file, entry.sha256, 1024 * 1024), source: { id: entry.source, commit: entry.commit, path: entry.path, url: entry.url }, classification: entry.classification, reason: entry.reason, references: entry.references.map((reference) => { const target = sourceEntries.find((item) => item.path === reference.resolved); return { ...reference, uri: target?.local_file ? `deveco://source/${target.id}` : null, read: target?.local_file ? { tool: "domain_content", action: "read", uri: `deveco://source/${target.id}` } : null, sha256: target?.sha256 ?? null, url: target?.url ?? null, status: !reference.resolved ? "unresolved_upstream_reference" : target?.local_file ? "bundled" : "tracked_not_bundled" }; }) };
  }
}
