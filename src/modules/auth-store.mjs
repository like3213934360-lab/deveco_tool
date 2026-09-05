import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";
import { deleteCredential, readCredential, writeCredential } from "./credential-store.mjs";

export function authCancelled() {
  const error = new Error("DevEco authentication was cancelled or superseded. Start a new login to continue.");
  error.code = "DEVECO_AUTH_CANCELLED";
  return error;
}

// All MCP hosts share the same credential file. The lock covers keychain I/O as well
// as the encrypted file; the revision invalidates work performed outside that lock
// (browser callbacks and network requests) when another process logs out or logs in.
export function createAuthStore(file) {
  const directory = path.dirname(file);
  const revisionFile = `${file}.session`;
  let queue = Promise.resolve();

  function revision() {
    try { return fs.readFileSync(revisionFile, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  function rotate() {
    const value = crypto.randomUUID();
    const temporary = `${revisionFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600 });
      fs.renameSync(temporary, revisionFile);
    } finally { fs.rmSync(temporary, { force: true }); }
    return value;
  }

  function run(signal, operation) {
    const task = queue.then(async () => {
      signal?.throwIfAborted();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      let compromised;
      const release = await lockfile.lock(directory, {
        lockfilePath: path.join(directory, "session.lock"),
        stale: 10000, update: 2000,
        retries: { retries: 120, factor: 1, minTimeout: 100 },
        onCompromised(error) { compromised = error; },
      });
      const guard = () => {
        signal?.throwIfAborted();
        if (compromised) throw compromised;
      };
      try {
        guard();
        const result = await operation(guard);
        guard();
        return result;
      } finally { await release(); }
    });
    queue = task.catch(() => {});
    return task.then((result) => { signal?.throwIfAborted(); return result; });
  }

  return {
    revision,
    begin: (signal) => run(signal, rotate),
    read: (signal) => run(signal, async (guard) => ({
      auth: await readCredential(file, { beforeWrite: guard }), revision: revision(),
    })),
    save: (data, signal, expectedRevision, replace = false) => run(signal, async (guard) => {
      const current = () => {
        guard();
        if (revision() !== expectedRevision) throw authCancelled();
      };
      current();
      await writeCredential(file, data, { beforeWrite: current });
      if (replace) rotate();
    }),
    clear: () => run(null, async () => { rotate(); await deleteCredential(file); }),
    flush: () => queue,
  };
}
