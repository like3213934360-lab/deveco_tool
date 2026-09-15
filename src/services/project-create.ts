import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { digest, fileDigest, inside, readObject, walk } from "../core/files.js";
import { DirectoryPublication } from "../core/directory-publication.js";
import { invariant, ToolError } from "../core/errors.js";

const identity = (file: string) => {
  const stat = fs.lstatSync(file);
  invariant(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "CREATE_PATH_CHANGED",
    `Expected a real directory: ${file}`,
  );
  return `${stat.dev}:${stat.ino}`;
};
const fileSchema = z.object({
  file: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const preparedSchema = z.object({
  format: z.literal(2),
  operation_id: z.string(),
  input_hash: z.string(),
  root: z.string(),
  root_identity: z.string(),
  stage: z.string(),
  stage_identity: z.string(),
  directories: z.record(z.string(), z.string()),
  files: z.array(fileSchema).min(1).max(10000),
});
type Prepared = z.infer<typeof preparedSchema>;

function ancestors(root: string, relative: string) {
  const target = inside(root, relative),
    parents: string[] = [];
  let current = path.dirname(target);
  while (current !== root) {
    parents.unshift(current);
    current = path.dirname(current);
  }
  return parents;
}
function sameFile(a: string, b: string, sha256: string) {
  const left = fs.lstatSync(a, { throwIfNoEntry: false }),
    right = fs.lstatSync(b, { throwIfNoEntry: false });
  return (
    !!left &&
    !!right &&
    left.isFile() &&
    right.isFile() &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    fileDigest(a) === sha256 &&
    fileDigest(b) === sha256
  );
}
function assertParents(prepared: Prepared, relative: string) {
  invariant(
    identity(prepared.root) === prepared.root_identity,
    "CREATE_PATH_CHANGED",
    "Project root was replaced during creation",
  );
  for (const parent of ancestors(prepared.root, relative)) {
    const current = identity(parent),
      expected = prepared.directories[path.relative(prepared.root, parent)];
    invariant(
      !expected || expected === current,
      "CREATE_PATH_CHANGED",
      `Project directory was replaced: ${parent}`,
    );
  }
}

/** Reconcile only links to the preserved staging files. Equal-looking user files
 * do not establish ownership. Existing files are never replaced or removed. */
function finish(prepared: Prepared, signal?: AbortSignal) {
  invariant(
    identity(prepared.stage) === prepared.stage_identity,
    "CREATE_STAGE_CHANGED",
    "Prepared project staging directory changed",
  );
  const stageDirectories = new Map<string, string>();
  for (const entry of prepared.files)
    for (const directory of ancestors(prepared.stage, entry.file))
      stageDirectories.set(directory, identity(directory));
  const publisher = new DirectoryPublication(
    prepared.root,
    prepared.root_identity,
    prepared.directories,
  );
  try {
    const sourcePublisher = new DirectoryPublication(
      prepared.stage,
      prepared.stage_identity,
      Object.fromEntries(
        [...stageDirectories].map(([directory, id]) => [
          path.relative(prepared.stage, directory),
          id,
        ]),
      ),
    );
    try {
      for (const entry of prepared.files) {
        signal?.throwIfAborted();
        const source = inside(prepared.stage, entry.file),
          stat = fs.lstatSync(source, { throwIfNoEntry: false });
        invariant(
          stat?.isFile() &&
            !stat.isSymbolicLink() &&
            fileDigest(source) === entry.sha256,
          "CREATE_STAGE_CHANGED",
          `Prepared file changed: ${entry.file}`,
        );
        invariant(
          identity(prepared.root) === prepared.root_identity,
          "CREATE_PATH_CHANGED",
          "Project root was replaced during creation",
        );
        for (const parent of ancestors(prepared.root, entry.file)) {
          const relative = path.relative(prepared.root, parent);
          if (!fs.lstatSync(parent, { throwIfNoEntry: false })) {
            assertParents(prepared, relative);
            publisher.mkdir(relative);
          }
          const current = identity(parent),
            expected = prepared.directories[relative];
          invariant(
            !expected || expected === current,
            "CREATE_PATH_CHANGED",
            `Project directory was replaced: ${relative}`,
          );
          prepared.directories[relative] = current;
        }
        assertParents(prepared, entry.file);
        const destination = inside(prepared.root, entry.file);
        if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
          invariant(
            sameFile(source, destination, entry.sha256),
            "CREATE_CONFLICT",
            `Creation cannot overwrite ${entry.file}`,
          );
        } else {
          // Atomic exclusive link: a concurrent file/symlink cannot be clobbered.
          try {
            publisher.link(sourcePublisher, entry.file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
              throw new ToolError(
                "CREATE_CONFLICT",
                `Creation cannot overwrite ${entry.file}`,
                { conflicts: [entry.file] },
              );
            throw error;
          }
          assertParents(prepared, entry.file);
          invariant(
            sameFile(source, destination, entry.sha256),
            "CREATE_PATH_CHANGED",
            `Published file changed: ${entry.file}`,
          );
        }
      }
      for (const entry of prepared.files) {
        assertParents(prepared, entry.file);
        invariant(
          sameFile(
            inside(prepared.stage, entry.file),
            inside(prepared.root, entry.file),
            entry.sha256,
          ),
          "CREATE_PATH_CHANGED",
          `Published project changed before completion: ${entry.file}`,
        );
      }
      assertParents(prepared, ".deveco-mcp/create.json");
      publisher.write(
        ".deveco-mcp/create.json",
        JSON.stringify({
          operation_id: prepared.operation_id,
          input_hash: prepared.input_hash,
          status: "completed",
          files: prepared.files,
        }),
      );
    } finally {
      sourcePublisher.close();
    }
  } finally {
    publisher.close();
  }
  // Only unlink the known staging files and empty owned directories. Unexpected
  // additions are retained; failure never recursively deletes a user's project.
  for (const entry of prepared.files) {
    const source = inside(prepared.stage, entry.file);
    if (sameFile(source, inside(prepared.root, entry.file), entry.sha256))
      fs.unlinkSync(source);
  }
  const directories = new Set(
    prepared.files.flatMap((entry) => ancestors(prepared.stage, entry.file)),
  );
  for (const directory of [...directories].sort(
    (a, b) => b.length - a.length,
  )) {
    try {
      if (identity(directory) === stageDirectories.get(directory))
        fs.rmdirSync(directory);
    } catch {
      /* Retain directories with unexpected additions. */
    }
  }
  try {
    if (identity(prepared.stage) === prepared.stage_identity)
      fs.rmdirSync(prepared.stage);
  } catch {
    /* Retain unexpected additions. */
  }
}

/** The caller fully generates and validates the project before publication. */
export function publishProject(
  stage: string,
  root: string,
  input: unknown,
  operationId: string,
  merge: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const files = walk(stage).map((file) => ({
    file: path.relative(stage, file).replaceAll("\\", "/"),
    sha256: fileDigest(file),
  }));
  const existing = fs.lstatSync(root, { throwIfNoEntry: false }),
    directories: Record<string, string> = {};
  const originalRoot = existing ? identity(root) : undefined;
  if (existing) {
    identity(root);
    invariant(
      merge || fs.readdirSync(root).length === 0,
      "PROJECT_EXISTS",
      "Project directory is not empty; use merge=true for explicit non-overwriting creation",
    );
  }
  const conflicts = new Set<string>();
  if (fs.lstatSync(path.join(root, ".deveco-mcp"), { throwIfNoEntry: false }))
    conflicts.add(".deveco-mcp");
  for (const entry of files) {
    for (const parent of ancestors(root, entry.file)) {
      const relative = path.relative(root, parent),
        stat = fs.lstatSync(parent, { throwIfNoEntry: false });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
        conflicts.add(relative);
        break;
      }
      if (stat) directories[relative] = identity(parent);
    }
    // Do not follow a known conflicting ancestor while inspecting children.
    if (
      [...conflicts].some(
        (conflict) =>
          entry.file === conflict ||
          entry.file.startsWith(conflict.replaceAll("\\", "/") + "/"),
      )
    )
      continue;
    if (fs.lstatSync(inside(root, entry.file), { throwIfNoEntry: false }))
      conflicts.add(entry.file);
  }
  if (conflicts.size)
    throw new ToolError(
      "CREATE_CONFLICT",
      "Project creation found conflicting paths; destination was not changed",
      { conflicts: [...conflicts].sort() },
    );
  signal?.throwIfAborted();
  if (!existing) {
    const parent = new DirectoryPublication(path.dirname(root));
    try {
      parent.mkdir(path.basename(root));
    } finally {
      parent.close();
    }
  } else
    invariant(
      identity(root) === originalRoot,
      "CREATE_PATH_CHANGED",
      "Project root changed during conflict inspection",
    );
  const prepared: Prepared = {
    format: 2,
    operation_id: operationId,
    input_hash: digest(input),
    root,
    root_identity: identity(root),
    stage,
    stage_identity: identity(stage),
    directories,
    files,
  };
  // Reserve a new receipt directory; never merge with another creator's journal.
  const publisher = new DirectoryPublication(
    root,
    prepared.root_identity,
    prepared.directories,
  );
  try {
    publisher.mkdir(".deveco-mcp");
    prepared.directories[".deveco-mcp"] = identity(
      path.join(root, ".deveco-mcp"),
    );
    publisher.write(".deveco-mcp/create-start.json", JSON.stringify(prepared));
  } finally {
    publisher.close();
  }
  finish(prepared, signal);
}

export function resumeProjectPublication(
  root: string,
  input: unknown,
  operationId: string,
  signal?: AbortSignal,
) {
  const journal = path.join(root, ".deveco-mcp/create-start.json");
  if (!fs.existsSync(journal)) return false;
  const parsed = preparedSchema.safeParse(readObject(journal));
  if (!parsed.success) return false;
  const prepared = parsed.data;
  if (
    prepared.operation_id !== operationId ||
    prepared.input_hash !== digest(input) ||
    prepared.root !== root
  )
    return false;
  invariant(
    path.dirname(prepared.stage) === path.dirname(root) &&
      path.basename(prepared.stage).startsWith(".deveco-create-"),
    "CREATE_STAGE_CHANGED",
    "Unexpected staging directory",
  );
  for (const file of prepared.files) {
    invariant(
      file.file !== "." &&
        file.file !== "" &&
        !path.isAbsolute(file.file) &&
        inside(root, file.file) !== root,
      "CREATE_JOURNAL_INVALID",
      "Invalid staged file path",
    );
  }
  finish(prepared, signal);
  return true;
}
