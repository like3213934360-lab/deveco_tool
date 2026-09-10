import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const document = z.object({
  uri: z.string(),
  version: z.number(),
  text: z.string(),
});
const documents = new Map<string, z.infer<typeof document>>();
const uri = (file: string) =>
  pathToFileURL(path.join(process.cwd(), file)).href;
const range = (line: number, character: number) => ({
  start: { line, character },
  end: { line, character: character + 5 },
});
const declaration = { uri: decodeURI(uri("Model.ets")), range: range(0, 13) },
  implementation = { uri: uri("Implementation.ets"), range: range(0, 13) },
  usage = { uri: uri("Consumer.ets"), range: range(1, 6) };
connection.onRequest("initialize", () => ({
  capabilities: {
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    implementationProvider: process.env.NO_IMPLEMENTATION !== "1",
    ...(process.env.NO_SYMBOLS === "1"
      ? {}
      : {
          documentSymbolProvider: true,
          workspaceSymbolProvider: { resolveProvider: false },
          callHierarchyProvider: { workDoneProgress: false },
        }),
    positionEncoding: process.env.POSITION_ENCODING ?? "utf-16",
  },
}));
connection.onNotification("textDocument/didOpen", (raw: unknown) => {
  const input = z.object({ textDocument: document }).parse(raw).textDocument;
  documents.set(input.uri, input);
  void connection.sendNotification("textDocument/publishDiagnostics", {
    uri: input.uri,
    version: input.version,
    diagnostics: [],
  });
});
connection.onNotification("textDocument/didChange", (raw: unknown) => {
  const input = z
    .object({
      textDocument: document.omit({ text: true }),
      contentChanges: z.array(z.object({ text: z.string() })).min(1),
    })
    .parse(raw);
  documents.set(input.textDocument.uri, {
    ...input.textDocument,
    text: input.contentChanges[0]!.text,
  });
  void connection.sendNotification("textDocument/publishDiagnostics", {
    uri: input.textDocument.uri,
    version: input.textDocument.version - 1,
    diagnostics: [{ range: range(0, 0), message: "stale diagnostic" }],
  });
  void connection.sendNotification("textDocument/publishDiagnostics", {
    uri: "invalid uri",
    diagnostics: [],
  });
  void connection.sendNotification("textDocument/publishDiagnostics", {
    uri: input.textDocument.uri,
    version: input.textDocument.version,
    diagnostics: input.contentChanges[0]!.text.includes("BROKEN")
      ? [{ range: range(0, 0), message: "current diagnostic" }]
      : [],
  });
});
connection.onNotification("textDocument/didClose", (raw: unknown) =>
  documents.delete(
    z.object({ textDocument: z.object({ uri: z.string() }) }).parse(raw)
      .textDocument.uri,
  ),
);
let active = 0;
connection.onRequest("textDocument/hover", async () => {
  active++;
  const concurrent = active;
  try {
    if (process.env.HOVER_DELAY_MS)
      await delay(Number(process.env.HOVER_DELAY_MS));
    if (process.env.EMPTY_HOVER === "1") return null;
    if (process.env.INVALID_RESULT === "1") return { contents: 42 };
    return {
      contents: JSON.stringify({
        documents: [...documents.values()],
        concurrent,
      }),
    };
  } finally {
    active--;
  }
});
connection.onRequest("textDocument/references", () => [
  declaration,
  implementation,
  usage,
]);
connection.onRequest("textDocument/definition", (raw: unknown) => {
  const input = z
      .object({ textDocument: z.object({ uri: z.string() }) })
      .parse(raw),
    target =
      input.textDocument.uri === implementation.uri
        ? implementation
        : declaration;
  return process.env.LOCATION_LINK === "1"
    ? [
        {
          targetUri: target.uri,
          targetSelectionRange: target.range,
          targetRange: range(0, 0),
        },
      ]
    : [target];
});
connection.onRequest("textDocument/implementation", () => {
  if (process.env.NO_IMPLEMENTATION === "1")
    throw new Error("Unsupported capability was dispatched");
  return [
    {
      targetUri: implementation.uri,
      targetSelectionRange: implementation.range,
      targetRange: range(0, 0),
    },
  ];
});
const item = (name: string, file = "Model.ets") => ({
  name,
  kind: 12,
  uri: uri(file),
  range: range(0, 0),
  selectionRange: range(0, 0),
  data: { symbol: name, source: documents.get(uri("Model.ets"))?.text },
});
connection.onRequest("textDocument/documentSymbol", (raw: unknown) => {
  z.strictObject({ textDocument: z.object({ uri: z.string() }) }).parse(raw);
  if (process.env.EMPTY_SYMBOLS === "1") return null;
  if (process.env.INVALID_SYMBOLS === "1") return [{ name: "bad", kind: 12 }];
  if (process.env.FLAT_SYMBOLS === "1")
    return [{ name: "flat", kind: 12, location: usage }];
  return [
    { ...item("outer"), children: [{ ...item("nested"), children: [] }] },
  ];
});
connection.onRequest("workspace/symbol", (raw: unknown) => {
  const { query } = z.strictObject({ query: z.string() }).parse(raw);
  if (process.env.EMPTY_SYMBOLS === "1") return [];
  return [{ name: query, kind: 12, location: usage, containerName: "跨文件" }];
});
connection.onRequest("textDocument/prepareCallHierarchy", () => {
  if (process.env.EMPTY_SYMBOLS === "1") return null;
  return [item("root"), item("overload")];
});
for (const direction of ["incomingCalls", "outgoingCalls"] as const) {
  if (direction === "outgoingCalls" && process.env.NO_OUTGOING_METHOD === "1")
    continue;
  connection.onRequest(
    `callHierarchy/${direction}`,
    async (raw: unknown, token) => {
      const input = z
        .object({
          item: z.object({
            name: z.string(),
            data: z.object({ symbol: z.string(), source: z.string() }),
          }),
        })
        .parse(raw).item;
      if (
        input.data.symbol !== input.name ||
        input.data.source !== documents.get(uri("Model.ets"))?.text
      )
        throw new Error("Missing or stale opaque server data");
      if (process.env.CALL_DELAY_MS)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Number(process.env.CALL_DELAY_MS));
          token.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      if (token.isCancellationRequested) return null;
      const key = direction === "incomingCalls" ? "from" : "to";
      return [
        {
          [key]: item(`${input.name}-one`, "Consumer.ets"),
          fromRanges: [range(1, 0), range(2, 0)],
        },
        {
          [key]: item(`${input.name}-two`, "Implementation.ets"),
          fromRanges: [range(3, 0)],
        },
      ];
    },
  );
}
connection.onRequest("shutdown", () => null);
connection.onNotification("exit", () => process.exit(0));
connection.listen();
