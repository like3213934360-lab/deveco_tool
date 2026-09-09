import crypto from "node:crypto";
import path from "node:path";
import { errorResult } from "./errors.js";
import { digest } from "./files.js";
import type { ProcessObserver, Command } from "./process.js";
import { sensitiveArguments } from "./process.js";
import { StateStore } from "./store.js";
import { currentTrace } from "./trace.js";

export class PersistentProcessObserver implements ProcessObserver {
  constructor(readonly store: StateStore) {}
  track(processId?: string) {
    return this.store.trackProcess(processId);
  }
  open(command: Command) {
    const trace = currentTrace(),
      id = crypto.randomUUID(),
      run = trace.run_id ?? "process";
    const secrets = sensitiveArguments(command),
      sensitive = command.sensitive || secrets.length > 0;
    const metadata = {
      ...trace,
      process_id: id,
      executable: path.basename(command.executable),
      command_hash: digest([
        command.executable,
        command.args.map((arg) =>
          secrets.reduce(
            (text, secret) => text.replaceAll(secret, "[redacted]"),
            arg,
          ),
        ),
        command.cwd,
      ]),
    };
    this.store.event(trace.run_id ?? null, "process_start", metadata);
    const artifact = sensitive ? undefined : this.store.streamArtifact(run);
    return {
      processId: id,
      outputFile: artifact?.file,
      reserve: artifact?.reserve,
      spawned: (pid: number | null) =>
        this.store.event(trace.run_id ?? null, "process_spawn", {
          ...metadata,
          pid,
        }),
      finish: (
        result: Parameters<ReturnType<ProcessObserver["open"]>["finish"]>[0],
      ) => {
        const log = artifact?.finish();
        // Even a full disk must not hide a confirmed process exit from its caller.
        try {
          this.store.event(trace.run_id ?? null, "process_finish", {
            ...metadata,
            ...result,
            error: result.error ? errorResult(result.error) : undefined,
            log,
          });
        } catch (error) {
          return { artifact: log, telemetry_error: errorResult(error) };
        }
        return log;
      },
    };
  }
}
