import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "../src/core/files.js";

function fixture(t: TestContext, platform: NodeJS.Platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-atomic-write-")),
    file = path.join(root, "state.json"),
    descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  fs.writeFileSync(file, "old complete state");
  Object.defineProperty(process, "platform", {
    ...descriptor,
    value: platform,
  });
  t.after(() => {
    t.mock.restoreAll();
    Object.defineProperty(process, "platform", descriptor);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const waits: number[] = [];
  t.mock.method(
    Atomics,
    "wait",
    (_array: Int32Array, _index: number, _value: number, timeout: number) => {
      waits.push(timeout);
      return "timed-out";
    },
  );
  return { root, file, waits };
}

test("Windows atomic replacement survives transient denial without exposing partial state", (t) => {
  const { root, file, waits } = fixture(t, "win32"),
    rename = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, "renameSync", (source: string, destination: string) => {
    assert.equal(fs.readFileSync(file, "utf8"), "old complete state");
    assert.equal(fs.readFileSync(source, "utf8"), "new complete state");
    const code = ["EPERM", "EACCES", "EBUSY"][calls++];
    if (code) throw Object.assign(new Error("transient denial"), { code });
    rename(source, destination);
  });
  atomicWrite(file, "new complete state");
  assert.equal(calls, 4);
  assert.deepEqual(waits, [10, 20, 30]);
  assert.equal(fs.readFileSync(file, "utf8"), "new complete state");
  assert.deepEqual(fs.readdirSync(root), ["state.json"]);
});

for (const code of ["EPERM", "EACCES", "EBUSY", "EINVAL"]) {
  test(`Windows atomic replacement preserves prior bytes and cleans scratch after permanent ${code}`, (t) => {
    const { root, file, waits } = fixture(t, "win32"),
      failure = Object.assign(new Error("permanent denial"), { code }),
      rename = t.mock.method(fs, "renameSync", () => {
        throw failure;
      });
    assert.throws(
      () => atomicWrite(file, "new state"),
      (error) => error === failure,
    );
    const retryable = code !== "EINVAL";
    assert.equal(rename.mock.callCount(), retryable ? 11 : 1);
    assert.deepEqual(
      waits,
      retryable ? [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] : [],
    );
    assert.equal(fs.readFileSync(file, "utf8"), "old complete state");
    assert.deepEqual(fs.readdirSync(root), ["state.json"]);
  });
}

test("non-Windows replacement denial fails immediately and retains prior state", (t) => {
  const { root, file, waits } = fixture(t, "linux"),
    failure = Object.assign(new Error("permission denied"), { code: "EPERM" }),
    rename = t.mock.method(fs, "renameSync", () => {
      throw failure;
    });
  assert.throws(
    () => atomicWrite(file, "new state"),
    (error) => error === failure,
  );
  assert.equal(rename.mock.callCount(), 1);
  assert.deepEqual(waits, []);
  assert.equal(fs.readFileSync(file, "utf8"), "old complete state");
  assert.deepEqual(fs.readdirSync(root), ["state.json"]);
});

test("exclusive atomic writes still reject existing destinations without replacement", (t) => {
  const { root, file, waits } = fixture(t, "win32"),
    rename = t.mock.method(fs, "renameSync", () => {
      assert.fail("exclusive publication must not rename");
    });
  assert.throws(() => atomicWrite(file, "new state", false), {
    code: "EEXIST",
  });
  assert.equal(rename.mock.callCount(), 0);
  assert.deepEqual(waits, []);
  assert.equal(fs.readFileSync(file, "utf8"), "old complete state");
  assert.deepEqual(fs.readdirSync(root), ["state.json"]);
});
