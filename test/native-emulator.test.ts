import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { EmulatorService } from "../src/services/emulator.js";
import { errorResult } from "../src/core/errors.js";

test("SDK's exact no-matching-images stderr denotes an empty inventory without hiding malformed output", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-emulator-images-")), store = new StateStore(root), processes = new ProcessService();
  let stdout = "", stderr = "No images matching the criteria were found.\n";
  t.mock.method(processes, "run", async () => ({ stdout, stderr, truncated: false }));
  const service = new EmulatorService(processes, store, (args) => ({ executable: "fixture", args }));
  try {
    assert.deepEqual(await service.manage({ action: "images", downloaded: true }), { images: [] });
    stderr += "SDK connection failed\n";
    await assert.rejects(service.manage({ action: "images", downloaded: true }));
    stderr = "";
    await assert.rejects(service.manage({ action: "images", downloaded: true }));
    stdout = "[]";
    assert.deepEqual(await service.manage({ action: "images", downloaded: true }), { images: [] });
  } finally { await service.close(); await processes.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("emulator readiness returns while its launcher stays alive; shutdown confirms inventory and closes logs", async (t) => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-emulator-")),
  );
  const store = new StateStore(root),
    processes = new ProcessService(new PersistentProcessObserver(store));
  const file = path.join(root, "instance.json");
  fs.writeFileSync(file, JSON.stringify({ name: "fixture", isRunning: false }));
  const service = new EmulatorService(processes, store, (args) => ({
    executable: process.execPath,
    args: [
      fileURLToPath(new URL("./fixtures/native-emulator.js", import.meta.url)),
      file,
      ...args,
    ],
  }));
  try {
    const start = await service.manage({ action: "start", name: "fixture" });
    assert.ok("verified" in start);
    assert.equal(start.verified, true);
    assert.equal((await service.list())[0]?.isRunning, true);
    await delay(100);
    assert.ok(processes.size >= 1);
    await service.close();
    await processes.close();
    assert.equal((await service.list())[0]?.isRunning, false);
    assert.deepEqual(
      store.db
        .prepare("SELECT * FROM managed_processes WHERE status<>'exited'")
        .all(),
      [],
    );
    assert.equal(
      store.db.prepare("SELECT * FROM artifact_streams").all().length,
      0,
    );
  } catch (error) {
    // Preserve the native stderr/receipt in TAP before temporary artifacts are removed.
    t.diagnostic(JSON.stringify(errorResult(error)));
    throw error;
  } finally {
    await service.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed session launch is observable and does not turn confirmed cleanup into a second failure", async () => {
  const processes = new ProcessService();
  const session = processes.startSession({
    executable: process.execPath,
    args: ["-e", "process.exit(12)"],
  });
  while (!session.settled) await delay(10);
  assert.throws(() => session.check(), { code: "PROCESS_FAILED" });
  assert.equal(processes.sessionCount, 0);
  await session.stop();
  await processes.close();
  assert.equal(processes.size, 0);
});
