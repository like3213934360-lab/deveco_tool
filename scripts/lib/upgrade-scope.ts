import { z } from "zod";
import { invariant } from "../../src/core/errors.js";
const lockSchema = z
  .object({
    packages: z.record(
      z.string(),
      z.object({ version: z.string().optional() }).passthrough(),
    ),
  })
  .passthrough();
const framework = [
  "@langchain/core",
  "@langchain/langgraph",
  "@langchain/langgraph-checkpoint",
  "@langchain/langgraph-checkpoint-sqlite",
  "@modelcontextprotocol/sdk",
  "better-sqlite3",
  "zod",
  "typescript",
];
export function upgradeScope(
  before: unknown,
  after: unknown,
  files: string[],
  hasOfficialBaseline: boolean,
) {
  const old = lockSchema.parse(before),
    next = lockSchema.parse(after),
    changes = framework.flatMap((name) => {
      const from = old.packages[`node_modules/${name}`]?.version,
        to = next.packages[`node_modules/${name}`]?.version;
      return from && to && from !== to ? [{ name, from, to }] : [];
    });
  const official = hasOfficialBaseline
    ? files.filter(
        (file) =>
          file === "provenance/upstream-lock.json" ||
          file === "provenance/upstream-mapping.json" ||
          file.startsWith("resources/"),
      )
    : [];
  invariant(
    !changes.length || !official.length,
    "UPGRADE_SCOPE_MIXED",
    "Framework dependency upgrades and official source/toolchain upgrades must use separate pull requests",
  );
  return {
    framework_updates: changes,
    official_files: official,
    initial_migration: !hasOfficialBaseline,
  };
}
