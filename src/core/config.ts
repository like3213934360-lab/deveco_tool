import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readJson5 } from "./files.js";

/** Package root: nearest ancestor with our package.json (code may live in dist/ or dist/chunks/). */
export const packageRoot = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest) && /"name":\s*"deveco-mcp"/.test(fs.readFileSync(manifest, "utf8"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
})();
/** Single source of truth: package.json (read once at startup). */
export const version: string = (() => {
  try { return (JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string }).version; }
  catch { return "0.0.0-dev"; } // bundled outside the package (tests)
})();

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

