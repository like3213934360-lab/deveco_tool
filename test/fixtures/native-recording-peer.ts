import { StateStore } from "../../src/core/store.js";
import { ProcessService } from "../../src/core/process.js";
import { DeviceService } from "../../src/services/device.js";
import { RecordingService } from "../../src/services/recording.js";
import { flowSchema } from "../../src/core/contracts.js";
import { z } from "zod";

// A separate process leaves a durable recording, without launching or touching
// any device. The parent tests whether other services honor that reservation.
const [state, target] = z
  .tuple([z.string().min(1), z.string().min(1)])
  .parse(process.argv.slice(2));
const store = new StateStore(state),
  processes = new ProcessService(),
  devices = new DeviceService(processes, store),
  recordings = new RecordingService(store, devices);
try {
  const result = await store.lease(`device:${target}`, async () => {
    const { run } = store.create("ui_record", { parameters: {} });
    recordings.initialize(
      run.id,
      target,
      flowSchema.parse({
        version: 1,
        id: "peer-recording",
        name: "Peer recording",
        app: {
          bundleName: "com.example.peer",
          module: "entry",
          ability: "MainAbility",
        },
        start: { mode: "attach" },
        steps: [],
      }),
    );
    recordings.activate(run.id);
    store.update(run.id, "needs_input");
    return { recording_id: run.id };
  });
  process.stdout.write(JSON.stringify(result));
} finally {
  await recordings.close();
  await devices.close();
  await processes.close();
  store.close();
}
