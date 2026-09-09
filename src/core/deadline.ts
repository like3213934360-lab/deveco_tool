import { ToolError } from "./errors.js";

/** A deadline cancels the operation and still waits for its cleanup to finish. */
export async function withinDeadline<T>(
  milliseconds: number,
  parent: AbortSignal | undefined,
  code: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController(),
    error = new ToolError(
      code,
      `Operation exceeded its ${milliseconds} ms deadline`,
    );
  const timer = setTimeout(() => controller.abort(error), milliseconds);
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  try {
    const result = await task(signal);
    signal.throwIfAborted();
    return result;
  } catch (cause) {
    if (
      cause instanceof ToolError &&
      ["CANCEL_UNCONFIRMED", "EFFECT_UNCERTAIN"].includes(cause.code)
    )
      throw cause;
    if (controller.signal.aborted && !parent?.aborted) throw error;
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
