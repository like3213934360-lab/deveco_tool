import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DirectoryPublication } from "../src/core/directory-publication.js";

test("directory publication uses private modes and never replaces a destination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-publication-"));
  const publisher = new DirectoryPublication(fs.realpathSync.native(root));
  try {
    publisher.mkdir("journal");
    publisher.write("journal/receipt.json", "complete receipt");
    assert.equal(
      fs.readFileSync(path.join(root, "journal/receipt.json"), "utf8"),
      "complete receipt",
    );
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.join(root, "journal")).mode & 0o777, 0o700);
      assert.equal(
        fs.statSync(path.join(root, "journal/receipt.json")).mode & 0o777,
        0o600,
      );
    }
    assert.throws(() => publisher.write("journal/receipt.json", "replace"));
    assert.equal(
      fs.readFileSync(path.join(root, "journal/receipt.json"), "utf8"),
      "complete receipt",
    );
    assert.deepEqual(fs.readdirSync(path.join(root, "journal")), [
      "receipt.json",
    ]);
  } finally {
    publisher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("captured directories cannot redirect publication through a replaced root", () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-publication-root-")),
  );
  for (const directory of ["source", "target", "outside"])
    fs.mkdirSync(path.join(root, directory));
  fs.writeFileSync(path.join(root, "source/file"), "owned");
  const source = new DirectoryPublication(path.join(root, "source")),
    publisher = new DirectoryPublication(path.join(root, "target"));
  try {
    if (process.platform === "win32") {
      assert.throws(() =>
        fs.renameSync(path.join(root, "target"), path.join(root, "moved")),
      );
      publisher.link(source, "file");
      assert.equal(
        fs.readFileSync(path.join(root, "target/file"), "utf8"),
        "owned",
      );
    } else {
      fs.renameSync(path.join(root, "target"), path.join(root, "moved"));
      fs.symlinkSync(
        path.join(root, "outside"),
        path.join(root, "target"),
        "dir",
      );
      publisher.link(source, "file");
      assert.deepEqual(fs.readdirSync(path.join(root, "outside")), []);
      assert.equal(
        fs.readFileSync(path.join(root, "moved/file"), "utf8"),
        "owned",
      );
    }
  } finally {
    publisher.close();
    source.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
