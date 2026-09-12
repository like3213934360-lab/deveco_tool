import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";
import {
  assertLanguageBudget,
  callItem,
  callItemCoordinates,
  symbolResults,
} from "./language-symbols.js";

type SymbolAction = keyof typeof symbolResults;
type CallItem = z.infer<typeof callItem>;

/** ArkTS's flat symbols use absolute file paths where LSP specifies a URI.
 * Only known protocol fields are normalized; opaque item.data stays untouched.
 */
export function arktsSymbolResult(action: SymbolAction, raw: unknown): unknown {
  assertLanguageBudget(raw);
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const uri = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    invariant(
      !value.includes("\0"),
      "LSP_INVALID_RESPONSE",
      "NUL in symbol URI",
    );
    if (/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value))
      return pathToFileURL(value, { windows: true }).href;
    if (path.posix.isAbsolute(value))
      return pathToFileURL(value, { windows: false }).href;
    // Do not reinterpret relative paths or drive-relative paths as a URI.
    invariant(
      !/^[a-z]:[^/]/i.test(value),
      "LSP_INVALID_RESPONSE",
      "Drive-relative symbol path",
    );
    // Some Studio handlers construct file URIs with unescaped spaces. Canonical
    // URL serialization gives the session and all symbol identities one key.
    // Invalid/relative strings still go through the strict response validator.
    try {
      return new URL(value).href;
    } catch {
      return value;
    }
  };
  const item = (value: unknown, nested = false): unknown => {
    if (!object(value)) return value;
    return {
      ...value,
      ...(typeof value.uri === "string" ? { uri: uri(value.uri) } : {}),
      ...(object(value.location)
        ? { location: { ...value.location, uri: uri(value.location.uri) } }
        : {}),
      ...(nested && Array.isArray(value.children)
        ? { children: value.children.map((child) => item(child, true)) }
        : {}),
    };
  };
  if (!Array.isArray(raw)) return raw;
  return raw.map((value: unknown) => {
    if (action === "incomingCalls" || action === "outgoingCalls") {
      if (!object(value)) return value;
      const key = action === "incomingCalls" ? "from" : "to";
      return { ...value, [key]: item(value[key]) };
    }
    return item(value, action === "documentSymbol");
  });
}

/** Studio reports a named arrow's expression extent separately from its
 * variable name. Keep its semantic call identity, but enclose both extents
 * only after documentSymbol confirms that exact variable declaration. This
 * changes neither selection coordinates nor call-site ranges. */
export async function reconcileArktsCallableExtents(
  action: SymbolAction,
  raw: unknown,
  variableDeclaration: (
    item: z.infer<typeof callItemCoordinates>,
  ) => Promise<boolean>,
): Promise<unknown> {
  if (
    !["prepareCallHierarchy", "incomingCalls", "outgoingCalls"].includes(
      action,
    ) ||
    !Array.isArray(raw)
  )
    return raw;
  assertLanguageBudget(raw);
  const compare = (
    a: { line: number; character: number },
    b: { line: number; character: number },
  ) => a.line - b.line || a.character - b.character;
  const result: unknown[] = [],
    verified = new Map<string, boolean>();
  for (const entry of raw) {
    const field =
      action === "incomingCalls"
        ? "from"
        : action === "outgoingCalls"
          ? "to"
          : undefined;
    const object =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : undefined;
    const value = field ? object?.[field] : entry;
    const parsed = callItemCoordinates.safeParse(value);
    if (!parsed.success || callItem.safeParse(value).success) {
      result.push(entry);
      continue;
    }
    const item = parsed.data;
    // Only the evidenced name-before-callable shape is eligible. Reversed,
    // overlapping, trailing or non-function extents remain invalid responses.
    if (
      item.kind !== 12 ||
      compare(item.selectionRange.end, item.range.start) > 0 ||
      compare(item.selectionRange.start, item.selectionRange.end) >= 0
    ) {
      result.push(entry);
      continue;
    }
    const key = JSON.stringify([
      item.uri,
      item.name,
      item.range,
      item.selectionRange,
    ]);
    if (!verified.has(key)) {
      invariant(
        verified.size < 128,
        "LSP_RESULT_LIMIT",
        "Callable extent verification is limited to 128 declarations",
      );
      verified.set(key, await variableDeclaration(item));
    }
    if (!verified.get(key))
      throw new ToolError(
        "LSP_CALL_EXTENT_UNVERIFIED",
        "ArkTS callable extent could not be linked to its exact variable declaration",
        {
          uri: item.uri,
          originalRange: item.range,
          selectionRange: item.selectionRange,
        },
      );
    const normalized = {
      ...item,
      range: { start: item.selectionRange.start, end: item.range.end },
      extentEvidence: {
        method: "textDocument/documentSymbol" as const,
        originalRange: item.range,
        declarationRange: item.selectionRange,
      },
    };
    result.push(field ? { ...object, [field]: normalized } : normalized);
  }
  return result;
}

const sameSelection = (a: CallItem, b: CallItem) =>
  new URL(a.uri).href === new URL(b.uri).href &&
  a.selectionRange.start.line === b.selectionRange.start.line &&
  a.selectionRange.start.character === b.selectionRange.start.character &&
  a.selectionRange.end.line === b.selectionRange.end.line &&
  a.selectionRange.end.character === b.selectionRange.end.character;

/** Studio 26's outgoing adapter converts fromSpans using the callee document,
 * and can repeat each property-access call span while incoming reports it once.
 * Its incoming adapter uses the caller document correctly. Recover cross-file
 * ranges from that semantic relation, never from text/name search or a guessed
 * line offset (callee EOF may have irreversibly clamped the original offsets).
 */
export async function reconcileArktsOutgoing(
  caller: CallItem,
  raw: unknown,
  incoming: (callee: CallItem) => Promise<unknown>,
) {
  const entries = symbolResults.outgoingCalls.parse(raw);
  if (entries === null) return null;
  const cache = new Map<string, z.infer<typeof symbolResults.incomingCalls>>();
  const result = [];
  for (const entry of entries) {
    const distinctOriginal = new Set(
      entry.fromRanges.map((range) => JSON.stringify(range)),
    ).size;
    if (
      new URL(entry.to.uri).href === new URL(caller.uri).href &&
      distinctOriginal === entry.fromRanges.length
    ) {
      result.push(entry);
      continue;
    }
    const key = JSON.stringify([entry.to.uri, entry.to.selectionRange]);
    if (!cache.has(key)) {
      invariant(
        cache.size < 128,
        "LSP_RESULT_LIMIT",
        "Cross-file call verification is limited to 128 callees; narrow the requested symbol",
      );
      const response = await incoming(entry.to);
      assertLanguageBudget(response);
      cache.set(key, symbolResults.incomingCalls.parse(response));
    }
    const matches = (cache.get(key) ?? []).filter((value) =>
      sameSelection(value.from, caller),
    );
    const ranges = matches.flatMap((value) => value.fromRanges);
    if (!(
      matches.length > 0 &&
      ranges.length > 0 &&
      (ranges.length === entry.fromRanges.length ||
        ranges.length === distinctOriginal)
    ))
      throw new ToolError(
        "LSP_CALL_RANGE_UNVERIFIED",
        "ArkTS cross-file outgoing ranges could not be confirmed by the matching incoming call relation",
        {
          caller: { uri: caller.uri, selectionRange: caller.selectionRange },
          callee: {
            uri: entry.to.uri,
            selectionRange: entry.to.selectionRange,
          },
          originalFromRanges: entry.fromRanges,
          matchingIncomingRanges: ranges,
        },
      );
    result.push({
      ...entry,
      fromRanges: ranges,
      rangeEvidence: {
        method: "callHierarchy/incomingCalls" as const,
        originalFromRanges: entry.fromRanges,
      },
    });
  }
  assertLanguageBudget(result);
  return result;
}
