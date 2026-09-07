import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { StateStore } from "../../src/core/store.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../../src/core/workflows.js";
const root = process.argv[2]!;
const store = new StateStore(root);
// Model a live MCP transport while the peer owns its lease or interrupted node.
setInterval(() => {}, 1000);
if (process.argv[3] === "stream") {
  const stream = store.streamArtifact("interrupted");
  stream.reserve(65536);
  fs.writeFileSync(stream.file, "partial");
  fs.writeFileSync(path.join(root, "ready"), "1");
} else if (process.argv[3] === "orphan") {
  await store.lease("project:shared", async () => {
    // Deliberately simulate a native tool which survives its MCP owner.
    // A normal Node child is killed by libuv's Windows job on owner death,
    // which would never exercise the persistent orphan recovery guard.
    const tracking = store.trackProcess();
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    tracking.spawned(child.pid ?? null);
    child.unref();
    fs.writeFileSync(path.join(root, "orphan"), String(child.pid));
    fs.writeFileSync(path.join(root, "ready"), "1");
    await new Promise(() => {});
  });
} else if (process.argv[3] === "lease") {
  await store.lease("project:shared", async () => {
    fs.writeFileSync(path.join(root, "ready"), "1");
    await new Promise(() => {});
  });
} else {
  const definition: WorkflowDefinition = {
    id: "restart",
    description: "restart test",
    capabilities: [],
    completion: "done",
    resources: () => [],
    steps: [
      {
        id: "effect",
        kind: "effect",
        async execute() {
          fs.appendFileSync(path.join(root, "effects"), "effect\n");
          return { written: true };
        },
      },
      {
        id: "pause",
        kind: "read",
        async execute() {
          fs.writeFileSync(path.join(root, "ready"), "1");
          await new Promise(() => {});
          return null;
        },
      },
    ],
  };
  const engine = new WorkflowEngine(store, [definition], async () => {}),
    run = engine.start("restart", { parameters: {} });
  fs.writeFileSync(path.join(root, "run"), run.run_id);
  setInterval(() => {
    const state = store.get(run.run_id);
    if (
      ["failed", "needs_input", "cancelled", "interrupted"].includes(
        state.status,
      )
    ) {
      fs.writeFileSync(
        path.join(root, "peer-error"),
        JSON.stringify({ status: state.status, error: state.error }),
      );
      process.exit(1);
    }
  }, 25);
}
