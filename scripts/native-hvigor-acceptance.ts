import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { ProjectService } from "../src/services/project.js";
import { HvigorSession } from "../src/services/hvigor/session.js";
import {
  HotConfiguration,
  hotPaths,
  assertNoHotWatch,
} from "../src/services/hvigor/hot-config.js";
import { atomicWrite, fileDigest, readObject } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity();
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const store = new StateStore(path.join(root, "state"));
const processes = new ProcessService(new PersistentProcessObserver(store));
const projects = new ProjectService(processes),
  toolchain = discoverToolchain();
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
let session: HvigorSession | undefined;
let configuration: HotConfiguration | undefined;
let failure: unknown;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const registry = path.join(
  process.env.HVIGOR_USER_HOME ?? path.join(os.homedir(), ".hvigor"),
  "daemon/cache/daemon-sec.json",
);
const shared = fs.existsSync(registry)
  ? Object.values(readObject(registry)).flatMap((row) => {
      const value = z
        .object({ pid: z.number().int().positive() })
        .safeParse(row);
      return value.success && alive(value.data.pid) ? [value.data.pid] : [];
    })
  : [];
async function observe<T>(name: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    throw error;
  }
}
try {
  const sdkVersion = z
    .object({ platformVersion: z.string() })
    .parse(
      readObject(path.join(toolchain.sdk, "default/sdk-pkg.json")).data,
    ).platformVersion;
  const project = await projects.create({
    project_path: path.join(root, "application"),
    app_name: "OwnedWatch",
    bundle_name: "com.deveco.ownedwatch",
    sdk_version: sdkVersion,
  });
  await observe("native_sync_without_shared_daemon", async () => {
    const result = await projects.sync(project);
    assert.equal(processes.size, 0);
    return result;
  });
  session = await HvigorSession.open(processes, toolchain, project.root);
  const identity = session.identity;
  const base = path.join(project.root, "entry/build/default/intermediates");
  configuration = HotConfiguration.prepare(project, project.modules);
  const common = {
    mode: "module" as const,
    prop: [
      "product=default",
      "module=entry@default",
      "debuggable=true",
      "hotReload=true",
      "requiredDeviceType=phone",
    ],
    parallel: true,
    incremental: true,
    analyze: "normal" as const,
    daemon: true as const,
    env: { DEVECO_SDK_HOME: toolchain.sdk },
  };
  await observe("owned_watch_baseline", async () => {
    const result = await session!.build({
      ...common,
      _: ["assembleHap"],
      watch: true,
      hotReloadBuild: true,
    });
    assert.equal(session!.connected, true);
    assert.ok(identity.pid && alive(identity.pid));
    return { ...result, identity };
  });
  const source = path.join(project.root, "entry/src/main/ets/pages/Index.ets");
  for (const revision of [1, 2]) {
    atomicWrite(
      source,
      fs
        .readFileSync(source, "utf8")
        .replace(
          revision === 1 ? "Hello World" : "Owned worker patch 1",
          `Owned worker patch ${revision}`,
        ),
    );
    atomicWrite(
      path.join(base, "hotReload/changedFileList.json"),
      JSON.stringify({
        modifiedFilesV2: [
          { filePath: source, belongProjectPath: project.root },
        ],
      }),
    );
    atomicWrite(
      path.join(base, "patch/default/changedFileList.json"),
      JSON.stringify({
        resources: { resFile: [], rawFile: [] },
        modifiedFiles: ["pages/Index.ets"],
      }),
    );
    await observe(`owned_worker_hot_compile_${revision}`, async () => {
      const file = hotPaths(project, project.modules[0]!).abc;
      const previous = fs.existsSync(file) ? fileDigest(file) : undefined;
      fs.rmSync(file, { force: true });
      const result = await session!.build({
        ...common,
        _: ["assembleDevHqf"],
        hotCompile: true,
      });
      assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0);
      assert.notEqual(fileDigest(file), previous);
      assert.deepEqual(session!.identity, identity);
      return {
        ...result,
        patch_sha256: fileDigest(file),
        bytes: fs.statSync(file).size,
        reused_worker: true,
      };
    });
  }
  await observe("owned_watch_stop_confirmed", async () => {
    await session!.stop();
    assert.equal(processes.size, 0);
    assert.ok(identity.pid && !alive(identity.pid));
    assert.ok(identity.worker_pid && !alive(identity.worker_pid));
    if (process.platform !== "win32") assert.equal(alive(-identity.pid), false);
    return { stopped: true, remaining_processes: processes.size };
  });
  await observe("shared_daemons_preserved", async () => {
    assert.ok(shared.every(alive));
    return {
      observed_before: shared.length,
      still_running: shared.filter(alive).length,
    };
  });
  await observe("watch_configuration_restored", async () => {
    configuration!.restore();
    assertNoHotWatch(project);
    assert.equal(
      fs.existsSync(hotPaths(project, project.modules[0]!).config),
      false,
    );
    return { restored: true };
  });
} catch (error) {
  failure = error;
  process.exitCode = 1;
} finally {
  await session?.stop();
  configuration?.restore();
  await processes.close();
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        scope:
          "Native SDK watch baseline, changed-source ABC compilation, owned process-group stop and preservation of observed shared daemons. No signing, installation or device hot-patch verification.",
        platform: process.platform,
        node: process.version,
        toolchain,
        observations,
        error: failure === undefined ? null : errorResult(failure),
      },
      null,
      2,
    ),
  );
  store.close();
}
