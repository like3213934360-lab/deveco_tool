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
