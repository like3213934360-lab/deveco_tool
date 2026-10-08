#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { sourceFingerprint, verifyBuild } from "./runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const checkout = fs.existsSync(path.join(root, "src"));
  let manifest;
  try {
    manifest = verifyBuild(root, checkout ? sourceFingerprint(root) : undefined);
  } catch (error) {
    if (!checkout || !fs.existsSync(path.join(root, "tools/build.mjs"))) throw error;
    console.error(`deveco-mcp: rebuilding stale/incomplete local build (${error.message})`);
    const result = spawnSync(process.execPath, [path.join(root, "tools/build.mjs")], {
      cwd: root, stdio: ["ignore", 2, 2], // stdout is exclusively the CLI/MCP protocol.
    });
    if (result.error || result.status !== 0) throw new Error("Local build failed; run npm ci and npm run build", { cause: result.error });
    manifest = verifyBuild(root, sourceFingerprint(root));
  }
  if ((process.argv[2] ?? "mcp") === "mcp")
    console.error(`deveco-mcp ${manifest.version} build ${manifest.input_hash}`);
  await import(pathToFileURL(path.join(root, "dist", manifest.entry)).href);
} catch (error) {
  console.error(`deveco-mcp: cannot start: ${error.message}. Rebuild this checkout or reinstall the package.`);
  process.exitCode = 1;
}
