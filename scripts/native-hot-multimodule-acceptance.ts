import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite, digest, readObject } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { nativeOperation } from "./lib/native-operation.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

// The peer shares SQLite ownership with the parent, but has its own runtime and
// process registry. It must refuse startup without blocking the owner's apply.
if (process.argv[2] === "--peer") {
  process.env.DEVECO_STATE_DIR = z.string().min(1).parse(process.argv[3]);
  const runtime = new Runtime();
  let result: Record<string, unknown> = {};
  try {
    const task = z.object({ run_id: z.string() }).parse(await runtime.call("hot_reload", JSON.parse(process.argv[4]!) as unknown));
    result = z.record(z.string(), z.unknown()).parse(await runtime.call("workflow_run", { action: "status", run_id: task.run_id, wait_ms: 20000 }));
    result.sdk_processes = runtime.processes.size;
  } finally {
    const closed = await runtime.close();
    console.log(JSON.stringify({ ...result, closed: closed.closed }));
  }
} else {
  // Reuse only the isolated, personally signed four-module fixture produced by
  // native-multimodule-acceptance. A target alias must match its original UDID.
  const [root, fixtureRoot, preparedRoot, signingRoot, target] = z.tuple([
    z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1),
  ]).parse(process.argv.slice(2));
  assert.ok(path.isAbsolute(root) && path.isAbsolute(fixtureRoot) && path.isAbsolute(preparedRoot) && path.isAbsolute(signingRoot));
  assert.equal(fs.existsSync(root), false, "Evidence directory must be new");
  z.object({ passed: z.literal(true), completed: z.literal(true), closed: z.literal(true) })
    .parse(readObject(path.join(fixtureRoot, "evidence.json")));
  const prepared = z.object({ bundle_name: z.string().startsWith("com.deveco.mcpacceptance.") })
    .parse(readObject(path.join(preparedRoot, "prepared.json")));
  const journal = z.object({ operations: z.object({ preflight: z.object({ result: z.object({ udid_sha256: z.string().regex(/^[a-f0-9]{64}$/) }) }) }) })
    .parse(readObject(path.join(signingRoot, "operations.private.json")));
  const project_path = path.join(fixtureRoot, "application"),
    selection = { project_path, product: "default", module_targets: { entry: "default", feature: "default", library: "default", shared: "default" } },
    relativeFiles = ["library/Cold.ets", "shared/Index.ets", "feature/src/main/ets/pages/Index.ets"],
    originals = new Map(relativeFiles.map((file) => [path.join(project_path, file), fs.readFileSync(path.join(project_path, file), "utf8")])),
    written = new Map(originals);
  assert.equal(originals.get(path.join(project_path, relativeFiles[0]!))!.split("library-tablet-preview").length, 2);
  assert.equal(originals.get(path.join(project_path, relativeFiles[1]!))!.split("shared-tablet-preview").length, 2);
  assert.equal(originals.get(path.join(project_path, relativeFiles[2]!))!.split("libraryMessage() + sharedMessage()").length, 2);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  atomicWrite(path.join(root, "config.json"), "{}\n");
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  process.env.DEVECO_CONFIG = path.join(root, "config.json");
  const tested = evidenceIdentity(), runtime = new Runtime(),
    observations: { name: string; result?: unknown; error?: unknown; elapsed_ms: number }[] = [];
  let completed = false, closed = false, cleaned = true;
  const report = path.join(root, "evidence.json"),
    save = () => atomicWrite(report, JSON.stringify({ tested, observations }, null, 2));
  async function observe<T>(name: string, task: () => Promise<T>) {
    const started = performance.now();
    try {
      const result = await task();
      observations.push({ name, result, elapsed_ms: performance.now() - started });
      console.log(`${name}: passed`);
      return result;
    } catch (error) {
      observations.push({ name, error: errorResult(error), elapsed_ms: performance.now() - started });
      console.log(`${name}: failed`);
      throw error;
    } finally { save(); }
  }
  const edit = (relative: string, transform: (source: string) => string) => {
    const file = path.join(project_path, relative), previous = written.get(file)!;
    assert.equal(fs.readFileSync(file, "utf8"), previous, "Source changed outside this acceptance");
    const next = transform(previous);
    assert.notEqual(next, previous);
    atomicWrite(file, next);
    written.set(file, next);
  };
  const verify = (text: string) => runtime.call("verify_ui", { target, assert: {
    visible: { key: "ModuleEvidence", text, textMode: "exact", bundle_name: prepared.bundle_name }, timeoutMs: 15000,
  } });
  const startInput = { action: "start", ...selection, target, modules: ["entry", "feature", "shared"],
    app: { bundle_name: prepared.bundle_name, module: "entry", ability: "EntryAbility" } };
  const patch = async (index: number) => {
    const result = z.object({ applied: z.literal(true), processPreserved: z.literal(true), patch_versions: z.record(z.string(), z.number()) }).passthrough()
      .parse(await nativeOperation(runtime, "hot_reload", { action: "apply", ...selection, target }, path.join(root, `patch-${index}.operation.private.json`)));
    assert.deepEqual(Object.keys(result.patch_versions).sort(), ["entry", "feature", "shared"]);
    assert.equal(new Set(Object.values(result.patch_versions)).size, 1);
    return result;
  };
  try {
    await observe("original_signing_device_identity", async () => {
      const raw = await runtime.devices.shell(await runtime.devices.target(target), ["bm", "get", "-u"]);
      const ids = raw.stdout.split(/\r?\n/).map((value) => value.trim()).filter((value) => /^[a-fA-F0-9]{64}$/.test(value));
      assert.equal(ids.length, 1);
      assert.equal(digest(ids[0]!.toUpperCase()), journal.operations.preflight.result.udid_sha256);
      return { matched: true };
    });
    await observe("start_three_module_signed_watch", async () => {
      const result = z.object({ baseline_packages: z.array(z.unknown()).length(3) }).passthrough()
        .parse(await nativeOperation(runtime, "hot_reload", startInput, path.join(root, "start.operation.private.json")));
      return result;
    });
    await observe("baseline_actual_ui", () => verify("library-tablet-previewshared-tablet-preview"));
    await observe("competing_process_rejected", async () => {
      const peer = await runtime.processes.run({ executable: process.execPath,
        args: [fileURLToPath(import.meta.url), "--peer", runtime.store.root, JSON.stringify(startInput)], env: { ...process.env } }, { timeoutMs: 30000 });
      const result = z.object({ status: z.literal("needs_input"), sdk_processes: z.literal(0), closed: z.literal(true),
        result: z.object({ interrupts: z.array(z.object({ value: z.object({ error: z.object({ code: z.literal("EFFECT_UNCERTAIN"),
          details: z.object({ cause: z.object({ code: z.literal("HOT_SESSION_ACTIVE") }) }) }) }) })).min(1) }) }).passthrough().parse(JSON.parse(peer.stdout));
      z.object({ active: z.literal(true) }).parse(await runtime.call("hot_reload", { action: "status", ...selection }));
      return result;
    });
    edit(relativeFiles[0]!, (source) => source.replace("library-tablet-preview", "hot-library-one"));
    edit(relativeFiles[1]!, (source) => source.replace("shared-tablet-preview", "hot-shared-one"));
    await observe("three_module_hqf", () => patch(1));
    await observe("har_and_hsp_patch_actual_ui", () => verify("hot-library-onehot-shared-one"));
    await observe("feature_launch", () => runtime.devices.launch(target, { bundle_name: prepared.bundle_name, module: "feature", ability: "EntryAbility" }));
    await observe("feature_shared_patch_actual_ui", () => verify("hot-library-onehot-shared-one"));
    edit(relativeFiles[2]!, (source) => source.replace("libraryMessage() + sharedMessage()", "libraryMessage() + sharedMessage() + ' feature-patched'"));
    await observe("feature_edit_retains_previous_patches", () => patch(2));
    await observe("feature_patch_actual_ui", () => verify("hot-library-onehot-shared-one feature-patched"));
    edit(relativeFiles[0]!, () => originals.get(path.join(project_path, relativeFiles[0]!))!);
    await observe("revert_har_retains_other_patches", () => patch(3));
    await observe("reverted_har_actual_ui", () => verify("library-tablet-previewhot-shared-one feature-patched"));
    await observe("stop_first_watch", () => runtime.call("hot_reload", { action: "stop", ...selection }));
    await observe("fresh_watch_without_source_edits", async () => {
      return z.object({ baseline_packages: z.array(z.unknown()).length(3) }).passthrough()
        .parse(await nativeOperation(runtime, "hot_reload", startInput, path.join(root, "restart.operation.private.json")));
    });
    await observe("restarted_watch_actual_ui", () => verify("library-tablet-previewhot-shared-one"));
    completed = true;
  } catch { process.exitCode = 1; }
  finally {
    try { await observe("stop_owned_watch", () => runtime.call("hot_reload", { action: "stop", ...selection })); }
    catch { cleaned = false; }
    try { await observe("restore_owned_sources", async () => {
      for (const [file] of originals) assert.equal(fs.readFileSync(file, "utf8"), written.get(file));
      for (const [file, original] of originals) atomicWrite(file, original);
      return { restored: true };
    }); } catch { cleaned = false; }
    try { await observe("close", async () => { const result = await runtime.close(); closed = result.closed; return result; }); }
    finally { finishAcceptance(report, tested, completed && cleaned, closed, { scope: "Direct native Runtime and real SDK/device; not an MCP Worker soak" }); }
  }
}
