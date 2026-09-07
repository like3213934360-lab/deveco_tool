import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { StateStore, type RunRecord } from "./store.js";
import { errorResult, invariant, ToolError } from "./errors.js";
import { digest } from "./files.js";
import { protocolVersion } from "./config.js";
import { withTrace } from "./trace.js";
import type { CapturedFile } from "./captured-file.js";
import type { Flow } from "./contracts.js";

export interface WorkflowContext {
  parameters: Record<string, unknown>;
  project_path?: string;
  product?: string;
  target?: string;
  toolchain_hash?: string;
  project_hash?: string;
  source_hash?: string;
  flow?: Flow;
  input_artifacts?: string[];
  deployment?: CapturedFile;
}
export interface StepContext {
  run_id: string;
  context: WorkflowContext;
  outputs: Record<string, unknown>;
  signal: AbortSignal;
}
export interface WorkflowStep {
  id: string;
  kind: "read" | "effect" | "input";
  execute(context: StepContext): Promise<unknown>;
  reconcile?(context: StepContext): Promise<unknown | undefined>;
}
export interface WorkflowDefinition {
  id: string;
  description: string;
  capabilities: string[];
  completion: string;
  steps: WorkflowStep[];
  resources(context: WorkflowContext): string[];
}
const GraphState = Annotation.Root({
  run_id: Annotation<string>(),
  outputs: Annotation<Record<string, unknown>>({
    reducer: (old, next) => ({ ...old, ...next }),
    default: () => ({}),
  }),
});
interface Execution {
  controller: AbortController;
  finished: Promise<void>;
  shuttingDown: boolean;
}

/** The execution map contains only cancellation handles. SQLite and LangGraph own all task state. */
export class WorkflowEngine {
  readonly checkpointer: SqliteSaver;
  private readonly executions = new Map<string, Execution>();
  private readonly definitions = new Map<string, WorkflowDefinition>();
  get activeCount(): number {
    return this.executions.size;
  }
  constructor(
    readonly store: StateStore,
    definitions: WorkflowDefinition[],
    readonly validate: (
      context: WorkflowContext,
      workflow: string,
    ) => Promise<void>,
  ) {
    this.checkpointer = new SqliteSaver(store.db);
    for (const definition of definitions) {
      invariant(
        !this.definitions.has(definition.id),
        "WORKFLOW_DUPLICATE",
        "Duplicate workflow definition",
      );
      this.definitions.set(definition.id, definition);
    }
  }
  definition(id: string): WorkflowDefinition {
    const value = this.definitions.get(id);
    invariant(value, "WORKFLOW_UNKNOWN", "Unknown workflow");
    return value;
  }
  catalog() {
    return [...this.definitions.values()].map(
      ({ id, description, capabilities, completion, steps }) => ({
        id,
        description,
        capabilities,
        completion,
        steps: steps.map(({ id, kind }) => ({ id, kind })),
        resume_inputs: { action: "recheck" },
      }),
    );
  }
  start(
    workflow: string,
    context: WorkflowContext,
    requestKey?: string,
    identity: unknown = context.parameters,
  ) {
    this.definition(workflow);
    invariant(
      JSON.stringify(context).length <= 65536,
      "WORKFLOW_INPUT_TOO_LARGE",
      "Workflow input exceeds 64 KiB",
    );
    invariant(
      this.executions.size < 32 ||
        (requestKey && this.store.byRequest(requestKey)),
      "RUN_CAPACITY",
      "At most 32 active/queued workflows",
    );
    const { run, created } = this.store.create(
      workflow,
      context,
      requestKey,
      identity,
      context.input_artifacts,
    );
    if (created) this.dispatch(run.id, false);
    return { run_id: run.id, status: run.status, deduplicated: !created };
  }
  private graph(definition: WorkflowDefinition) {
    const graph = new StateGraph(GraphState);
    for (const step of definition.steps) {
      graph.addNode(step.id, async (state) =>
        withTrace({ run_id: state.run_id, node: step.id }, async () => {
          const execution = this.executions.get(state.run_id);
          invariant(execution, "RUN_NOT_ACTIVE", "Execution handle is missing");
          const signal = execution.controller.signal;
          signal.throwIfAborted();
          this.store.capacity();
          const context = JSON.parse(
            this.store.get(state.run_id).input,
          ) as WorkflowContext;
          const call: StepContext = {
            run_id: state.run_id,
            context,
            outputs: state.outputs,
            signal,
          };
          const started = performance.now();
          this.store.event(state.run_id, "node_start", { node: step.id });
          let output: unknown;
          if (step.kind === "input") {
            output = await step.execute(call);
            while (output === undefined) {
              const response: unknown = interrupt({
                node: step.id,
                required_input: { action: "recheck" },
              });
              invariant(
                !!response &&
                  typeof response === "object" &&
                  "action" in response &&
                  response.action === "recheck",
                "RESUME_INPUT_INVALID",
                "Only recheck is accepted",
              );
              signal.throwIfAborted();
              output = await step.execute(call);
            }
          } else if (step.kind === "effect") {
            const bounded = (value: unknown) => {
              const json = JSON.stringify(value ?? null);
              return Buffer.byteLength(json) > 16384
                ? {
                    result_artifact: this.store.artifact(
                      state.run_id,
                      json,
                      "application/json",
                    ),
                  }
                : (value ?? null);
            };
            const execute = () =>
              this.store.effect(
                state.run_id,
                step.id,
                { context_hash: digest(context), outputs: state.outputs },
                async () => bounded(await step.execute(call)),
                step.reconcile
                  ? async () => {
                      const value = await step.reconcile!(call);
                      return value === undefined ? undefined : bounded(value);
                    }
                  : undefined,
              );
            try {
              output = await execute();
            } catch (error) {
              if (
                !(error instanceof ToolError) ||
                error.code !== "EFFECT_UNCERTAIN"
              )
                throw error;
              const response: unknown = interrupt({
                node: step.id,
                error: errorResult(error),
                required_input: { action: "recheck" },
              });
              invariant(
                !!response &&
                  typeof response === "object" &&
                  "action" in response &&
                  response.action === "recheck",
                "RESUME_INPUT_INVALID",
                "Only recheck is accepted",
              );
              output = await execute();
            }
          } else {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                output = await step.execute(call);
                break;
              } catch (error) {
                if (
                  !(error instanceof ToolError) ||
                  !error.retryable ||
                  attempt === 2
                )
                  throw error;
                await delay(100 * 2 ** attempt, undefined, { signal });
              }
            }
          }
          signal.throwIfAborted();
          this.store.event(state.run_id, "node_finish", {
            node: step.id,
            elapsed_ms: performance.now() - started,
          });
          // Large outputs live in artifacts. Operators explicitly resolve references when they need the full result.
          const json = JSON.stringify(output ?? null),
            value =
              json.length > 16384
                ? {
                    result_artifact: this.store.artifact(
                      state.run_id,
                      json,
                      "application/json",
                    ),
                  }
                : (output ?? null);
          return { outputs: { [step.id]: value } };
        }),
      );
    }
    // Names are data from this package's fixed definitions, never supplied by the client.
    let previous: string = START;
    for (const step of definition.steps) {
      graph.addEdge(previous as typeof START, step.id as typeof END);
      previous = step.id;
    }
    graph.addEdge(previous as typeof START, END);
    return graph.compile({ checkpointer: this.checkpointer });
  }
  private dispatch(id: string, resume: boolean) {
    invariant(!this.executions.has(id), "RUN_BUSY", "Run is already executing");
    invariant(
      this.executions.size < 32,
      "RUN_CAPACITY",
      "At most 32 active/queued workflow executions per runtime",
    );
    const execution: Execution = {
      controller: new AbortController(),
      finished: Promise.resolve(),
      shuttingDown: false,
    };
    this.executions.set(id, execution);
    // The run trace must cover queueing and validation as well as graph nodes.
    // Otherwise lease events outlive their completed run as unbound telemetry.
    execution.finished = withTrace({ run_id: id }, () =>
      this.execute(id, resume, execution),
    ).finally(() => this.executions.delete(id));
    void execution.finished.catch(() => {});
  }
  private async execute(id: string, resume: boolean, execution: Execution) {
    const record = this.store.get(id),
      definition = this.definition(record.workflow),
      context = JSON.parse(record.input) as WorkflowContext;
    let claimed = false;
    const monitor = setInterval(() => {
      try {
        if (this.store.get(id).status === "cancelling")
          execution.controller.abort(
            new ToolError("CANCELLED", "Workflow cancellation requested"),
          );
      } catch (error) {
        execution.controller.abort(error);
      }
    }, 100);
    monitor.unref();
    try {
      this.store.claim(id);
      claimed = true;
      const resources = [...new Set(definition.resources(context))].sort(
        (a, b) =>
          Number(b.startsWith("project:")) - Number(a.startsWith("project:")) ||
          a.localeCompare(b),
      );
      const enter = async (index: number): Promise<void> => {
        if (index < resources.length) {
          await this.store.lease(
            resources[index]!,
            () => enter(index + 1),
            execution.controller.signal,
          );
          return;
        }
        this.store.activate(id);
        await this.validate(context, record.workflow);
        execution.controller.signal.throwIfAborted();
        const graph = this.graph(definition),
          config = {
            configurable: { thread_id: id },
            durability: "sync" as const,
            signal: execution.controller.signal,
          };
        const state = resume ? await graph.getState(config) : undefined;
        const hasInterrupt = state?.tasks.some(
          (task) => task.interrupts?.length,
        );
        const result = await graph.invoke(
          resume
            ? hasInterrupt
              ? new Command({ resume: { action: "recheck" } })
              : null
            : { run_id: id, outputs: {} },
          config,
        );
        execution.controller.signal.throwIfAborted();
        const after = await graph.getState(config),
          waiting = after.tasks.some((task) => task.interrupts?.length);
        this.store.update(
          id,
          waiting ? "needs_input" : "succeeded",
          waiting
            ? {
                interrupts: after.tasks.flatMap(
                  (task) => task.interrupts ?? [],
                ),
              }
            : result.outputs,
        );
      };
      await enter(0);
    } catch (error) {
      if (claimed) {
        let failure = error;
        const requestedCancellation =
          execution.controller.signal.aborted ||
          (error instanceof ToolError && error.code === "CANCELLED");
        if (requestedCancellation) {
          try {
            this.store.assertStopped(id);
          } catch (recoveryError) {
            failure = recoveryError;
          }
        }
        const uncertain =
          failure instanceof ToolError &&
          ["EFFECT_UNCERTAIN", "CANCEL_UNCONFIRMED"].includes(failure.code);
        this.store.update(
          id,
          uncertain
            ? "needs_input"
            : requestedCancellation
              ? execution.shuttingDown
                ? "interrupted"
                : "cancelled"
              : "failed",
          undefined,
          errorResult(failure),
        );
      }
    } finally {
      clearInterval(monitor);
    }
  }
  async resume(id: string, input?: { action: "recheck" }) {
    const run = this.store.get(id);
    invariant(
      run.protocol === protocolVersion,
      "RUN_VERSION_MISMATCH",
      "Execution protocol changed; start a new run",
    );
    invariant(
      ["interrupted", "needs_input", "failed"].includes(run.status),
      "RUN_NOT_RESUMABLE",
      "Run is not resumable",
    );
    if (run.status === "needs_input")
      invariant(
        input?.action === "recheck",
        "RESUME_INPUT_REQUIRED",
        "Supply action=recheck to reconcile external state",
      );
    await this.validate(JSON.parse(run.input) as WorkflowContext, run.workflow);
    this.dispatch(id, true);
    return { run_id: id, status: "queued" };
  }
  async status(id: string, waitMs = 0) {
    const initial = this.store.get(id),
      deadline = Date.now() + waitMs;
    while (
      Date.now() < deadline &&
      ![
        "needs_input",
        "interrupted",
        "succeeded",
        "failed",
        "cancelled",
      ].includes(this.store.get(id).status)
    ) {
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
      if (this.store.get(id).status !== initial.status) break;
    }
    return this.present(this.store.get(id));
  }
  present(run: RunRecord) {
    return {
      run_id: run.id,
      workflow: run.workflow,
      status: run.status,
      created_at: new Date(run.created).toISOString(),
      updated_at: new Date(run.updated).toISOString(),
      result: run.result ? (JSON.parse(run.result) as unknown) : null,
      error: run.error ? (JSON.parse(run.error) as unknown) : null,
    };
  }
  list(offset = 0, limit = 100) {
    return this.store.list(offset, limit).map((run) => this.present(run));
  }
  async cancel(id: string) {
    const record = this.store.get(id);
    if (["needs_input", "interrupted", "failed"].includes(record.status)) {
      this.store.assertStopped(id);
      this.store.claim(id);
      this.store.update(id, "cancelled");
      return this.status(id);
    }
    this.store.cancel(id);
    const execution = this.executions.get(id);
    execution?.controller.abort(
      new ToolError("CANCELLED", "Workflow cancellation requested"),
    );
    return this.status(id);
  }
  async close() {
    for (const execution of this.executions.values()) {
      execution.shuttingDown = true;
      execution.controller.abort(
        new ToolError("RUNTIME_STOPPING", "Runtime is stopping"),
      );
    }
    await Promise.allSettled(
      [...this.executions.values()].map((execution) => execution.finished),
    );
  }
}
