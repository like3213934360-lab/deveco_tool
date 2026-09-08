import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { atomicWrite } from "../../src/core/files.js";
import { ManagedCommand } from "../../src/core/managed-command.js";
import { ProcessService } from "../../src/core/process.js";
import { PersistentProcessObserver } from "../../src/core/process-observer.js";
import { StateStore } from "../../src/core/store.js";
import {
  WorkflowEngine,
  type StepContext,
  type WorkflowDefinition,
} from "../../src/core/workflows.js";

export const fixtureFile = fileURLToPath(import.meta.url);
const resultSchema = z.object({ file: z.string(), output: z.string() });

export function commandDefinition(
  root: string,
  store: StateStore,
  processes: ProcessService,
  build: string,
): WorkflowDefinition {
  const execute = async (call: StepContext) => {
    const journal = new ManagedCommand(store, processes);
    const phase = (name: string) =>
      journal.run(
        name,
        {
          executable: process.execPath,
          args: [fixtureFile, "command", root, name],
          cwd: root,
        },
        { signal: call.signal, timeoutMs: 30000 },
        (result) => ({
          file: path.join(root, name + ".output"),
          output: result.stdout,
        }),
        (value) => resultSchema.parse(value),
        (value) => [value.file],
      );
    await phase("sync");
    return phase(build);
  };
  return {
    id: "command_recovery",
    description: "Recover completed command phases before a graph checkpoint",
    capabilities: [],
    completion: "Both command results and their files are verified",
    resources: () => ["project:" + root],
    steps: [{ id: "sdk_project", kind: "effect", execute, reconcile: execute }],
  };
}

if (process.argv[1] === fixtureFile) {
  const [, , mode, root, phase, fault] = process.argv;
  if (!root || !phase)
    throw new Error("Missing command recovery fixture input");
  if (mode === "command") {
    fs.appendFileSync(path.join(root, phase + ".count"), "x");
    atomicWrite(path.join(root, phase + ".output"), "original command output");
    fs.writeSync(1, phase === "large" ? "x".repeat(200000) : phase + " result");
    if (phase === "failure") {
      fs.writeSync(2, "compiler rejected the fixture\n");
      process.exitCode = 17;
    }
  } else if (mode === "owner") {
    const store = new StateStore(path.join(root, "state")),
      processes = new ProcessService(new PersistentProcessObserver(store)),
      run = processes.run.bind(processes);
    processes.run = (command, options = {}) =>
      run(command, {
        ...options,
        onSettled: async (result, failure) => {
          if (command.args.at(-1) !== phase)
            return options.onSettled?.(result, failure);
          try {
            if (fault !== "before") await options.onSettled?.(result, failure);
          } finally {
            // Kill the actual workflow owner after its SDK child has stopped.
            // No shutdown path can save the enclosing graph/effect result.
            atomicWrite(path.join(root, "killed-at"), phase + ":" + fault);
            process.kill(process.pid, "SIGKILL");
          }
        },
      });
    const engine = new WorkflowEngine(
      store,
      [
        commandDefinition(
          root,
          store,
          processes,
          phase === "sync" ? "build" : phase,
        ),
      ],
      async () => {},
    );
    const { run_id } = engine.start("command_recovery", { parameters: {} });
    atomicWrite(path.join(root, "run-id"), run_id);
    const result = await engine.status(run_id, 20000);
    throw new Error(
      "Owner unexpectedly survived the interruption: " + result.status,
    );
  } else throw new Error("Unknown command recovery fixture mode");
}
