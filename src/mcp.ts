/**
 * Minimal MCP stdio transport + JSON-RPC dispatcher (newline-delimited JSON).
 * Replaces @modelcontextprotocol/sdk, saving ~17 MB RSS and its dependency tree.
 * Implements: initialize, ping, tools/*, resources/*, prompts/*, notifications/cancelled.
 */
type Json = Record<string, unknown>;
export type Handler = (params: Json, signal: AbortSignal) => Promise<unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const requestId = (value: unknown): value is string | number => typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));

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
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // MCP uses named params and non-null string/integer ids. This transport does not
    // advertise batching, including for the older protocol versions we negotiate.
    const id = object(message) && requestId(message.id) ? message.id : null;
    const invalid = (code: number, detail: string) => this.send({ id, error: { code, message: detail } });
    if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method
      || (Object.hasOwn(message, "id") && !requestId(message.id))) {
      invalid(-32600, "Invalid Request (expected a single MCP JSON-RPC 2.0 request)");
      return;
    }
    const { method } = message;
    const notification = !Object.hasOwn(message, "id");
    if (message.params !== undefined && !object(message.params)) {
      if (!notification) invalid(-32602, "Invalid params: expected an object");
      return;
    }
    const params = (message.params ?? {}) as Json;
    if (notification) {
      if (method === "notifications/cancelled" && requestId(params.requestId)) this.inflight.get(params.requestId)?.abort();
      return;
    }
    if (this.inflight.has(id!)) {
      invalid(-32600, "Request id is already in use");
      return;
    }
    if (method === "initialize") {
      if (typeof params.protocolVersion !== "string" || !object(params.capabilities) || !object(params.clientInfo)
        || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
        invalid(-32602, "initialize requires protocolVersion, capabilities and clientInfo");
        return;
      }
      const requested = params.protocolVersion;
      this.send({ id, result: { protocolVersion: supported.includes(requested) ? requested : supported[0], capabilities: this.capabilities, serverInfo: this.info, instructions: this.instructions } });
      return;
    }
    const handler = this.handlers.get(method);
    if (!handler) {
      this.send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    const controller = new AbortController();
    this.inflight.set(id!, controller);
    Promise.resolve().then(() => handler(params, controller.signal))
      .then((result) => { if (!controller.signal.aborted) this.send({ id, result }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) this.send({ id, error: { code: (error as { rpcCode?: number })?.rpcCode ?? -32603, message: error instanceof Error ? error.message : String(error) } }); })
      .finally(() => this.inflight.delete(id!));
  }
}
