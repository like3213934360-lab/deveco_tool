// npm ships exactly the active generation, without deleting code used by local live servers.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage } from "./build.mjs";
import { atomicWrite } from "../bin/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = await buildPackage(root);
const generation = path.posix.dirname(manifest.entry);
atomicWrite(path.join(root, "dist/.npmignore"), [
  "*", "!cli.js", "!current.json", "!builds/", "builds/*", `!${generation}/`, `!${generation}/**`, "",
].join("\n"));
