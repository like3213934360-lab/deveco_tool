import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProcessService } from "../../src/core/process.js";
import { digest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes("..") &&
      !/[\x00-\x1f]/.test(value),
    "Expected a repository relative path",
  );
export const sourceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url(),
  ref: z.string().startsWith("refs/"),
  commit: sha,
  tree: sha,
  version: z.string(),
  role: z.enum(["resource_source", "protocol_reference"]),
  acceptance: z.enum(["pending", "verified"]),
});
export const lockSchema = z.strictObject({
  format: z.literal(1),
  sources: z.array(sourceSchema).min(1),
});
export const mappingSchema = z.strictObject({
  format: z.literal(1),
  rules: z.array(
    z.strictObject({
      id: z.string().min(1),
      source: z.string(),
      path: relativePath,
      prefix: z.boolean().default(false),
      disposition: z.enum(["adapt", "exclude", "unmapped"]),
      reason: z.string().min(1),
      targets: z.array(relativePath),
      tests: z.array(relativePath),
    }),
  ),
});
export type Source = z.infer<typeof sourceSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export interface TreeEntry {
  path: string;
  oid: string;
  mode: string;
  type: string;
}

export async function git(repository: string, args: string[]): Promise<string> {
  const processService = new ProcessService();
  try {
    const result = await processService.run(
      {
        executable: "git",
        args: ["-C", repository, "--no-pager", ...args],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      { timeoutMs: 120000, limitBytes: 32 * 1024 * 1024 },
    );
    invariant(
      !result.truncated,
      "UPSTREAM_TOO_LARGE",
      "Git metadata exceeds the bounded update report size",
    );
    return result.stdout;
  } finally {
    await processService.close();
  }
}
export async function revision(
  repository: string,
  ref: string,
): Promise<{ commit: string; tree: string }> {
  const commit = sha.parse(
    (
      await git(repository, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
      ])
    ).trim(),
  );
  const tree = sha.parse(
    (
      await git(repository, ["rev-parse", "--verify", `${commit}^{tree}`])
    ).trim(),
  );
  return { commit, tree };
}
export async function tree(
  repository: string,
  commit: string,
): Promise<TreeEntry[]> {
  sha.parse(commit);
  return (await git(repository, ["ls-tree", "-r", "-z", "--full-tree", commit]))
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d{6}) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
      invariant(
        match?.[1] && match[2] && match[3] && match[4],
        "UPSTREAM_TREE_INVALID",
        "Malformed Git tree entry",
      );
      return {
        mode: match[1],
        type: match[2],
        oid: match[3],
        path: relativePath.parse(match[4]),
      };
    });
}
export function classify(mapping: Mapping, source: string, file: string) {
  const rules = mapping.rules
    .filter(
      (rule) =>
        rule.source === source &&
        (rule.prefix ? file.startsWith(rule.path) : file === rule.path),
    )
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(a.prefix) - Number(b.prefix),
    );
  invariant(
    !rules[1] ||
      rules[0]!.path.length !== rules[1].path.length ||
      rules[0]!.prefix !== rules[1].prefix,
    "UPSTREAM_MAPPING_AMBIGUOUS",
    `Ambiguous upstream mapping: ${file}`,
  );
  return rules[0];
}
export function changes(
  source: Source,
  before: TreeEntry[],
  after: TreeEntry[],
  mapping: Mapping,
  workspace: string,
) {
  const old = new Map(before.map((item) => [item.path, item])),
    next = new Map(after.map((item) => [item.path, item]));
  return [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .flatMap((file) => {
      const a = old.get(file),
        b = next.get(file);
      if (a?.oid === b?.oid && a?.mode === b?.mode) return [];
      const rule = classify(mapping, source.id, file);
      const unsafe = [a, b].some(
        (item) =>
          item &&
          (item.type !== "blob" || !["100644", "100755"].includes(item.mode)),
      );
      const missing = (
        rule?.disposition === "adapt" ? [...rule.targets, ...rule.tests] : []
      ).filter((target) => !fs.existsSync(inside(workspace, target)));
      return [
        {
          path: file,
          status: a
            ? b
              ? ("modified" as const)
              : ("deleted" as const)
            : ("added" as const),
          before: a ?? null,
          after: b ?? null,
          mapping: rule?.id ?? null,
          disposition:
            unsafe || missing.length
              ? ("unmapped" as const)
              : (rule?.disposition ?? ("unmapped" as const)),
          reason: unsafe
            ? "Symlink or submodule changes require explicit source handling"
            : missing.length
              ? `Mapped targets/tests do not exist: ${missing.join(", ")}`
              : (rule?.reason ??
                "No reviewed mapping covers this upstream path"),
          targets: rule?.targets ?? [],
          tests: rule?.tests ?? [],
        },
      ];
    });
}
export async function candidate(
  source: Source,
  repository: string,
  ref: string,
  mapping: Mapping,
  workspace: string,
) {
  const origin = (await git(repository, ["remote", "get-url", "origin"]))
    .trim()
    .replace(/\.git$/, "");
  invariant(
    origin === source.url.replace(/\.git$/, ""),
    "UPSTREAM_ORIGIN_MISMATCH",
    "Candidate checkout origin does not match its source lock",
  );
  const base = await revision(repository, source.commit);
  invariant(
    base.tree === source.tree,
    "UPSTREAM_BASE_MISMATCH",
    "Locked upstream tree does not match the checked out Git objects",
  );
  const next = await revision(repository, ref);
  const [before, after] = await Promise.all([
    tree(repository, base.commit),
    tree(repository, next.commit),
  ]);
  const delta = changes(source, before, after, mapping, workspace);
  const report = {
    format: 1 as const,
    source: source.id,
    url: source.url,
    base,
    candidate: next,
    mapping_sha256: digest(mapping),
    changes: delta,
    gate: delta.some((item) => item.disposition === "unmapped")
      ? "blocked_unmapped"
      : delta.some((item) => item.disposition === "adapt")
        ? "requires_adapter_review"
        : "requires_release_validation",
    required_tests: [...new Set(delta.flatMap((item) => item.tests))].sort(),
    note: "Source classification is a review proposal. It does not convert natural language into code, approve protocol semantics, modify the active source lock or authorize release.",
  };
  return { ...report, sha256: digest(report) };
}
export function candidateBody(
  report: Awaited<ReturnType<typeof candidate>>,
): string {
  const quoted = (value: string) => value.replace(/[\r\n`]/g, " ");
  return `# Upstream update candidate: ${quoted(report.source)}\n\nBase: ${report.base.commit}\nCandidate: ${report.candidate.commit}\nReport SHA-256: ${report.sha256}\nGate: ${report.gate}\n\nThis draft requires adapter and workflow review before the source lock can change.\n\n${report.changes.map((item) => `- ${item.status}: \`${quoted(item.path)}\` — ${item.disposition} (${quoted(item.mapping ?? "unmapped")})`).join("\n")}\n\nRequired validation:\n${report.required_tests.map((file) => `- \`${quoted(file)}\``).join("\n")}\n\nReview steps:\n1. Resolve every unmapped path with explicit targets or an exclusion reason.\n2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.\n3. Run the mapped regressions and the platform/performance release gates.\n4. Review the candidate commit and content digests, then update the source lock in the reviewed change.\n5. Publish a candidate release only after the complete release gate passes.\n`;
}

const treeEntrySchema = z.strictObject({
  path: relativePath,
  oid: sha,
  mode: z.string(),
  type: z.string(),
});
export const candidateSchema = z.strictObject({
  format: z.literal(1),
  source: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url(),
  base: z.strictObject({ commit: sha, tree: sha }),
  candidate: z.strictObject({ commit: sha, tree: sha }),
  mapping_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z
    .array(
      z.strictObject({
        path: relativePath,
        status: z.enum(["added", "modified", "deleted"]),
        before: treeEntrySchema.nullable(),
        after: treeEntrySchema.nullable(),
        mapping: z.string().nullable(),
        disposition: z.enum(["adapt", "exclude", "unmapped"]),
        reason: z.string(),
        targets: z.array(relativePath),
        tests: z.array(relativePath),
      }),
    )
    .max(20000),
  gate: z.enum([
    "blocked_unmapped",
    "requires_adapter_review",
    "requires_release_validation",
  ]),
  required_tests: z.array(relativePath),
  note: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function verifyCandidate(
  raw: unknown,
  source: Source,
  mapping: Mapping,
) {
  const report = candidateSchema.parse(raw),
    { sha256, ...payload } = report;
  invariant(
    digest(payload) === sha256,
    "UPSTREAM_REPORT_CHANGED",
    "Candidate report failed its digest check",
  );
  invariant(
    report.source === source.id &&
      report.url === source.url &&
      report.base.commit === source.commit &&
      report.base.tree === source.tree,
    "UPSTREAM_REPORT_STALE",
    "Candidate no longer matches the source lock",
  );
  invariant(
    report.mapping_sha256 === digest(mapping),
    "UPSTREAM_REPORT_STALE",
    "Candidate mapping has changed; regenerate the report",
  );
  const expectedGate = report.changes.some(
    (item) => item.disposition === "unmapped",
  )
    ? "blocked_unmapped"
    : report.changes.some((item) => item.disposition === "adapt")
      ? "requires_adapter_review"
      : "requires_release_validation";
  invariant(
    report.gate === expectedGate,
    "UPSTREAM_GATE_INVALID",
    "Candidate gate does not match its classified changes",
  );
  return report;
}
