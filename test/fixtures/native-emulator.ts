import fs from "node:fs";
import { z } from "zod";

const file = z.string().parse(process.argv[2]);
const action = process.argv[3];
const read = () =>
  z
    .object({
      name: z.string(),
      isRunning: z.boolean(),
      pid: z.number().optional(),
    })
    .parse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
if (action === "-list") process.stdout.write(JSON.stringify([read()]));
else if (action === "-start") {
  const state = read();
  fs.writeFileSync(
    file,
    JSON.stringify({ ...state, isRunning: true, pid: process.pid }),
  );
  const stop = () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ name: state.name, isRunning: false }),
    );
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.stdout.write("ready\n");
  // Model the emulator's stop protocol rather than POSIX signal handlers, which
  // do not run when another process calls kill(SIGTERM) on Windows.
  setInterval(() => {
    if (fs.existsSync(file + ".stop")) stop();
  }, 20);
} else if (action === "-stop") {
  fs.writeFileSync(file + ".stop", "stop");
} else throw new Error(`Unexpected action: ${action}`);
