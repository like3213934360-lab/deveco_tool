import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { digest, fileDigest } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { z } from "zod";

/** Freeze actual dependency bytes, including native bindings, as well as the
 * package lock. A lockfile alone cannot detect a modified installed module. */
export function installationIdentity(root: string) {
  const pkg = z.object({ dependencies: z.record(z.string(), z.string()).default({}) }).parse(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")));
  const lock = z.object({ packages: z.record(z.string(), z.object({ version: z.string().optional(), dependencies: z.record(z.string(), z.string()).optional() })).default({}) }).parse(JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")));
  for (const [name, requested] of Object.entries(pkg.dependencies)) {
    invariant(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name), "UPGRADE_DEPENDENCY_INVALID", "Dependency name must identify a package inside node_modules");
    const relative = `node_modules/${name}`, file = path.join(root, relative, "package.json");
    invariant(lock.packages[""]?.dependencies?.[name] === requested && lock.packages[relative]?.version && fs.existsSync(file), "UPGRADE_DEPENDENCY_MISSING", "Every production dependency must match the package lock and be installed");
    const installed = z.object({ version: z.string() }).parse(JSON.parse(fs.readFileSync(file, "utf8")));
    invariant(installed.version === lock.packages[relative]!.version, "UPGRADE_DEPENDENCY_CHANGED", "Installed dependency version differs from the frozen lock");
  }
  const files: { path: string; bytes: number; sha256: string }[] = [];
  let bytes = 0;
  const visit = (relative: string, depth: number) => {
    invariant(depth <= 48 && files.length <= 100000, "UPGRADE_INSTALLATION_LIMIT", "Installation exceeds the bounded inventory");
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() && relative.startsWith("node_modules/") && relative.includes("/.bin/")) {
      const target = fs.realpathSync.native(file), modules = path.join(root, "node_modules") + path.sep;
      invariant(target.startsWith(modules) && fs.statSync(target).isFile(), "UPGRADE_INSTALLATION_LINK", "Installed executable links must resolve to a regular dependency file");
      files.push({ path: relative, bytes: stat.size, sha256: digest({ link: fs.readlinkSync(file), target_sha256: fileDigest(target) }) });
      return;
    }
    invariant(!stat.isSymbolicLink(), "UPGRADE_INSTALLATION_LINK", `Installed runtime cannot traverse a symlink: ${relative}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(`${relative}/${name}`, depth + 1);
    else {
      invariant(stat.isFile() && (bytes += stat.size) <= 1024 * 1024 * 1024, "UPGRADE_INSTALLATION_LIMIT", "Installed runtime must contain at most 1 GiB of regular files");
      files.push({ path: relative, bytes: stat.size, sha256: fileDigest(file) });
    }
  };
  for (const relative of ["dist/src", "src", "resources", "provenance", "skills", "package.json", "package-lock.json", "node_modules"])
    if (fs.existsSync(path.join(root, relative))) visit(relative, 0);
  invariant(files.some((item) => item.path === "package.json") && files.some((item) => item.path === "package-lock.json"), "UPGRADE_INSTALLATION_INVALID", "A complete installation and lock are required");
  return { sha256: digest(files), files: files.length, bytes };
}

export function nativeNodeIdentity(node: string) {
  const stat = fs.lstatSync(node);
  invariant(stat.isFile() && !stat.isSymbolicLink(), "UPGRADE_NODE_INVALID", "Node executable must be a regular file");
  const version = execFileSync(node, ["--version"], { encoding: "utf8", timeout: 10000, maxBuffer: 1024, env: { ...process.env, NODE_OPTIONS: "" } }).trim();
  const parsed = /^v(22|24)\.(\d+)\.(\d+)$/.exec(version);
  invariant(parsed && (parsed[1] !== "22" || Number(parsed[2]) >= 18), "UPGRADE_NODE_UNSUPPORTED", "This release requires Node 22.18+ or Node 24");
  return { version, sha256: fileDigest(node) };
}

/** Resolve an existing standalone release without retaining or loading its execution engine. */
export function installedRoot(entry: string) {
  invariant(path.isAbsolute(entry) && fs.lstatSync(entry).isFile(), "UPGRADE_PREVIOUS_INSTALLATION_MISSING", "Keep the previous complete installation available for rollback");
  let directory = path.dirname(fs.realpathSync.native(entry));
  for (let depth = 0; depth < 5; depth++) {
    if (fs.existsSync(path.join(directory, "package.json"))) return directory;
    directory = path.dirname(directory);
  }
  invariant(false, "UPGRADE_PREVIOUS_INSTALLATION_MISSING", "Previous MCP entry has no installed package root");
}
