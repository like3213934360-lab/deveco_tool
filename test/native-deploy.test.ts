import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { z } from "zod";
import { archiveEntry } from "../src/core/archive.js";
import { Runtime } from "../src/services/runtime.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import type { ProcessResult } from "../src/core/process.js";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { DeviceService } from "../src/services/device.js";
import { captureFiles } from "../src/core/captured-file.js";

const app = {
  bundle_name: "com.deveco.fixture",
  module: "entry",
  ability: "EntryAbility",
};
function writePackage(
  file: string,
  options: {
    module?: string;
    type?: string;
    ability?: string | null;
    version?: number;
  } = {},
) {
  const zip = new AdmZip();
  zip.addFile(
    "module.json",
    Buffer.from(
      JSON.stringify({
        app: {
          bundleName: app.bundle_name,
          versionCode: options.version ?? 1,
          versionName: "1.0",
        },
        module: {
          name: options.module ?? app.module,
          type: options.type ?? "entry",
          abilities:
            options.ability === null
              ? []
              : [{ name: options.ability ?? app.ability }],
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
test("package sets accept shared dependencies and reject duplicate modules, mixed versions and ambiguous launch abilities", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-package-set-")),
    entry = path.join(root, "entry.hap"),
    other = path.join(root, "other.hap"),
    shared = path.join(root, "shared.hsp");
  try {
    writePackage(entry);
    writePackage(shared, { module: "shared", type: "shared", ability: null });
    assert.equal(
      (await inspectApplicationPackages([entry, shared], app)).modules.length,
      2,
    );
    writePackage(other);
    await assert.rejects(inspectApplicationPackages([entry, other], app), {
      code: "PACKAGE_MODULE_DUPLICATE",
    });
    writePackage(other, { module: "feature", type: "feature", version: 2 });
    await assert.rejects(inspectApplicationPackages([entry, other], app), {
      code: "PACKAGE_VERSION_MISMATCH",
    });
    writePackage(other, { module: "feature", type: "feature" });
    await assert.rejects(
      inspectApplicationPackages([entry, other], {
        bundle_name: app.bundle_name,
        ability: app.ability,
      }),
      { code: "PACKAGE_ABILITY_AMBIGUOUS" },
    );
    assert.equal(
      (await inspectApplicationPackages([entry, other], app)).module,
      "entry",
    );
    await assert.rejects(inspectApplicationPackages([shared], app), {
      code: "PACKAGE_MODULE_MISMATCH",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["transfer", "install"])
  test(`batch ${failure} failure neither repeats installation nor reports success`, async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "deveco-batch-failure-"),
      ),
      store = new StateStore(path.join(root, "state")),
      processes = new ProcessService(),
      devices = new DeviceService(processes, store),
      entry = path.join(root, "entry.hap"),
      shared = path.join(root, "shared.hsp");
    try {
      writePackage(entry);
      writePackage(shared, { module: "shared", type: "shared", ability: null });
      const files = await captureFiles(store, "fixture", [
        { path: entry },
        { path: shared },
      ]);
      let transferred = 0,
        installs = 0,
        cleanups = 0;
      t.mock.method(devices, "command", async () => {
        transferred++;
        if (failure === "transfer" && transferred === 2)
          return receipt("transfer failed");
        return receipt("FileTransfer finish");
      });
      t.mock.method(
        devices,
        "shell",
        async (_target: string, args: string[]) => {
          if (args[0] === "bm") {
            installs++;
            throw new Error("lost device receipt");
          }
          if (args[0] === "rm") cleanups++;
          return receipt("");
        },
      );
      await assert.rejects(devices.install("fixture", files, app));
      assert.equal(installs, failure === "transfer" ? 0 : 1);
      assert.equal(cleanups, failure === "transfer" ? 1 : 0);
      assert.equal(
        (
          store.db
            .prepare(
              "SELECT COUNT(*) AS count FROM events WHERE kind='device_package_cleanup_pending'",
            )
            .get() as { count: number }
        ).count,
        failure === "install" ? 1 : 0,
      );
    } finally {
      devices.close();
      await processes.close();
      store.close();
      t.mock.restoreAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
test("application package identity is checked before any device installation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-package-"));
  try {
    const file = path.join(root, "entry.hap");
    writePackage(file);
    const metadata = await inspectApplicationPackages([file], app);
    assert.equal(metadata.bundle_name, app.bundle_name);
    for (const [change, code] of [
      [{ bundle_name: "com.another.app" }, "PACKAGE_BUNDLE_MISMATCH"],
      [{ module: "feature" }, "PACKAGE_MODULE_MISMATCH"],
      [{ ability: "MissingAbility" }, "PACKAGE_ABILITY_MISMATCH"],
    ] as const)
      await assert.rejects(
        inspectApplicationPackages([file], { ...app, ...change }),
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

for (const packageCount of [1, 3])
  test(`native deployment of ${packageCount} packages checkpoints installation separately and never reinstalls after a lost launch receipt`, async (t) => {
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
    fs.mkdirSync(path.join(root, "fixture-clt"));
    process.env.DEVECO_STATE_DIR = path.join(root, "state");
    const runtime = new Runtime();
    try {
      const artifact = path.join(root, "entry.hap");
      writePackage(artifact);
      const packages = [{ path: artifact }];
      if (packageCount > 1) {
        const feature = path.join(root, "feature.hap"),
          shared = path.join(root, "shared.hsp");
        writePackage(feature, {
          module: "feature",
          type: "feature",
          ability: "FeatureAbility",
        });
        writePackage(shared, {
          module: "shared",
          type: "shared",
          ability: null,
        });
        packages.push({ path: feature }, { path: shared });
      }
      let installs = 0,
        launches = 0;
      const transferred = new Map<string, string>();
      t.mock.method(runtime.devices, "target", async () => "fixture-device");
      t.mock.method(runtime.devices, "command", async (args: string[]) => {
        assert.deepEqual(args.slice(0, 4), [
          "-t",
          "fixture-device",
          "file",
          "send",
        ]);
        assert.ok(
          args[4]!.startsWith(
            path.join(runtime.store.root, "artifacts") + path.sep,
          ),
        );
        transferred.set(
          args[5]!,
          createHash("sha256").update(fs.readFileSync(args[4]!)).digest("hex"),
        );
        return receipt("FileTransfer finish");
      });
      t.mock.method(
        runtime.devices,
        "shell",
        async (_target: string, args: string[]) => {
          if (args[0] === "sha256sum") {
            assert.equal(transferred.size, packageCount);
            return receipt(
              args
                .slice(1)
                .map((file) => `${transferred.get(file)}  ${file}`)
                .join("\n"),
            );
          }
          if (args[0] === "sh") {
            if (args[2]!.startsWith("test ! -L ")) {
              assert.match(args[2]!, /test -d .*mkdir -m 700/);
              assert.equal(installs, 0);
              return receipt("");
            }
            assert.ok(args[2]!.includes("'bm' 'install' '-p'"));
            const identity = /'DEVECO_DEVICE_RECEIPT_V1' '([a-f0-9]{64})'/.exec(
              args[2]!,
            );
            assert.ok(identity);
            installs++;
            return receipt(
              `DEVECO_DEVICE_RECEIPT_V1\n${identity[1]}\n0\ninstall bundle successfully`,
            );
          }
          assert.ok(["mkdir", "rm"].includes(args[0]!));
          return receipt("");
        },
      );
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
          input: { packages, app: { ...app, bundle_name: "com.wrong.bundle" } },
        }),
      );
      assert.equal((await finish(invalid.run_id)).status, "failed");
      assert.equal(installs, 0);
      const submit = () =>
        runtime.call("workflow_run", {
          action: "start",
          workflow: "app_deploy",
          request_key: "same-installation",
          input: { packages, app },
        });
      const submitted = await Promise.all([submit(), submit()]);
      const run = z.object({ run_id: z.string() }).parse(submitted[0]);
      assert.equal(
        z.object({ run_id: z.string() }).parse(submitted[1]).run_id,
        run.run_id,
      );
      assert.equal(
        (
          runtime.store.db
            .prepare(
              "SELECT COUNT(*) AS count FROM artifacts WHERE run_id='workflow-input'",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.equal((await finish(run.run_id)).status, "needs_input");
      assert.equal(
        (
          runtime.store.db
            .prepare(
              "SELECT COUNT(*) AS count FROM artifacts WHERE run_id=? AND mime=?",
            )
            .get(run.run_id, "application/vnd.harmony.package") as {
            count: number;
          }
        ).count,
        0,
      );
      assert.equal((runtime.store.db.prepare("SELECT COUNT(*) AS count FROM released_packages WHERE run_id=?")
        .get(run.run_id) as { count: number }).count, packageCount);
      assert.deepEqual(
        runtime.store.db
          .prepare(
            "SELECT node,status FROM operations WHERE run_id=? ORDER BY node",
          )
          .all(run.run_id),
        [
          { node: "install_application", status: "done" },
          { node: "install_application:device:install", status: "done" },
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
