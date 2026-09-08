import { currentTrace, withTrace } from "../core/trace.js";
import { isWindowSurface } from "./ui-tree.js";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import {
  atomicWrite,
  digest,
  privateDirectory,
  readObject,
} from "../core/files.js";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import { StateStore } from "../core/store.js";
import { DeviceService, UiIndex } from "./device.js";
import {
  flowIdSchema,
  controlSchema,
  flowSchema,
  meaningfulSelector,
  type Flow,
} from "../core/contracts.js";
export {
  flowIdSchema,
  assertionSchema,
  flowSchema,
  type Flow,
} from "../core/contracts.js";
import type { Project } from "./project.js";
import { withinDeadline } from "../core/deadline.js";

export class FlowService {
  constructor(
    readonly devices: DeviceService,
    readonly store: StateStore,
  ) {}
  private async surface(
    target: string,
    bundle: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    return withinDeadline(
      Math.max(50, timeoutMs - 50),
      signal,
      "FLOW_APP_UI_NOT_READY",
      async (signal) => {
        let failures = 0;
        for (;;) {
          try {
            const snapshot = await this.devices.snapshot(target, signal),
              nodes = snapshot.nodes.filter(
                (node) => node.bundleName === bundle,
              );
            if (
              nodes.some(
                (node) =>
                  isWindowSurface(node) &&
                  node.rect &&
                  node.visible !== false &&
                  node.focused !== false,
              )
            )
              return {
                ...snapshot,
                nodes,
                query: new UiIndex(nodes),
                controlSnapshot: snapshot,
              };
          } catch (error) {
            if (
              !(error instanceof ToolError) ||
              !["UI_DUMP_FAILED", "UI_DUMP_INVALID"].includes(error.code) ||
              ++failures >= 3
            )
              throw error;
          }
          await delay(100, undefined, { signal });
        }
      },
    );
  }
  private file(project: Project, id: string): string {
    const directory = path.join(project.root, ".arkpilot", "flows");
    for (const file of [path.dirname(directory), directory])
      if (fs.existsSync(file))
        invariant(
          !fs.lstatSync(file).isSymbolicLink(),
          "FLOW_PATH_UNSAFE",
          "Flow storage must not be symlinked",
        );
    const file = path.join(directory, `${flowIdSchema.parse(id)}.json`);
    if (fs.existsSync(file))
      invariant(
        !fs.lstatSync(file).isSymbolicLink(),
        "FLOW_PATH_UNSAFE",
        "Flow files must not be symlinked",
      );
    return file;
  }
  list(project: Project) {
    const directory = path.dirname(this.file(project, "placeholder"));
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        try {
          const flow = this.read(project, file.slice(0, -5));
          return {
            id: flow.id,
            name: flow.name,
            app: flow.app,
            steps: flow.steps.length,
            verified: !!flow.assert,
          };
        } catch (error) {
          return {
            id: file.slice(0, -5),
            invalid: true,
            error: errorResult(error),
          };
        }
      });
  }
  read(project: Project, id: string): Flow {
    return flowSchema.parse(readObject(this.file(project, id)));
  }
  assertAvailable(project: Project, id: string): void {
    invariant(
      !fs.existsSync(this.file(project, id)),
      "FLOW_EXISTS",
      "Flow already exists; choose a new recording ID",
    );
  }
  async delete(project: Project, id: string) {
    return this.store.lease(`project:${project.root}`, async () => {
      const file = this.file(project, id);
      invariant(
        fs.existsSync(file),
        "FLOW_NOT_FOUND",
        "Saved flow does not exist",
      );
      fs.unlinkSync(file);
      return { id, deleted: true };
    });
  }
  async save(
    project: Project,
    raw: unknown,
    replace = false,
    expectedHash?: string,
  ) {
    const flow = flowSchema.parse(raw);
    invariant(
      flow.assert,
      "FLOW_ASSERT_REQUIRED",
      "A saved flow needs a final assertion",
    );
    return this.store.lease(`project:${project.root}`, async () => {
      const file = this.file(project, flow.id);
      if (fs.existsSync(file)) {
        invariant(
          replace,
          "FLOW_EXISTS",
          "Flow already exists; explicitly request replacement",
        );
        if (expectedHash)
          invariant(
            digest(this.read(project, flow.id)) === expectedHash,
            "FLOW_CHANGED",
            "Flow changed during replay; repair was not saved",
          );
      }
      privateDirectory(path.dirname(file));
      atomicWrite(file, JSON.stringify(flow, null, 2) + "\n");
      return { id: flow.id, saved: true };
    });
  }
  validateInputs(flow: Flow, variables: Record<string, string>) {
    invariant(
      flow.assert,
      "FLOW_ASSERT_REQUIRED",
      "Flow has no final assertion",
    );
    for (const name of Object.keys(variables))
      invariant(
        Object.hasOwn(flow.variables, name),
        "FLOW_VARIABLE_UNKNOWN",
        `Unknown flow variable: ${name}`,
      );
    for (const [name, definition] of Object.entries(flow.variables))
      invariant(
        !definition.required || Object.hasOwn(variables, name),
        "FLOW_VARIABLE_REQUIRED",
        `Missing flow variable: ${name}`,
      );
    for (const step of flow.steps)
      if (step.action === "input")
        invariant(
          Object.hasOwn(variables, step.value!.slice(2, -1)),
          "FLOW_VARIABLE_REQUIRED",
          `Missing input for step ${step.id}`,
        );
    return flow;
  }
  async run(project: Project, id: string, target: string, variables: Record<string, string>, signal?: AbortSignal, captured?: Flow) {
    const original = captured ?? this.read(project, id), flow = structuredClone(this.validateInputs(original, variables));
    invariant(flow.id === id, "FLOW_ID_MISMATCH", "Captured flow does not match the requested ID");
    const parent = currentTrace().node ?? "flow";
    const scoped = <T>(name: string, task: () => Promise<T>) => withTrace({ node: `${parent}:flow:${id}:${name}` }, task);
    return withinDeadline(600000, signal, "FLOW_TIMEOUT", (signal) => this.store.lease(`project:${project.root}`, () =>
      this.store.lease(`device:${target}`, async () => {
        if (flow.start.mode === "restart") {
          await scoped("stop", () => this.devices.stopApplication(target, flow.app.bundleName, signal));
          await scoped("launch", () => this.devices.launch(target, {
            bundle_name: flow.app.bundleName, module: flow.app.module, ability: flow.app.ability,
          }, signal, !!currentTrace().run_id));
        }
        const receipts: { step_id: string; action: string; elapsed_ms: number; repaired: boolean }[] = [];
        let changed = false;
        for (const step of flow.steps) {
          const result = await scoped(`step:${step.id}`, () => withinDeadline(step.timeoutMs, signal, "FLOW_STEP_TIMEOUT", async (signal) => {
            const assertion = ["waitVisible", "waitHidden", "assertVisible", "assertHidden"].includes(step.action);
            const resultSchema = z.object({ step_id: z.string(), action: z.string(), elapsed_ms: z.number(), repaired: z.boolean(), selector: meaningfulSelector.optional() });
            const execute = async () => {
              const started = performance.now();
              if (assertion) {
                await this.devices.verify(target, {
                  [step.action.endsWith("Hidden") ? "hidden" : "visible"]: step.selector,
                  timeoutMs: step.timeoutMs, alternates: step.alternates,
                }, signal, flow.app.bundleName);
                return { step_id: step.id, action: step.action, elapsed_ms: performance.now() - started, repaired: false };
              }
              const prepared = await this.store.privateMemo("step", { step, variables, bundle: flow.app.bundleName }, async () => {
                let selector = step.selector, repaired = false;
                const surface = await this.surface(target, flow.app.bundleName, step.timeoutMs, signal), application = surface.nodes;
                    if (
                      selector &&
                      ![
                        "waitVisible",
                        "waitHidden",
                        "assertVisible",
                        "assertHidden",
                      ].includes(step.action)
                    ) {
                      const snapshot = { ...surface, nodes: application },
                        primary = snapshot.query.select({
                          ...selector,
                          limit: 2,
                        });
                      if (primary.length === 0) {
                        const proposed = [...(step.alternates ?? [])];
                        const inferred =
                          selector.key && selector.text
                            ? meaningfulSelector.parse({
                                ...selector,
                                key: undefined,
                              })
                            : undefined;
                        if (inferred) proposed.push(inferred);
                        const matches = proposed.map((candidate) => ({
                          candidate,
                          nodes: snapshot.query.select({
                            ...candidate,
                            limit: 2,
                          }),
                        }));
                        invariant(
                          matches.every((match) => match.nodes.length <= 1),
                          "FLOW_TARGET_AMBIGUOUS",
                          "A proposed repair matches multiple UI nodes",
                        );
                        const candidates = matches
                          .filter((match) => match.nodes.length === 1)
                          .map((match) => match.candidate);
                        const nodes = new Map(
                          candidates.map((candidate) => [
                            digest(
                              snapshot.query.select({
                                ...candidate,
                                limit: 2,
                              })[0],
                            ),
                            candidate,
                          ]),
                        );
                        invariant(
                          nodes.size === 1,
                          "FLOW_TARGET_MISSING",
                          "No unambiguous selector repair; inspect the current UI",
                        );
                        selector = nodes.values().next().value;
                        invariant(
                          selector,
                          "FLOW_TARGET_MISSING",
                          "Missing repaired selector",
                        );

                        repaired = true;

                      } else
                        invariant(
                          primary.length === 1,
                          "FLOW_TARGET_AMBIGUOUS",
                          `Step ${step.id} matches ${primary.length} nodes`,
                        );
                    }

                const action = step.action === "tap" ? "click" : step.action === "doubleTap" ? "doubleClick" : step.action === "longTap" ? "longClick" : step.action === "input" ? "inputText" : step.action === "key" ? "keyEvent" : step.action;
                const control = controlSchema.parse({ action,
                  ...(selector ? { selector: { ...selector, bundle_name: flow.app.bundleName } } : {}),
                  window: { bundle_name: flow.app.bundleName },
                  ...(step.point ? { point: step.point } : {}),
                  ...(step.gesture ? { gesture: step.gesture } : {}),
                  ...(step.action === "key" ? { keys: [step.key] } : {}),
                  ...(step.action === "input" ? { text: variables[step.value!.slice(2, -1)] } : {}),
                });
                return { control, repaired, selector };
              }, (value) => z.object({ control: controlSchema, repaired: z.boolean(), selector: meaningfulSelector.optional() }).parse(value));
              await this.devices.control(target, prepared.control, signal);
              return { step_id: step.id, action: step.action, elapsed_ms: performance.now() - started, repaired: prepared.repaired, selector: prepared.selector };
            };
            // Completed steps are replayed from receipts. An unfinished action only reads its child receipt.
            return this.store.privateEffect("step-result", { step, variables, bundle: flow.app.bundleName }, execute,
              (value) => resultSchema.parse(value), execute);
          }));
          if (result.repaired && result.selector) { step.selector = result.selector; changed = true; }
          receipts.push({ step_id: result.step_id, action: result.action, elapsed_ms: result.elapsed_ms, repaired: result.repaired });
        }
        const verification = await this.devices.verify(target, flow.assert!, signal, flow.app.bundleName);
        if (changed) await scoped("save-repairs", () => this.store.privateEffect("save", { before: digest(original), after: digest(flow) }, async () => {
          await this.save(project, flow, true, digest(original)); return { saved: true };
        }, (value) => z.object({ saved: z.literal(true) }).parse(value), async () => {
          return digest(this.read(project, id)) === digest(flow) ? { saved: true as const } : undefined;
        }));
        return { id, target, verified: true, selector_repairs_saved: changed, verification, steps: receipts };
      }, signal), signal));
  }
}
