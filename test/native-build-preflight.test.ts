import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { buildPreflight } from "../src/services/build-preflight.js";
import { workflowInputs } from "../src/core/contracts.js";
import { withTrace } from "../src/core/trace.js";
import { Runtime } from "../src/services/runtime.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { ToolError } from "../src/core/errors.js";
const report = (success: boolean, errors: number) => ({
  success,
  checked_file_count: 3,
  summary: { errorCount: errors, warnCount: 0 },
  artifact: { artifact_id: "fixture-report" },
});
async function fixture(task: (store: StateStore) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-preflight-")),
    store = new StateStore(root);
  try {
    await task(store);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("fresh preflight blocks both success=false and positive error counts before build, and checks fixed sources again", async () =>
  fixture(async (store) => {
    let builds = 0,
      checks = 0,
      content = "broken";
    const runBuild = async (success: boolean, errors: number) => {
      await buildPreflight(
        store,
        { mode: "check" },
        async () => {
          checks++;
          return report(success, errors);
        },
        () => content,
      );
      builds++;
    };
    await assert.rejects(runBuild(true, 1), { code: "BUILD_CHECK_BLOCKED" });
    await assert.rejects(runBuild(false, 0), { code: "BUILD_CHECK_BLOCKED" });
    assert.equal(builds, 0);
    content = "fixed";
    await runBuild(true, 0);
    assert.equal(builds, 1);
    assert.equal(checks, 3);
  }));

test("production build workflow settles first-attempt preflight rejection, but preserves uncertainty during recovery", async () =>
  fixture(async (store) => {
    let errors = 1,
      checks = 0,
      builds = 0,
      loseReceipt = false;
    const project = {
      root: store.root,
      product: { name: "default" },
      modules: [],
      fingerprint: "fixture",
    };
    // Exercise the real runtime definitions and durable workflow engine while
    // replacing only the external checker/build boundary.
    const runtime = Object.assign(Object.create(Runtime.prototype) as Runtime, {
      store,
      project: () => project,
      diagnostics: {
        arkts: async () => {
          checks++;
          return report(errors === 0, errors);
        },
      },
      projects: {
        build: async () => {
          builds++;
          if (loseReceipt)
            throw new ToolError("CONNECTION_LOST", "Build response lost");
          return { artifacts: [] };
        },
      },
    });
    const definitions = (
      Reflect.get(runtime, "definitions") as () => WorkflowDefinition[]
    ).call(runtime);
    const engine = new WorkflowEngine(store, definitions, async () => {});
    const finish = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const state = await engine.status(id, 100);
        if (["failed", "needs_input", "succeeded"].includes(state.status))
          return state;
      }
      throw new Error("Build workflow did not settle");
    };
    const start = () =>
      engine.start("project_build", { parameters: { sync: false } }).run_id;
    try {
      const rejected = start(),
        first = await finish(rejected);
      assert.equal(first.status, "failed");
      assert.match(JSON.stringify(first.error), /BUILD_CHECK_BLOCKED/);
      assert.equal(store.operationState(rejected, "build_project"), "failed");
      assert.equal(builds, 0);
      await engine.resume(rejected);
      assert.equal((await finish(rejected)).status, "failed");
      assert.equal(
        checks,
        1,
        "A settled failed attempt is never silently replayed",
      );
      errors = 0;
      assert.equal((await finish(start())).status, "succeeded");
      assert.equal(builds, 1);
      loseReceipt = true;
      const uncertain = start();
      assert.equal((await finish(uncertain)).status, "needs_input");
      errors = 1;
      await engine.resume(uncertain, { action: "recheck" });
      assert.equal((await finish(uncertain)).status, "needs_input");
      assert.equal(store.operationState(uncertain, "build_project"), "started");
      assert.equal(
        builds,
        2,
        "Failed recovery preflight cannot dispatch another build",
      );
    } finally {
      await engine.close();
    }
  }));
test("preflight rejects changing source evidence and cancellation; manual override is explicit and durable", async () =>
  fixture(async (store) => {
    let content = "before";
    await assert.rejects(
      buildPreflight(
        store,
        { mode: "check" },
        async () => {
          content = "after";
          return report(true, 0);
        },
        () => content,
      ),
      { code: "CHECK_EVIDENCE_STALE" },
    );
    const controller = new AbortController();
    await assert.rejects(
      buildPreflight(
        store,
        { mode: "check" },
        async () => {
          controller.abort();
          return report(true, 0);
        },
        () => content,
        controller.signal,
      ),
      { name: "AbortError" },
    );
    const run = store.create("project_build", {}).run;
    const value = await withTrace({ run_id: run.id }, () =>
      buildPreflight(
        store,
        {
          mode: "manual_override",
          reason: "Investigate native compiler diagnostics",
        },
        async () => {
          throw new Error("override must not claim a check");
        },
        () => content,
      ),
    );
    assert.equal(value.status, "overridden");
    assert.match(
      JSON.stringify(
        store.db
          .prepare(
            "SELECT data FROM events WHERE run_id=? AND kind='build_preflight'",
          )
          .all(run.id),
      ),
      /Investigate native compiler diagnostics/,
    );
    assert.equal(
      workflowInputs.project_build.safeParse({
        preflight: { mode: "manual_override" },
      }).success,
      false,
    );
    assert.deepEqual(workflowInputs.project_build.parse({}).preflight, {
      mode: "check",
    });
  }));
