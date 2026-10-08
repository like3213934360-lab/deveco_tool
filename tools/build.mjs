// Build an immutable generation, then publish its pointer atomically. Running processes retain
// their generation, including lazy chunks, for their entire lifetime. File age is never a lease.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { atomicWrite, digest, packageInfo, sourceFingerprint, verifyBuild } from "../bin/runtime.mjs";

export async function buildPackage(root) {
  const input_hash = sourceFingerprint(root);
  const { version } = packageInfo(root);
  const dist = path.join(root, "dist");
  fs.mkdirSync(path.join(dist, "builds"), { recursive: true });
  const nonce = randomBytes(6).toString("hex");
  const generation = `builds/${input_hash}-${nonce}`;
  const staging = path.join(dist, "builds", `.staging-${nonce}`);
  try {
    await build({
      entryPoints: [path.join(root, "src/cli.ts")], outdir: staging,
      bundle: true, splitting: true, format: "esm", platform: "node", target: "node22",
      packages: "external", sourcemap: "linked", chunkNames: "chunks/[name]-[hash]", logLevel: "warning",
      define: { __DEVECO_BUILD__: JSON.stringify({ version, input_hash }) },
    });
    if (sourceFingerprint(root) !== input_hash) throw new Error("Source changed during build; no build was published");
    const files = {};
    for (const name of fs.readdirSync(staging, { recursive: true }).sort()) {
      const file = path.join(staging, String(name));
      if (fs.statSync(file).isFile()) files[`${generation}/${String(name).split(path.sep).join("/")}`] = digest(fs.readFileSync(file));
    }
    const manifest = { schema: 1, version, input_hash, entry: `${generation}/cli.js`, files };
    fs.renameSync(staging, path.join(dist, generation));
    atomicWrite(path.join(dist, "current.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Existing hosts pointing at dist/cli.js enter the same gate without editing their settings.
    atomicWrite(path.join(dist, "cli.js"), '#!/usr/bin/env node\nimport "../bin/deveco-mcp.mjs";\n');
    fs.chmodSync(path.join(dist, "cli.js"), 0o755);
    return verifyBuild(root, input_hash);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = performance.now();
  const manifest = await buildPackage(root);
  console.error(`built ${Object.keys(manifest.files).length} files (${manifest.version}, ${manifest.input_hash.slice(0, 12)}) in ${Math.round(performance.now() - started)} ms`);
}
