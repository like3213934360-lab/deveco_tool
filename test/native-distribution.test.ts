import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import {
  prepareDistribution,
  sealDistribution,
  archiveDistribution,
  extractDistribution,
  verifyDistribution,
  validateDistributionLock,
} from "../scripts/lib/distribution.js";
import { release } from "../src/core/config.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "native-package-中文 空格-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    output = path.join(root, "candidate"),
    archive = path.join(root, "candidate.zip");
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(
      path.join(source, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  write("package.json", {
    dependencies: { zod: "4.4.3", "@deveco/deveco-cli": "1.3.1" },
    overrides: {},
  });
  write("package-lock.json", {
    name: "deveco-tool",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": { version: "0.1.0", dependencies: { "@deveco/deveco-cli": "1.3.1" } },
    },
  });
  write("provenance/native-dependencies.json", {
    format: 1,
    dependencies: ["zod"],
  });
  write("provenance/upstream-lock.json", {});
  write("provenance/upstream-mapping.json", {});
  write("provenance/installed-skill-fingerprints.json", { format: 1, installations: [] });
  write("LICENSE", "test license");
  write("NOTICE.fixture", "fixture provenance");
  write("docs/native-installation.md", "installation test");
  write("dist/src/cli.js", "#!/usr/bin/env node\nexport {};\n");
  write("dist/src/worker.js", "export {};\n");
  write("resources/knowledge.json", "[]\n");
  write("resources/templates/hvigorfile.ts", "export {};\n");
  write("provenance/resources.json", {
    format: 1,
    sources: [
      {
        id: "fixture",
        version: "1",
        url: "https://example.com",
        integrity: "fixture",
        license: "LICENSE",
      },
    ],
    files: [
      { file: "resources/knowledge.json", text: "[]\n" },
      { file: "resources/templates/hvigorfile.ts", text: "export {};\n" },
    ].map(({ file, text }) => ({
      file,
      sha256: hash(text),
      source: "fixture",
      source_path: file,
      source_sha256: hash(text),
      transformation: "unchanged",
    })),
  });
  const normalized = () =>
    fs.writeFileSync(
      path.join(output, "package-lock.json"),
      JSON.stringify({
        name: "deveco-tool",
        version: release,
        lockfileVersion: 3,
        packages: {
          "": { version: release, dependencies: { zod: "4.4.3" } },
          "node_modules/zod": {
            version: "4.4.3",
            resolved: "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
            integrity: "sha512-Zml4dHVyZQ==",
          },
        },
      }),
    );
  return { root, source, output, archive, normalized };
}
test("compiled distribution excludes legacy inputs and round-trips its production lock and attributed resources", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.source, "skills"));
  fs.writeFileSync(path.join(f.source, "skills/SKILL.md"), "must never ship");
  prepareDistribution(f.source, f.output);
  assert.equal(fs.existsSync(path.join(f.output, "skills")), false);
  assert.throws(() => prepareDistribution(f.source, f.output), {
    code: "DISTRIBUTION_EXISTS",
  });
  assert.throws(() =>
    sealDistribution(
      f.output,
      f.archive,
      path.join(f.source, "package-lock.json"),
    ),
  );
  assert.equal(fs.existsSync(f.archive), false);
  f.normalized();
  const receipt = sealDistribution(
    f.output,
    f.archive,
    path.join(f.source, "package-lock.json"),
  );
  assert.equal(receipt.kind, "installation-validation");
  assert.equal(receipt.packages, 1);
  assert.equal(
    new AdmZip(f.archive).readAsText("dist/src/worker.js"),
    "export {};\n",
  );
  assert.ok(new AdmZip(f.archive).getEntry("package-lock.json"));
  const acceptedManifest = fs.readFileSync(
    path.join(f.output, "distribution.json"),
  );
  const republished = path.join(f.root, "republished.zip");
  const republishedReceipt = archiveDistribution(f.output, republished);
  assert.equal(republishedReceipt.manifest_sha256, receipt.manifest_sha256);
  assert.deepEqual(fs.readFileSync(republished), fs.readFileSync(f.archive));
  assert.deepEqual(
    fs.readFileSync(path.join(f.output, "distribution.json")),
    acceptedManifest,
  );
  const installed = path.join(f.root, "installed"),
    verified = extractDistribution(f.archive, installed);
  assert.equal(verified.manifest_sha256, receipt.manifest_sha256);
  fs.mkdirSync(path.join(installed, "node_modules"));
  assert.throws(() => verifyDistribution(installed), {
    code: "DISTRIBUTION_UNEXPECTED_FILE",
  });
  assert.equal(
    verifyDistribution(installed, true).manifest_sha256,
    receipt.manifest_sha256,
  );
  fs.appendFileSync(path.join(installed, "dist/src/worker.js"), "changed");
  assert.throws(() => verifyDistribution(installed, true), {
    code: "DISTRIBUTION_DIGEST_MISMATCH",
  });
});
test("production locks reject legacy, development, linked and unpinned dependencies", (t) => {
  const f = fixture(t);
  prepareDistribution(f.source, f.output);
  for (const [name, change] of [
    ["node_modules/@deveco/deveco-cli", {}],
    ["node_modules/@deveco-codegenie/mcp-darwin-arm64", {}],
    ["node_modules/typescript", {}],
    ["node_modules/zod", { dev: true }],
    ["node_modules/zod", { devOptional: true }],
    ["node_modules/zod", { link: true }],
    ["node_modules/zod", { resolved: "file:../outside" }],
    ["node_modules/zod", { integrity: "" }],
    ["node_modules/zod", { version: "4.4.2" }],
  ] as const) {
    f.normalized();
    const lock = JSON.parse(
      fs.readFileSync(path.join(f.output, "package-lock.json"), "utf8"),
    ) as { packages: Record<string, Record<string, unknown>> };
    lock.packages[name] = { ...lock.packages["node_modules/zod"], ...change };
    fs.writeFileSync(
      path.join(f.output, "package-lock.json"),
      JSON.stringify(lock),
    );
    assert.throws(
      () => validateDistributionLock(f.output),
      name + JSON.stringify(change),
    );
  }
});
test("packaging rejects symlinks and unexpected old runtime files before creating an archive", (t) => {
  const f = fixture(t);
  prepareDistribution(f.source, f.output);
  f.normalized();
  fs.writeFileSync(path.join(f.output, "dist/src/old.mjs"), "old");
  assert.throws(
    () =>
      sealDistribution(
        f.output,
        f.archive,
        path.join(f.source, "package-lock.json"),
      ),
    { code: "DISTRIBUTION_UNEXPECTED_FILE" },
  );
  fs.unlinkSync(path.join(f.output, "dist/src/old.mjs"));
  fs.symlinkSync(
    path.join(f.source, "dist/src"),
    path.join(f.output, "dist/src/link"),
    "junction",
  );
  assert.throws(
    () =>
      sealDistribution(
        f.output,
        f.archive,
        path.join(f.source, "package-lock.json"),
      ),
    { code: "DISTRIBUTION_SYMLINK" },
  );
  assert.equal(fs.existsSync(f.archive), false);
});
test("archive extraction rejects traversal, unlisted files, path collisions and symlinks before writing", (t) => {
  const f = fixture(t);
  for (const [index, names] of [
    ["../outside", "distribution.json"],
    ["/absolute", "distribution.json"],
    ["C:/absolute", "distribution.json"],
    ["C:\\absolute", "distribution.json"],
    ["..\\outside", "distribution.json"],
    ["resources/item", "resources/item/child", "distribution.json"],
    ["skills/SKILL.md", "distribution.json"],
    ["resources/CON.js", "distribution.json"],
    ["dist/src/A.js", "dist/src/a.js", "distribution.json"],
    ["dist/src/link.js", "distribution.json"],
  ].entries()) {
    const zip = new AdmZip();
    for (const name of names) {
      const entry = zip.addFile(name, Buffer.from("{}"), "", 0o100644);
      // AdmZip's addFile sanitizes traversal and forces regular-file modes;
      // construct hostile central-directory metadata explicitly for this test.
      entry.entryName = name;
      if (name.endsWith("link.js")) entry.attr = (0o120777 << 16) >>> 0;
    }
    const file = path.join(f.root, `bad-${index}.zip`),
      output = path.join(f.root, `bad-${index}`);
    zip.writeZip(file);
    assert.throws(() => extractDistribution(file, output));
    assert.equal(fs.existsSync(output), false, `archive case ${index}`);
  }
});
test("archive decompression enforces the declared size before inflated data can exceed the budget", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.source, "dist/src/worker.js"),
    "x".repeat(1024 * 1024),
  );
  prepareDistribution(f.source, f.output);
  f.normalized();
  sealDistribution(
    f.output,
    f.archive,
    path.join(f.source, "package-lock.json"),
  );
  const zip = new AdmZip(f.archive);
  zip.getEntry("dist/src/worker.js")!.header.size = 1;
  const forged = path.join(f.root, "forged.zip");
  zip.writeZip(forged);
  assert.throws(
    () => extractDistribution(forged, path.join(f.root, "forged-output")),
    { code: "ERR_BUFFER_TOO_LARGE" },
  );
});

test("distribution rejects duplicate paths, special files and excessive declared sizes before writing", (t) => {
  const f = fixture(t);
  for (const kind of [0o120777, 0o020600, 0o060600, 0o010600, 0o040700, 0, 1]) {
    const zip = new AdmZip();
    zip.addFile("distribution.json", Buffer.from("{}"));
    const entry = zip.addFile("resources/item", Buffer.from("{}"));
    if (kind === 0) zip.addFile("resources/other", Buffer.from("{}")).entryName = "resources/item";
    else if (kind === 1) entry.header.size = 257 * 1024 * 1024;
    else entry.attr = (kind << 16) >>> 0;
    zip.writeZip(f.archive);
    const output = path.join(f.root, `rejected-${kind}`);
    assert.throws(() => extractDistribution(f.archive, output));
    assert.equal(fs.existsSync(output), false);
  }
});
test("distribution validates all hashes before writing and removes partial IO failures without touching existing destinations", (t) => {
  const f = fixture(t);
  prepareDistribution(f.source, f.output); f.normalized();
  sealDistribution(f.output, f.archive, path.join(f.source, "package-lock.json"));
  const zip = new AdmZip(f.archive), originalBytes = fs.readFileSync(f.archive);
  zip.updateFile("dist/src/worker.js", Buffer.from("tampered")); zip.writeZip(f.archive);
  const output = path.join(f.root, "new-install");
  assert.throws(() => extractDistribution(f.archive, output), { code: "DISTRIBUTION_DIGEST_MISMATCH" });
  assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(f.archive, originalBytes);
  const original = fs.writeFileSync; let writes = 0;
  const mock = t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    if (++writes === 2) throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
    return original(...args);
  });
  assert.throws(() => extractDistribution(f.archive, output), { code: "ENOSPC" });
  assert.equal(writes, 2); assert.equal(fs.existsSync(output), false); mock.mock.restore();
  fs.symlinkSync(f.output, output, "junction");
  assert.throws(() => extractDistribution(f.archive, output), { code: "DISTRIBUTION_EXISTS" });
  assert.ok(verifyDistribution(f.output).manifest_sha256);
});
