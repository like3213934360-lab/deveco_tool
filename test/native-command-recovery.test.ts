import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { WorkflowEngine } from "../src/core/workflows.js";
import {
  commandDefinition,
  fixtureFile,
} from "./fixtures/native-command-recovery.js";

for (const scenario of [
  { phase: "sync", fault: "after", expected: "succeeded" },
  { phase: "build", fault: "after", expected: "succeeded" },
  { phase: "large", fault: "after", expected: "succeeded" },
  { phase: "failure", fault: "after", expected: "failed" },
  { phase: "build", fault: "before", expected: "needs_input" },
  { phase: "build", fault: "after", expected: "failed", changed: true },
]) {
  test(`hard owner interruption ${scenario.phase}/${scenario.fault}${scenario.changed ? "/changed-file" : ""} recovers only recorded command results`, async () => {
    const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "deveco-command-recovery-")),
      ),
      owner = new ProcessService();
    let store: StateStore | undefined,
      processes: ProcessService | undefined,
      engine: WorkflowEngine | undefined;
    const build = scenario.phase === "sync" ? "build" : scenario.phase;
    try {
      const killed = await owner.run(
        {
          executable: process.execPath,
          args: [fixtureFile, "owner", root, scenario.phase, scenario.fault],
        },
        { allowFailure: true, timeoutMs: 60000 },
      );
      assert.ok(killed.exitCode !== 0 || killed.signal, killed.stderr);
      assert.equal(
        fs.readFileSync(path.join(root, "killed-at"), "utf8"),
        scenario.phase + ":" + scenario.fault,
      );
      const id = fs.readFileSync(path.join(root, "run-id"), "utf8");
      store = new StateStore(path.join(root, "state"));
      assert.equal(store.get(id).status, "interrupted");
      assert.ok(
        store
          .uncertainOperations(id)
          .some(({ node }) => node === "sdk_project"),
      );
      assert.equal(fs.readFileSync(path.join(root, "sync.count"), "utf8"), "x");
      if (scenario.changed)
        fs.writeFileSync(
          path.join(root, "build.output"),
          "replaced command output",
        );
      processes = new ProcessService(new PersistentProcessObserver(store));
      engine = new WorkflowEngine(
        store,
        [commandDefinition(root, store, processes, build)],
        async () => {},
      );
      const settle = async () => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const result = await engine!.status(id, 100);
          if (!["queued", "running"].includes(result.status)) return result;
        }
        throw new Error("Recovered workflow did not settle");
      };
      await engine.resume(id);
      const result = await settle();
      assert.equal(result.status, scenario.expected, JSON.stringify(result));
      assert.equal(fs.readFileSync(path.join(root, "sync.count"), "utf8"), "x");
      assert.equal(
        fs.readFileSync(path.join(root, build + ".count"), "utf8"),
        "x",
      );
      if (scenario.expected === "needs_input") {
        await engine.resume(id, { action: "recheck" });
        assert.equal((await settle()).status, "needs_input");
        assert.equal(
          fs.readFileSync(path.join(root, build + ".count"), "utf8"),
          "x",
        );
        assert.ok(store.uncertainOperations(id).length > 0);
        await assert.rejects(engine.cancel(id), { code: "EFFECT_UNCERTAIN" });
      } else {
        assert.deepEqual(store.uncertainOperations(id), []);
        if (scenario.expected === "failed")
          assert.match(
            store.get(id).error ?? "",
            scenario.changed ? /COMMAND_OUTPUT_CHANGED/ : /PROCESS_FAILED/,
          );
      }
      if (scenario.phase === "large") {
        const row = store.db
          .prepare("SELECT result FROM operations WHERE run_id=? AND node=?")
          .get(id, "sdk_project:command:large:completion") as {
          result: string;
        };
        assert.ok(Buffer.byteLength(row.result) < 1024);
        assert.match(row.result, /artifact_id/);
      }
    } finally {
      await engine?.close();
      await processes?.close();
      store?.close();
      await owner.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
