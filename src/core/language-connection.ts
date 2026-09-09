import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  Message,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";

/** A broken language-server pipe must reject requests without crashing the worker. */
export function languageConnection(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): MessageConnection {
  let connection: MessageConnection;
  class LanguageWriter extends StreamMessageWriter {
    override async write(message: Message): Promise<void> {
      try {
        await super.write(message);
      } catch (error) {
        // vscode-jsonrpc 8.2.1 rethrows failed request writes from an async
        // Promise executor, creating an unhandled rejection after rejecting
        // the request itself. Dispose through its public API first: all pending
        // requests fail, and no failed write can be reported as a response.
        // Notification callers still receive the original write failure.
        connection.dispose();
        if (!Message.isRequest(message)) throw error;
      }
    }
  }
  connection = createMessageConnection(
    new StreamMessageReader(input),
    new LanguageWriter(output),
  );
  return connection;
}
