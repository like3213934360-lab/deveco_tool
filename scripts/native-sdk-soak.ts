import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { HvigorSession } from "../src/services/hvigor/session.js";
import {
  HotConfiguration,
  hotPaths,
  assertNoHotWatch,
} from "../src/services/hvigor/hot-config.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, fileDigest, readObject } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const duration = z.coerce
  .number()
  .int()
  .min(10)
  .max(7200)
  .parse(process.argv[3] ?? 3600);
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const tested = evidenceIdentity(),
  runtime = new Runtime(),
  toolchain = discoverToolchain();
const started = performance.now(),
  initialCpu = process.cpuUsage();
const samples: unknown[] = [];
let session: HvigorSession | undefined,
  hot: HotConfiguration | undefined,
  failure: unknown;
let cycles = 0,
  patches = 0,
  lspRequests = 0;
function save(status: string) {
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        toolchain,
        status,
        duration_seconds: duration,
        elapsed_ms: performance.now() - started,
        scope:
          "Real SDK LSP reuse and changed-document queries, owned Hvigor watch and ABC patches on a dedicated project. No cloud signing, installation, UI or device HQF validation. CPU/RSS include the runtime only; SDK process identities and retained log bytes are recorded separately.",
        cycles,
        patches,
        lsp_requests: lspRequests,
        cpu: process.cpuUsage(initialCpu),
        samples,
        error: failure === undefined ? null : errorResult(failure),
      },
      null,
      2,
    ),
  );
}
try {
  const sdkVersion = z
    .object({ platformVersion: z.string() })
    .parse(
      readObject(path.join(toolchain.sdk, "default/sdk-pkg.json")).data,
    ).platformVersion;
  const project = await runtime.projects.create({
    project_path: path.join(root, "application"),
    app_name: "NativeSdkSoak",
    bundle_name: "com.deveco.nativesdksoak",
    sdk_version: sdkVersion,
  });
  await runtime.projects.sync(project);
  hot = HotConfiguration.prepare(project, project.modules);
  session = await HvigorSession.open(
    runtime.processes,
    toolchain,
    project.root,
  );
  const identity = session.identity;
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
  await session.build({
    ...common,
    _: ["assembleHap"],
    watch: true,
    hotReloadBuild: true,
  });
  const file = path.join(project.root, "entry/src/main/ets/pages/Index.ets"),
    original = fs.readFileSync(file, "utf8"),
    base = path.join(project.root, "entry/build/default/intermediates");
  const lines = original.split("\n"),
    line = lines.findIndex((value) => value.includes("Text(this.message)")),
    character = lines[line]!.indexOf("message") + 1;
  const running = performance.now();
  let lastPatch: string | undefined;
  save("running");
  do {
    if (cycles % 12 === 0) {
      atomicWrite(
        file,
        original.replace("Hello World", `Native SDK soak ${++patches}`),
      );
      atomicWrite(
        path.join(base, "hotReload/changedFileList.json"),
        JSON.stringify({
          modifiedFilesV2: [
            { filePath: file, belongProjectPath: project.root },
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
      const abc = hotPaths(project, project.modules[0]!).abc;
      fs.rmSync(abc, { force: true });
      await session.build({
        ...common,
        _: ["assembleDevHqf"],
        hotCompile: true,
      });
      assert.ok(fs.statSync(abc).size > 0);
      const hash = fileDigest(abc);
      assert.notEqual(hash, lastPatch);
      lastPatch = hash;
      assert.deepEqual(session.identity, identity);
    }
    const result = await runtime.diagnostics.lsp.request(project, {
      action: "hover",
      file,
      line,
      character,
    });
    assert.match(JSON.stringify(result), /message|string/);
    lspRequests++;
    assert.equal(session.connected, true);
    assert.equal(
      runtime.processes.size,
      2,
      "One owned watch launcher and one LSP session must be reused",
    );
    runtime.store.prune();
    runtime.store.capacity();
    const directories = z
      .array(z.object({ bytes: z.number(), closing: z.number() }))
      .parse(
        runtime.store.db
          .prepare("SELECT bytes,closing FROM native_directories")
          .all(),
      );
    assert.equal(directories.length, 1);
    assert.equal(directories[0]!.closing, 0);
    cycles++;
    if (cycles % 12 === 1) {
      global.gc?.();
      samples.push({
        elapsed_ms: performance.now() - running,
        runtime_memory: process.memoryUsage(),
        owned_sessions: runtime.processes.size,
        hvigor: identity,
        native_directories: directories,
        patch_sha256: lastPatch,
      });
      save("running");
      process.stdout.write(
        `SDK soak: ${cycles} cycles, ${patches} patches, ${Math.round((performance.now() - running) / 1000)} seconds\n`,
      );
    }
    await delay(
      Math.min(
        5000,
        Math.max(0, running + duration * 1000 - performance.now()),
      ),
    );
  } while (performance.now() - running < duration * 1000);
  await session.stop();
  hot.restore();
  assertNoHotWatch(project);
  await runtime.diagnostics.lsp.close();
  assert.equal(runtime.processes.size, 0);
  assert.deepEqual(
    runtime.store.db.prepare("SELECT * FROM native_directories").all(),
    [],
  );
  const closed = await runtime.close();
  assert.equal(closed.closed, true, JSON.stringify(closed));
  assert.equal(
    evidenceIdentity().compiled_sha256,
    tested.compiled_sha256,
    "Tested compiled files changed during the soak",
  );
  samples.push({
    owned_sessions: 0,
    native_directories: 0,
    configuration_restored: true,
    closed: true,
    runtime_memory: process.memoryUsage(),
  });
  save("passed");
} catch (error) {
  failure = error;
  try {
    await session?.stop();
    hot?.restore();
    const closed = await runtime.close();
    samples.push({ cleanup: closed });
  } catch (cleanup) {
    samples.push({ cleanup_error: errorResult(cleanup) });
  }
  save("failed");
  process.exitCode = 1;
}
