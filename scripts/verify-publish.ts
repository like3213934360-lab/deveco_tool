import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Uses only Node built-ins so the contents:write job need not install or build
// dependencies. Its inputs are outputs of its own gate job, not dispatch input.
export function verifyPublish(
  directory: string,
  tag: string,
  archiveSha: string,
  receiptSha: string,
) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(archiveSha, /^[a-f0-9]{64}$/);
  assert.match(receiptSha, /^[a-f0-9]{64}$/);
  const archive = `deveco-tool-${tag.slice(1)}.zip`;
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    [archive, `${archive}.sha256`, "acceptance.json"].sort(),
  );
  const read = (name: string) => {
    const file = path.join(directory, name);
    assert.ok(
      fs.lstatSync(file).isFile(),
      "Publish assets must be regular files",
    );
    return fs.readFileSync(file);
  };
  const hash = (bytes: Buffer) =>
    crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(read(archive)), archiveSha);
  const receipt = read("acceptance.json");
  assert.equal(hash(receipt), receiptSha);
  const accepted = JSON.parse(receipt.toString("utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(accepted.release, tag.slice(1));
  assert.equal(accepted.passed, true);
  assert.equal(accepted.archive_sha256, archiveSha);
  assert.equal(
    read(`${archive}.sha256`).toString("utf8"),
    `${archiveSha}  ${archive}\n`,
  );
  return { tag, archive_sha256: archiveSha, receipt_sha256: receiptSha };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify(
      verifyPublish(
        process.argv[2]!,
        process.env.RELEASE_TAG!,
        process.env.ARCHIVE_SHA256!,
        process.env.RECEIPT_SHA256!,
      ),
    ),
  );
}
