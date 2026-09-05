import path from "node:path";
import { URI } from "vscode-uri";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";

const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const documents = new Map();
const uri = (name) => URI.file(path.join(process.cwd(), name)).toString();
const range = (line, character) => ({ start: { line, character }, end: { line, character: character + 5 } });
const declaration = { uri: URI.parse(uri("Model.ets")).toString(true), range: range(0, 13) };
const implementation = { uri: uri("Implementation.ets"), range: range(0, 13) };
const use = { uri: uri("Consumer.ets"), range: range(1, 6) };
connection.onRequest("initialize", () => ({ capabilities: {
  definitionProvider: true, referencesProvider: true, hoverProvider: true, implementationProvider: true,
} }));
connection.onNotification("textDocument/didOpen", ({ textDocument }) => documents.set(textDocument.uri, textDocument));
connection.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) => {
  documents.set(textDocument.uri, { ...textDocument, text: contentChanges[0].text });
});
connection.onNotification("textDocument/didClose", ({ textDocument }) => documents.delete(textDocument.uri));
connection.onRequest("textDocument/hover", () => ({ contents: JSON.stringify([...documents.values()]) }));
connection.onRequest("textDocument/references", () => [declaration, implementation, use]); // Reproduce ace-server ignoring false.
connection.onRequest("textDocument/definition", ({ textDocument }) => {
  const target = textDocument.uri === implementation.uri ? implementation : declaration;
  return process.env.LOCATION_LINK === "1"
    ? [{ targetUri: URI.parse(target.uri).toString(), targetSelectionRange: target.range,
      targetRange: { start: { line: 0, character: 0 }, end: { line: 4, character: 1 } } }]
    : [{ ...target, uri: URI.parse(target.uri).toString() }];
});
connection.onRequest("shutdown", () => null);
connection.onNotification("exit", () => process.exit(0));
connection.listen();
