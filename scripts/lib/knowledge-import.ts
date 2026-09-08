import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite, fileDigest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { revision, tree, git, type Source } from "./upstream.js";
import { resourceManifest } from "./resources.js";
import { compileCrashReference } from "../../src/services/crash-patterns.js";

/** Prepare reviewed resource bytes in a new bundle; active files and source locks are never silently updated. */
export async function prepareKnowledge(baseRoot: string, repository: string, source: Source, outputRoot: string) {
invariant(!fs.existsSync(outputRoot), "OUTPUT_EXISTS", "Use a new knowledge output directory");
const base = await revision(repository, source.commit);
invariant(
  base.tree === source.tree,
  "UPSTREAM_BASE_MISMATCH",
  "Knowledge source tree does not match its lock",
);
const entries = [];
const contents = new Map<string, string>();
for (const item of await tree(repository, source.commit)) {
  const match =
    /^packages\/opencode\/resources\/skills\/(arkts-error-fixes|arkts-grammar-standards|arkts-runtime-fix)\/(references?\/([^/]+\.md)|assets\/([^/]+\.ets))$/.exec(
      item.path,
    );
  if (!match) continue;
  invariant(
    item.mode === "100644" && item.type === "blob",
    "KNOWLEDGE_SOURCE_INVALID",
    "Knowledge entries must be ordinary source files",
  );
  const content = await git(repository, [
    "show",
    `${source.commit}:${item.path}`,
  ]);
  const category = match[1]!,
    name = match[3] ?? match[4]!;
  const example = name.endsWith(".ets");
  const file = `knowledge/${category}/${example ? "examples/" : ""}${name}`;
  if (category === "arkts-runtime-fix")
    compileCrashReference(
      `${category}/${path.basename(name, path.extname(name))}`,
      content,
    );
  const title =
    /^#+\s+(.+)$/m.exec(content)?.[1] ??
    path.basename(name, path.extname(name));
  contents.set(file, content);
  entries.push({
    id: `${category}/${example ? "examples/" : ""}${path.basename(name, path.extname(name))}`,
    file,
    title,
    source: source.id,
    source_path: item.path,
    commit: source.commit,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    kind: example
      ? "example"
      : category === "arkts-grammar-standards"
        ? "rule"
        : "case",
    summary: example
      ? `Upstream ArkTS error/corrected code example: ${title}`
      : `Upstream ${category} reference: ${title}`,
    applicability:
      category === "arkts-runtime-fix"
        ? "HarmonyOS runtime error analysis; compare the case with captured logs and the project's target SDK before recommending a change. No automatic code modification."
        : example
          ? "Illustrative ArkTS examples, including intentionally invalid code. Not a complete application or proof of compatibility with every target API."
          : "ArkTS language and API guidance. Compiler and target API version applicability must be checked against the selected SDK; static advice is not compilation proof.",
    related_ids: [] as string[],
  });
}
invariant(
  entries.length > 0,
  "KNOWLEDGE_SOURCE_EMPTY",
  "No mapped knowledge references or examples were found",
);
for (const category of [
  "arkts-error-fixes",
  "arkts-grammar-standards",
  "arkts-runtime-fix",
])
  invariant(
    entries.some((entry) => entry.id.startsWith(category + "/")),
    "KNOWLEDGE_CATEGORY_MISSING",
    `No references were imported for ${category}`,
  );
const bySource = new Map(entries.map((entry) => [entry.source_path, entry.id]));
for (const entry of entries) {
  const content = contents.get(entry.file)!;
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1]!.split("#")[0]!;
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const id = bySource.get(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(entry.source_path), target),
      ),
    );
    if (id && !entry.related_ids.includes(id)) entry.related_ids.push(id);
  }
}
entries.sort((a, b) => a.id.localeCompare(b.id));
const index = JSON.stringify(entries, null, 2) + "\n";
contents.set("knowledge.json", index);
const manifest = resourceManifest.parse(JSON.parse(fs.readFileSync(path.join(baseRoot, "provenance/resources.json"), "utf8")) as unknown);
const previous = manifest.files.filter((item) => item.file === "resources/knowledge.json" || item.file.startsWith("resources/knowledge/"));
for (const item of previous) invariant(fileDigest(inside(baseRoot, item.file)) === item.sha256, "KNOWLEDGE_LOCAL_CHANGE", "Existing knowledge changed; review local edits before importing an upstream revision");
const records = entries.map((entry) => ({ file: `resources/${entry.file}`, sha256: entry.sha256, source: source.id, source_path: entry.source_path, source_sha256: entry.sha256, transformation: "unchanged" }));
const indexHash = crypto.createHash("sha256").update(index).digest("hex");
records.push({ file: "resources/knowledge.json", sha256: indexHash, source: "deveco-tool", source_path: "resources/knowledge.json", source_sha256: indexHash, transformation: "repository-authored metadata, documentation or SVG resource" });
manifest.files = [...manifest.files.filter((item) => !previous.includes(item)), ...records].sort((a, b) => a.file.localeCompare(b.file));
const origin = manifest.sources.find((item) => item.id === source.id);
invariant(origin, "KNOWLEDGE_SOURCE_MISSING", "Resource origin is missing");
origin.version = source.commit; origin.integrity = `git-tree:${source.tree}`;
for (const [file, content] of contents) atomicWrite(inside(outputRoot, `resources/${file}`), content, false);
atomicWrite(path.join(outputRoot, "provenance/resources.json"), JSON.stringify(manifest, null, 2) + "\n", false);
return { entries: entries.length, writes: [...records.map((item) => item.file), "provenance/resources.json"], deletes: previous.filter((item) => !records.some((next) => next.file === item.file)).map((item) => item.file) };
}
