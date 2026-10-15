import fs from "node:fs";
import path from "node:path";
import { walk, inside } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { run } from "../core/proc.js";

/** Static candidates, deliberately separate from runtime component metadata. */
export async function sourceOrigin(project: string, input: { key?: string; text?: string; file?: string; line?: number }, signal: AbortSignal) {
  invariant(input.key || input.text || input.file, "INVALID_INPUT", "origin requires key, text or file");
  const candidates: { file: string; line: number; code: string; evidence: string }[] = [];
  if (input.file) {
    const file = inside(project, input.file), lines = fs.readFileSync(file, "utf8").split("\n"), line = input.line ?? 1;
    invariant(line <= lines.length, "INVALID_INPUT", "line is outside the file");
    candidates.push({ file: path.relative(project, file), line, code: lines[line - 1]!, evidence: "caller-location" });
  } else for (const file of walk(project)) {
    if (!/\.(ets|ts)$/.test(file)) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((code, i) => {
      const key = input.key && [`.id('${input.key}')`, `.id("${input.key}")`].some((s) => code.includes(s));
      if (key || (input.text && [JSON.stringify(input.text), `'${input.text}'`].some((s) => code.includes(s)))) candidates.push({ file: path.relative(project, file), line: i + 1, code: code.trim().slice(0, 400), evidence: key ? "literal-id" : "literal-text" });
    });
  }
  const locations = [];
  const repository = await run({ file: "git", args: ["rev-parse", "--is-inside-work-tree"], cwd: project }, { signal, allowFailure: true });
  for (const c of candidates.slice(0, 30)) {
    const tracked = await run({ file: "git", args: ["ls-files", "--error-unmatch", "--", c.file], cwd: project }, { signal, allowFailure: true });
    const blame = await run({ file: "git", args: ["blame", "--line-porcelain", "-L", `${c.line},${c.line}`, "--", c.file], cwd: project }, { signal, allowFailure: true });
    const diff = await run({ file: "git", args: ["diff", "--unified=0", "HEAD", "--", c.file], cwd: project }, { signal, allowFailure: true });
    const ranges = [...diff.stdout.matchAll(/^@@ .*? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ start: Number(m[1]), count: Number(m[2] ?? 1) }));
    locations.push({ ...c, changed: repository.code !== 0 ? null : tracked.code !== 0 ? true : diff.code === 0 ? ranges.some((r) => c.line >= r.start && c.line < r.start + r.count) : null, commit: blame.code === 0 ? blame.stdout.split(" ")[0] : null, git_available: repository.code === 0, tracked: repository.code === 0 ? tracked.code === 0 : null });
  }
  return { mapping: "static-candidates", runtime_identity_verified: false, total: candidates.length, locations, more: Math.max(0, candidates.length - locations.length) };
}
