import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";
import { lockSchema, revision, tree, git } from "./lib/upstream.js";

const repository = path.resolve(z.string().min(1).parse(process.argv[2]));
const lock = lockSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "provenance/upstream-lock.json"),
      "utf8",
    ),
  ) as unknown,
);
const source = lock.sources.find((item) => item.id === "deveco-code");
invariant(source, "SOURCE_MISSING", "Missing reviewed knowledge source");
const base = await revision(repository, source.commit);
invariant(
  base.tree === source.tree,
  "UPSTREAM_BASE_MISMATCH",
  "Knowledge source tree does not match its lock",
);
const entries = [];
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
  const title =
    /^#+\s+(.+)$/m.exec(content)?.[1] ??
    path.basename(name, path.extname(name));
  atomicWrite(path.join(packageRoot, "resources", file), content);
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
  const content = fs.readFileSync(
    path.join(packageRoot, "resources", entry.file),
    "utf8",
  );
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
atomicWrite(
  path.join(packageRoot, "resources/knowledge.json"),
  JSON.stringify(entries, null, 2) + "\n",
);
process.stdout.write(
  `Imported ${entries.length} pinned knowledge entries. No Skill definitions or executable upstream scripts were imported.\n`,
);
