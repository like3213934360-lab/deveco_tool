import fs from "node:fs";
import path from "node:path";
import { readObject } from "../../src/core/files.js";
import { z } from "zod";

const root = process.cwd(),
  args = process.argv.slice(2),
  phase = args.includes("install")
    ? "ohpm"
    : args.includes("--sync")
      ? "sync"
      : "build";
fs.appendFileSync(path.join(root, phase + ".count"), "x");
if (phase === "ohpm")
  fs.writeFileSync(
    path.join(root, "oh-package-lock.json5"),
    '{"lockVersion":1}',
  );
else {
  const targets = z.object({ modules: z.array(z.object({ name: z.string(), targets: z.array(z.object({ name: z.string() })) })) })
    .parse(readObject(path.join(root, "build-profile.json5"))).modules.find((module) => module.name === "entry")!.targets;
  const selected = args.find((arg) => arg.startsWith("module=entry@"))?.slice("module=entry@".length) ?? "default";
  const output = path.join(root, "entry/build/default/outputs", selected);
  for (const target of targets) fs.mkdirSync(path.join(root, "entry/build/default/outputs", target.name), { recursive: true });
  fs.mkdirSync(path.join(root, ".hvigor/outputs/sync"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".hvigor/outputs/sync/output.json"),
    JSON.stringify({
      "ohos-project": { SELECT_PRODUCT_NAME: "default" },
      "ohos-module-entry": {
        TARGETS: Object.fromEntries(targets.map((target) => [target.name, { BUILD_PATH: { OUTPUT_PATH: path.join(root, "entry/build/default/outputs", target.name) } }])),
      },
    }),
  );
  if (phase === "build") {
    fs.writeFileSync(path.join(root, "build-args.json"), JSON.stringify(args));
    if (fs.existsSync(path.join(root, "reject-build"))) {
      fs.writeSync(
        2,
        "ArkTS:ERROR File: Index.ets:1:1\nError Message: fixture compiler rejection\n",
      );
      for (let i = 0; i < 150; i++) fs.writeSync(2, "x".repeat(8192) + "\n");
      process.exitCode = 17;
    } else fs.writeFileSync(path.join(output, "entry.hap"), "fixture artifact");
  }
}
