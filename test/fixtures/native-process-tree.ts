import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore } from "../../src/core/store.js";
import { ProcessService } from "../../src/core/process.js";
import { PersistentProcessObserver } from "../../src/core/process-observer.js";

const root = process.argv[2]!,
  mode = process.argv[3]!,
  script = fileURLToPath(import.meta.url);
if (mode === "owner") {
  const store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(new PersistentProcessObserver(store));
  await store.lease("project:tree", async () => {
    processes.spawn({
      executable: process.execPath,
      args: [script, root, "tree"],
    });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  });
} else if (mode === "leaf") {
  fs.writeFileSync(path.join(root, "leaf"), String(process.pid));
  setInterval(() => {}, 1000);
} else {
  fs.writeFileSync(path.join(root, "launcher"), String(process.pid));
  // Detached Windows children escape libuv's ordinary job. The MCP's stricter
  // enclosing job must still own them. POSIX children stay in the owned group.
  const leaf = spawn(process.execPath, [script, root, "leaf"], {
    stdio: "ignore",
    detached: process.platform === "win32",
    windowsHide: true,
  });
  leaf.unref();
  while (!fs.existsSync(path.join(root, "leaf"))) await delay(10);
  fs.writeFileSync(path.join(root, "ready"), "1");
  if (mode === "early") process.exit(7);
  else if (mode === "session") process.exit(0);
  else setInterval(() => {}, 1000);
}
