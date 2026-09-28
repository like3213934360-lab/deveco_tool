/** Error categories tell the host what kind of fix is needed. */
export type ErrorCategory =
  | "input" // caller supplied invalid or conflicting arguments
  | "environment" // toolchain, SDK, device or login missing
  | "project" // the user's project has a problem (compile error, config)
  | "tool" // an external tool failed unexpectedly
  | "evidence" // outcome could not be verified
  | "internal";

const categories: Record<string, ErrorCategory> = {
  INVALID_INPUT: "input",
  NOT_FOUND: "input",
  CONFLICT: "input",
  TOOLCHAIN_MISSING: "environment",
  CAPABILITY_UNAVAILABLE: "environment",
  DEVICE_UNAVAILABLE: "environment",
  DEVICE_AMBIGUOUS: "input",
  AUTH_REQUIRED: "environment",
  KB_MISSING: "environment",
  PROJECT_INVALID: "project",
  BUILD_FAILED: "project",
  CHECK_FAILED: "project",
  PROCESS_FAILED: "tool",
  TIMEOUT: "tool",
  HTTP_ERROR: "tool",
  CANCELLED: "tool",
  ASSERTION_FAILED: "evidence",
  EFFECT_UNCERTAIN: "evidence",
};

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly hint?: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  hint?: string,
): asserts condition {
  if (!condition) throw new ToolError(code, message, details, hint);
}

export function errorResult(error: unknown) {
  if (error instanceof ToolError)
    return {
      code: error.code,
      category: categories[error.code] ?? categoryFromCode(error.code),
      message: error.message,
      retryable: error.retryable,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.details ? { details: error.details } : {}),
    };
  if (error instanceof Error && error.name === "ZodError")
    return { code: "INVALID_INPUT", category: "input" as const, message: error.message, retryable: false };
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    return { code: "CANCELLED", category: "tool" as const, message: error.message, retryable: true };
  return {
    code: "INTERNAL",
    category: "internal" as const,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function categoryFromCode(code: string): ErrorCategory {
  if (/_MISSING$|_UNAVAILABLE$|^AUTH_/.test(code)) return "environment";
  if (/_INVALID$|_REQUIRED$|_AMBIGUOUS$|_CONFLICT$/.test(code)) return "input";
  if (/^BUILD_|^PROJECT_|^CHECK_/.test(code)) return "project";
  return "tool";
}
