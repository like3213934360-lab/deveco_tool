import path from "node:path";
import { z } from "zod";
import { git } from "./lib/upstream.js";
import { upgradeScope } from "./lib/upgrade-scope.js";
const repository = path.resolve(z.string().min(1).parse(process.argv[2])),
  supplied = process.argv[3],
  defaultBranch = z
    .string()
    .min(1)
    .parse(process.argv[4] ?? "main");
const base = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .parse(
    supplied && !/^0+$/.test(supplied)
      ? supplied
      : (
          await git(repository, [
            "merge-base",
            "HEAD",
            `refs/remotes/origin/${defaultBranch}`,
          ])
        ).trim(),
  );
const files = (
  await git(repository, ["diff", "--name-only", "-z", base, "HEAD", "--"])
)
  .split("\0")
  .filter(Boolean);
const [before, after, baseline] = await Promise.all([
  git(repository, ["show", `${base}:package-lock.json`]),
  git(repository, ["show", "HEAD:package-lock.json"]),
  git(repository, [
    "ls-tree",
    "--name-only",
    base,
    "--",
    "provenance/upstream-lock.json",
  ]),
]);
console.log(
  JSON.stringify(
    upgradeScope(
      JSON.parse(before) as unknown,
      JSON.parse(after) as unknown,
      files,
      Boolean(baseline.trim()),
    ),
    null,
    2,
  ),
);
