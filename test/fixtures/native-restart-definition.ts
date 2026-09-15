import fs from "node:fs";
import path from "node:path";
import type { WorkflowDefinition } from "../../src/core/workflows.js";

/** Both processes use the exact implementation fingerprint. Only the external
 * interruption barrier changes; replaying the effect remains visible on disk. */
export function restartDefinition(root: string, resumed = false, trace: (stage: string) => void = () => {}): WorkflowDefinition {
  return {
    id: "restart", description: "restart test", capabilities: [], completion: "done", resources: () => [],
    steps: [
      { id: "effect", kind: "effect", async execute() {
        trace("effect-enter");
        fs.appendFileSync(path.join(root, "effects"), "effect\n");
        return { written: true };
      } },
      { id: "pause", kind: "read", async execute() {
        trace("pause-enter");
        if (resumed) return { resumed: true };
        fs.writeFileSync(path.join(root, "ready"), "1");
        await new Promise(() => {});
        return null;
      } },
    ],
  };
}
