import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ProcessService, type Command } from "../../core/process.js";
import { component, type Toolchain } from "../../core/toolchain.js";
import { invariant, ToolError } from "../../core/errors.js";
import { withinDeadline } from "../../core/deadline.js";
import { bridgeEvent, buildRequest, type BuildOptions } from "./protocol.js";

/** One owned SDK cluster worker; cancellation destroys its entire owned group. */
export class HvigorSession {
  private readonly process: ReturnType<ProcessService["startSession"]>;
  private readonly initialized = Promise.withResolvers<void>();
  private input = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private truncated = false;
  private ended = false;
  private workerPid?: number;
  private active?: {
    id: string;
    resolve: () => void;
    reject: (error: unknown) => void;
    output?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
  };
  constructor(processes: ProcessService, command: Command) {
    void this.initialized.promise.catch(() => {});
    this.process = processes.startSession(command, {
      keepInput: true,
      onOutput: (stream, chunk) => {
        if (stream === "stderr") {
          this.active?.output?.(stream, chunk);
          const all = Buffer.concat([this.tail, chunk]);
          this.truncated ||= all.length > 262144;
          this.tail = all.subarray(-262144);
          return;
        }
        this.input = Buffer.concat([this.input, chunk]);
        invariant(
          this.input.length <= 65536,
          "HVIGOR_PROTOCOL_INVALID",
          "SDK bridge output exceeds its frame limit",
        );
        for (;;) {
          const end = this.input.indexOf(10);
          if (end < 0) break;
          const frame = bridgeEvent.parse(
            JSON.parse(this.input.subarray(0, end).toString("utf8")) as unknown,
          );
          this.input = this.input.subarray(end + 1);
          this.receive(frame);
        }
      },
    });
    void this.process.done.then(() => {
      this.ended = true;
      let error: unknown = new ToolError(
        "HVIGOR_SESSION_EXITED",
        "Owned SDK worker exited; its baseline is no longer valid",
      );
      try {
        this.process.check();
      } catch (failure) {
        error = failure;
      }
      this.initialized.reject(error);
      this.active?.reject(error);
    });
  }
  static async open(
    processes: ProcessService,
    toolchain: Toolchain,
    project: string,
    signal?: AbortSignal,
  ) {
    const sdkRoot = path.resolve(
      path.dirname(component(toolchain, "hvigor")),
      "../hvigor",
    );
    invariant(
      fs.existsSync(
        path.join(
          sdkRoot,
          "src/base/daemon/cluster/worker-process-lifecycle.js",
        ),
      ),
      "HVIGOR_PROTOCOL_UNAVAILABLE",
      "Selected SDK has no supported cluster worker entry",
    );
    const session = new HvigorSession(processes, {
      executable: component(toolchain, "node"),
      args: [fileURLToPath(new URL("./bridge.js", import.meta.url)), sdkRoot],
      cwd: project,
      env: {
        ...process.env,
        DEVECO_SDK_HOME: toolchain.sdk,
        JAVA_HOME: toolchain.components.java
          ? path.dirname(path.dirname(toolchain.components.java))
          : process.env.JAVA_HOME,
      },
    });
    try {
      await session.ready(signal);
      return session;
    } catch (error) {
      await session.stop();
      throw error;
    }
  }
  get connected() {
    return !this.ended && !this.process.settled;
  }
  get identity() {
    return { pid: this.process.pid, worker_pid: this.workerPid };
  }
  log() {
    return { text: this.tail.toString("utf8"), truncated: this.truncated };
  }
  private receive(frame: z.infer<typeof bridgeEvent>) {
    if (frame.type === "ready") {
      this.workerPid = frame.pid;
      this.initialized.resolve();
    } else if (frame.type === "fatal") {
      const error = new ToolError("HVIGOR_SESSION_EXITED", frame.message);
      this.initialized.reject(error);
      this.active?.reject(error);
      this.ended = true;
    } else {
      invariant(
        this.active?.id === frame.id,
        "HVIGOR_PROTOCOL_INVALID",
        "SDK result does not match the active request",
      );
      if (frame.success) this.active.resolve();
      else
        this.active.reject(
          new ToolError(
            "HVIGOR_BUILD_FAILED",
            frame.message ?? "Native SDK build failed",
            this.log(),
          ),
        );
    }
  }
  async ready(signal?: AbortSignal) {
    await withinDeadline(
      25000,
      signal,
      "HVIGOR_INITIALIZATION_TIMEOUT",
      (signal) => this.wait(this.initialized.promise, signal),
    );
  }
  private wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async build(
    options: BuildOptions,
    signal?: AbortSignal,
    output?: (stream: "stdout" | "stderr", chunk: Buffer) => void,
  ) {
    signal?.throwIfAborted();
    invariant(
      this.connected && !this.active,
      "HVIGOR_SESSION_BUSY",
      "Owned SDK worker is unavailable or busy",
    );
    const request = buildRequest.parse({
      id: crypto.randomUUID(),
      action: "build",
      options,
    });
    const receipt = Promise.withResolvers<void>();
    this.active = {
      id: request.id,
      resolve: receipt.resolve,
      reject: receipt.reject,
      output,
    };
    this.tail = Buffer.alloc(0);
    this.truncated = false;
    void receipt.promise.catch(() => {});
    const started = performance.now();
    try {
      await withinDeadline(
        1200000,
        signal,
        "HVIGOR_BUILD_TIMEOUT",
        async (signal) => {
          await this.process.write(JSON.stringify(request) + "\n");
          await this.wait(receipt.promise, signal);
        },
      );
      return { elapsedMs: performance.now() - started, ...this.log() };
    } catch (error) {
      // SDK failure/acknowledgement is not a stop receipt. Verify OS group exit.
      await this.stop();
      throw error;
    } finally {
      this.active = undefined;
    }
  }
  async stop() {
    await this.process.stop();
    this.ended = true;
  }
}
