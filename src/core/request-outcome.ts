/** Allowlisted telemetry only. Never serialize inputs, diagnostics text, auth
 * tokens, source code or whole result trees into ordinary request events. */
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function requestAction(input: unknown) {
  const value = object(input),
    operation = object(value.operation);
  return Object.fromEntries(
    [
      "action",
      "workflow",
      "run_id",
      "test_id",
      "review_id",
      "attempt_id",
      "step_id",
    ]
      .flatMap((key) =>
        typeof value[key] === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(value[key])
          ? [[key, value[key]]]
          : [],
      )
      .concat(
        typeof operation.action === "string" &&
          /^[A-Za-z0-9_-]{1,64}$/.test(operation.action)
          ? [["operation", operation.action]]
          : [],
      ),
  );
}
export function requestOutcome(data: unknown) {
  const value = object(data),
    summary = object(value.summary),
    review = object(value.review);
  const result: Record<string, unknown> = {};
  for (const key of ["run_id", "test_id", "review_id", "receipt_id"])
    if (
      typeof value[key] === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(value[key])
    )
      result[key] = value[key];
  for (const key of ["errorCount", "warnCount"])
    if (
      typeof summary[key] === "number" &&
      Number.isSafeInteger(summary[key]) &&
      (summary[key] as number) >= 0
    )
      result[key] = summary[key];
  const status = [
    "queued",
    "running",
    "needs_input",
    "interrupted",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
    "required",
    "passed",
    "insufficient",
    "insufficient_evidence",
    "blocked",
    "complete",
    "incomplete",
  ].includes(String(value.status))
    ? value.status
    : undefined;
  if (status) result.status = status;
  if (
    value.success === false ||
    value.assertion_status === "failed" ||
    (typeof summary.errorCount === "number" && summary.errorCount > 0) ||
    ["failed", "blocked", "incomplete"].includes(String(status))
  )
    result.outcome = "failed";
  else if (
    ["required", "pending"].includes(String(review.status)) ||
    [
      "queued",
      "running",
      "needs_input",
      "interrupted",
      "cancelling",
      "required",
      "insufficient",
      "insufficient_evidence",
    ].includes(String(status))
  )
    result.outcome = "pending";
  else if (value.verified === false) result.outcome = "unverified";
  else if (
    value.verified === true ||
    value.success === true ||
    ["succeeded", "passed", "complete"].includes(String(status))
  )
    result.outcome = "passed";
  else if (value.commandAccepted === true || value.accepted === true)
    result.outcome = "accepted";
  else result.outcome = "returned";
  return result;
}
