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
  process.on("SIGTERM", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ name: state.name, isRunning: false }),
    );
    process.exit(0);
  });
  process.stdout.write("ready\n");
  setInterval(() => {}, 1000);
} else if (action === "-stop") {
  const state = read();
  if (state.pid) process.kill(state.pid, "SIGTERM");
} else throw new Error(`Unexpected action: ${action}`);
