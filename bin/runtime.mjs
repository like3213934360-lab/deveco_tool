// Shared build contract. The launcher has no npm dependencies and never trusts package.json
// as the identity of compiled code. Source checkouts also bind the build to its exact inputs.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const packageInfo = (root) => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// Reuse a bounded buffer: verifying source maps must not leave megabytes of dead Buffers
// resident in a long-lived server before its first GC. No timers or explicit GC are needed.
function hashFile(hash, file, buffer) {
  const fd = fs.openSync(file, "r");
  try {
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
  } finally {
    fs.closeSync(fd);
  }
}

export function sourceFingerprint(root) {
  const files = ["package.json", "package-lock.json", "tools/build.mjs"];
  for (const dir of ["src", "bin", "resources", "templates", "knowledge"]) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (![".DS_Store", "Thumbs.db"].includes(path.basename(file)) && fs.statSync(path.join(root, dir, file)).isFile() && (dir !== "src" && dir !== "bin" || String(file).endsWith(dir === "src" ? ".ts" : ".mjs")))
        files.push(`${dir}/${String(file).split(path.sep).join("/")}`);
    }
  }
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const file of files.sort()) {
    const absolute = path.join(root, file);
    hash.update(`${file}\0${fs.statSync(absolute).size}\0`);
    hashFile(hash, absolute, buffer);
  }
  return hash.digest("hex");
}

export function atomicWrite(file, text) {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Verify the complete immutable generation before allowing any code from it to run. */
export function verifyBuild(root, expectedFingerprint) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/current.json"), "utf8"));
  const generation = /^builds\/([a-f0-9]{64}-[a-f0-9]{12})\/cli\.js$/.exec(manifest.entry ?? "");
  if (manifest.schema !== 1 || !generation || !/^[a-f0-9]{64}$/.test(manifest.input_hash)
    || !generation[1].startsWith(`${manifest.input_hash}-`)
    || manifest.version !== packageInfo(root).version
    || (expectedFingerprint && manifest.input_hash !== expectedFingerprint))
    throw new Error("Compiled build does not match this package/source checkout");
  const prefix = `builds/${generation[1]}/`;
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)
    || !Object.hasOwn(manifest.files, manifest.entry)) throw new Error("Incomplete build manifest");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!file.startsWith(prefix) || !file.split("/").every((part) => part.length && !/[\\\x00-\x1f]/.test(part))
      || file.split("/").some((part) => part === ".." || part === ".") || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error(`Invalid build output: ${file}`);
    const actual = createHash("sha256");
    hashFile(actual, path.join(root, "dist", file), buffer);
    if (actual.digest("hex") !== hash)
      throw new Error(`Missing or changed build output: ${file}`);
  }
  return manifest;
}

/** Builders, launchers and collectors share one gate so a generation cannot vanish before leasing. */
export async function withBuildLock(root, action) {
  const lock = path.join(root, "dist/.build-lock"), deadline = Date.now() + 30000;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Build is reserved: ${lock}. Inspect owner.json and the owning process; remove this lock only after confirming the builder stopped.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
    return await action();
  } finally { fs.rmSync(lock, { recursive: true }); }
}

const claims = new Map();
export async function useGeneration(root, entry) {
  // Source-less packages contain one fixed generation and ship no builder/collector.
  if (!fs.existsSync(path.join(root, "src"))) return;
  root = fs.realpathSync(root);
  const key = `${root}|${entry}`;
  if (claims.has(key)) return;
  await withBuildLock(root, () => {
    if (claims.has(key)) return;
    if (!/^builds\/[a-f0-9]{64}-[a-f0-9]{12}\/cli\.js$/.test(entry) || !fs.existsSync(path.join(root, "dist", entry)))
      throw new Error("Build generation was retired; launch again through bin/deveco-mcp.mjs");
    const dir = path.join(root, "dist/.build-users");
    fs.mkdirSync(dir, { recursive: true });
    const lease = path.join(dir, `${process.pid}-${randomBytes(6).toString("hex")}.json`);
    fs.writeFileSync(lease, JSON.stringify({ pid: process.pid, generation: entry.split("/")[1] }));
    claims.set(key, lease);
    process.once("exit", () => fs.rmSync(lease, { force: true }));
  });
}

/** Called only under the build gate. PID reuse retains an extra generation rather than removing a live one. */
export function collectBuilds(root, current) {
  const dist = path.join(root, "dist"), users = path.join(dist, ".build-users");
  const keep = new Set([current.entry.split("/")[1]]), owners = new Set([process.pid]);
  if (fs.existsSync(users)) for (const name of fs.readdirSync(users)) {
    const file = path.join(users, name);
    let lease;
    try { lease = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; } // The owner may exit after enumeration.
    if (!Number.isSafeInteger(lease.pid) || lease.pid <= 0 || !/^[a-f0-9]{64}-[a-f0-9]{12}$/.test(lease.generation))
      throw new Error(`Invalid build lease: ${file}`);
    try { process.kill(lease.pid, 0); keep.add(lease.generation); owners.add(lease.pid); }
    catch (error) { if (error.code === "ESRCH") fs.rmSync(file, { force: true }); else throw error; }
  }
  // Pre-lease hosts can still lazily import any old generation. Retain them until those exact
  // package processes stop; file age and open file descriptors cannot prove JS is no longer used.
  const processes = process.platform === "win32"
    ? [].concat(JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" })) ?? [])
        .map((p) => ({ pid: p.ProcessId, command: p.CommandLine ?? "", node: /^node(?:js)?\.exe$/i.test(p.Name) }))
    : execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n").map((line) => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line); return { pid: Number(match?.[1]), command: match?.[2] ?? "" };
      });
  const nodeProcesses = ["win32", "linux"].includes(process.platform) ? undefined : new Set(execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" }).split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line); return match && /(?:^|[/\\])node(?:js)?$/.test(match[2]) ? [Number(match[1])] : [];
  }));
  const isNode = (p) => {
    if (process.platform === "win32") return p.node;
    if (process.platform !== "linux") return nodeProcesses.has(p.pid);
    // Linux comm is a mutable thread name (including Node's MainThread), not an executable.
    try { return /(?:^|\/)node(?:js)?(?: \(deleted\))?$/.test(fs.readlinkSync(`/proc/${p.pid}/exe`)); }
    catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
  };
  const roots = new Set([root, fs.realpathSync(root)]);
  if (process.platform === "darwin") for (const dir of [...roots]) roots.add(dir.replace(/^\/private(?=\/var\/)/, ""));
  const legacy = processes.some((p) => !owners.has(p.pid) && ([...roots].some((dir) => p.command.includes(dir)) || /(?:^|\s)(?:\.\/)?(?:bin[/\\]deveco-mcp\.mjs|dist[/\\].*cli\.js)(?:\s|$)/.test(p.command)) && /(?:deveco-mcp\.mjs|dist[/\\].*cli\.js)/.test(p.command) && isNode(p));
  // A managed child may outlive its host after an abrupt exit and still read generation assets.
  for (const p of processes) if ([...roots].some((dir) => p.command.includes(dir)))
    for (const match of p.command.matchAll(/[/\\]dist[/\\]builds[/\\]([a-f0-9]{64}-[a-f0-9]{12})(?:[/\\]|\s|$)/g)) keep.add(match[1]);
  for (const name of fs.readdirSync(path.join(dist, "builds"))) {
    if (!/^[a-f0-9]{64}-[a-f0-9]{12}$/.test(name) || keep.has(name)) continue;
    const directory = path.join(dist, "builds", name), protocol = path.join(directory, "runtime.json");
    // Pre-lease hosts can only retain pre-lease code. New generations claim a lease before any
    // lazy import, so legacy migration cannot cause every future build to accumulate forever.
    if (legacy && (!fs.existsSync(protocol) || JSON.parse(fs.readFileSync(protocol, "utf8")).lease_protocol !== 1)) continue;
    fs.rmSync(directory, { recursive: true });
  }
  if (!legacy) fs.rmSync(path.join(dist, "chunks"), { recursive: true, force: true });
}
