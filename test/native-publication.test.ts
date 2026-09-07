import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { publishFile } from "../src/core/files.js";

test("SDK output publication syncs writable bytes, retains the source and never replaces an existing output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-publish-")),
    source = path.join(root, "source"),
    output = path.join(root, "output"),
    bytes = Buffer.alloc(65536, 0x5a);
  try {
    await fs.writeFile(source, bytes);
    await fs.chmod(source, 0o400);
    const receipt = await publishFile(source, output);
    assert.equal(receipt.bytes, bytes.length);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await fs.readFile(output), bytes);
    assert.deepEqual(await fs.readFile(source), bytes);
    if (process.platform !== "win32")
      assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
    await assert.rejects(publishFile(source, output), { code: "EEXIST" });
    assert.deepEqual(await fs.readdir(root), ["output", "source"]);
    assert.deepEqual(await fs.readFile(output), bytes);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("cancelled output publication exposes no partial result", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "deveco-publish-cancel-"),
    ),
    source = path.join(root, "source"),
    output = path.join(root, "output");
  try {
    await fs.writeFile(source, Buffer.alloc(1024));
    const controller = new AbortController();
    const operation = publishFile(source, output, controller.signal);
    controller.abort();
    await assert.rejects(operation, { name: "AbortError" });
    assert.deepEqual(await fs.readdir(root), ["source"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("competing SDK publications expose exactly one complete output and reclaim both temporary copies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-publish-race-")),
    first = path.join(root, "first"),
    second = path.join(root, "second"),
    output = path.join(root, "output"),
    contents = ["x".repeat(65536), "y".repeat(131072)];
  try {
    await fs.writeFile(first, contents[0]!);
    await fs.writeFile(second, contents[1]!);
    const results = await Promise.allSettled([
      publishFile(first, output),
      publishFile(second, output),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal((rejected?.reason as NodeJS.ErrnoException).code, "EEXIST");
    assert.ok(contents.includes(await fs.readFile(output, "utf8")));
    assert.deepEqual(await fs.readdir(root), ["first", "output", "second"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
