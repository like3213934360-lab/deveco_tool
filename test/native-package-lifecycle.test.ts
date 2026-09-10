import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import AdmZip from "adm-zip";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { captureFile, type CapturedFile } from "../src/core/captured-file.js";
import { fileDigest } from "../src/core/files.js";
import { Runtime } from "../src/services/runtime.js";
import { StorageService } from "../src/services/storage.js";

const app = { bundle_name: "com.deveco.fixture", module: "entry", ability: "EntryAbility" };
const receipt = (files: CapturedFile[]) => ({ installed: true as const, packages: files.map(file => ({
  artifact_id: file.artifact_id, sha256: file.sha256,
})) });
const retained = (store: StateStore) => store.db.prepare("SELECT id FROM artifacts WHERE mime='application/vnd.harmony.package'").all();
const root = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-package-lifecycle-")));

test("confirmed installation releases only its owned package bytes and exports their digests", async () => {
  const dir = root(), store = new StateStore(path.join(dir, "state")), source = path.join(dir, "input.hap");
  try {
    fs.writeFileSync(source, randomBytes(1024 * 1024));
    const sha256 = fileDigest(source);
    for (let n = 0; n < 8; n++) {
      const file = await captureFile(store, "workflow-input", source);
      const run = store.create("app_deploy", { deployment: [file] }, undefined, {}, [file.artifact_id]).run;
      const report = store.artifact(run.id, "installation log", "text/plain");
      await store.effect(run.id, "install_application", {}, async () => receipt([file]));
      assert.equal(fs.existsSync(file.path), false);
      assert.deepEqual(retained(store), []);
      assert.equal(store.capacityStatus().breakdown.pending_deletion, 0);
      const artifactBytes = store.capacityStatus().breakdown.artifacts;
      assert.ok(artifactBytes !== undefined && artifactBytes < 1024 * 1024, "only small reports remain charged");
      assert.equal(Buffer.from(store.readArtifact(report.artifact_id).data, "base64").toString("utf8"), "installation log");
      store.update(run.id, "succeeded", { installed: true });
      const destination = path.join(dir, "export-" + n);
      await new StorageService(store).export([run.id], destination);
      const manifest = JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"), "utf8"));
      assert.deepEqual(manifest.released_packages.map((item: Record<string, unknown>) => ({ id: item.artifact_id, sha256: item.sha256, bytes: item.bytes })),
        [{ id: file.artifact_id, sha256, bytes: file.bytes }]);
      assert.equal(manifest.artifacts.some((item: { id: string }) => item.id === file.artifact_id), false);
      assert.equal(fileDigest(source), sha256);
    }
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an uncertain install keeps its input until the outer receipt is reconciled", async () => {
  const dir = root(), store = new StateStore(path.join(dir, "state")), source = path.join(dir, "input.hap");
  try {
    fs.writeFileSync(source, "recovery input");
    const file = await captureFile(store, "workflow-input", source);
    const run = store.create("app_deploy", { deployment: [file] }, undefined, {}, [file.artifact_id]).run;
    await store.effect(run.id, "install_application:device:install", {}, async () => ({ confirmed: true }));
    await assert.rejects(store.effect(run.id, "install_application", {}, async () => { throw new Error("receipt lost"); }));
    store.prune();
    assert.equal(fs.existsSync(file.path), true, "the child receipt cannot authorize removal");
    await store.effect(run.id, "install_application", {}, async () => { throw new Error("must not reinstall"); }, async () => receipt([file]));
    assert.equal(fs.existsSync(file.path), false);
    assert.deepEqual(store.uncertainOperations(run.id), []);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("restart completes pending unlink and preserves the installation release receipt", async t => {
  const dir = root(), source = path.join(dir, "input.hap");
  let store = new StateStore(path.join(dir, "state"));
  try {
    fs.writeFileSync(source, "owned package");
    const file = await captureFile(store, "workflow-input", source);
    const run = store.create("app_deploy", { deployment: [file] }, undefined, {}, [file.artifact_id]).run;
    const remove = fs.rmSync;
    t.mock.method(fs, "rmSync", (...args: Parameters<typeof fs.rmSync>) => {
      if (args[0] === file.path) throw new Error("file temporarily locked");
      return remove(...args);
    });
    await store.effect(run.id, "install_application", {}, async () => receipt([file]));
    assert.equal(fs.existsSync(file.path), true);
    assert.equal(z.object({ bytes: z.number() }).parse(store.db.prepare("SELECT bytes FROM artifact_gc WHERE file=?").get(file.path)).bytes, file.bytes);
    store.close(); t.mock.restoreAll();
    store = new StateStore(path.join(dir, "state"));
    assert.equal(fs.existsSync(file.path), false);
    assert.equal(z.object({ sha256: z.string() }).parse(store.db.prepare("SELECT sha256 FROM released_packages WHERE artifact_id=?").get(file.artifact_id)).sha256, file.sha256);
    assert.equal(fs.readFileSync(source, "utf8"), "owned package");
  } finally { t.mock.restoreAll(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("deployment resumes a failed launch after package release without a second install", async t => {
  const dir = root(), source = path.join(dir, "entry.hap");
  const prior = { state: process.env.DEVECO_STATE_DIR, config: process.env.DEVECO_CONFIG };
  let runtime: Runtime | undefined, installs = 0;
  try {
    const zip = new AdmZip();
    zip.addFile("module.json", Buffer.from(JSON.stringify({ app: { bundleName: app.bundle_name, versionCode: 1, versionName: "1" },
      module: { name: app.module, type: "entry", abilities: [{ name: app.ability }] } })));
    zip.writeZip(source);
    fs.mkdirSync(path.join(dir, "clt"));
    process.env.DEVECO_STATE_DIR = path.join(dir, "state");
    process.env.DEVECO_CONFIG = path.join(dir, "config.json");
    fs.writeFileSync(process.env.DEVECO_CONFIG, JSON.stringify({ clt: path.join(dir, "clt") }));
    const setup = () => {
      runtime = new Runtime();
      t.mock.method(runtime.devices, "target", async () => "fixture");
      t.mock.method(runtime.devices, "install", async (_target: string, files: CapturedFile[]) => { installs++; return receipt(files); });
      t.mock.method(runtime.devices, "shell", async () => ({ stdout: "123", stderr: "", exitCode: 0, truncated: false }));
    };
    setup();
    t.mock.method(runtime!.devices, "launch", async () => { throw new Error("launch response lost"); });
    const request = { action: "start", workflow: "app_deploy", request_key: "one-deploy", input: { packages: [{ path: source }], target: "fixture", app } };
    const runId = z.object({ run_id: z.string() }).parse(await runtime!.call("workflow_run", request)).run_id;
    const settle = async () => {
      for (let i = 0; i < 100; i++) {
        const status = z.object({ status: z.string() }).passthrough().parse(await runtime!.call("workflow_run", { action: "status", run_id: runId, wait_ms: 100 }));
        if (!["queued", "running"].includes(status.status)) return status;
      }
      throw new Error("workflow did not settle");
    };
    assert.equal((await settle()).status, "needs_input");
    assert.equal(installs, 1);
    assert.deepEqual(retained(runtime!.store), []);
    await runtime!.close(); t.mock.restoreAll(); setup();
    t.mock.method(runtime!.devices, "reconcileLaunch", async () => ({ started: true }));
    await runtime!.call("workflow_run", { action: "resume", run_id: runId, resume_input: { action: "recheck" } });
    const final = await settle();
    assert.equal(final.status, "succeeded", JSON.stringify(final));
    assert.equal(installs, 1);
    assert.equal(z.object({ deduplicated: z.boolean() }).parse(await runtime!.call("workflow_run", request)).deduplicated, true);
    assert.deepEqual(retained(runtime!.store), []);
  } finally {
    await runtime?.close(); t.mock.restoreAll();
    if (prior.state === undefined) delete process.env.DEVECO_STATE_DIR; else process.env.DEVECO_STATE_DIR = prior.state;
    if (prior.config === undefined) delete process.env.DEVECO_CONFIG; else process.env.DEVECO_CONFIG = prior.config;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
