/**
 * @file Cross-process mutual exclusion for uitest, which is a singleton on the device.
 * @author deveco-tool
 *
 * `src/device-ui.mjs` already serialises work per device, but only inside one process. That is not
 * where the contended resource lives. Measured with two independent processes issuing
 * `uitest dumpLayout` against one device at the same time:
 *
 *   process 1: failed after 30533ms -- "DumpLayout failed:Wait for subscribe
 *              uitest.broadcast.command.reply timeout" -- and left a 0-byte artifact behind
 *   process 2: succeeded in 1303ms
 *
 * So the loser does not fail fast, it blocks for half a minute. Two MCP clients on one machine
 * (a second agent session, or a CLI run beside a server) is enough to hit it.
 *
 * SCOPE, AND WHAT THIS CANNOT DO: this coordinates processes that take this lock. DevEco Studio
 * drives uitest through its own client and will never see it, so a foreign contender can still
 * produce the 30-second failure above. `src/device-ui.mjs` recognises that signature separately and
 * reports it as UI_DEVICE_BUSY. Do not document this lock as making the device safe -- it makes
 * *our own* processes safe, which is the part we control.
 *
 * The directory is passed in rather than derived here: path ownership stays with device-ui.mjs,
 * which already computes the per-device scratch directory, and tests can point the lock at a
 * throwaway directory without touching the real one.
 */

import fs from "node:fs";
import path from "node:path";

const LOCK_FILE = "uitest.lock";

/**
 * A live holder older than this is treated as wedged and its lock is reclaimed.
 *
 * A healthy dumpLayout takes about 1.3s and the observed contention failure resolves in ~30s, so
 * 90s is comfortably past anything that is still making progress. Without a ceiling, one hung
 * process would block every future one for as long as it stays alive.
 */
const STALE_AFTER_MS = 90000;

/**
 * A lock file is created first and written immediately after, so a competitor can briefly observe
 * an empty one. That is not evidence of a crash until it has stayed empty for longer than any
 * write could take.
 */
const UNREADABLE_GRACE_MS = 2000;

const MIN_POLL_MS = 50;
const MAX_POLL_MS = 250;

function fail(message, code, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  throw error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a pid is still running.
 *
 * Signal 0 performs the permission and existence checks without delivering anything. EPERM means
 * the process exists but belongs to another user, which is still very much alive.
 *
 * @param {number} pid Process id to probe.
 * @returns {boolean} True when the process exists.
 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readHolder(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    // Missing (the holder released between our EEXIST and this read) or half-written.
    return null;
  }
}

/**
 * Decide whether an existing lock may be reclaimed.
 *
 * @param {object|null} holder Parsed lock contents, or null when unreadable.
 * @param {number} ageMs Age of the lock file on disk.
 * @returns {boolean} True when the lock is abandoned.
 */
function isReclaimable(holder, ageMs) {
  if (!holder) return ageMs > UNREADABLE_GRACE_MS;
  if (!processAlive(holder.pid)) return true;
  return ageMs > STALE_AFTER_MS;
}

/**
 * @param {object|null} holder Parsed lock contents.
 * @param {number} ageMs The same age isReclaimable judged, so the message cannot contradict the
 *   decision. It comes from the file's mtime rather than the holder's own `startedAt`: the
 *   filesystem cannot be wrong about when the lock appeared, whereas a half-written record can.
 * @returns {string} Human-readable holder description.
 */
function describeHolder(holder, ageMs) {
  const age = `held for ${Math.round(ageMs)}ms`;
  if (!holder) return `an unidentified process (${age})`;
  return `pid ${holder.pid}${holder.op ? ` running ${holder.op}` : ""} (${age})`;
}

/**
 * Run `task` while holding the device's uitest lock.
 *
 * @param {{directory: string, op: string, timeoutMs: number}} options Lock target and budget.
 * @param {() => Promise<any>} task Work that must not overlap another uitest client.
 * @returns {Promise<any>} Whatever `task` resolves to.
 */
export async function withUitestLock({ directory, op = "uitest", timeoutMs = 60000 }, task) {
  const lockPath = path.join(directory, LOCK_FILE);
  const deadline = Date.now() + Math.max(timeoutMs, MIN_POLL_MS);
  fs.mkdirSync(directory, { recursive: true });

  const token = { pid: process.pid, startedAt: Date.now(), op };
  const stamp = JSON.stringify(token);
  let poll = MIN_POLL_MS;
  let lastHolder = null;
  let lastAgeMs = 0;

  for (;;) {
    try {
      // "wx" is the atomic part: it creates the file or fails, with no window in which two
      // processes both believe they created it.
      const handle = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(handle, stamp);
      } finally {
        fs.closeSync(handle);
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      let ageMs = 0;
      try {
        ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        // Released underneath us; the next attempt will take it.
        continue;
      }
      lastHolder = readHolder(lockPath);
      lastAgeMs = ageMs;

      if (isReclaimable(lastHolder, ageMs)) {
        // Losing this race is harmless: the competitor that also declared it stale will have
        // recreated the file, our create fails with EEXIST again, and we come back round.
        fs.rmSync(lockPath, { force: true });
        continue;
      }

      if (Date.now() >= deadline) {
        fail(
          `Another process holds this device's uitest lock: ${describeHolder(lastHolder, lastAgeMs)}`,
          "UI_DEVICE_BUSY",
          "Wait for it to finish, or stop the other agent session or CLI run driving this device.",
        );
      }
      await sleep(Math.min(poll, Math.max(0, deadline - Date.now())) || MIN_POLL_MS);
      poll = Math.min(poll * 2, MAX_POLL_MS);
    }
  }

  try {
    return await task();
  } finally {
    // Only remove the file if it is still ours. A reclaim by a process that (wrongly) judged us
    // stale would otherwise see its own fresh lock deleted by our release.
    const current = readHolder(lockPath);
    if (current && current.pid === token.pid && current.startedAt === token.startedAt) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}

export const lockInternals = { STALE_AFTER_MS, UNREADABLE_GRACE_MS, LOCK_FILE, processAlive };
