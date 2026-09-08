import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { StateStore } from "../src/core/store.js";
import { ProcessService, type ProcessResult } from "../src/core/process.js";
import { captureFiles } from "../src/core/captured-file.js";
import { withTrace } from "../src/core/trace.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { DeviceService } from "../src/services/device.js";

const app = {
  bundle_name: "com.deveco.fixture",
  module: "entry",
  ability: "EntryAbility",
};
const receipt = (stdout: string): ProcessResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  truncated: false,
  elapsedMs: 0,
  pid: null,
});
function packages(root: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const file = path.join(
      root,
      index === 0 ? "entry.hap" : `shared${index}.hsp`,
    );
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
            name: index === 0 ? app.module : `shared${index}`,
            type: index === 0 ? "entry" : "shared",
            abilities: index === 0 ? [{ name: app.ability }] : [],
          },
        }),
      ),
    );
    zip.writeZip(file);
    return { path: file };
  });
}
test("changed device package bytes prevent dispatch of an installation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-install-hash-")),
    store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(),
    devices = new DeviceService(processes, store);
  let transfers = 0;
  try {
    const files = await captureFiles(store, "run", packages(root, 1));
    t.mock.method(devices, "command", async () => {
      transfers++;
      return receipt("FileTransfer finish");
    });
    t.mock.method(devices, "shell", async (_target: string, args: string[]) => {
      if (args[0] === "sh" && args[2]?.startsWith("test ! -L ")) {
        assert.match(args[2], /test -d .*mkdir -m 700/);
        return receipt("");
      }
      if (args[0] === "sha256sum")
        return receipt(`${"0".repeat(64)}  ${args[1]}`);
      assert.ok(
        ["mkdir", "rm"].includes(args[0]!),
        "must not dispatch bm on mismatched input bytes",
      );
      return receipt("");
    });
    await assert.rejects(
      withTrace({ run_id: "run", node: "install" }, () =>
        devices.install("fixture", files, app, undefined, true),
      ),
      { code: "PACKAGE_TRANSFER_CHANGED" },
    );
    assert.equal(transfers, 1);
    assert.deepEqual(store.uncertainOperations("run"), []);
    assert.deepEqual(store.externalGuards(), []);
  } finally {
    devices.close();
    await processes.close();
    store.close();
    t.mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The device runs POSIX commands on all host platforms. This fixture executes
// those commands on POSIX hosts; byte/intent checks above also run on Windows.
if (process.platform !== "win32") {
  for (const count of [1, 3])
    for (const accepted of [true, false]) {
      test(`${count}-package ${accepted ? "successful" : "rejected"} installation recovers after restart without a second upload or install`, async (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "deveco-install-recovery-"),
          ),
          processes = new ProcessService();
        let store = new StateStore(path.join(root, "state")),
          devices = new DeviceService(processes, store),
          transfers = 0,
          verifies = 0,
          loseResponse = true;
        const counter = path.join(root, "installed"),
          launches = path.join(root, "launched");
        fs.writeFileSync(
          path.join(root, "bm"),
          [
            "#!/bin/sh",
            '[ "$1" = install ] && [ "$2" = -p ] || exit 11',
            `set -- "$3"/*; [ "$#" = ${count} ] || exit 12`,
            'printf x >> "$DEVECO_TEST_INSTALL_COUNTER"',
            accepted
              ? 'printf "install bundle successfully\\n"'
              : 'printf "signature validation failed\\n"; exit 17',
            "",
          ].join("\n"),
          { mode: 0o700 },
        );
        fs.writeFileSync(
          path.join(root, "aa"),
          '#!/bin/sh\nprintf x >> "$DEVECO_TEST_LAUNCH_COUNTER"\nprintf "start ability successfully\\n"\n',
          { mode: 0o700 },
        );
        const local = (value: string) =>
          value.replaceAll("/data/local/tmp/", root + "/");
        const mockDevice = () => {
          t.mock.method(devices, "command", async (args: string[]) => {
            assert.deepEqual(args.slice(0, 4), [
              "-t",
              "fixture",
              "file",
              "send",
            ]);
            transfers++;
            fs.copyFileSync(args[4]!, local(args[5]!));
            return receipt("FileTransfer finish");
          });
          t.mock.method(
            devices,
            "shell",
            async (_target: string, args: string[], signal?: AbortSignal) => {
              if (args[0] === "pidof") return receipt("1234\n");
              if (args[0] === "sha256sum")
                return receipt(
                  args
                    .slice(1)
                    .map(
                      (file) =>
                        `${createHash("sha256")
                          .update(fs.readFileSync(local(file)))
                          .digest("hex")}  ${file}`,
                    )
                    .join("\n"),
                );
              const mapped = args.map(local);
              const result = await processes.run(
                {
                  executable: mapped[0]!,
                  args: mapped.slice(1),
                  cwd: root,
                  env: {
                    ...process.env,
                    PATH: root + path.delimiter + process.env.PATH,
                    DEVECO_TEST_INSTALL_COUNTER: counter,
                    DEVECO_TEST_LAUNCH_COUNTER: launches,
                  },
                },
                { signal },
              );
              if (
                loseResponse &&
                args[0] === "sh" &&
                args[2]!.includes("'bm' 'install'")
              ) {
                loseResponse = false;
                throw new Error("HDC lost the completed install response");
              }
              return result;
            },
          );
        };
        const files = await captureFiles(
          store,
          "fixture",
          packages(root, count),
        );
        const definition: WorkflowDefinition = {
          id: "deploy",
          description: "fixture",
          capabilities: [],
          completion: "verified",
          resources: () => ["device:fixture"],
          steps: [
            {
              id: "install",
              kind: "effect",
              execute: (call) =>
                devices.install("fixture", files, app, call.signal, true),
              reconcile: (call) =>
                devices.reconcileInstall("fixture", files, app, call.signal),
            },
            {
              id: "launch",
              kind: "effect",
              execute: (call) =>
                devices.launch("fixture", app, call.signal, true),
              reconcile: (call) =>
                devices.reconcileLaunch("fixture", app, call.signal),
            },
            {
              id: "verify",
              kind: "read",
              execute: async () => {
                verifies++;
                return { verified: true };
              },
            },
          ],
        };
        let engine = new WorkflowEngine(store, [definition], async () => {});
        const settle = async (id: string) => {
          for (let i = 0; i < 100; i++) {
            const value = await engine.status(id, 100);
            if (!["queued", "running"].includes(value.status)) return value;
          }
          throw new Error("Installation did not settle");
        };
        try {
          mockDevice();
          const { run_id } = engine.start("deploy", {
            parameters: { app, files },
          });
          assert.equal((await settle(run_id)).status, "needs_input");
          assert.equal(fs.readFileSync(counter, "utf8"), "x");
          assert.equal(fs.existsSync(launches), false);
          await assert.rejects(
            store.lease("device:fixture", async () => true),
            { code: "RESOURCE_RECOVERY_REQUIRED" },
          );
          await assert.rejects(engine.cancel(run_id), {
            code: "CANCEL_UNCONFIRMED",
          });
          await engine.close();
          devices.close();
          store.close();
          t.mock.restoreAll();
          store = new StateStore(path.join(root, "state"));
          devices = new DeviceService(processes, store);
          engine = new WorkflowEngine(store, [definition], async () => {});
          mockDevice();
          await engine.resume(run_id, { action: "recheck" });
          assert.equal(
            (await settle(run_id)).status,
            accepted ? "succeeded" : "failed",
          );
          assert.equal(transfers, count);
          assert.equal(fs.readFileSync(counter, "utf8"), "x");
          assert.equal(verifies, accepted ? 1 : 0);
          assert.equal(
            fs.existsSync(launches) ? fs.readFileSync(launches, "utf8") : "",
            accepted ? "x" : "",
          );
          assert.deepEqual(store.uncertainOperations(run_id), []);
          assert.deepEqual(store.externalGuards(), []);
          assert.deepEqual(
            fs
              .readdirSync(root)
              .filter(
                (name) =>
                  name.startsWith("deveco-packages-") ||
                  name.startsWith("deveco-mcp-op-"),
              ),
            [],
          );
          if (!accepted) {
            await engine.resume(run_id);
            assert.equal((await settle(run_id)).status, "failed");
            assert.equal((await engine.cancel(run_id)).status, "cancelled");
            assert.equal(fs.readFileSync(counter, "utf8"), "x");
            assert.equal(transfers, count);
          }
        } finally {
          await engine.close();
          devices.close();
          await processes.close();
          store.close();
          t.mock.restoreAll();
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    }
}
