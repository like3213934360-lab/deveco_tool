export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
/** The external command has confirmed completion. Its failure is durable and
 * must never be replayed automatically, even if the workflow is resumed. */
export class SettledEffectError extends ToolError {
  static from(error: unknown): SettledEffectError {
    const result = errorResult(error);
    return new SettledEffectError(
      result.code,
      result.message,
      "details" in result ? result.details : null,
    );
  }
}
export function invariant(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ToolError(code, message);
}
export function errorResult(error: unknown) {
  return error instanceof ZodError
    ? {
        code: "INVALID_ARGUMENT",
        message: "Input did not match the declared schema",
        details: error.issues.map(({ path, message, code }) => ({
          path,
          message,
          code,
        })),
        retryable: false,
      }
    : error instanceof ToolError
      ? {
          code: error.code,
          message: error.message,
          details: error.details,
          retryable: error.retryable,
        }
      : {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        };
}
export function object(value: unknown): Record<string, unknown> {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_DATA",
    "Expected an object",
  );
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string): string {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_ARGUMENT",
    `${field} must be a nonempty string`,
  );
  return value;
}
import { ZodError } from "zod";
