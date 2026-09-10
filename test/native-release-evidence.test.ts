import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { fileDigest } from "../src/core/files.js";
import { extractEvidence } from "../scripts/lib/release-evidence.js";

test("release evidence restores only authenticated members and refuses tampering before writing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-release-evidence-"));
  try {
    const payload = Buffer.from('{"fixture":"not release evidence"}'), archive = path.join(root, "bundle.zip");
    const inventory = { format: 1, files: [{ file: "release.json", bytes: payload.length, sha256: crypto.createHash("sha256").update(payload).digest("hex") }] };
    const make = (mutate: (zip: AdmZip) => void) => {
      const zip = new AdmZip(); zip.addFile("release.json", payload);
      zip.addFile("evidence-inventory.json", Buffer.from(JSON.stringify(inventory))); mutate(zip); zip.writeZip(archive);
    };
    make(() => {});
    const output = path.join(root, "restored");
    extractEvidence(archive, output, fileDigest(archive));
    assert.deepEqual(fs.readdirSync(output), ["release.json"]);
    assert.deepEqual(fs.readFileSync(path.join(output, "release.json")), payload);
    const rejected = path.join(root, "rejected");
    assert.throws(() => extractEvidence(archive, rejected, "0".repeat(64)), { code: "EVIDENCE_ARCHIVE_CHANGED" });
    make((zip) => zip.updateFile("release.json", Buffer.from("changed")));
    assert.throws(() => extractEvidence(archive, rejected, fileDigest(archive)), { code: "EVIDENCE_INVENTORY_CHANGED" });
    make((zip) => zip.addFile("Release.json", payload));
    assert.throws(() => extractEvidence(archive, rejected, fileDigest(archive)), { code: "EVIDENCE_PATH_COLLISION" });
    make((zip) => { const file = zip.getEntry("release.json")!; file.attr = (0o120777 << 16) >>> 0; });
    assert.throws(() => extractEvidence(archive, rejected, fileDigest(archive)), { code: "EVIDENCE_FILE_UNSAFE" });
    make((zip) => zip.addFile("release.json/child", payload));
    assert.throws(() => extractEvidence(archive, rejected, fileDigest(archive)), { code: "EVIDENCE_PATH_COLLISION" });
    assert.equal(fs.existsSync(rejected), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function archiveFixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-evidence-security-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "input.zip"), output = path.join(root, "output");
  const zip = new AdmZip(), payload = Buffer.from("{}"), files = ["release.json", "nested/report.json"];
  for (const file of files) zip.addFile(file, payload);
  zip.addFile("evidence-inventory.json", Buffer.from(JSON.stringify({ format: 1, files: files.map((file) => ({
    file, bytes: payload.length, sha256: crypto.createHash("sha256").update(payload).digest("hex"),
  })) })));
  const extract = () => { zip.writeZip(archive); return extractEvidence(archive, output, fileDigest(archive)); };
  return { root, archive, output, zip, extract };
}

for (const name of ["../escape", "/absolute", "C:/absolute", "C:\\absolute", "..\\escape", "a/../../escape", "//server/share", "release.json", "Release.json", "release.json/child", "nested", "nested/NUL.txt"]) {
  test(`evidence rejects unsafe or colliding ZIP path ${JSON.stringify(name)} before writing`, (t) => {
    const f = archiveFixture(t);
    f.zip.addFile("hostile", Buffer.from("{}")).entryName = name;
    assert.throws(f.extract);
    assert.equal(fs.existsSync(f.output), false);
    assert.equal(fs.existsSync(path.join(f.root, "escape")), false);
  });
}
for (const kind of [0o120777, 0o020600, 0o060600, 0o010600, 0o040700]) {
  test(`evidence rejects Unix special entry type ${kind.toString(8)}`, (t) => {
    const f = archiveFixture(t);
    f.zip.getEntry("release.json")!.attr = (kind << 16) >>> 0;
    assert.throws(f.extract, { code: "EVIDENCE_FILE_UNSAFE" });
    assert.equal(fs.existsSync(f.output), false);
  });
}
test("evidence bounds declared size, understated deflate size, CRC, compression and encryption", (t) => {
  for (const change of [
    (entry: AdmZip.IZipEntry) => { entry.header.size = 513 * 1024 * 1024; },
    (entry: AdmZip.IZipEntry) => { entry.header.size = 1; },
    (entry: AdmZip.IZipEntry) => { entry.header.crc ^= 1; },
    (entry: AdmZip.IZipEntry) => { entry.header.method = 99; },
    (entry: AdmZip.IZipEntry) => { entry.header.flags |= 1; },
  ]) {
    const f = archiveFixture(t);
    // Serialize then reopen so later writes preserve the forged metadata.
    f.zip.writeZip(f.archive);
    const zip = new AdmZip(f.archive); change(zip.getEntry("evidence-inventory.json")!); zip.writeZip(f.archive);
    assert.throws(() => extractEvidence(f.archive, f.output, fileDigest(f.archive)));
    assert.equal(fs.existsSync(f.output), false);
  }
});
test("evidence independently checks inventory SHA and cleans after a partial write failure", (t) => {
  const f = archiveFixture(t);
  f.zip.updateFile("release.json", Buffer.from("[]")); // same byte count, new CRC, stale SHA
  assert.throws(f.extract, { code: "EVIDENCE_INVENTORY_CHANGED" });
  assert.equal(fs.existsSync(f.output), false);
  f.zip.updateFile("release.json", Buffer.from("{}")); f.zip.writeZip(f.archive);
  const original = fs.writeFileSync; let writes = 0;
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    if (++writes === 2) throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
    return original(...args);
  });
  assert.throws(() => extractEvidence(f.archive, f.output, fileDigest(f.archive)), { code: "ENOSPC" });
  assert.equal(writes, 2);
  assert.equal(fs.existsSync(f.output), false);
});
test("evidence refuses an existing destination symlink without touching its target", (t) => {
  const f = archiveFixture(t), outside = path.join(f.root, "outside");
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "sentinel"), "preserve");
  fs.symlinkSync(outside, f.output, "junction");
  assert.throws(f.extract, { code: "OUTPUT_EXISTS" });
  assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "preserve");
});
