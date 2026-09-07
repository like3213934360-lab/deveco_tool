import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { ToolError } from "./errors.js";
import { fileURLToPath } from "node:url";
import { WindowsJob } from "./windows-job.js";

export interface Command {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Raw output must not be written to process artifacts (for example, Want data). */
  sensitive?: boolean;
}
export function sensitiveArguments(command: Command): string[] {
  return command.args.flatMap((arg, index) => {
    const match =
      /^--?(?:keyPwd|keystorePwd|password|token|secret)(?:=(.*))?$/i.exec(arg);
    return match
      ? [match[1] ?? command.args[index + 1] ?? ""].filter(Boolean)
      : [];
  });
}
export interface ProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number | null;
  outputFile?: string;
  limitBytes?: number;
  allowFailure?: boolean;
  input?: string;
  onOutput?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
  /** Internal lifecycle hook used by managed sessions. */
  onSpawn?: (child: ChildProcess) => void;
  keepDescendants?: boolean;
  keepInput?: boolean;
}
export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsedMs: number;
  pid: number | null;
  log?: unknown;
}
export interface ProcessObservation {
  processId?: string;
  outputFile?: string;
  reserve?: (bytes: number) => void;
  spawned?: (pid: number | null) => void;
  finish: (result: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    elapsedMs: number;
    pid: number | null;
    outputBytes: number;
    truncated: boolean;
    error?: unknown;
  }) => unknown;
}
interface ProcessTracker {
  spawned(pid: number | null, windowsJob?: string): void;
  closed(confirmed?: boolean): void;
  unconfirmed(): void;
}
export interface ProcessObserver {
  open(command: Command): ProcessObservation;
  track?(processId?: string): ProcessTracker;
}
export class ProcessService {
  constructor(readonly observer?: ProcessObserver) {}
  private readonly children = new Set<ChildProcess>();
  private readonly sessions = new Set<{ stop(): Promise<void> }>();
  private readonly lifecycle = new WeakMap<
    ChildProcess,
    {
      closed: boolean;
      done: Promise<void>;
      terminating?: Promise<void>;
      tracking?: ProcessTracker;
      job?: WindowsJob;
    }
  >();
  get size(): number {
    return this.children.size;
  }
  get sessionCount(): number {
    return this.sessions.size;
  }
  private groupAlive(child: ChildProcess): boolean {
    const job = this.lifecycle.get(child)?.job;
    if (job) return job.alive();
    if (process.platform === "win32" || !child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  spawn(
    command: Command,
    processId?: string,
    keepDescendants = false,
  ): ChildProcess {
    const tracking = this.observer?.track?.(processId);
    let child: ChildProcess;
    let job: WindowsJob | undefined;
    try {
      if (process.platform === "win32") job = new WindowsJob();
      const bootstrapEnv = { ...(command.env ?? process.env) };
      // Only the captured SDK command receives user Node configuration, after
      // containment. Bootstrap preload hooks must not run before assignment.
      for (const key of Object.keys(bootstrapEnv))
        if (["NODE_OPTIONS", "NODE_PATH"].includes(key.toUpperCase()))
          delete bootstrapEnv[key];
      child = spawn(
        job ? process.execPath : command.executable,
        job
          ? [fileURLToPath(new URL("./windows-bootstrap.js", import.meta.url))]
          : command.args,
        {
          cwd: command.cwd,
          env: job ? bootstrapEnv : (command.env ?? process.env),
          stdio: job ? ["pipe", "pipe", "pipe", "ipc"] : "pipe",
          windowsHide: true,
          detached: process.platform !== "win32",
        },
      );
    } catch (error) {
      job?.close();
      tracking?.spawned(null);
      throw error;
    }
    const done = Promise.withResolvers<void>(),
      state = { closed: false, done: done.promise, tracking, job };
    this.lifecycle.set(child, state);
    this.children.add(child);
    child.on("error", () => {});
    child.once("close", () => {
      state.closed = true;
      try {
        if (!this.groupAlive(child)) {
          this.children.delete(child);
          job?.close();
          tracking?.closed(true);
        } else tracking?.unconfirmed();
      } catch {
        /* The durable active row remains a conservative recovery guard. */
        try {
          tracking?.unconfirmed();
        } catch {}
      }
      done.resolve();
    });
    child.once("exit", () => {
      // Descendants may still hold stdout/stderr after their launcher exits;
      // terminate the owned job before waiting for stream close, unless this
      // is an explicit long-lived session (for example an emulator launcher).
      if (job && !keepDescendants) {
        try {
          job.terminate();
        } catch (error) {
          child.emit("error", error);
        }
      }
    });
    try {
      if (job && child.pid) job.assign(child.pid);
      tracking?.spawned(child.pid ?? null, job?.name);
      if (job && child.pid)
        child.send(
          {
            executable: command.executable,
            args: command.args,
            cwd: command.cwd,
            env: command.env ?? process.env,
          },
          (error) => {
            if (error) {
              child.emit("error", error);
              void this.terminate(child).catch(() => {});
            }
          },
        );
    } catch (error) {
      // Before assignment/dispatch there is no SDK child to recover. Stopping
      // the bootstrap itself also covers a failed OpenProcess/Assign call.
      child.kill();
      void this.terminate(child).catch(() => {});
      throw error;
    }
    return child;
  }
  async terminate(child: ChildProcess): Promise<void> {
    const state = this.lifecycle.get(child);
    if (!state) return;
    if (state.closed && !this.groupAlive(child)) {
      // Windows accounting may reach zero just after the close callback.
      // Finalize a naturally finished session too, rather than leaving its
      // handle and durable guard behind through this early return.
      this.children.delete(child);
      state.job?.close();
      state.tracking?.closed(true);
      return;
    }
    if (state.terminating) return state.terminating;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        state.job?.terminate();
      } else {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    };
    state.terminating = (async () => {
      const escalation =
          process.platform === "win32"
            ? undefined
            : setTimeout(() => kill("SIGKILL"), 1500),
        polling = new AbortController();
      let deadline: NodeJS.Timeout | undefined;
      try {
        kill("SIGTERM");
        await Promise.race([
          (async () => {
            await state.done;
            while (this.groupAlive(child))
              await delay(25, undefined, { signal: polling.signal });
            this.children.delete(child);
            state.job?.close();
            state.tracking?.closed(true);
          })(),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new ToolError(
                    "CANCEL_UNCONFIRMED",
                    "Owned process group did not confirm exit",
                  ),
                ),
              10000,
            );
          }),
        ]);
      } catch (error) {
        state.tracking?.unconfirmed();
        throw new ToolError(
          "CANCEL_UNCONFIRMED",
          "Owned processes did not confirm exit",
          { cause: String(error) },
        );
      } finally {
        clearTimeout(escalation);
        clearTimeout(deadline);
        polling.abort();
      }
    })();
    return state.terminating;
  }
  async run(
    command: Command,
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    options.signal?.throwIfAborted();
    if (this.observer && options.outputFile)
      throw new ToolError(
        "PROCESS_OUTPUT_CONFLICT",
        "Observed processes write their output through the artifact store",
      );
    const started = performance.now(),
      observation = this.observer?.open(command);
    let child: ChildProcess;
    const secrets = sensitiveArguments(command),
      redact = (value: string) =>
        secrets.reduce(
          (text, secret) => text.replaceAll(secret, "[redacted]"),
          value,
        );
    try {
      child = this.spawn(
        command,
        observation?.processId,
        options.keepDescendants,
      );
    } catch (error) {
      observation?.finish({
        exitCode: null,
        signal: null,
        elapsedMs: performance.now() - started,
        pid: null,
        outputBytes: 0,
        truncated: false,
        error,
      });
      throw error;
    }
    const limit = options.limitBytes ?? 512 * 1024;
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      truncated = false,
      outputBytes = 0;
    let failure: Error | undefined;
    let stopping: Promise<void> | undefined;
    const unconfirmed = Promise.withResolvers<never>();
    const stop = (error: Error) => {
      failure ??= error;
      stopping ??= this.terminate(child).catch((error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        unconfirmed.reject(failure);
      });
    };
    const outputFile = options.outputFile ?? observation?.outputFile;
    const output = outputFile
      ? fs.createWriteStream(outputFile, { flags: "wx", mode: 0o600 })
      : undefined;
    output?.on("error", (error) => stop(error));
    const capture = (
      stream: NodeJS.ReadableStream | null,
      kind: "stdout" | "stderr",
    ) =>
      stream?.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        try {
          options.onOutput?.(kind, chunk);
        } catch (error) {
          stop(error instanceof Error ? error : new Error(String(error)));
        }
        const value = Buffer.concat([
          kind === "stdout" ? stdout : stderr,
          chunk,
        ]);
        if (value.length > limit) truncated = true;
        const tail = value.subarray(Math.max(0, value.length - limit));
        if (kind === "stdout") stdout = tail;
        else stderr = tail;
        if (output && !output.destroyed) {
          try {
            observation?.reserve?.(chunk.length);
          } catch (error) {
            stop(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (!output.write(chunk)) {
            stream.pause();
            output.once("drain", () => stream.resume());
          }
        }
      });
    capture(child.stdout, "stdout");
    capture(child.stderr, "stderr");
    // Install exit/output observation before user lifecycle hooks can fail.
    // Hook failures must follow the same stop-and-confirm path as cancellation.
    try {
      options.onSpawn?.(child);
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)));
    }
    const abort = () => stop(new ToolError("CANCELLED", "Operation cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer =
      options.timeoutMs === null
        ? undefined
        : setTimeout(
            () =>
              stop(
                new ToolError("PROCESS_TIMEOUT", "Process deadline exceeded"),
              ),
            options.timeoutMs ?? 120000,
          );
    if (options.signal?.aborted) abort();
    child.stdin?.on("error", () => {});
    if (!options.keepInput) child.stdin?.end(options.input);
    let exitCode: number | null = null,
      exitSignal: NodeJS.Signals | null = null,
      log: unknown,
      finished = false;
    try {
      try {
        observation?.spawned?.(child.pid ?? null);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
      [exitCode, exitSignal] = await Promise.race([
        unconfirmed.promise,
        new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
          child.once("error", (error) => {
            failure = error;
          });
          child.once("close", (code, signal) => resolve([code, signal]));
        }),
      ]);
      await stopping;
      if (!options.keepDescendants || !this.groupAlive(child))
        await this.terminate(child);
      if (output && !output.destroyed)
        await new Promise<void>((resolve, reject) => {
          output.once("error", reject);
          output.end(() => resolve());
        });
      finished = true;
      log = observation?.finish({
        exitCode,
        signal: exitSignal,
        elapsedMs: performance.now() - started,
        pid: child.pid ?? null,
        outputBytes,
        truncated,
        error: failure,
      });
      if (failure) {
        if (failure instanceof ToolError && log)
          throw new ToolError(
            failure.code,
            failure.message,
            { cause: failure.details, log },
            failure.retryable,
          );
        throw failure;
      }
      const result = {
        exitCode,
        signal: exitSignal,
        stdout: redact(stdout.toString("utf8")),
        stderr: redact(stderr.toString("utf8")),
        truncated,
        elapsedMs: performance.now() - started,
        pid: child.pid ?? null,
        ...(log ? { log } : {}),
      };
      if (!options.allowFailure && (exitCode !== 0 || exitSignal))
        throw new ToolError(
          "PROCESS_FAILED",
          `Tool exited with ${exitSignal ?? exitCode}`,
          result,
        );
      return result;
    } catch (error) {
      if (!finished) {
        if (output && !output.closed)
          await new Promise<void>((resolve) => {
            output.once("close", resolve);
            output.destroy();
          });
        observation?.finish({
          exitCode,
          signal: exitSignal,
          elapsedMs: performance.now() - started,
          pid: child.pid ?? null,
          outputBytes,
          truncated,
          error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      output?.destroy();
    }
  }
  /** A session has no command deadline; readiness and stopping are owned by its service. */
  startSession(
    command: Command,
    options: Pick<ProcessOptions, "onOutput" | "keepInput"> = {},
  ) {
    const controller = new AbortController();
    let child: ChildProcess | undefined,
      result: ProcessResult | undefined,
      failure: unknown;
    let settled = false;
    const done = this.run(command, {
      ...options,
      signal: controller.signal,
      timeoutMs: null,
      keepDescendants: true,
      onSpawn: (value) => {
        child = value;
      },
    })
      .then(
        (value) => {
          result = value;
        },
        (error: unknown) => {
          failure = error;
        },
      )
      .finally(() => {
        settled = true;
        // A naturally exited session must not accumulate until runtime shutdown.
        // Keep unresolved descendants registered so close() still owns cleanup.
        if (!child || (!this.children.has(child) && !this.groupAlive(child)))
          this.sessions.delete(session);
      });
    let stopping: Promise<void> | undefined;
    const session = {
      done,
      get pid() {
        return child?.pid ?? null;
      },
      get settled() {
        return settled;
      },
      get result() {
        return result;
      },
      check: () => {
        if (failure !== undefined) throw failure;
      },
      write: async (data: string) => {
        if (failure !== undefined) throw failure;
        if (settled || !child?.stdin?.writable || !options.keepInput)
          throw new ToolError("SESSION_CLOSED", "Session input is unavailable");
        await new Promise<void>((resolve, reject) =>
          child!.stdin!.write(data, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
      },
      stop: () =>
        (stopping ??= (async () => {
          controller.abort();
          if (child) await this.terminate(child);
          await done;
          this.sessions.delete(session);
          if (
            failure instanceof ToolError &&
            failure.code === "CANCEL_UNCONFIRMED"
          )
            throw failure;
        })()),
    };
    this.sessions.add(session);
    return session;
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([
      ...[...this.sessions].map((session) => session.stop()),
      ...[...this.children].map((child) => this.terminate(child)),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new ToolError(
        "CANCEL_UNCONFIRMED",
        "Some owned processes have not confirmed exit",
        failures.map((result) => String(result.reason)),
      );
  }
}
