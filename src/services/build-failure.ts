import { errorResult, SettledEffectError, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import type { KnowledgeService } from "./knowledge.js";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const clip = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max).toWellFormed() : null;
const artifactRead = (value: unknown) => {
  const id = record(value).artifact_id;
  return typeof id === "string"
    ? { tool: "workflow_run", action: "read_artifact", artifact_id: id }
    : null;
};

/** Follow only the native command's retained envelope, never arbitrary nested output. */
export function nativeFailureExecution(store: StateStore, details: unknown) {
  let value = record(details);
  for (let i = 0; i < 6; i++) {
    if ("exitCode" in value || "exitSignal" in value || "signal" in value)
      return value;
    if (value.execution) {
      value = record(value.execution);
      continue;
    }
    if (value.value) {
      value = record(value.value);
      continue;
    }
    const reference = record(value.reference);
    if (
      typeof reference.artifact_id !== "string" ||
      typeof reference.bytes !== "number" ||
      reference.bytes <= 0 ||
      reference.bytes > 8 * 1024 * 1024
    )
      break;
    const chunks: Buffer[] = [];
    let offset = 0;
    do {
      const part = store.readArtifact(reference.artifact_id, offset, 65536);
      if (part.bytes !== reference.bytes || part.next_offset <= offset)
        throw new ToolError(
          "COMMAND_RECEIPT_CHANGED",
          "Retained command receipt length changed",
        );
      chunks.push(Buffer.from(part.data, "base64"));
      offset = part.next_offset;
    } while (offset < reference.bytes);
    value = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  return {};
}

export function diagnosticTerms(value: unknown) {
  const json = JSON.stringify(value);
  return (
    [
      ...new Set(
        json.match(/(?:arkts-[a-z-]+|[A-Za-z]+Error|TS\d{3,5})/g) ?? [],
      ),
    ]
      .slice(0, 6)
      .join(" ") || "ArkTS diagnostics"
  );
}

/** Add repair pointers without collecting another report or changing effect certainty. */
export function enrichBuildFailure(
  error: unknown,
  store: StateStore,
  knowledge?: Pick<KnowledgeService, "search">,
): unknown {
  if (
    !(error instanceof ToolError) ||
    !["BUILD_CHECK_BLOCKED", "PROJECT_BUILD_FAILED"].includes(error.code)
  )
    return error;
  const details = record(error.details),
    preflight = error.code === "BUILD_CHECK_BLOCKED";
  const raw = preflight
    ? array(details.diagnostics)
    : array(record(details.diagnostics).examples);
  const diagnostics = raw.slice(0, 8).map((item) => {
    const row = record(item);
    if (preflight) return { ...row, origin: "arkts-preflight" };
    const location = typeof row.location === "string" ? row.location : "";
    // No invented coordinates when the compiler did not print an unambiguous location.
    const match = /(?:File:\s*)?(.+?):(\d+)(?::(\d+))?\s*$/.exec(
      location.replace(/^.*?File:\s*/, ""),
    );
    return {
      origin: "native-compiler",
      file: match?.[1] ?? null,
      line: match ? Number(match[2]) : null,
      column: match?.[3] ? Number(match[3]) : null,
      location: row.location ?? null,
      category: row.category,
      message: row.message,
      rule:
        typeof row.message === "string"
          ? (row.message.match(/(?:arkts-[a-z-]+|TS\d{3,5})/)?.[0] ?? null)
          : null,
    };
  });
  const diagnosis: Record<string, unknown> = {
    origin: preflight ? "arkts-preflight" : "native-compiler",
    compilationVerified: false,
    compiler_started: !preflight,
    diagnostics,
    summary: preflight ? details.summary : record(details.diagnostics).counts,
    truncated:
      raw.length > diagnostics.length ||
      (preflight ? details.diagnostics_truncated !== false : true),
    coverage: preflight
      ? "captured static preflight preview"
      : "recognized compiler log examples; counts are diagnostic lines, not unique issues",
    report_read: artifactRead(details.artifact),
  };
  try {
    const execution = nativeFailureExecution(store, details);
    diagnosis.execution = Object.fromEntries(
      Object.entries(execution).filter(([key]) =>
        [
          "exitCode",
          "exitSignal",
          "signal",
          "elapsedMs",
          "truncated",
          "log",
        ].includes(key),
      ),
    );
    diagnosis.log_read = artifactRead(execution.log);
  } catch (failure) {
    diagnosis.execution_unavailable = errorResult(failure);
  }
  try {
    if (!knowledge)
      throw new ToolError(
        "KNOWLEDGE_UNAVAILABLE",
        "Knowledge lookup is unavailable",
      );
    const query = diagnosticTerms(diagnostics),
      matched = knowledge.search(query, 5);
    diagnosis.knowledge = {
      query,
      status: "candidate_references",
      root_cause_verified: false,
      ...matched,
    };
  } catch (failure) {
    diagnosis.knowledge_unavailable = errorResult(failure);
  }
  const Failure =
    error instanceof SettledEffectError ? SettledEffectError : ToolError;
  return new Failure(
    error.code,
    error.message,
    { ...details, diagnosis },
    error.retryable,
  );
}

/** Status keeps a few usable coordinates and links even if the full error exceeds its text budget. */
export function buildFailurePreview(details: unknown) {
  const diagnosis = record(record(details).diagnosis);
  if (!diagnosis.origin) return undefined;
  const diagnostics = array(diagnosis.diagnostics);
  const knowledge = record(diagnosis.knowledge);
  return {
    origin: diagnosis.origin,
    compiler_started: diagnosis.compiler_started,
    compilationVerified: false,
    summary: diagnosis.summary,
    coverage: diagnosis.coverage,
    diagnostics: diagnostics.slice(0, 3).map((item) => {
      const row = record(item);
      return {
        ...row,
        line: typeof row.line === "number" ? row.line : null,
        column: typeof row.column === "number" ? row.column : null,
        file: clip(row.file, 1024),
        location: clip(row.location, 1024),
        message: clip(row.message, 768),
        rule: clip(row.rule, 256),
      };
    }),
    truncated:
      diagnosis.truncated === true ||
      diagnostics.length > 3 ||
      diagnostics.slice(0, 3).some((item) => {
        const row = record(item);
        return ["file", "location", "message", "rule"].some(
          (key) =>
            typeof row[key] === "string" &&
            (row[key] as string).length >
              ({ file: 1024, location: 1024, message: 768, rule: 256 }[key] ??
                0),
        );
      }),
    report_read: diagnosis.report_read,
    log_read: diagnosis.log_read,
    execution: diagnosis.execution,
    knowledge: {
      status: knowledge.status ?? "unavailable",
      root_cause_verified: false,
      references: array(knowledge.rules)
        .slice(0, 3)
        .map((item) => {
          const row = record(item);
          return {
            id: row.id,
            title: clip(row.title, 256),
            read: row.read,
            uri: row.uri,
          };
        }),
    },
    knowledge_unavailable: diagnosis.knowledge_unavailable,
    execution_unavailable: diagnosis.execution_unavailable,
  };
}
