import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readJson5 } from "./files.js";

/** Package root: nearest ancestor with our package.json, including immutable build generations. */
export const packageRoot = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest) && /"name":\s*"deveco-mcp"/.test(fs.readFileSync(manifest, "utf8"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
})();
// Replaced at compile time. Running code never relabels itself after a package/source update.
declare const __DEVECO_BUILD__: { version: string; input_hash: string };
export const buildInfo = typeof __DEVECO_BUILD__ === "undefined"
  ? { version: "0.0.0-dev", input_hash: "unbundled" } : __DEVECO_BUILD__;
export const version = buildInfo.version;

const configSchema = z
  .object({
    studio: z.string().optional(),
    clt: z.string().optional(),
    java_home: z.string().optional(),
    state_dir: z.string().optional(),
    retention_days: z.number().int().min(1).max(365).default(1),
    max_jobs: z.number().int().min(10).max(10000).default(200),
    max_artifact_mb: z.number().int().min(16).max(65536).default(512),
    session_idle_minutes: z.number().int().min(1).max(240).default(10),
    auto_accept_ui_agreements: z.boolean().default(true),
    kb_package: z.string().default("@deveco-mcp/kb"),
    kb_upstream_package: z.string().default("@deveco-test/deveco-cli-knowledgebase"),
    npm_registry: z.string().url().default("https://registry.npmjs.org"),
  })
  .passthrough();
export type Config = z.infer<typeof configSchema>;

let cached: Config | undefined;
export function config(): Config {
  if (cached) return cached;
  const file = process.env.DEVECO_CONFIG;
  const raw = file && fs.existsSync(file) ? readJson5(file) : {};
  cached = configSchema.parse(raw);
  return cached;
}
export function resetConfig() {
  cached = undefined;
}

export function stateDir(): string {
  const dir = path.resolve(
    process.env.DEVECO_STATE_DIR || config().state_dir || path.join(os.homedir(), ".deveco-mcp"),
  );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
