import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  captureFile,
  captureFiles,
  verifyCapturedFile,
} from "../src/core/captured-file.js";
import { StateStore } from "../src/core/store.js";
import { fileDigest } from "../src/core/files.js";
import { ProcessService } from "../src/core/process.js";
import { DeviceService } from "../src/services/device.js";
import { withTrace } from "../src/core/trace.js";
import { ToolError } from "../src/core/errors.js";
import AdmZip from "adm-zip";

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "deveco-captured-"));
function clean(root: string, store: StateStore) {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
test("partial package-set capture reclaims all earlier copies and their quota", async () => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    source = path.join(root, "input.hap");
  try {
    fs.writeFileSync(source, Buffer.alloc(65536));
    await assert.rejects(
      captureFiles(store, "workflow-input", [
        { path: source },
        { path: path.join(root, "missing.hsp") },
      ]),
    );
    assert.deepEqual(fs.readdirSync(path.join(store.root, "artifacts")), []);
    for (const table of ["artifacts", "artifact_streams", "artifact_gc"])
      assert.deepEqual(store.db.prepare(`SELECT * FROM ${table}`).all(), []);
  } finally {
    clean(root, store);
  }
});

test("captured packages retain submission bytes across source rebuilds and belong to their workflow", async () => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    source = path.join(root, "input.hap");
  try {
    fs.writeFileSync(source, Buffer.alloc(2 * 1024 * 1024 + 23, 71));
    const hash = fileDigest(source),
      captured = await captureFile(store, "workflow-input", source, hash);
    assert.equal(captured.sha256, hash);
    assert.equal(captured.bytes, 2 * 1024 * 1024 + 23);
    fs.writeFileSync(source, "new build");
    await verifyCapturedFile(captured);
    assert.notEqual(captured.path, source);
    assert.equal(fileDigest(captured.path), hash);
    const { run } = store.create(
      "app_deploy",
      { deployment: [captured] },
      undefined,
      {},
      [captured.artifact_id],
    );
    assert.deepEqual(
      store.db
        .prepare("SELECT run_id,file,bytes FROM artifacts WHERE id=?")
        .get(captured.artifact_id),
      { run_id: run.id, file: captured.path, bytes: captured.bytes },
    );
    fs.chmodSync(captured.path, 0o600);
    fs.writeFileSync(captured.path, Buffer.alloc(captured.bytes, 72));
    await assert.rejects(verifyCapturedFile(captured), {
      code: "ARTIFACT_CHANGED",
    });
  } finally {
    clean(root, store);
  }
});

test("failed capture releases descriptors, stream reservations and partial files", async (t) => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    source = path.join(root, "input.hap");
  fs.writeFileSync(source, "bytes");
  try {
    await assert.rejects(
      captureFile(store, "workflow-input", source, "0".repeat(64)),
      { code: "ARTIFACT_CHANGED" },
    );
    assert.deepEqual(fs.readdirSync(path.join(store.root, "artifacts")), []);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM artifact_streams").all(),
      [],
    );
    const open = fsp.open;
    let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
    t.mock.method(fsp, "open", async (...args: Parameters<typeof fsp.open>) => {
      const value = await open(...args);
      if (args[0] === source) handle = value;
      return value;
    });
    t.mock.method(store, "capacity", () => {
      throw new ToolError("STATE_CAPACITY", "fixture full disk budget");
    });
    await assert.rejects(captureFile(store, "workflow-input", source), {
      code: "STATE_CAPACITY",
    });
    assert.ok(handle);
    await assert.rejects(handle.read(Buffer.alloc(1), 0, 1, 0), {
      code: "EBADF",
    });
    assert.deepEqual(
      store.db.prepare("SELECT * FROM artifact_streams").all(),
      [],
    );
  } finally {
    t.mock.restoreAll();
    clean(root, store);
  }
});

test("source mutation and cancellation during streaming cannot publish a partial deployment input", async (t) => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    source = path.join(root, "input.hap"),
    abort = new AbortController();
  fs.writeFileSync(source, Buffer.alloc(3 * 1024 * 1024, 65));
  const open = fsp.open;
  let cancel = false;
  t.mock.method(fsp, "open", async (...args: Parameters<typeof fsp.open>) => {
    const handle = await open(...args);
    if (args[0] === source) {
      const read = handle.read.bind(handle);
      t.mock.method(
        handle,
        "read",
        async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const result = await read(
            buffer,
            offset,
            Math.min(length, 4096),
            position,
          );
          if (position === 0) {
            if (cancel) abort.abort();
            else fs.appendFileSync(source, "changed");
          }
          return result;
        },
      );
    }
    return handle;
  });
  try {
    // Short reads exercise the loop rather than treating a short read as EOF.
    await assert.rejects(captureFile(store, "workflow-input", source), {
      code: "ARTIFACT_CHANGED",
    });
    cancel = true;
    await assert.rejects(
      captureFile(store, "workflow-input", source, undefined, abort.signal),
      { name: "AbortError" },
    );
    assert.deepEqual(store.db.prepare("SELECT * FROM artifacts").all(), []);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM artifact_streams").all(),
      [],
    );
    assert.deepEqual(fs.readdirSync(path.join(store.root, "artifacts")), []);
  } finally {
    t.mock.restoreAll();
    clean(root, store);
  }
});

test("device installation checks a captured package after its lease wait and never dispatches mutated bytes", async (t) => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(),
    devices = new DeviceService(processes, store),
    source = path.join(root, "input.hap");
  const app = { bundle_name: "com.test", module: "entry", ability: "Main" },
    zip = new AdmZip();
  zip.addFile(
    "module.json",
    Buffer.from(
      JSON.stringify({
        app: { bundleName: app.bundle_name, versionCode: 1, versionName: "1" },
        module: {
          name: app.module,
          type: "entry",
          abilities: [{ name: app.ability }],
        },
      }),
    ),
  );
  zip.writeZip(source);
  try {
    const captured = await captureFile(store, "deployment", source),
      acquired = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const owner = withTrace({ request_id: "lease-owner" }, () =>
      store.lease("device:test", async () => {
        acquired.resolve();
        await release.promise;
      }),
    );
    await acquired.promise;
    const waiting = Promise.withResolvers<void>(),
      lease = store.lease.bind(store);
    t.mock.method(
      store,
      "lease",
      async <T>(
        resource: string,
        task: () => Promise<T>,
        signal?: AbortSignal,
      ) => {
        waiting.resolve();
        return lease(resource, task, signal);
      },
    );
    let installs = 0;
    t.mock.method(devices, "command", async () => {
      installs++;
      throw new Error("Must not install changed bytes");
    });
    const blocked = devices.install("test", [captured], app),
      rejected = assert.rejects(blocked, { code: "ARTIFACT_CHANGED" });
    await waiting.promise;
    // ZIP identity was checked before waiting; append a byte while installation waits for the lease.
    fs.chmodSync(captured.path, 0o600);
    fs.appendFileSync(captured.path, "x");
    release.resolve();
    await owner;
    await rejected;
    assert.equal(installs, 0);
  } finally {
    devices.close();
    await processes.close();
    clean(root, store);
  }
});
