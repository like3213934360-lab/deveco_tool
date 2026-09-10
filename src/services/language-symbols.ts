import { z } from "zod";
import { invariant } from "../core/errors.js";

const point = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
const compare = (a: z.infer<typeof point>, b: z.infer<typeof point>) =>
  a.line - b.line || a.character - b.character;
const range = z
  .object({ start: point, end: point })
  .refine((value) => compare(value.start, value.end) <= 0, "Reversed range");
const symbol = {
  name: z.string(),
  kind: z.number().int().positive(),
  tags: z.array(z.number().int().positive()).max(32).optional(),
};
const location = z.object({ uri: z.url(), range });
const information = z.object({
  ...symbol,
  location,
  containerName: z.string().optional(),
  deprecated: z.boolean().optional(),
});
const extent = { range, selectionRange: range };
const contained = (value: {
  range: z.infer<typeof range>;
  selectionRange: z.infer<typeof range>;
}) =>
  compare(value.range.start, value.selectionRange.start) <= 0 &&
  compare(value.selectionRange.end, value.range.end) <= 0;

interface DocumentSymbol {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  deprecated?: boolean;
  range: z.infer<typeof range>;
  selectionRange: z.infer<typeof range>;
  children?: DocumentSymbol[];
}
const documentSymbol: z.ZodType<DocumentSymbol> = z.lazy(() =>
  z
    .object({
      ...symbol,
      ...extent,
      detail: z.string().optional(),
      deprecated: z.boolean().optional(),
      children: z.array(documentSymbol).max(10000).optional(),
    })
    .refine(contained, "Selection must lie within its symbol range"),
);

export const callItem = z
  .object({
    ...symbol,
    ...extent,
    uri: z.url(),
    detail: z.string().optional(),
    // Opaque server data is required for the follow-up request. The JSON budget
    // is checked before parsing; do not strip this field or accept host-made items.
    data: z.unknown().optional(),
  })
  .refine(contained, "Selection must lie within its symbol range");

export const symbolResults = {
  documentSymbol: z
    .union([
      z.array(documentSymbol).max(10000),
      z.array(information).max(10000),
    ])
    .nullable(),
  // We do not advertise resolveSupport: a server must return complete ranges.
  workspaceSymbol: z.array(information).max(10000).nullable(),
  prepareCallHierarchy: z.array(callItem).max(10000).nullable(),
  incomingCalls: z
    .array(
      z.object({
        from: callItem,
        fromRanges: z.array(range).max(10000),
      }),
    )
    .max(10000)
    .nullable(),
  outgoingCalls: z
    .array(
      z.object({
        to: callItem,
        fromRanges: z.array(range).max(10000),
      }),
    )
    .max(10000)
    .nullable(),
};

/** Bound recursion, total entries and string bytes before recursive validation. */
export function assertLanguageBudget(raw: unknown): void {
  const pending = [{ value: raw, depth: 0 }];
  let nodes = 0,
    bytes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    invariant(
      ++nodes <= 200000 && depth <= 64,
      "LSP_RESULT_LIMIT",
      "Language result exceeds the entry or nesting limit",
    );
    if (typeof value === "string") bytes += Buffer.byteLength(value);
    else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      invariant(
        pending.length + entries.length + nodes <= 200000,
        "LSP_RESULT_LIMIT",
        "Language result exceeds the entry limit",
      );
      for (const [key, child] of entries) {
        bytes += Buffer.byteLength(key) + 8;
        pending.push({ value: child, depth: depth + 1 });
      }
    }
    invariant(
      bytes <= 4 * 1024 * 1024,
      "LSP_RESULT_LIMIT",
      "Language result exceeds 4 MiB; narrow the workspace symbol query",
    );
  }
}
