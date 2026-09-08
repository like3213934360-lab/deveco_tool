import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertionSchema,
  controlSchema,
  flowSchema,
  meaningfulSelector,
  stepSchema,
  selectorSchema,
  type Flow,
} from "../core/contracts.js";
import { PayloadCipher } from "../core/crypto.js";
import { invariant, ToolError } from "../core/errors.js";
import { digest } from "../core/files.js";
import { StateStore } from "../core/store.js";
import { withTrace } from "../core/trace.js";
import { DeviceService, type Snapshot, type UiNode } from "./device.js";
import { isWindowSurface } from "./ui-tree.js";

import { resolveControl, uiInputArguments } from "./ui-control.js";

const payloadSchema = z.strictObject({
  flow: flowSchema,
  pending: stepSchema.optional(),
  receipts: z
    .array(z.strictObject({ step_id: z.string(), accepted: z.literal(true) }))
    .max(200)
    .default([]),
});
type Payload = z.infer<typeof payloadSchema>;
type State =
  "preparing" | "active" | "sealed" | "cancelling" | "finished" | "cancelled";
interface Row {
  run_id: string;
  target: string;
  state: State;
  payload: string;
  operation_owner: string | null;
}

/** Recording data belongs to a durable workflow. Only live operation cancellation uses process-local handles. */
export class RecordingService {
  private readonly cipher: PayloadCipher;
  private readonly shutdown = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  constructor(
    readonly store: StateStore,
    readonly devices: DeviceService,
  ) {
    this.cipher = new PayloadCipher(path.join(store.root, "recording.key"));
  }
  private row(id: string): Row {
    const row = this.store.db
      .prepare("SELECT * FROM ui_recordings WHERE run_id=?")
      .get(id) as Row | undefined;
    invariant(
      row,
      "RECORDING_NOT_FOUND",
      "Recording has not initialized or does not exist",
    );
    return row;
  }
  private payload(row: Row): Payload {
    return payloadSchema.parse(
      JSON.parse(this.cipher.open(row.run_id, row.payload)) as unknown,
    );
  }
  private write(id: string, value: Payload) {
    const json = JSON.stringify(payloadSchema.parse(value));
    invariant(
      Buffer.byteLength(json) <= 262144,
      "RECORDING_CAPACITY",
      "Recording data exceeds 256 KiB",
    );
    this.store.capacity(Buffer.byteLength(json) * 2);
    this.store.db
      .prepare("UPDATE ui_recordings SET payload=?,updated=? WHERE run_id=?")
      .run(this.cipher.seal(id, json), Date.now(), id);
  }
  initialize(id: string, target: string, draft: Flow) {
    return this.store.db
      .transaction(() => {
        const run = this.store.get(id);
        invariant(
          run.workflow === "ui_record",
          "RECORDING_RUN_INVALID",
          "Recording needs its own durable workflow",
        );
        const previous = this.store.db
          .prepare("SELECT run_id FROM ui_recordings WHERE run_id=?")
          .get(id);
        if (previous) return { recording_id: id };
        invariant(
          !this.store.db
            .prepare(
              "SELECT run_id FROM ui_recordings WHERE target=? AND state IN ('preparing','active','sealed','cancelling')",
            )
            .get(target),
          "RECORDING_ACTIVE",
          "This device already has an unfinished recording",
        );
        invariant(
          (
            this.store.db
              .prepare(
                "SELECT COUNT(*) AS count FROM ui_recordings WHERE state NOT IN ('finished','cancelled')",
              )
              .get() as { count: number }
          ).count < 32,
          "RECORDING_CAPACITY",
          "At most 32 unfinished recordings",
        );
        this.store.capacity(16384);
        this.store.db
          .prepare("INSERT INTO ui_recordings VALUES (?,?,?,?,NULL,?)")
          .run(
            id,
            target,
            "preparing",
            this.cipher.seal(id, JSON.stringify({ flow: draft, receipts: [] })),
            Date.now(),
          );
        return { recording_id: id };
      })
      .immediate();
  }
  activate(id: string) {
    const row = this.row(id);
    invariant(
      ["preparing", "active", "sealed"].includes(row.state),
      "RECORDING_NOT_ACTIVE",
      "Recording is stopping",
    );
    this.store.db
      .prepare(
        "UPDATE ui_recordings SET state='active',updated=? WHERE run_id=? AND state='preparing'",
      )
      .run(Date.now(), id);
    return this.status(id);
  }
  status(id: string) {
    const row = this.row(id),
      { flow, pending, receipts } = this.payload(row);
    return {
      recording_id: id,
      run_id: id,
      target: row.target,
      state: row.state,
      flow_id: flow.id,
      step_count: flow.steps.length,
      receipt_count: receipts.length,
      variables: flow.variables,
      uncertain_operation: pending
        ? { step_id: pending.id, action: pending.action }
        : null,
    };
  }
  statusIfInitialized(id: string) {
    return this.store.db
      .prepare("SELECT run_id FROM ui_recordings WHERE run_id=?")
      .get(id)
      ? this.status(id)
      : null;
  }
  flow(id: string): Flow {
    return this.payload(this.row(id)).flow;
  }
  assertTaskTarget(target: string, recordingFlowId?: string) {
    const row = this.store.db
      .prepare(
        "SELECT * FROM ui_recordings WHERE target=? AND state IN ('preparing','active','sealed','cancelling')",
      )
      .get(target) as Row | undefined;
    invariant(
      !row ||
        (!!recordingFlowId && this.payload(row).flow.id === recordingFlowId),
      "RECORDING_ACTIVE",
      "Finish or cancel this device's recording before another workflow changes the application",
    );
  }
  ready(id: string): unknown | undefined {
    const row = this.row(id);
    invariant(
      !["cancelled", "cancelling"].includes(row.state),
      "CANCELLED",
      "Recording cancelled",
    );
    return row.state === "sealed" || row.state === "finished"
      ? { sealed: true, digest: digest(this.flow(id)) }
      : undefined;
  }
  async seal(id: string, rawAssertion: unknown, signal?: AbortSignal) {
    const assertion = assertionSchema.parse(rawAssertion),
      row = this.row(id);
    return this.store.lease(
      `device:${row.target}`,
      async () => {
        const current = this.row(id),
          value = this.payload(current);
        invariant(
          ["active", "sealed", "finished"].includes(current.state),
          "RECORDING_NOT_ACTIVE",
          "Recording is not ready to finish",
        );
        invariant(
          !value.pending,
          "RECORDING_UNCERTAIN",
          "A UI operation has no recording receipt; discard this recording after confirming operations stopped",
        );
        if (value.flow.assert)
          invariant(
            digest(value.flow.assert) === digest(assertion),
            "RECORDING_ASSERT_CHANGED",
            "A sealed recording keeps its original assertion",
          );
        else {
          value.flow.assert = assertion;
          this.store.db
            .transaction(() => {
              this.write(id, value);
              this.store.db
                .prepare(
                  "UPDATE ui_recordings SET state='sealed' WHERE run_id=?",
                )
                .run(id);
            })
            .immediate();
        }
        return this.status(id);
      },
      signal,
    );
  }
  finish(id: string) {
    this.store.db
      .prepare(
        "UPDATE ui_recordings SET state='finished',updated=? WHERE run_id=? AND state='sealed'",
      )
      .run(Date.now(), id);
    return this.status(id);
  }
  async cancel(
    id: string,
    cancelRun: () => Promise<unknown>,
    signal?: AbortSignal,
  ) {
    // Persist the cancellation request before waiting for the device lease. The executing action polls it.
    this.store.db
      .prepare(
        "UPDATE ui_recordings SET state='cancelling',updated=? WHERE run_id=? AND state IN ('preparing','active','sealed')",
      )
      .run(Date.now(), id);
    try {
      await cancelRun();
    } catch (error) {
      if (!(error instanceof ToolError) || error.code !== "CANCEL_UNCONFIRMED")
        throw error;
    }
    const existing = this.store.db
      .prepare("SELECT target FROM ui_recordings WHERE run_id=?")
      .get(id) as { target: string } | undefined;
    const cancel = async () => {
      const result = await cancelRun();
      if (this.store.get(id).status === "cancelled")
        this.store.db
          .prepare(
            "UPDATE ui_recordings SET state='cancelled',operation_owner=NULL,updated=? WHERE run_id=? AND state='cancelling'",
          )
          .run(Date.now(), id);
      return result;
    };
    return existing
      ? this.store.lease(`device:${existing.target}`, cancel, signal)
      : cancel();
  }
  control(target: string, raw: unknown, signal?: AbortSignal) {
    invariant(
      !this.shutdown.signal.aborted,
      "RUNTIME_STOPPING",
      "Recording service is stopping",
    );
    invariant(
      this.operations.size < 32,
      "RECORDING_CAPACITY",
      "At most 32 queued or active UI controls",
    );
    const combined = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    const operation = this.executeControl(target, raw, combined);
    this.operations.add(operation);
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation),
    );
    return operation;
  }
  private async executeControl(
    target: string,
    raw: unknown,
    signal: AbortSignal,
  ) {
    return this.store.lease(
      `device:${target}`,
      async () => {
        const row = this.store.db
          .prepare(
            "SELECT * FROM ui_recordings WHERE target=? AND state IN ('preparing','active','sealed','cancelling')",
          )
          .get(target) as Row | undefined;
        if (!row) return this.devices.control(target, raw, signal);
        invariant(
          row.state === "active",
          "RECORDING_NOT_ACTIVE",
          "Recording is preparing or sealed; wait, finish or cancel it before more UI actions",
        );
        const value = this.payload(row);
        invariant(
          !value.pending,
          "RECORDING_UNCERTAIN",
          "Previous UI operation has no recording receipt; do not repeat it automatically",
        );
        invariant(
          this.store.get(row.run_id).status === "needs_input",
          "RECORDING_NOT_READY",
          "Wait for the recording workflow to pause before operating the UI",
        );
        invariant(
          value.flow.steps.length < 200,
          "RECORDING_CAPACITY",
          "At most 200 recorded steps",
        );
        const input = controlSchema.parse(raw),
          controller = new AbortController();
        const combined = signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal;
        return withTrace(
          { run_id: row.run_id, node: "record_ui_action" },
          async () => {
            this.devices.invalidate(target);
            const snapshot = await this.devices.snapshot(target, combined);
            const resolved = resolveControl(input, snapshot);
            uiInputArguments(resolved);
            const step = recordedStep(snapshot, value.flow, {
              ...resolved,
              ...(input.selector && !input.point && !input.gesture
                ? {
                    selector: selectorSchema.parse({
                      ...input.selector,
                      ...(resolved.display_id === undefined
                        ? {}
                        : { displayId: resolved.display_id }),
                      ...(input.window?.id
                        ? { window_id: input.window.id }
                        : {}),
                    }),
                  }
                : {}),
            });
            if (step.action === "input")
              value.flow.variables[step.value!.slice(2, -1)] = {
                required: true,
                secret: true,
              };
            value.pending = step;
            this.store.db
              .transaction(() => {
                invariant(
                  this.row(row.run_id).state === "active",
                  "CANCELLED",
                  "Recording is stopping",
                );
                this.write(row.run_id, value);
                this.store.db
                  .prepare(
                    "UPDATE ui_recordings SET operation_owner=? WHERE run_id=?",
                  )
                  .run(this.store.owner, row.run_id);
              })
              .immediate();
            const monitor = setInterval(() => {
              try {
                if (this.row(row.run_id).state === "cancelling")
                  controller.abort(
                    new ToolError(
                      "CANCELLED",
                      "Recording cancellation requested",
                    ),
                  );
              } catch {
                controller.abort(
                  new ToolError(
                    "RECORDING_STATE_UNAVAILABLE",
                    "Recording state is unavailable",
                  ),
                );
              }
            }, 50);
            try {
              const result = await this.devices.control(
                target,
                resolved,
                combined,
                snapshot,
              );
              // A persistence failure after a physical action must not misreport that action as rejected.
              try {
                value.flow.steps.push(step);
                value.receipts.push({ step_id: step.id, accepted: true });
                delete value.pending;
                this.write(row.run_id, value);
                return {
                  ...result,
                  recording: {
                    recording_id: row.run_id,
                    recorded: true,
                    step_id: step.id,
                  },
                };
              } catch {
                return {
                  ...result,
                  recording: {
                    recording_id: row.run_id,
                    recorded: false,
                    uncertain: true,
                    reason:
                      "Recording receipt could not be persisted; stop and inspect recording status",
                  },
                };
              }
            } finally {
              clearInterval(monitor);
              try {
                this.store.db
                  .prepare(
                    "UPDATE ui_recordings SET operation_owner=NULL WHERE run_id=? AND operation_owner=?",
                  )
                  .run(row.run_id, this.store.owner);
              } catch {
                /* Keep the guard when state storage fails; never turn an accepted UI action into a retryable failure. */
              }
            }
          },
        );
      },
      signal,
    );
  }
  async close() {
    this.shutdown.abort(
      new ToolError("RUNTIME_STOPPING", "Recording service is stopping"),
    );
    await Promise.allSettled(this.operations);
    this.cipher.close();
  }
}

export function recordedStep(
  snapshot: Snapshot,
  flow: Flow,
  input: z.infer<typeof controlSchema>,
): z.infer<typeof stepSchema> {
  const nodes = snapshot.nodes.filter(
      (node) =>
        node.bundleName === flow.app.bundleName &&
        (input.display_id === undefined ||
          node.displayId === String(input.display_id)),
    ),
    windows = nodes.filter(
      (node) =>
        isWindowSurface(node) &&
        node.rect &&
        node.focused !== false &&
        node.visible !== false,
    );
  invariant(
    windows.length === 1 && windows[0]?.rect,
    "RECORDING_WINDOW_UNKNOWN",
    "Recording requires exactly one focused application window",
  );
  const rect = windows[0].rect;
  const point = (x: number | undefined, y: number | undefined) => {
    invariant(
      x !== undefined &&
        y !== undefined &&
        x >= rect.x1 &&
        y >= rect.y1 &&
        x < rect.x2 &&
        y < rect.y2,
      "RECORDING_COORDINATES_INVALID",
      "Coordinates must lie inside the recorded application window",
    );
    return {
      xPercent: ((x - rect.x1) / (rect.x2 - rect.x1)) * 100,
      yPercent: ((y - rect.y1) / (rect.y2 - rect.y1)) * 100,
    };
  };
  const step: z.input<typeof stepSchema> = {
    id: `step-${randomUUID()}`,
    action: "tap",
  };
  if (input.action === "keyEvent") {
    invariant(
      input.keys?.length === 1,
      "RECORDING_KEYS_UNSUPPORTED",
      "A saved flow supports one key per step; no key chord is silently truncated",
    );
    return stepSchema.parse({ ...step, action: "key", key: input.keys[0] });
  }
  invariant(
    input.action !== "dircFling",
    "RECORDING_GESTURE_UNSUPPORTED",
    "Record a swipe or fling with explicit endpoints",
  );
  if (["swipe", "fling", "drag"].includes(input.action)) {
    invariant(
      !input.selector,
      "RECORDING_GESTURE_UNSUPPORTED",
      "Recorded gestures need explicit endpoint coordinates",
    );
    const from = point(input.x, input.y),
      to = point(input.x2, input.y2);
    return stepSchema.parse({
      ...step,
      action: input.action,
      fragile: true,
      gesture: {
        fromXPercent: from.xPercent,
        fromYPercent: from.yPercent,
        toXPercent: to.xPercent,
        toYPercent: to.yPercent,
        velocity: input.velocity,
        ...(input.step_length === undefined
          ? {}
          : { stepLength: input.step_length }),
      },
    });
  }
  let node: UiNode | undefined;
  if (input.selector) {
    const found = snapshot.query.select({ ...input.selector, limit: 2 });
    invariant(
      found.length === 1 &&
        found[0]?.bundleName === flow.app.bundleName &&
        found[0].enabled !== false &&
        found[0].rect,
      "RECORDING_TARGET_AMBIGUOUS",
      "The recorded selector must resolve to one enabled node in this application",
    );
    node = found[0];
  }
  if (node) {
    // Input fields may contain passwords or user text. Never capture their text/value as selector fallback.
    const candidates = [
      ...(node.key ? [{ key: node.key }] : []),
      ...(input.action !== "inputText" && node.text
        ? [
            {
              text: node.text,
              textMode: "exact" as const,
              ...(node.type ? { type: node.type } : {}),
            },
          ]
        : []),
      ...(node.type ? [{ type: node.type }] : []),
    ].map((candidate) =>
      meaningfulSelector.parse({
        ...candidate,
        bundle_name: flow.app.bundleName,
      }),
    );
    const unique = candidates.filter((candidate) => {
      const found = snapshot.query.select(candidate);
      return found.length === 1 && found[0] === node;
    });
    invariant(
      unique[0],
      "RECORDING_SELECTOR_UNSTABLE",
      "No unique persistent selector; provide explicit coordinates or a stable component key",
    );
    step.selector = unique[0];
    if (unique.length > 1) step.alternates = unique.slice(1);
  } else {
    step.point = point(input.x, input.y);
    step.fragile = true;
  }
  step.action =
    input.action === "inputText"
      ? "input"
      : input.action === "doubleClick"
        ? "doubleTap"
        : input.action === "longClick"
          ? "longTap"
          : "tap";
  if (step.action === "input") {
    invariant(input.text, "UI_INPUT_REQUIRED", "Input text required");
    step.value = `\${input${Object.keys(flow.variables).length + 1}}`;
  }
  return stepSchema.parse(step);
}
