import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDirectory } from "../core/config.js";
import {
  atomicWrite,
  digest,
  fileDigest,
  inside,
  privateDirectory,
} from "../core/files.js";
import { invariant } from "../core/errors.js";
import type { Project } from "./project.js";

const entrySchema = z
  .object({
    directory: z.string().min(1),
    file: z.string().min(1),
    command: z.string().min(1).optional(),
    arguments: z.array(z.string()).min(1).optional(),
    output: z.string().optional(),
  })
  .refine(
    (entry) => entry.command !== undefined || entry.arguments !== undefined,
    "Compilation entry needs its real command or arguments",
  );
export interface CompilationDatabase {
  directory: string;
  hash: string;
  abi: string;
  mode: string;
  files: ReadonlySet<string>;
  sources: string[];
}

/** Consume native Hvigor/CMake output for one product, target, mode and ABI. Never synthesize compiler flags. */
export function compilationDatabase(
  project: Project,
  input: { abi?: string; mode?: "debug" | "release" } = {},
): CompilationDatabase {
  const mode = input.mode ?? "debug";
  const candidates: { file: string; abi: string; module: string }[] = [];
  for (const module of project.modules) {
    const directory = inside(
      module.root,
      path.join(".cxx", project.product.name, module.target, mode),
    );
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name, "compile_commands.json");
      if (entry.isDirectory() && !entry.isSymbolicLink() && fs.existsSync(file))
        candidates.push({ file, abi: entry.name, module: module.name });
    }
  }
  const available = [...new Set(candidates.map((item) => item.abi))].sort(),
    abi = input.abi ?? (available.length === 1 ? available[0] : undefined);
  invariant(
    candidates.length > 0,
    "COMPILE_DATABASE_MISSING",
    "Build native modules to generate their CMake compilation databases",
  );
  invariant(
    abi && available.includes(abi),
    "COMPILE_DATABASE_ABI_AMBIGUOUS",
    `Select one built ABI: ${available.join(", ")}`,
  );
  const selected = candidates.filter((item) => item.abi === abi);
  const hash = digest([
    project.root,
    project.fingerprint,
    mode,
    abi,
    selected.map((item) => [item.file, fileDigest(item.file)]),
  ]);
  const directory = path.join(stateDirectory(), "compilation-databases", hash),
    output = path.join(directory, "compile_commands.json");
  const commands = selected.flatMap((item) => {
    invariant(
      fs.statSync(item.file).size <= 32 * 1024 * 1024,
      "COMPILE_DATABASE_TOO_LARGE",
      "Compilation database exceeds 32 MiB",
    );
    return z
      .array(entrySchema)
      .max(100000)
      .parse(JSON.parse(fs.readFileSync(item.file, "utf8")) as unknown);
  });
  invariant(
    commands.length > 0,
    "COMPILE_DATABASE_EMPTY",
    "Native compilation databases contain no translation units",
  );
  const unique = [
    ...new Map(commands.map((command) => [digest(command), command])).values(),
  ];
  const files = new Set(
    unique.map((command) =>
      fs.realpathSync.native(path.resolve(command.directory, command.file)),
    ),
  );
  privateDirectory(directory);
  if (!fs.existsSync(output)) atomicWrite(output, JSON.stringify(unique));
  return {
    directory,
    hash,
    abi,
    mode,
    files,
    sources: selected.map((item) => item.file),
  };
}
