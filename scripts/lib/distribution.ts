import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync, crc32 } from "node:zlib";
import AdmZip from "adm-zip";
import { z } from "zod";
import { invariant } from "../../src/core/errors.js";
import { release, protocolVersion } from "../../src/core/config.js";
import { verifyResources } from "./resources.js";

const limitBytes = 256 * 1024 * 1024;
const limitFiles = 10000;
const manifestName = "distribution.json";
const sha256 = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const record = z.record(z.string(), z.string());
const policySchema = z.strictObject({
  format: z.literal(1),
  dependencies: z.array(z.string().min(1)).min(1),
});
const metadataFiles = new Set([
  "package.json",
  "package-lock.json",
  "LICENSE",
  "INSTALL.md",
  "provenance/resources.json",
  "provenance/upstream-lock.json",
  "provenance/upstream-mapping.json",
  "provenance/native-dependencies.json",
  "provenance/installed-skill-fingerprints.json",
]);
const packageSchema = z.strictObject({
  name: z.literal("deveco-tool"),
  version: z.literal(release),
  private: z.literal(true),
  description: z.literal(
    "Native compiled installation candidate; release gates are still required",
  ),
  type: z.literal("module"),
  engines: z.strictObject({ node: z.literal("^22.18.0 || ^24.0.0") }),
  bin: z.strictObject({ "deveco-tool": z.literal("dist/src/cli.js") }),
  dependencies: record,
  overrides: record,
});
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.includes(":") &&
      !value.includes("\0") &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            !/[<>"|?*\x00-\x1f]/.test(part) &&
            !/[ .]$/.test(part) &&
            !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
        ),
  );
const manifestSchema = z.strictObject({
  format: z.literal(1),
  kind: z.literal("installation-validation"),
  release: z.literal(release),
  protocol: z.literal(protocolVersion),
  source_lock_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z
    .array(
      z.strictObject({
        file: relativePath,
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(limitFiles),
});
type Manifest = z.infer<typeof manifestSchema>;
function json(file: string): unknown {
  invariant(
    fs.lstatSync(file).isFile() && fs.statSync(file).size <= 8 * 1024 * 1024,
    "DISTRIBUTION_METADATA_INVALID",
    "Metadata must be a bounded regular file",
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}
function dependencyPolicy(root: string) {
  const policy = policySchema.parse(
    json(path.join(root, "provenance/native-dependencies.json")),
  );
  invariant(
    new Set(policy.dependencies).size === policy.dependencies.length,
    "DISTRIBUTION_DEPENDENCIES_INVALID",
    "Duplicate native dependency names",
  );
  return policy.dependencies;
}
function forbiddenDependency(name: string) {
  return (
    /(?:^|\/)@deveco(?:-codegenie)?\//.test(name) ||
    /(?:^|\/)typescript$/.test(name)
  );
}
export function nativePackage(root: string) {
  const source = z
    .object({ dependencies: record, overrides: record.default({}) })
    .parse(json(path.join(root, "package.json")));
  const dependencies = Object.fromEntries(
    dependencyPolicy(root).map((name) => {
      const version = source.dependencies[name];
      invariant(
        !forbiddenDependency(name) &&
          version &&
          /^\d+\.\d+\.\d+$/.test(version),
        "DISTRIBUTION_DEPENDENCIES_INVALID",
        `Native dependency must be allowed and exactly pinned: ${name}`,
      );
      return [name, version];
    }),
  );
  return packageSchema.parse({
    name: "deveco-tool",
    version: release,
    private: true,
    description:
      "Native compiled installation candidate; release gates are still required",
    type: "module",
    engines: { node: "^22.18.0 || ^24.0.0" },
    bin: { "deveco-tool": "dist/src/cli.js" },
    dependencies,
    overrides: source.overrides,
  });
}
function allowed(file: string) {
  return (
    metadataFiles.has(file) ||
    /^NOTICE\.[A-Za-z0-9_-]+$/.test(file) ||
    /^dist\/src\/.+\.(?:js|js\.map|d\.ts)$/.test(file) ||
    file.startsWith("resources/")
  );
}
function inventory(root: string, installed = false) {
  invariant(
    fs.lstatSync(root).isDirectory(),
    "DISTRIBUTION_PATH_INVALID",
    "Distribution root must be a real directory",
  );
  const files: Manifest["files"] = [];
  let total = 0;
  const caseNames = new Set<string>();
  const visit = (relative: string) => {
    for (const item of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const file = relative ? `${relative}/${item.name}` : item.name;
      // The installed dependency tree is checked against the lock by npm ci.
      if (installed && file === "node_modules" && item.isDirectory()) continue;
      relativePath.parse(file);
      invariant(
        !item.isSymbolicLink(),
        "DISTRIBUTION_SYMLINK",
        `Symlinks cannot be packaged: ${file}`,
      );
      invariant(
        !caseNames.has(file.toLowerCase()),
        "DISTRIBUTION_PATH_COLLISION",
        `Case-insensitive path collision: ${file}`,
      );
      caseNames.add(file.toLowerCase());
      if (item.isDirectory()) {
        invariant(
          file === "dist" ||
            file === "dist/src" ||
            file.startsWith("dist/src/") ||
            file === "resources" ||
            file.startsWith("resources/") ||
            file === "provenance",
          "DISTRIBUTION_UNEXPECTED_FILE",
          `Unexpected directory: ${file}`,
        );
        visit(file);
      } else {
        invariant(
          item.isFile(),
          "DISTRIBUTION_SPECIAL_FILE",
          `Only regular files can be packaged: ${file}`,
        );
        if (file === manifestName) continue;
        invariant(
          allowed(file),
          "DISTRIBUTION_UNEXPECTED_FILE",
          `Unexpected file: ${file}`,
        );
        const stat = fs.statSync(path.join(root, file));
        total += stat.size;
        invariant(
          total <= limitBytes && files.length < limitFiles,
          "DISTRIBUTION_LIMIT",
          "Distribution exceeds its file or byte budget",
        );
        const bytes = fs.readFileSync(path.join(root, file));
        invariant(
          bytes.length === stat.size,
          "DISTRIBUTION_CHANGED",
          `File size changed: ${file}`,
        );
        files.push({ file, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  visit("");
  return files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
export function prepareDistribution(root: string, output: string) {
  const relative = path.relative(root, output);
  invariant(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "DISTRIBUTION_PATH_INVALID",
    "Build the distribution outside its source directory",
  );
  invariant(
    !fs.existsSync(output),
    "DISTRIBUTION_EXISTS",
    "Use a new distribution directory",
  );
  const pkg = nativePackage(root);
  verifyResources(root);
  fs.mkdirSync(output, { recursive: true });
  const copy = (relative: string) => {
    const input = path.join(root, relative),
      target = path.join(output, relative),
      stat = fs.lstatSync(input);
    invariant(
      !stat.isSymbolicLink(),
      "DISTRIBUTION_SYMLINK",
      `Symlinks cannot be packaged: ${relative}`,
    );
    if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(input)) copy(`${relative}/${name}`);
    } else {
      invariant(
        stat.isFile() && allowed(relative),
        "DISTRIBUTION_UNEXPECTED_FILE",
        `Unexpected input: ${relative}`,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(input, target, fs.constants.COPYFILE_EXCL);
    }
  };
  for (const name of ["dist/src", "resources", ...metadataFiles].filter(
    (name) => !["package.json", "INSTALL.md"].includes(name),
  ))
    copy(name);
  for (const name of fs
    .readdirSync(root)
    .filter((name) => name.startsWith("NOTICE.")))
    copy(name);
  fs.copyFileSync(
    path.join(root, "docs/native-installation.md"),
    path.join(output, "INSTALL.md"),
    fs.constants.COPYFILE_EXCL,
  );
  writeJson(path.join(output, "package.json"), pkg);
  invariant(
    fs.existsSync(path.join(output, "dist/src/cli.js")),
    "DISTRIBUTION_ENTRY_MISSING",
    "Compile TypeScript before preparing a distribution",
  );
  fs.chmodSync(path.join(output, "dist/src/cli.js"), 0o755);
  // The copied lock is a seed only. npm must normalize it before seal accepts it.
  return {
    output,
    kind: "installation-validation",
    next: "npm install --package-lock-only --ignore-scripts",
  };
}
export function validateDistributionLock(root: string) {
  const pkg = packageSchema.parse(json(path.join(root, "package.json"))),
    names = dependencyPolicy(root);
  invariant(
    Object.keys(pkg.dependencies).length === names.length &&
      names.every((name) => Object.hasOwn(pkg.dependencies, name)),
    "DISTRIBUTION_DEPENDENCIES_INVALID",
    "Manifest dependencies do not match native policy",
  );
  const lockEntry = z
    .object({
      version: z.string().optional(),
      name: z.string().optional(),
      dependencies: record.optional(),
      devDependencies: record.optional(),
      dev: z.boolean().optional(),
      devOptional: z.boolean().optional(),
      link: z.boolean().optional(),
      resolved: z.string().optional(),
      integrity: z.string().optional(),
    })
    .passthrough();
  const lock = z
    .object({
      name: z.literal(pkg.name),
      version: z.literal(pkg.version),
      lockfileVersion: z.literal(3),
      packages: z.record(z.string(), lockEntry),
    })
    .parse(json(path.join(root, "package-lock.json")));
  const base = lock.packages[""];
  invariant(
    base &&
      base.version === pkg.version &&
      !base.devDependencies &&
      JSON.stringify(Object.entries(base.dependencies ?? {}).sort()) ===
        JSON.stringify(Object.entries(pkg.dependencies).sort()),
    "DISTRIBUTION_LOCK_STALE",
    "Normalize the production lock before sealing",
  );
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!name) continue;
    invariant(
      name.startsWith("node_modules/") &&
        !forbiddenDependency(name) &&
        !item.dev &&
        !item.devOptional &&
        !item.link &&
        item.version &&
        item.resolved?.startsWith("https://registry.npmjs.org/") &&
        /^sha(?:512|256)-[A-Za-z0-9+/]+=*$/.test(item.integrity ?? ""),
      "DISTRIBUTION_LOCK_INVALID",
      `Unpinned, development or forbidden package in lock: ${name}`,
    );
  }
  for (const [name, version] of Object.entries(pkg.dependencies))
    invariant(
      /^\d+\.\d+\.\d+$/.test(version) &&
        lock.packages[`node_modules/${name}`]?.version === version,
      "DISTRIBUTION_LOCK_STALE",
      `Direct dependency differs from its lock: ${name}`,
    );
  return { packages: Object.keys(lock.packages).length - 1 };
}
export function verifyDistribution(root: string, installed = false) {
  const manifest = manifestSchema.parse(json(path.join(root, manifestName))),
    files = inventory(root, installed);
  invariant(
    JSON.stringify(files) === JSON.stringify(manifest.files),
    "DISTRIBUTION_DIGEST_MISMATCH",
    "Distribution content differs from its sealed file inventory",
  );
  invariant(
    metadataFiles.size <= files.length &&
      [...metadataFiles].every((file) =>
        files.some((item) => item.file === file),
      ) &&
      files.some((item) => item.file === "dist/src/cli.js"),
    "DISTRIBUTION_REQUIRED_FILE_MISSING",
    "Distribution omits a required file",
  );
  const lock = validateDistributionLock(root),
    resources = verifyResources(root);
  return {
    kind: manifest.kind,
    release: manifest.release,
    protocol: manifest.protocol,
    manifest_sha256: sha256(fs.readFileSync(path.join(root, manifestName))),
    files: files.length,
    bytes: files.reduce((sum, item) => sum + item.bytes, 0),
    ...lock,
    ...resources,
  };
}
export function sealDistribution(
  root: string,
  archive: string,
  sourceLock: string,
) {
  invariant(
    !fs.existsSync(archive) && !fs.existsSync(`${archive}.sha256`),
    "DISTRIBUTION_EXISTS",
    "Archive and checksum must be new paths",
  );
  const relative = path.relative(root, archive);
  invariant(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "DISTRIBUTION_ARCHIVE_PATH",
    "Archive must be outside the distribution directory",
  );
  validateDistributionLock(root);
  verifyResources(root);
  const manifest: Manifest = {
    format: 1,
    kind: "installation-validation",
    release,
    protocol: protocolVersion,
    source_lock_sha256: sha256(fs.readFileSync(sourceLock)),
    files: inventory(root),
  };
  manifestSchema.parse(manifest);
  writeJson(path.join(root, manifestName), manifest);
  const verified = verifyDistribution(root);
  return writeDistributionArchive(root, archive, manifest, verified);
}

function writeDistributionArchive(
  root: string,
  archive: string,
  manifest: Manifest,
  verified: ReturnType<typeof verifyDistribution>,
) {
  const zip = new AdmZip();
  for (const item of [
    ...manifest.files,
    {
      file: manifestName,
      bytes: fs.statSync(path.join(root, manifestName)).size,
      sha256: verified.manifest_sha256,
    },
  ]) {
    const data = fs.readFileSync(path.join(root, item.file));
    invariant(
      data.length === item.bytes && sha256(data) === item.sha256,
      "DISTRIBUTION_CHANGED",
      `File changed while sealing: ${item.file}`,
    );
    const entry = zip.addFile(
      item.file,
      data,
      "",
      item.file === "dist/src/cli.js" ? 0o100755 : 0o100644,
    );
    entry.header.time = new Date(2000, 0, 1);
  }
  const bytes = zip.toBuffer();
  fs.writeFileSync(archive, bytes, { flag: "wx" });
  fs.writeFileSync(
    `${archive}.sha256`,
    `${sha256(bytes)}  ${path.basename(archive)}\n`,
    { flag: "wx" },
  );
  return {
    ...verified,
    archive,
    archive_bytes: bytes.length,
    archive_sha256: sha256(bytes),
  };
}

/** Recreate publish bytes from an already sealed, accepted distribution. */
export function archiveDistribution(root: string, archive: string) {
  invariant(
    !fs.existsSync(archive) && !fs.existsSync(`${archive}.sha256`),
    "DISTRIBUTION_EXISTS",
    "Archive and checksum must be new paths",
  );
  const relative = path.relative(root, archive);
  invariant(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "DISTRIBUTION_ARCHIVE_PATH",
    "Archive must be outside the distribution directory",
  );
  const manifest = manifestSchema.parse(json(path.join(root, manifestName)));
  const verified = verifyDistribution(root);
  return writeDistributionArchive(root, archive, manifest, verified);
}
/** Extract only our bounded format into a new directory; validate before any write. */
export function extractDistribution(archive: string, output: string) {
  invariant(
    !fs.existsSync(output),
    "DISTRIBUTION_EXISTS",
    "Extract into a new directory",
  );
  invariant(
    fs.lstatSync(archive).isFile() && fs.statSync(archive).size <= limitBytes,
    "DISTRIBUTION_LIMIT",
    "Archive must be a bounded regular file",
  );
  const zip = new AdmZip(archive),
    entries = zip.getEntries(),
    seen = new Set<string>();
  let total = 0;
  invariant(
    entries.length <= limitFiles + 1,
    "DISTRIBUTION_LIMIT",
    "Too many archive entries",
  );
  for (const entry of entries) {
    const name = relativePath.parse(entry.entryName);
    invariant(
      !entry.isDirectory &&
        (name === manifestName || allowed(name)) &&
        !seen.has(name.toLowerCase()) &&
        [0, 0o100000].includes((entry.attr >>> 16) & 0o170000) &&
        [0, 8].includes(entry.header.method) &&
        !(entry.header.flags & 0x41),
      "DISTRIBUTION_ARCHIVE_INVALID",
      `Invalid archive entry: ${name}`,
    );
    seen.add(name.toLowerCase());
    total += entry.header.size;
    invariant(
      total <= limitBytes,
      "DISTRIBUTION_LIMIT",
      "Archive expands beyond its byte budget",
    );
  }
  invariant(
    seen.has(manifestName),
    "DISTRIBUTION_ARCHIVE_INVALID",
    "Archive lacks a sealed inventory",
  );
  const decode = (entry: AdmZip.IZipEntry, bound = limitBytes) => {
    invariant(
      entry.header.size <= bound,
      "DISTRIBUTION_LIMIT",
      "Archive entry exceeds its byte budget",
    );
    // ZIP headers can understate the inflated size. Enforce the allocation bound
    // inside zlib, then check both CRC and the inventory's independent SHA-256.
    const compressed = entry.getCompressedData(),
      data =
        entry.header.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.header.size),
            });
    invariant(
      data.length === entry.header.size && crc32(data) === entry.header.crc,
      "DISTRIBUTION_ARCHIVE_INVALID",
      "Archive entry size or CRC mismatch",
    );
    return data;
  };
  const manifest = manifestSchema.parse(
    JSON.parse(
      decode(zip.getEntry(manifestName)!, 8 * 1024 * 1024).toString("utf8"),
    ) as unknown,
  );
  const expected = new Map(manifest.files.map((item) => [item.file, item]));
  invariant(
    expected.size === manifest.files.length &&
      expected.size === entries.length - 1 &&
      !expected.has(manifestName) &&
      entries.every(
        (entry) =>
          entry.entryName === manifestName || expected.has(entry.entryName),
      ),
    "DISTRIBUTION_ARCHIVE_INVALID",
    "Archive entries do not match the inventory",
  );
  fs.mkdirSync(output, { recursive: true });
  for (const entry of entries) {
    const file = path.join(output, entry.entryName),
      data = decode(entry),
      item = expected.get(entry.entryName);
    invariant(
      entry.entryName === manifestName ||
        (item && data.length === item.bytes && sha256(data) === item.sha256),
      "DISTRIBUTION_DIGEST_MISMATCH",
      "Archive file differs from its sealed inventory",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, {
      flag: "wx",
      mode: entry.entryName === "dist/src/cli.js" ? 0o755 : 0o644,
    });
  }
  return verifyDistribution(output);
}
