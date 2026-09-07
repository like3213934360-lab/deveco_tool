import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { invariant } from "./errors.js";

export const configSchema = z.strictObject({
  studio: z.string().min(1).optional(),
  clt: z.string().min(1).optional(),
  default_project: z.string().min(1).optional(),
  state_dir: z.string().min(1).optional(),
  max_runs: z.number().int().positive().default(100),
  retention_days: z.number().int().positive().default(7),
  max_bytes: z
    .number()
    .int()
    .positive()
    .default(256 * 1024 * 1024),
});
export type Configuration = z.infer<typeof configSchema>;
export const release = "0.2.0-rc.1";
export const protocolVersion = "native-2";
export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const resourceRoot = path.join(packageRoot, "resources");
export function configuration(): Configuration {
  const file = process.env.DEVECO_CONFIG;
  const raw: unknown = file
    ? JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))
    : {};
  const config = configSchema.parse(raw);
  invariant(
    !(config.studio && config.clt),
    "CONFIG_CONFLICT",
    "Configure either studio or clt",
  );
  return config;
}
export function stateDirectory(): string {
  return path.resolve(
    process.env.DEVECO_STATE_DIR ||
      configuration().state_dir ||
      path.join(os.homedir(), ".deveco-tool"),
  );
}
