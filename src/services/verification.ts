import type { z } from "zod";
import { tools } from "../core/contracts.js";
import { errorResult, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import type { DeviceService } from "./device.js";

type VerificationInput = z.infer<typeof tools.verify_ui.schema>;
type AssertionResult = Awaited<ReturnType<DeviceService["verify"]>>;
type Screenshot = Awaited<ReturnType<DeviceService["screenshot"]>>;

export class VerificationService {
  constructor(
    readonly store: StateStore,
    readonly devices: DeviceService,
  ) {}

  async verify(target: string, input: VerificationInput, signal?: AbortSignal) {
    if (input.assert && !input.review && !input.capture)
      return this.devices.verify(target, input.assert, signal);
    return this.store.lease(
      `device:${target}`,
      async () => {
        let assertion: AssertionResult | undefined,
          failure: ToolError | undefined,
          screenshot: Screenshot | undefined,
          captureError: ReturnType<typeof errorResult> | undefined;
        const started = Date.now();
        if (input.assert) {
          try {
            assertion = await this.devices.verify(target, input.assert, signal);
          } catch (error) {
            signal?.throwIfAborted();
            if (
              !(error instanceof ToolError) ||
              !["VERIFICATION_FAILED", "UI_TARGET_AMBIGUOUS"].includes(
                error.code,
              )
            )
              throw error;
            failure = error;
          }
        }
        const assertionCompleted = Date.now();
        try {
          signal?.throwIfAborted();
          screenshot = await this.devices.screenshot(
            target,
            input.capture,
            signal,
          );
        } catch (error) {
          signal?.throwIfAborted();
          captureError = errorResult(error);
          failure ??= new ToolError(captureError.code, captureError.message);
        }
        signal?.throwIfAborted();
        const report = {
          verified: !!assertion && !input.review && !captureError,
          assertion: assertion
            ? { status: "passed", result: assertion }
            : failure && input.assert
              ? { status: "failed", error: errorResult(failure) }
              : { status: "not_requested" },
          review: input.review
            ? { status: "required", requirement: input.review.requirement }
            : { status: "not_requested" },
          screenshot: screenshot ?? null,
          capture_error: captureError ?? null,
          sampling: input.assert
            ? "assertion_then_screenshot"
            : "screenshot_only",
          started_at: started,
          assertion_completed_at: input.assert ? assertionCompleted : null,
          completed_at: Date.now(),
        };
        const report_artifact = this.store.artifact(
          currentTrace().run_id ?? "ui",
          JSON.stringify(report),
          "application/json",
        );
        const result = { ...report, report_artifact };
        if (failure)
          throw new ToolError(
            failure.code,
            failure.message,
            result,
            failure.retryable,
          );
        return result;
      },
      signal,
    );
  }
}
