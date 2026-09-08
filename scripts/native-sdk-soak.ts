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
import { processMetrics } from "./lib/process-metrics.js";
import { validateSoak } from "./lib/soak-gate.js";
import { evidenceIdentity } from "./lib/evidence.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const duration = z.coerce
  .number()
  .int()
  .min(3600)
  .max(7200)
  .parse(process.argv[3] ?? 3600);
const target = z.string().min(1).parse(process.argv[4]);
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const tested = evidenceIdentity(),
  runtime = new Runtime(),
  toolchain = discoverToolchain();
const started = performance.now(),
  initialCpu = process.cpuUsage();
let running = 0;
const samples: unknown[] = [], idleSamples: unknown[] = [], cancellations: { scope: string; elapsed_ms: number; confirmed: boolean }[] = [];
let finalMetrics: Awaited<ReturnType<Runtime["lifecycleMetrics"]>> | undefined, idleElapsed = 0;
let session: HvigorSession | undefined,
  hot: HotConfiguration | undefined,
  failure: unknown;
let cycles = 0,
  patches = 0,
  lspRequests = 0, uiRequests = 0;
let lastSample = -Infinity;
function save(status: string) {
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        toolchain,
        format: 2,
        status,
        passed: status === "passed",
        scopes: ["sdk", "lsp", "ui", "watch"],
        duration_seconds: duration,
        elapsed_ms: running ? Math.min(performance.now() - running, duration * 1000) : 0,
        total_elapsed_ms: performance.now() - started,
        scope:
          "Real SDK LSP reuse, changed-document hover, owned Hvigor watch and ABC patches on a dedicated project, plus real HDC UI snapshots on the explicitly selected device. Runtime measurements include this small in-process driver. SDK process-tree samples exclude exited process CPU; unavailable counters carry reasons. Six minutes of natural idle reclamation follows explicit watch stop. No cloud signing, installation or device HQF validation.",
        cycles,
        patches,
        lsp_requests: lspRequests,
        cpu: process.cpuUsage(initialCpu),
        samples,
        idle_samples: idleSamples,
        idle_elapsed_ms: idleElapsed,
        final: finalMetrics,
        cancellations,
        cancel_ms: cancellations.map((item) => item.elapsed_ms),
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
  running = performance.now();
  let lastPatch: string | undefined;
  save("running");
  do {
    assert.equal(discoverToolchain().fingerprint, toolchain.fingerprint, "Toolchain identity changed during soak; repeat after SDK preparation finishes");
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
    const ui = z.object({ node_count: z.number().int().positive(), signature: z.string().min(1) }).parse(await runtime.call("ui_snapshot", { target, mode: "tree" }));
    assert.ok(ui.node_count > 0);
    uiRequests++;
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
    if (performance.now() - running - lastSample >= 30000) {
      lastSample = performance.now() - running;
      global.gc?.();
      samples.push({
        elapsed_ms: performance.now() - running,
        ...(await processMetrics(runtime.processes, [identity.worker_pid].filter((pid): pid is number => typeof pid === "number"))),
        activity: { sdk_builds: patches, lsp_requests: lspRequests, ui_requests: uiRequests, watch_connected: session.connected },
        retained: await runtime.lifecycleMetrics(),
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
  samples.push({ elapsed_ms: performance.now() - running, ...(await processMetrics(runtime.processes, [identity.worker_pid].filter((pid): pid is number => typeof pid === "number"))), activity: { sdk_builds: patches, lsp_requests: lspRequests, ui_requests: uiRequests, watch_connected: session.connected }, retained: await runtime.lifecycleMetrics() });
  let cancelledAt = performance.now();
  await session.stop();
  cancellations.push({ scope: "sdk_watch", elapsed_ms: performance.now() - cancelledAt, confirmed: !session.connected });
  hot.restore();
  assertNoHotWatch(project);
  const idleStarted = performance.now();
  do {
    idleElapsed = performance.now() - idleStarted;
    idleSamples.push({ elapsed_ms: idleElapsed, ...(await runtime.lifecycleMetrics()) });
    save("idle_reclamation");
    process.stdout.write(`SDK soak idle reclamation: ${Math.round(idleElapsed / 1000)}/360 seconds\n`);
    if (idleElapsed < 360000) await delay(Math.min(30000, 360000 - idleElapsed));
  } while (idleElapsed < 360000);
  assert.equal(runtime.diagnostics.lsp.metrics.connections, 0, "LSP must reclaim idle connections without explicit close");
  assert.equal(runtime.devices.cacheMetrics.snapshots, 0);
  assert.equal(runtime.savedTrees.metrics.entries, 0);
  assert.equal(runtime.cpu.metrics.workers, 0);
  assert.equal(runtime.processes.size, 0);
  assert.deepEqual(
    runtime.store.db.prepare("SELECT * FROM native_directories").all(),
    [],
  );
  cancelledAt = performance.now();
  const closed = await runtime.close();
  cancellations.push({ scope: "mcp_runtime", elapsed_ms: performance.now() - cancelledAt, confirmed: closed.closed });
  finalMetrics = await runtime.lifecycleMetrics();
  assert.equal(closed.closed, true, JSON.stringify(closed));
  assert.equal(
    evidenceIdentity().compiled_sha256,
    tested.compiled_sha256,
    "Tested compiled files changed during the soak",
  );
  save("passed");
  validateSoak(readObject(path.join(root, "evidence.json")).data);
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
