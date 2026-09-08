import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { digest, fileDigest } from "../../src/core/files.js";
import { verifyResources } from "./resources.js";

/** Capture the tested bytes before running, including uncommitted compiled code. */
export function evidenceIdentity(root = fileURLToPath(new URL("../../../", import.meta.url))) {
  const compiled: { file: string; sha256: string }[] = [];
  const visit = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && item.name.endsWith(".js"))
        compiled.push({
          file: path.relative(root, file).split(path.sep).join("/"),
          sha256: fileDigest(file),
        });
    }
  };
  visit(path.join(root, "dist"));
  compiled.sort((a, b) => a.file.localeCompare(b.file));
  // Validation hashes the actual resource files, not just the manifest claims.
  const resources = verifyResources(root);
  let baseCommit: string | null = null;
  try {
    baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    // Installed releases need no Git checkout; byte digests remain authoritative.
  }
  return {
    captured_at: new Date().toISOString(),
    entrypoint: process.argv[1] ? path.relative(root, process.argv[1]).split(path.sep).join("/") : null,
    base_commit: baseCommit,
    runtime_sha256: digest(
      compiled.filter((item) => item.file.startsWith("dist/src/")),
    ),
    compiled_sha256: digest(compiled),
    compiled,
    package_lock_sha256: fileDigest(path.join(root, "package-lock.json")),
    resource_manifest_sha256: fileDigest(
      path.join(root, "provenance/resources.json"),
    ),
    resources,
    upstream_lock_sha256: fileDigest(
      path.join(root, "provenance/upstream-lock.json"),
    ),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}
