/**
 * @file Terminating a spawned child together with everything still attached to it.
 * @author deveco-tool
 *
 * Shared by the two places that impose a timeout on an external process: the Skill script registry
 * and the DevEco CLI runner. Neither timeout exists upstream -- DevEco Code's own
 * `runBundledDevecoCli` is `Bun.spawn` plus `await proc.exited`, with no deadline and therefore no
 * cleanup problem. The timeouts are this pack's addition, so the cleanup is this pack's job.
 */

import { spawn } from "node:child_process";

// How long a timed-out process group gets to honour SIGTERM before SIGKILL. Long enough for a
// Python worker or a node script to run its cleanup, short enough that nothing lingers.
export const SIGKILL_GRACE_MS = 2000;

/**
 * Terminate a spawned child and everything still running in its process group.
 *
 * The child must have been spawned with `detached: true`, which makes it a process-group leader;
 * signalling the negative pid then reaches its descendants too. Without that, a timed-out build
 * left the hvigor client front-end and ohpm downloads running.
 *
 * What this deliberately does NOT reach is the hvigor daemon. That is a persistent build server,
 * like Gradle's: it re-parents itself to pid 1 and becomes its own group leader, so it is already
 * outside any caller's group. Verified on a live machine -- the daemon showed PPID 1 and
 * PGID equal to its own pid, having survived several builds. Killing our group therefore cannot
 * disturb the daemon that DevEco Studio shares, which is the desired outcome, not a limitation.
 *
 * @param {import("node:child_process").ChildProcess} child The spawned child.
 * @param {number} [graceMs] How long to wait between SIGTERM and SIGKILL.
 * @returns {() => void} Cancels the pending escalation; called automatically once the child exits.
 */
export function terminateProcessTree(child, graceMs = SIGKILL_GRACE_MS) {
  if (!child?.pid) return () => {};

  if (process.platform === "win32") {
    const taskkill = (force) => {
      const args = ["/pid", String(child.pid), "/t"];
      if (force) args.push("/f");
      try {
        const killer = spawn("taskkill.exe", args, {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.unref();
      } catch {
        try { child.kill(); } catch { /* already exited */ }
      }
    };
    taskkill(false);
    const escalation = setTimeout(() => taskkill(true), graceMs);
    escalation.unref();
    const cancel = () => clearTimeout(escalation);
    child.once("close", cancel);
    return cancel;
  }

  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is gone, or the platform refused the negative pid; the direct child still counts.
      try { child.kill(signal); } catch { /* already exited */ }
    }
  };

  signalGroup("SIGTERM");
  // SIGTERM is a request. A process wedged in a syscall, or one holding its own handler, ignores
  // it, so escalate rather than reporting a timeout while the tree is still running.
  const escalation = setTimeout(() => signalGroup("SIGKILL"), graceMs);
  escalation.unref();
  const cancel = () => clearTimeout(escalation);
  child.once("close", cancel);
  return cancel;
}
