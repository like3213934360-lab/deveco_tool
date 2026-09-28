// Bundle src/ into dist/ with esbuild: one ESM entry plus lazily loaded chunks.
// Dependencies stay external (installed via npm) so native/optional packages resolve normally.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const started = performance.now();
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, "src/cli.ts")],
  outdir: path.join(root, "dist"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  sourcemap: "linked",
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "warning",
});
fs.chmodSync(path.join(root, "dist/cli.js"), 0o755);
const files = fs.readdirSync(path.join(root, "dist"), { recursive: true }).filter((f) => String(f).endsWith(".js"));
console.log(`built ${files.length} files in ${Math.round(performance.now() - started)} ms`);
