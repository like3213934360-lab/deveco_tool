import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    assert.ok(
      Date.now() < end,
      "Process state did not converge within 10 seconds",
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
  try {
    await until(() => fs.existsSync(path.join(root, "ready")));
    const leaf = pid(root, "leaf"),
      launcher = pid(root, "launcher");
    assert.ok(alive(leaf));
    abort.abort();
    await rejected;
    assert.equal(alive(leaf), false);
    assert.equal(alive(launcher), false);
    assert.ok(alive(unrelated.pid!));
    assert.equal(service.size, 1);
  } finally {
    abort.abort();
    await service.close();
    await rejected;
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
  let store: StateStore | undefined;
  try {
    await until(() => fs.existsSync(path.join(root, "ready")));
    const leaf = pid(root, "leaf"),
      launcher = pid(root, "launcher"),
      closed = once(owner, "close");
    owner.kill("SIGKILL");
    await closed;
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
    for (const name of ["leaf", "launcher"])
      if (fs.existsSync(path.join(root, name))) {
        try {
          process.kill(pid(root, name), "SIGKILL");
        } catch {}
      }
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
