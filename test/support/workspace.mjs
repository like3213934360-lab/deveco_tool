// Disposable test material lives under the checkout, separate from explicit E2E evidence.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "../..");
const markerName = ".deveco-temporary.json";
/** @param {string} file @param {unknown} value */
const write = (file, value) => {
  const temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
};

/** @param {string} name @param {boolean} [external] */
export function workspace(name, external = false) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Workspace name must contain lowercase letters, digits and hyphens");
  const directory = external ? path.join(os.tmpdir(), `deveco-test-${name}-${randomBytes(8).toString("hex")}`)
    : path.join(root, ".scratch", `test-${name}-${randomBytes(8).toString("hex")}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  write(path.join(directory, markerName), { schema: 1, package_root: root, created: Date.now(), pids: [process.pid] });
  return { directory, remove: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

/** @param {string} name @param {boolean} [external] */
export const temporaryDirectory = (name, external = false) => workspace(name.replace(/^deveco-/, "").replace(/-$/, ""), external).directory;

/** Hold a workspace while an MCP child uses it, even if the test parent exits abruptly.
 * @param {string | undefined} file @param {number | undefined} pid */
export function retainWorkspace(file, pid) {
  if (!file || !pid) return () => {};
  let directory = path.resolve(file);
  const roots = [path.join(root, ".scratch"), os.tmpdir()];
  while (roots.some((base) => directory.startsWith(base + path.sep))) {
    const marker = path.join(directory, markerName);
    if (fs.existsSync(marker)) {
      const value = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (value.package_root !== root) return () => {};
      value.pids = [...new Set([...value.pids, pid])]; write(marker, value);
      return () => {
        if (!fs.existsSync(marker)) return;
        const current = JSON.parse(fs.readFileSync(marker, "utf8"));
        current.pids = current.pids.filter((/** @type {number} */ p) => p !== pid); write(marker, current);
      };
    }
    directory = path.dirname(directory);
  }
  return () => {};
}
