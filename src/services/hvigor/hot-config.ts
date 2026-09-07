import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  atomicWrite,
  fileDigest,
  inside,
  destinationPath,
} from "../../core/files.js";
import { invariant } from "../../core/errors.js";
import type { Project } from "../project.js";

// Protocol reference: deveco-cli src/apply/hotreload/build-config-hotreload.ts.
// The SDK supplies compileConfig itself; only the required patch configuration
// is injected. Product selects build output, target selects its intermediate tree.
export function hotPaths(project: Project, module: Project["modules"][number]) {
  const base = inside(
    project.root,
    destinationPath(
      path.join(module.root, "build", project.product.name, "intermediates"),
    ),
  );
  const config = inside(
    project.root,
    destinationPath(path.join(module.root, "build/config/buildConfig.json")),
  );
  return {
    config,
    receipt: inside(
      project.root,
      destinationPath(
        path.join(module.root, "build/config/deveco-hot-reload.json"),
      ),
    ),
    changed: path.join(base, "hotReload/changedFileList.json"),
    abc: path.join(base, "hotReload/patchAbcPath/ets/modules.abc"),
    symbols: path.join(base, "loader_out", module.target, "ets"),
  };
}
export function assertNoHotWatch(project: Project) {
  invariant(
    project.modules.every(
      (module) => !fs.existsSync(hotPaths(project, module).receipt),
    ),
    "HOT_SESSION_ACTIVE",
    "Stop or recover the project's hot reload session before running another build or sync",
  );
}
const receiptSchema = z.strictObject({
  version: z.literal(1),
  owner_pid: z.number().int().positive(),
  config: z.string(),
  written_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  previous: z.string().max(1398104).nullable(),
  previous_mode: z.number().int().nonnegative().nullable(),
});
export class HotConfiguration {
  private readonly entries: {
    receipt: string;
    value: z.infer<typeof receiptSchema>;
  }[] = [];
  static prepare(project: Project, modules: Project["modules"]) {
    assertNoHotWatch(project);
    const configuration = new HotConfiguration();
    try {
      for (const module of modules) {
        const paths = hotPaths(project, module);
        const previous = fs.existsSync(paths.config)
          ? fs.readFileSync(paths.config)
          : null;
        invariant(
          !previous || previous.length <= 1048576,
          "HOT_CONFIG_TOO_LARGE",
          "Existing SDK build configuration exceeds 1 MiB",
        );
        const bytes = JSON.stringify({
          patchConfig: {
            enableMap: "true",
            mode: "hotReload",
            oldMapFilePath: paths.symbols,
            changedFileList: paths.changed,
            patchAbcPath: path.dirname(paths.abc),
            removeChangedFileListInSdk: "true",
          },
        });
        const value = receiptSchema.parse({
          version: 1,
          owner_pid: process.pid,
          config: paths.config,
          written_sha256: contentDigest(bytes),
          previous: previous?.toString("base64") ?? null,
          previous_mode: previous
            ? fs.statSync(paths.config).mode & 0o777
            : null,
        });
        fs.mkdirSync(path.dirname(paths.receipt), { recursive: true });
        // Write the receipt before touching the SDK config. A crash retains a
        // recovery marker and blocks unrelated builds instead of reusing it.
        atomicWrite(paths.receipt, JSON.stringify(value), false);
        configuration.entries.push({ receipt: paths.receipt, value });
        atomicWrite(paths.config, bytes);
      }
      return configuration;
    } catch (error) {
      configuration.restore();
      throw error;
    }
  }
  /** Restore only receipts whose previous runtime is confirmed absent. Never kill a recorded PID. */
  static recover(project: Project) {
    const configuration = new HotConfiguration();
    for (const module of project.modules) {
      const paths = hotPaths(project, module);
      if (!fs.existsSync(paths.receipt)) continue;
      invariant(
        fs.statSync(paths.receipt).size <= 1500000,
        "HOT_CONFIG_TOO_LARGE",
        "Watch recovery receipt exceeds its size limit",
      );
      const value = receiptSchema.parse(
        JSON.parse(fs.readFileSync(paths.receipt, "utf8")) as unknown,
      );
      invariant(
        value.config === paths.config,
        "HOT_CONFIG_CHANGED",
        "Watch configuration path changed since the receipt was written",
      );
      let absent = false;
      try {
        process.kill(value.owner_pid, 0);
      } catch (error) {
        absent = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
      invariant(
        absent,
        "HOT_SESSION_ACTIVE",
        "The watch configuration owner is still running or cannot be verified",
      );
      configuration.entries.push({ receipt: paths.receipt, value });
    }
    configuration.restore();
  }
  restore() {
    for (const entry of [...this.entries].reverse()) {
      const { config, previous, written_sha256, previous_mode } = entry.value;
      invariant(
        destinationPath(config) === config &&
          destinationPath(entry.receipt) === entry.receipt,
        "HOT_CONFIG_CHANGED",
        "Watch configuration paths changed during execution",
      );
      const previousHash =
        previous === null
          ? undefined
          : contentDigest(Buffer.from(previous, "base64"));
      const currentHash = fs.existsSync(config)
        ? fileDigest(config)
        : undefined;
      invariant(
        currentHash === written_sha256 || currentHash === previousHash,
        "HOT_CONFIG_CHANGED",
        "SDK build configuration changed during watch; preserve the recovery receipt for review",
      );
      if (previous === null) fs.rmSync(config, { force: true });
      else {
        atomicWrite(config, Buffer.from(previous, "base64"));
        if (previous_mode !== null) fs.chmodSync(config, previous_mode);
      }
      fs.rmSync(entry.receipt);
      this.entries.splice(this.entries.indexOf(entry), 1);
    }
  }
}
function contentDigest(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
