import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import { archiveEntry } from "../src/core/archive.js";
import { Runtime } from "../src/services/runtime.js";
import { inspectApplicationPackage } from "../src/services/package.js";
import type { ProcessResult } from "../src/core/process.js";

const app = {
  bundle_name: "com.deveco.fixture",
  module: "entry",
  ability: "EntryAbility",
};
function writePackage(file: string) {
  const zip = new AdmZip();
  zip.addFile(
    "module.json",
    Buffer.from(
      JSON.stringify({
        app: {
          bundleName: app.bundle_name,
          versionCode: 1,
          versionName: "1.0",
        },
        module: {
          name: app.module,
          type: "entry",
          abilities: [{ name: app.ability }],
        },
      }),
    ),
  );
  zip.addFile("unrelated-large-content", Buffer.alloc(8 * 1024 * 1024));
  zip.writeZip(file);
}
const receipt = (stdout: string): ProcessResult => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  truncated: false,
  elapsedMs: 1,
  pid: null,
});
test("application package identity is checked before any device installation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-package-"));
  try {
    const file = path.join(root, "entry.hap");
    writePackage(file);
    const metadata = await inspectApplicationPackage(file, app);
    assert.equal(metadata.bundle_name, app.bundle_name);
    for (const [change, code] of [
      [{ bundle_name: "com.another.app" }, "PACKAGE_BUNDLE_MISMATCH"],
      [{ module: "feature" }, "PACKAGE_MODULE_MISMATCH"],
      [{ ability: "MissingAbility" }, "PACKAGE_ABILITY_MISMATCH"],
    ] as const)
      await assert.rejects(
        inspectApplicationPackage(file, { ...app, ...change }),
        { code },
      );
    await assert.rejects(archiveEntry(file, "module.json", 8), {
      code: "ARCHIVE_MEMBER_TOO_LARGE",
    });
    await assert.rejects(archiveEntry(file, "missing.json", 1024), {
      code: "ARCHIVE_MEMBER_MISSING",
    });
    // Cancelled archive work must release its file descriptor, including on Windows.
    await assert.rejects(
      archiveEntry(file, "module.json", 1024, AbortSignal.abort()),
      { name: "AbortError" },
    );
    fs.renameSync(file, path.join(root, "moved.hap"));
    assert.ok(!fs.existsSync(file));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native deployment checkpoints installation separately and never reinstalls after a lost launch receipt", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-deploy-"));
  const previous = {
    config: process.env.DEVECO_CONFIG,
    state: process.env.DEVECO_STATE_DIR,
  };
  const config = path.join(root, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({ clt: path.join(root, "fixture-clt") }),
  );
  process.env.DEVECO_CONFIG = config;
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  const runtime = new Runtime();
  try {
    const artifact = path.join(root, "entry.hap");
    writePackage(artifact);
    let installs = 0,
      launches = 0;
    t.mock.method(runtime.devices, "target", async () => "fixture-device");
    t.mock.method(runtime.devices, "command", async (args: string[]) => {
      assert.deepEqual(args.slice(0, 3), ["-t", "fixture-device", "install"]);
      assert.notEqual(args[3], artifact);
      assert.equal(
        path.dirname(args[3]!),
        path.join(runtime.store.root, "artifacts"),
      );
      assert.ok(args[3]?.endsWith(".hap"));
      installs++;
      return receipt("install bundle successfully");
    });
    t.mock.method(runtime.devices, "launch", async () => {
      launches++;
      throw new Error("device accepted launch but response was lost");
    });
    const stateSchema = z.object({ status: z.string() });
    const finish = async (run_id: string) => {
      for (let i = 0; i < 100; i++) {
        const value = stateSchema.parse(
          await runtime.call("workflow_run", {
            action: "status",
            run_id,
            wait_ms: 100,
          }),
        );
        if (!["queued", "running"].includes(value.status)) return value;
      }
      throw new Error("Deployment did not settle");
    };
    const invalid = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "app_deploy",
        input: { artifact, app: { ...app, bundle_name: "com.wrong.bundle" } },
      }),
    );
    assert.equal((await finish(invalid.run_id)).status, "failed");
    assert.equal(installs, 0);
    const run = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "app_deploy",
        input: { artifact, app },
      }),
    );
    assert.equal((await finish(run.run_id)).status, "needs_input");
    assert.deepEqual(
      runtime.store.db
        .prepare(
          "SELECT node,status FROM operations WHERE run_id=? ORDER BY node",
        )
        .all(run.run_id),
      [
        { node: "install_application", status: "done" },
        { node: "launch_application", status: "started" },
      ],
    );
    await runtime.call("workflow_run", {
      action: "resume",
      run_id: run.run_id,
      resume_input: { action: "recheck" },
    });
    assert.equal((await finish(run.run_id)).status, "needs_input");
    assert.equal(installs, 1);
    assert.equal(launches, 1);
  } finally {
    await runtime.close();
    t.mock.restoreAll();
    if (previous.config === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous.state;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
