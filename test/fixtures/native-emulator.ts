import fs from "node:fs";
import { z } from "zod";
import { atomicWrite } from "../../src/core/files.js";

const file = z.string().parse(process.argv[2]);
const action = process.argv[3];
fs.appendFileSync(
  file + ".commands",
  JSON.stringify(process.argv.slice(3)) + "\n",
);
const read = () =>
  z
    .object({
      name: z.string(),
      isRunning: z.boolean(),
      pid: z.number().optional(),
      instancePath: z.string().optional(),
    })
    .parse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
if (action === "-list") process.stdout.write(JSON.stringify([read()]));
else if (action === "-start") {
  const state = read();
  atomicWrite(
    file,
    JSON.stringify({ ...state, isRunning: true, pid: process.pid }),
  );
  const stop = () => {
    atomicWrite(file, JSON.stringify({ ...state, isRunning: false, pid: undefined }));
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
} else if (action === "-version")
  process.stdout.write("HarmonyOS Emulator :26.0.0.400\n");
else if (action === "-help")
  process.stdout.write(
    "-shake -power -rotation -volume -foldedState -battery -batteryStatus -gps -longitude -latitude -altitude -bearing -outdoorRunning -outdoorCycling -drivingNavigation -sensor -light -steps -heartrate",
  );
else if (action === "-instance")
  process.stdout.write(
    fs.existsSync(file + ".response")
      ? fs.readFileSync(file + ".response", "utf8")
      : "Scenario simulation success.\n",
  );
else if (action === "-license") {
  if (process.argv[4] !== "accept")
    throw new Error("Interactive license viewing must never run");
  if (!fs.existsSync(file + ".license-unconfirmed"))
    fs.writeFileSync(
      file + ".config",
      "unrelated:keep\nHarmonyOS_Software_Service_Agreement:agree\nHarmonyOS_SDK_Agreement:agree\n",
    );
  process.stdout.write("Agreements accepted.\n");
} else throw new Error(`Unexpected action: ${action}`);
