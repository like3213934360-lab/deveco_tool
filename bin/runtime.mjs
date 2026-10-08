// Shared build contract. The launcher has no npm dependencies and never trusts package.json
// as the identity of compiled code. Source checkouts also bind the build to its exact inputs.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const packageInfo = (root) => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// Reuse a bounded buffer: verifying source maps must not leave megabytes of dead Buffers
// resident in a long-lived server before its first GC. No timers or explicit GC are needed.
function hashFile(hash, file, buffer) {
  const fd = fs.openSync(file, "r");
  try {
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
  } finally {
    fs.closeSync(fd);
  }
}

export function sourceFingerprint(root) {
  const files = ["package.json", "package-lock.json", "tools/build.mjs"];
  for (const dir of ["src", "bin"]) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (String(file).endsWith(dir === "src" ? ".ts" : ".mjs"))
        files.push(`${dir}/${String(file).split(path.sep).join("/")}`);
    }
  }
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const file of files.sort()) {
    const absolute = path.join(root, file);
    hash.update(`${file}\0${fs.statSync(absolute).size}\0`);
    hashFile(hash, absolute, buffer);
  }
  return hash.digest("hex");
}

export function atomicWrite(file, text) {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Verify the complete immutable generation before allowing any code from it to run. */
export function verifyBuild(root, expectedFingerprint) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/current.json"), "utf8"));
  const generation = /^builds\/([a-f0-9]{64}-[a-f0-9]{12})\/cli\.js$/.exec(manifest.entry ?? "");
  if (manifest.schema !== 1 || !generation || !/^[a-f0-9]{64}$/.test(manifest.input_hash)
    || !generation[1].startsWith(`${manifest.input_hash}-`)
    || manifest.version !== packageInfo(root).version
    || (expectedFingerprint && manifest.input_hash !== expectedFingerprint))
    throw new Error("Compiled build does not match this package/source checkout");
  const prefix = `builds/${generation[1]}/`;
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)
    || !Object.hasOwn(manifest.files, manifest.entry)) throw new Error("Incomplete build manifest");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!file.startsWith(prefix) || !/^[a-zA-Z0-9_./-]+\.(?:js|js\.map)$/.test(file)
      || file.split("/").some((part) => part === ".." || part === ".") || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error(`Invalid build output: ${file}`);
    const actual = createHash("sha256");
    hashFile(actual, path.join(root, "dist", file), buffer);
    if (actual.digest("hex") !== hash)
      throw new Error(`Missing or changed build output: ${file}`);
  }
  return manifest;
}
