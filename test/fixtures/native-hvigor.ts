import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { HotConfiguration } from "../../src/services/hvigor/hot-config.js";
import { buildRequest } from "../../src/services/hvigor/protocol.js";
const mode = process.argv[2];
if (mode === "prepare-config") {
  const root = fs.realpathSync.native(process.argv[3]!);
  HotConfiguration.prepare(
    {
      root,
      product: {
        name: "demo",
        compatibleSdkVersion: 26,
        runtimeOS: "HarmonyOS",
      },
      modules: [
        { name: "entry", root: path.join(root, "entry"), target: "tablet" },
      ],
      fingerprint: "fixture",
    },
    [{ name: "entry", root: path.join(root, "entry"), target: "tablet" }],
  );
  process.exit(0);
}
process.stdout.write(
  JSON.stringify({ type: "ready", pid: process.pid }) + "\n",
);
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = buildRequest.parse(JSON.parse(line) as unknown);
  if (mode === "hang") {
    process.stderr.write("build_started\n");
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "invalid") {
    process.stdout.write(JSON.stringify({ type: "close" }) + "\n");
    return;
  }
  if (mode === "logs") fs.writeSync(2, "x".repeat(1048576));
  process.stdout.write(
    JSON.stringify({
      type: "result",
      id: request.id,
      success: mode !== "fail",
      ...(mode === "fail" ? { message: "compiler error" } : {}),
    }) + "\n",
  );
});
