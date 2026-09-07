import fs from "node:fs";
import path from "node:path";
import { StateStore } from "../../src/core/store.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../../src/core/workflows.js";
import { ProcessService } from "../../src/core/process.js";
import { PersistentProcessObserver } from "../../src/core/process-observer.js";
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
  const processes = new ProcessService(new PersistentProcessObserver(store));
  await store.lease("project:shared", async () => {
    const child = processes.spawn({
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
    });
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
}
