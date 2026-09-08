import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { z } from "zod";
import { atomicWrite, fileDigest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { readJson } from "./upstream-adaptation.js";
import { releaseGate, releaseManifestSchema } from "./release-gate.js";

const maximumBytes = 512 * 1024 * 1024, maximumFiles = 12000;
const hash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const relative = z.string().min(1).refine((value) => !/[\\:\x00-\x1f<>"|?*]/.test(value) && value.split("/").every((part) => part && part !== "." && part !== ".." && !/[ .]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)));
const entry = z.strictObject({ file: relative, bytes: z.number().int().nonnegative().max(maximumBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const inventorySchema = z.strictObject({ format: z.literal(1), files: z.array(entry).min(1).max(maximumFiles) });
const inventoryName = "evidence-inventory.json";

function regular(root: string, name: string) {
  relative.parse(name);
  let current = root;
  const parts = name.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    invariant(!stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()), "EVIDENCE_FILE_UNSAFE", "Evidence references must resolve through regular files and directories");
  }
  return current;
}

/** Select only the manifest's closed reference set, never state, credentials,
 * sibling logs, node_modules or an entire acceptance directory. */
export function evidenceFiles(directory: string, manifestName: string) {
  const manifest = releaseManifestSchema.parse(readJson(regular(directory, manifestName)));
  const selected = new Set<string>([manifestName]);
  for (const ref of [...manifest.regression, ...manifest.installation, ...manifest.acceptance, manifest.performance, manifest.soak]) {
    invariant(fileDigest(regular(directory, ref.file)) === ref.sha256, "RELEASE_EVIDENCE_CHANGED", "Referenced report changed");
    selected.add(ref.file);
  }
  for (const ref of manifest.acceptance) {
    const report = z.object({ cases: z.array(z.object({ artifacts: z.array(z.object({ file: relative, sha256: entry.shape.sha256 })) })) }).parse(readJson(regular(directory, ref.file)));
    for (const item of report.cases.flatMap((item) => item.artifacts)) {
      invariant(fileDigest(regular(directory, item.file)) === item.sha256, "RELEASE_EVIDENCE_CHANGED", "Referenced acceptance artifact changed");
      selected.add(item.file);
    }
  }
  const distributionName = `${relative.parse(manifest.distribution)}/distribution.json`;
  invariant(fileDigest(regular(directory, distributionName)) === manifest.distribution_sha256, "RELEASE_DISTRIBUTION_CHANGED", "Referenced distribution changed");
  selected.add(distributionName);
  const distribution = z.object({ files: z.array(entry).min(1).max(maximumFiles) }).parse(readJson(regular(directory, distributionName)));
  for (const item of distribution.files) selected.add(`${manifest.distribution}/${item.file}`);
  invariant(!selected.has(inventoryName), "EVIDENCE_RESERVED_PATH", "Bundle inventory cannot be supplied as evidence");
  let total = 0;
  const files = [...selected].sort().map((file) => {
    const source = regular(directory, file), bytes = fs.statSync(source).size;
    total += bytes;
    invariant(total <= maximumBytes, "EVIDENCE_LIMIT", "Evidence exceeds 512 MiB");
    return entry.parse({ file, bytes, sha256: fileDigest(source) });
  });
  return inventorySchema.parse({ format: 1, files });
}

export function prepareEvidence(root: string, manifestFile: string, archive: string) {
  invariant(path.basename(manifestFile) === "release.json", "EVIDENCE_MANIFEST_NAME", "Use release.json at the evidence root");
  invariant(!fs.existsSync(archive), "OUTPUT_EXISTS", "Use a new evidence archive");
  const directory = fs.realpathSync.native(path.dirname(manifestFile)), raw = readJson(manifestFile);
  const accepted = releaseGate(root, directory, raw), inventory = evidenceFiles(directory, "release.json"), zip = new AdmZip();
  for (const item of inventory.files) {
    const bytes = fs.readFileSync(regular(directory, item.file));
    invariant(bytes.length === item.bytes && hash(bytes) === item.sha256, "RELEASE_EVIDENCE_CHANGED", "Evidence changed while preparing the archive");
    zip.addFile(item.file, bytes);
  }
  zip.addFile(inventoryName, Buffer.from(JSON.stringify(inventory, null, 2) + "\n"));
  atomicWrite(archive, zip.toBuffer(), false);
  const sha256 = fileDigest(archive);
  atomicWrite(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`, false);
  return { archive, sha256, files: inventory.files.length, manifest_sha256: accepted.manifest_sha256 };
}

/** Complete validation happens before the first filesystem write. ZIP members
 * are treated as untrusted, including Unix attributes and case aliases. */
export function extractEvidence(archive: string, directory: string, expectedSha: string) {
  entry.shape.sha256.parse(expectedSha);
  invariant(fs.lstatSync(archive).isFile() && fs.statSync(archive).size <= maximumBytes, "EVIDENCE_LIMIT", "Archive must be a bounded regular file");
  invariant(fileDigest(archive) === expectedSha, "EVIDENCE_ARCHIVE_CHANGED", "Evidence archive does not match the supplied SHA-256");
  invariant(!fs.existsSync(directory), "OUTPUT_EXISTS", "Use a new extraction directory");
  const zip = new AdmZip(archive), members = zip.getEntries();
  invariant(members.length > 1 && members.length <= maximumFiles + 1, "EVIDENCE_LIMIT", "Unexpected archive entry count");
  const names = new Set<string>();
  let total = 0;
  for (const member of members) {
    relative.parse(member.entryName);
    const kind = (member.attr >>> 16) & 0o170000;
    invariant(!member.isDirectory && (kind === 0 || kind === 0o100000), "EVIDENCE_FILE_UNSAFE", "Evidence ZIP may contain only regular files");
    invariant(!names.has(member.entryName.toLowerCase()), "EVIDENCE_PATH_COLLISION", "Duplicate or case-aliased ZIP path");
    names.add(member.entryName.toLowerCase()); total += member.header.size;
    invariant(total <= maximumBytes, "EVIDENCE_LIMIT", "Uncompressed evidence exceeds 512 MiB");
  }
  for (const name of names) {
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++) invariant(!names.has(parts.slice(0, index).join("/")), "EVIDENCE_PATH_COLLISION", "An archive file cannot also be a parent directory");
  }
  const metadata = zip.getEntry(inventoryName);
  invariant(metadata && metadata.header.size <= 8 * 1024 * 1024, "EVIDENCE_INVENTORY_MISSING", "Expected a bounded bundle inventory");
  const inventory = inventorySchema.parse(JSON.parse(metadata.getData().toString("utf8")));
  invariant(inventory.files.length === members.length - 1 && new Set(inventory.files.map((item) => item.file.toLowerCase())).size === inventory.files.length, "EVIDENCE_INVENTORY_CHANGED", "Inventory must name every entry exactly once");
  invariant(inventory.files.some((item) => item.file === "release.json"), "EVIDENCE_MANIFEST_NAME", "Bundle must include release.json");
  const verified = inventory.files.map((item) => {
    const member = zip.getEntry(item.file);
    invariant(member && item.file !== inventoryName && member.header.size === item.bytes, "EVIDENCE_INVENTORY_CHANGED", "Inventory size or name differs from ZIP");
    const bytes = member.getData();
    invariant(bytes.length === item.bytes && hash(bytes) === item.sha256, "EVIDENCE_INVENTORY_CHANGED", "Extracted evidence bytes differ from inventory");
    return { file: item.file, bytes };
  });
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  for (const item of verified) atomicWrite(inside(directory, item.file), item.bytes, false);
  return { directory, files: inventory.files.length, sha256: expectedSha };
}
