import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { ToolError } from "../src/core/errors.js";

const script = fileURLToPath(
    new URL("./fixtures/native-process-tree.js", import.meta.url),
  ),
  temp = () =>
    fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-process-tree-")),
    );
async function until(check: () => boolean, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    assert.ok(
      Date.now() < end,
      `Process state did not converge within ${timeoutMs} ms`,
    );
    await delay(20);
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function observeProcess(pid: number) {
  if (process.platform !== "win32")
    return { alive: () => alive(pid), close() {} };
  // Pin the actual process before cancellation. Reopening a numeric PID after
  // exit can observe a reused PID, and kill(pid, 0) also requests TERMINATE
  // access. Neither is an independent proof that this descendant survived.
  const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi"),
    kernel = koffi.load("kernel32.dll"),
    open = kernel.func("void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)"),
    wait = kernel.func("uint32_t __stdcall WaitForSingleObject(void *handle, uint32_t milliseconds)"),
    close = kernel.func("int __stdcall CloseHandle(void *handle)"),
    handle = open(0x100000, 0, pid); // SYNCHRONIZE only; never terminate.
  assert.ok(handle, `Cannot observe process ${pid} before cancellation`);
  return {
    alive() {
      const result = wait(handle, 0);
      assert.ok(result === 0 || result === 258, `Process ${pid} wait failed: ${result}`);
      return result === 258;
    },
    close() { assert.equal(close(handle), 1); },
  };
}
const pid = (root: string, name: string) =>
  Number(fs.readFileSync(path.join(root, name), "utf8"));
const command = (root: string, mode: string) => ({
  executable: process.execPath,
  args: [script, root, mode],
});
const cancelled = (error: unknown) =>
  error instanceof ToolError && error.code === "CANCELLED";

test("cancellation confirms descendant exit without terminating a separate command", async () => {
  const root = temp(),
    service = new ProcessService(),
    abort = new AbortController();
  const unrelated = service.spawn({
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
  });
  const running = service.run(command(root, "tree"), { signal: abort.signal });
  const rejected = assert.rejects(running, cancelled);
  const observed: ReturnType<typeof observeProcess>[] = [];
  const observe = (pid: number) => {
    const result = observeProcess(pid);
    observed.push(result);
    return result;
  };
  try {
    await until(() => fs.existsSync(path.join(root, "ready")));
    const leaf = observe(pid(root, "leaf")),
      launcher = observe(pid(root, "launcher")),
      independent = observe(unrelated.pid!);
    assert.ok(leaf.alive());
    abort.abort();
    await rejected;
    assert.equal(leaf.alive(), false, "Captured descendant must have exited before cancellation returns");
    assert.equal(launcher.alive(), false, "Captured launcher must have exited before cancellation returns");
    assert.ok(independent.alive());
    assert.equal(service.size, 1);
  } finally {
    abort.abort();
    await service.close();
    await rejected;
    for (const process of observed) process.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an exited launcher retains its exit code while remaining command descendants are stopped", async () => {
  const root = temp(),
    service = new ProcessService();
  try {
    const result = await service.run(command(root, "early"), {
      allowFailure: true,
    });
    assert.equal(result.exitCode, 7);
    assert.equal(alive(pid(root, "leaf")), false);
    assert.equal(service.size, 0);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("session descendants retain persistent resource guards after launcher exit until confirmed stop", async () => {
  const root = temp(),
    store = new StateStore(path.join(root, "state")),
    service = new ProcessService(new PersistentProcessObserver(store));
  let peer: StateStore | undefined;
  try {
    const session = await store.lease("project:tree", async () =>
      service.startSession(command(root, "session")),
    );
    await session.done;
    session.check();
    const leaf = pid(root, "leaf");
    assert.ok(alive(leaf));
    assert.equal(service.size, 1);
    peer = new StateStore(path.join(root, "state"));
    await assert.rejects(
      peer.lease("project:tree", async () => null),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === "RESOURCE_RECOVERY_REQUIRED",
    );
    await session.stop();
    assert.equal(alive(leaf), false);
    assert.equal(
      await peer.lease("project:tree", async () => "released"),
      "released",
    );
    assert.equal(service.size, 0);
  } finally {
    await service.close();
    peer?.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("abrupt MCP death closes Windows jobs and leaves POSIX survivors guarded for explicit recovery", async () => {
  const root = temp(),
    owner = spawn(process.execPath, [script, root, "owner"], {
      stdio: "ignore",
      windowsHide: true,
    });
  // Register before readiness checks so failed startup still has a close
  // barrier. kill() only requests termination; SQLite can remain open until
  // close arrives, especially on loaded Windows runners.
  const ownerClosed = once(owner, "close");
  let store: StateStore | undefined;
  try {
    await until(() => fs.existsSync(path.join(root, "ready")), 30000);
    const leaf = pid(root, "leaf"),
      launcher = pid(root, "launcher");
    owner.kill("SIGKILL");
    await ownerClosed;
    store = new StateStore(path.join(root, "state"));
    if (process.platform === "win32") {
      await until(() => !alive(leaf) && !alive(launcher));
    } else {
      assert.ok(alive(leaf));
      await assert.rejects(
        store.lease("project:tree", async () => null),
        (error: unknown) =>
          error instanceof ToolError &&
          error.code === "RESOURCE_RECOVERY_REQUIRED",
      );
      process.kill(-launcher, "SIGKILL");
      await until(() => !alive(leaf) && !alive(launcher));
    }
    assert.equal(
      await store.lease("project:tree", async () => "released"),
      "released",
    );
  } finally {
    owner.kill("SIGKILL");
    await ownerClosed;
    const descendants: number[] = [];
    for (const name of ["leaf", "launcher"])
      if (fs.existsSync(path.join(root, name))) {
        const child = pid(root, name);
        descendants.push(child);
        try {
          process.kill(child, "SIGKILL");
        } catch {}
      }
    store?.close();
    await until(() => descendants.every((child) => !alive(child)));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
