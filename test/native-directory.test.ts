import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { NativeDirectory } from "../src/core/native-directory.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";

const temporary = () =>
  fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-native-dir-")),
  );
test("SDK output exceeding reservation cancels its writer and reports a capacity error after exit", async () => {
  const root = temporary(),
    store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store)),
    directory = new NativeDirectory(store, 32768);
  try {
    await assert.rejects(
      directory.execute((signal) =>
        processes.run(
          {
            executable: process.execPath,
            args: [
              "-e",
              "const fs=require('node:fs');setInterval(()=>fs.appendFileSync(process.argv[1],Buffer.alloc(4096)),10)",
              path.join(directory.file, "large.log"),
            ],
          },
          { signal, timeoutMs: 10000 },
        ),
      ),
      { code: "NATIVE_DIRECTORY_CAPACITY" },
    );
    assert.equal(processes.size, 0);
    assert.equal(fs.existsSync(directory.file), false);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM native_directories").all(),
      [],
    );
  } finally {
    await processes.close();
    await directory.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native directory cleanup retains live process inputs and reclaims them after confirmed exit", async () => {
  const root = temporary(),
    store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store)),
    directory = new NativeDirectory(store, 65536);
  try {
    fs.writeFileSync(path.join(directory.file, "input"), "owned");
    const child = directory.own(() =>
      processes.spawn({
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      }),
    );
    await directory.close();
    assert.equal(fs.existsSync(directory.file), true);
    store.prune();
    assert.equal(fs.existsSync(directory.file), true);
    await processes.terminate(child);
    store.prune();
    assert.equal(fs.existsSync(directory.file), false);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM native_directories").all(),
      [],
    );
  } finally {
    await processes.close();
    await directory.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("peers count native reservations in the same shared byte budget", async () => {
  const root = temporary(),
    store = new StateStore(root),
    peer = new StateStore(root),
    directory = new NativeDirectory(store, 128 * 1024 * 1024);
  try {
    assert.throws(() => new NativeDirectory(peer, 128 * 1024 * 1024), {
      code: "STATE_CAPACITY",
    });
    await directory.close();
    const replacement = new NativeDirectory(peer, 128 * 1024 * 1024);
    await replacement.close();
  } finally {
    await directory.close();
    peer.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native startup and validation failures release their reservations", async () => {
  const root = temporary(),
    store = new StateStore(root),
    directory = new NativeDirectory(store, 65536);
  try {
    await assert.rejects(
      directory.execute(async () => {
        throw new Error("invalid input");
      }),
      /invalid input/,
    );
    assert.equal(fs.existsSync(directory.file), false);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM native_directories").all(),
      [],
    );
  } finally {
    await directory.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native output scans reject directory links without following foreign files", async () => {
  const root = temporary(),
    store = new StateStore(path.join(root, "state")),
    directory = new NativeDirectory(store, 65536),
    foreign = path.join(root, "foreign");
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, "keep"), "unrelated");
  fs.symlinkSync(
    foreign,
    path.join(directory.file, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    await assert.rejects(directory.check(), {
      code: "NATIVE_DIRECTORY_SYMLINK",
    });
    assert.equal(directory.controller.signal.aborted, true);
    await directory.close();
    assert.equal(
      fs.readFileSync(path.join(foreign, "keep"), "utf8"),
      "unrelated",
    );
  } finally {
    await directory.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
