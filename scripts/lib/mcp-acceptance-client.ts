import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { packageRoot } from "../../src/core/config.js";
import type { ToolGroup } from "../../src/core/catalog.js";
import { ToolError, invariant } from "../../src/core/errors.js";
import { acceptanceResult } from "./acceptance-result.js";

/** Isolated candidate MCP over its actual public stdio/worker path. */
export class AcceptanceMcp {
  private client?: Client;
  private transport?: StdioClientTransport;
  constructor(
    readonly root: string,
    readonly name: string,
    readonly options: {
      installation?: string;
      state_dir?: string;
      configuration_file?: string;
      tool_groups?: readonly ToolGroup[];
    } = {},
  ) {}
  async connect() {
    invariant(
      !this.client,
      "ACCEPTANCE_ALREADY_CONNECTED",
      "Close the current client before reconnecting",
    );
    this.client = new Client({ name: this.name, version: "1" });
    const installation = this.options.installation ?? packageRoot;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(installation, "dist/src/cli.js")],
      cwd: installation,
      stderr: "pipe",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (v): v is [string, string] =>
              v[1] !== undefined &&
              !v[0].startsWith("DEVECO_") &&
              !["NODE_OPTIONS", "NODE_PATH"].includes(v[0]),
          ),
        ),
        DEVECO_STATE_DIR:
          this.options.state_dir ?? path.join(this.root, "state"),
        DEVECO_CONFIG:
          this.options.configuration_file ??
          path.join(this.root, "config.json"),
        DEVECO_TOOL_GROUPS: (this.options.tool_groups ?? ["core"]).join(","),
      },
    });
    this.transport.stderr?.on("data", (chunk: Buffer) => {
      const log = path.join(this.root, "mcp.ndjson"),
        size = fs.existsSync(log) ? fs.statSync(log).size : 0;
      if (size < 4 * 1024 * 1024)
        fs.appendFileSync(log, chunk.subarray(0, 4 * 1024 * 1024 - size), {
          mode: 0o600,
        });
    });
    await this.client.connect(this.transport);
  }
  async call(
    name: string,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const data = (await this.callResponse(name, raw, signal)).structuredContent!.data;
    return acceptanceResult(data, input => this.call("workflow_run", input, signal));
  }
  async listTools() {
    invariant(this.client, "ACCEPTANCE_CLIENT_REQUIRED", "Connect MCP first");
    return this.client.listTools();
  }
  /** Preserve actual image content blocks and their read tokens for host review. */
  async callResponse(name: string, raw: unknown, signal?: AbortSignal) {
    invariant(this.client, "ACCEPTANCE_CLIENT_REQUIRED", "Connect MCP first");
    const response = CallToolResultSchema.parse(
      await this.client.callTool(
        { name, arguments: z.record(z.string(), z.unknown()).parse(raw) },
        undefined,
        { timeout: 180000, signal },
      ),
    );
    const result = z
      .object({
        ok: z.boolean(),
        data: z.unknown().optional(),
        error: z
          .object({
            code: z.string(),
            message: z.string(),
            details: z.unknown().optional(),
          })
          .optional(),
      })
      .parse(response.structuredContent);
    if (!result.ok) {
      invariant(
        result.error,
        "ACCEPTANCE_ENVELOPE_INVALID",
        "Failed MCP response omitted its error",
      );
      throw new ToolError(
        result.error.code,
        result.error.message,
        result.error.details,
      );
    }
    return response;
  }
  async close() {
    try {
      await this.client?.close();
    } finally {
      await this.transport?.close();
      this.client = undefined;
      this.transport = undefined;
    }
  }
}
