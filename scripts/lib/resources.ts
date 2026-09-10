import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fileDigest, inside, walk } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { knowledgeEntrySchema } from "../../src/services/knowledge.js";
import { compileCrashReference } from "../../src/services/crash-patterns.js";
import { skillCatalogSchema } from "../../src/services/skills.js";

const relative = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
  );
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const resourceManifest = z.strictObject({
  format: z.literal(1),
  sources: z.array(
    z.strictObject({
      id: z.string(),
      version: z.string(),
      url: z.string(),
      integrity: z.string(),
      license: relative,
    }),
  ),
  files: z.array(
    z.strictObject({
      file: relative,
      sha256: sha,
      source: z.string(),
      source_path: relative,
      source_sha256: sha,
      transformation: z.string(),
    }),
  ),
});
export function verifyResources(root: string) {
  const skillFile = path.join(root, "resources/skills.json");
  const skills = fs.existsSync(skillFile) ? skillCatalogSchema.parse(JSON.parse(fs.readFileSync(skillFile, "utf8"))).skills : [];
  const skillPaths = new Set(skills.flatMap(skill => skill.files.map(file => `resources/skills/${skill.name}/${file.path}`)));
  invariant(new Set(skills.map(skill => skill.name)).size === skills.length, "SKILL_CATALOG_INVALID", "Duplicate Skill catalog names");
  const manifest = resourceManifest.parse(
    JSON.parse(
      fs.readFileSync(path.join(root, "provenance/resources.json"), "utf8"),
    ) as unknown,
  );
  const sources = new Map(
    manifest.sources.map((source) => [source.id, source]),
  );
  invariant(
    sources.size === manifest.sources.length,
    "RESOURCE_SOURCE_DUPLICATE",
    "Duplicate resource origin",
  );
  for (const source of sources.values())
    invariant(
      fs.statSync(inside(root, source.license)).isFile(),
      "RESOURCE_LICENSE_MISSING",
      `Missing license for ${source.id}`,
    );
  const files = new Set<string>();
  for (const record of manifest.files) {
    invariant(
      record.file.startsWith("resources/") && !files.has(record.file),
      "RESOURCE_DUPLICATE",
      "Resource paths must be unique and within resources",
    );
    files.add(record.file);
    const file = inside(root, record.file);
    invariant(
      !fs.lstatSync(file).isSymbolicLink() &&
        fileDigest(file) === record.sha256,
      "RESOURCE_DIGEST_MISMATCH",
      `Resource changed without a reviewed digest: ${record.file}`,
    );
    invariant(
      sources.has(record.source),
      "RESOURCE_SOURCE_MISSING",
      `Unknown origin: ${record.source}`,
    );
    if (record.transformation === "unchanged")
      invariant(
        record.sha256 === record.source_sha256,
        "RESOURCE_SOURCE_MISMATCH",
        `Unmodified resource differs from its origin: ${record.file}`,
      );
    invariant(
      !/\/(?:SKILL(?:_[A-Z]+)?\.md|[^/]+\.(?:mjs|cjs|js))$/i.test(record.file) ||
        (skillPaths.has(record.file) && record.file.endsWith("/SKILL.md") && record.transformation === "native-skill-adaptation" && record.source === "deveco-code-skills"),
      "RESOURCE_EXECUTABLE",
      "Only catalogued, reviewed native Skill adaptations may ship; upstream JavaScript runtimes remain excluded",
    );
  }
  const actual = walk(path.join(root, "resources")).map((file) =>
    path.relative(root, file).split(path.sep).join("/"),
  );
  for (const skill of skills) {
    invariant(skill.files.some(file => file.path === "SKILL.md") && new Set(skill.files.map(file => file.path)).size === skill.files.length,
      "SKILL_CATALOG_INVALID", "Skill requires one unique entrypoint and file list");
    for (const file of skill.files) {
      const resource = `resources/skills/${skill.name}/${file.path}`, record = manifest.files.find(record => record.file === resource);
      invariant(record?.sha256 === file.sha256, "SKILL_SOURCE_MISMATCH", `Skill digest differs from the resource manifest: ${resource}`);
      if (file.path === "SKILL.md") invariant(record.source_path === skill.upstream.path && record.source_sha256 === skill.upstream.sha256 &&
        sources.get(record.source)?.version === skill.upstream.commit && sources.get(record.source)?.url === skill.upstream.url,
        "SKILL_SOURCE_MISMATCH", `Skill origin differs from the resource manifest: ${resource}`);
    }
  }
  invariant(actual.filter(file => file.startsWith("resources/skills/")).every(file => skillPaths.has(file)), "SKILL_UNINDEXED", "Every packaged Skill file requires a catalog entry");
  invariant(
    actual.length === files.size && actual.every((file) => files.has(file)),
    "RESOURCE_UNMAPPED",
    "Every packaged resource must have a reviewed origin entry",
  );
  const entries = z
    .array(knowledgeEntrySchema)
    .parse(
      JSON.parse(
        fs.readFileSync(path.join(root, "resources/knowledge.json"), "utf8"),
      ) as unknown,
    );
  const ids = new Set(entries.map((entry) => entry.id));
  invariant(
    ids.size === entries.length,
    "KNOWLEDGE_DUPLICATE",
    "Knowledge IDs must be unique",
  );
  for (const entry of entries) {
    const file = `resources/${entry.file}`,
      record = manifest.files.find((item) => item.file === file);
    invariant(
      record &&
        record.sha256 === entry.sha256 &&
        record.source_path === entry.source_path &&
        sources.get(record.source)?.version === entry.commit &&
        entry.related_ids.every((id) => ids.has(id)),
      "KNOWLEDGE_SOURCE_MISMATCH",
      `Knowledge metadata does not match its resource: ${entry.id}`,
    );
    if (entry.id.startsWith("arkts-runtime-fix/"))
      compileCrashReference(
        entry.id,
        fs.readFileSync(inside(root, file), "utf8"),
      );
  }
  const knowledgeFiles = actual.filter((file) =>
    file.startsWith("resources/knowledge/"),
  );
  invariant(
    knowledgeFiles.length === entries.length &&
      knowledgeFiles.every((file) =>
        entries.some((entry) => file === `resources/${entry.file}`),
      ),
    "KNOWLEDGE_UNINDEXED",
    "Removed or unindexed knowledge must not remain in the package",
  );
  return {
    resources: actual.length,
    knowledge: entries.length,
    sources: sources.size,
  };
}
