/**
 * Minimal MCP stdio transport + JSON-RPC dispatcher (newline-delimited JSON).
 * Replaces @modelcontextprotocol/sdk, saving ~17 MB RSS and its dependency tree.
 * Implements: initialize, ping, tools/*, resources/*, prompts/*, notifications/cancelled.
 */
type Json = Record<string, unknown>;
export type Handler = (params: Json, signal: AbortSignal) => Promise<unknown>;

const supported = ["2025-06-18", "2025-03-26", "2024-11-05"];

export class McpServer {
  private readonly handlers = new Map<string, Handler>();
  private readonly inflight = new Map<string | number, AbortController>();
  private buffer = "";

  constructor(private readonly info: { name: string; version: string }, private readonly capabilities: Json, private readonly instructions: string) {
    this.handlers.set("ping", async () => ({}));
  }

  on(method: string, handler: Handler) {
    this.handlers.set(method, handler);
  }

  start(onEnd: () => void) {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line) this.receive(line);
      }
    });
    process.stdin.once("end", onEnd);
  }

  private send(message: Json) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }

  private receive(line: string) {
    let message: { id?: string | number; method?: string; params?: Json };
    try {
      message = JSON.parse(line);
    } catch {
      this.send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const { id, method, params = {} } = message;
    if (!method) return; // responses to server->client requests are not used
    if (id === undefined) {
      if (method === "notifications/cancelled") this.inflight.get((params as { requestId: string | number }).requestId)?.abort();
      return;
    }
    if (method === "initialize") {
      const requested = String((params as { protocolVersion?: string }).protocolVersion ?? "");
      this.send({ id, result: { protocolVersion: supported.includes(requested) ? requested : supported[0], capabilities: this.capabilities, serverInfo: this.info, instructions: this.instructions } });
      return;
    }
    const handler = this.handlers.get(method);
    if (!handler) {
      this.send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    const controller = new AbortController();
    this.inflight.set(id, controller);
    handler(params, controller.signal)
      .then((result) => { if (!controller.signal.aborted) this.send({ id, result }); })
      .catch((error: unknown) => this.send({ id, error: { code: (error as { rpcCode?: number }).rpcCode ?? -32603, message: error instanceof Error ? error.message : String(error) } }))
      .finally(() => this.inflight.delete(id));
  }
}
