import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { ipcInput } from "../../src/core/ipc.js";

const port = parentPort!;
const { fail } = z.object({ fail: z.boolean() }).parse(workerData);
port.on("message", (raw: unknown) => {
  if (z.strictObject({ release: z.literal(true) }).safeParse(raw).success) {
    port.close();
    return;
  }
  const input = ipcInput.parse(raw);
  if (input.type === "call")
    port.postMessage({ id: input.id, ok: true, data: { ready: true } });
  if (input.type === "close") {
    if (fail)
      port.postMessage({
        id: input.id,
        ok: false,
        error: {
          code: "CANCEL_UNCONFIRMED",
          message: "Fixture cleanup failure",
          retryable: false,
        },
      });
    else {
      port.postMessage({ id: input.id, ok: true, data: { closed: true } });
      port.close();
    }
  }
});
