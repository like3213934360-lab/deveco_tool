import fs from "node:fs";
import { workerData } from "node:worker_threads";
import { Runtime } from "../../src/services/runtime.js";

// Exercise the production worker IPC and error/log boundary with an operation
// held until cancelled, independently of an installed SDK and cold-start speed.
const call = Runtime.prototype.call;
Runtime.prototype.call = async function (name, input, signal) {
  if (name !== "lsp") return call.call(this, name, input, signal);
  signal!.throwIfAborted();
  fs.writeFileSync(workerData.startedFile as string, "started");
  return new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(signal!.reason), {
      once: true,
    });
  });
};
await import("../../src/worker.js");
