import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { acceptLanguageSymbols, acceptCppSymbols } from "./lib/lsp-symbols.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { CapabilityReceipts } from "./lib/capability-receipts.js";
import type { Runtime } from "../src/services/runtime.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const project = path.resolve(z.string().min(1).parse(process.argv[3]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity();
const receipts = new CapabilityReceipts(root, tested);
const results: Record<string, unknown> = {};
let client: Client | undefined, transport: StdioClientTransport | undefined;
let completed = false,
  closed = false;
const call: Runtime["call"] = async (name, raw, signal) => {
  assert.ok(client);
  const response = await client.callTool(
    { name, arguments: z.record(z.string(), z.unknown()).parse(raw) },
    undefined,
    { timeout: 180000, signal },
  );
  const envelope = z
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
  if (!envelope.ok)
    throw new ToolError(
      envelope.error!.code,
      envelope.error!.message,
      envelope.error!.details,
    );
  return envelope.data;
};
async function connect() {
  client = new Client({ name: "native-lsp-mcp-acceptance", version: "2" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist/src/cli.js")],
    cwd: packageRoot,
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
      DEVECO_STATE_DIR: path.join(root, "state"),
      DEVECO_CONFIG: path.join(root, "config.json"),
    },
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    const file = path.join(root, "mcp.ndjson");
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size < 4 * 1024 * 1024)
      fs.appendFileSync(file, chunk.subarray(0, 4 * 1024 * 1024 - size), {
        mode: 0o600,
      });
  });
  await client.connect(transport);
}
async function disconnect() {
  try {
    await client?.close();
  } finally {
    await transport?.close();
    client = undefined;
    transport = undefined;
  }
}
try {
  await connect();
  results.doctor = await call("deveco_doctor", {});
  const cancelled = new AbortController(),
    cancellation = new McpError(
      ErrorCode.InvalidRequest,
      "Owned acceptance cancels a cold LSP query",
    );
  const timer = setTimeout(() => cancelled.abort(cancellation), 150);
  try {
    await assert.rejects(
      call(
        "lsp",
        {
          action: "documentSymbol",
          project_path: project,
          file: "entry/src/main/ets/pages/Index.ets",
        },
        cancelled.signal,
      ),
      (error) => {
        assert.equal(cancelled.signal.aborted, true);
        // SDK 1.30 wraps ordinary abort reasons as RequestTimeout. Give it a
        // typed reason and require that exact cancellation, never a timeout.
        assert.equal(error, cancellation);
        return true;
      },
    );
    results.public_cancellation = {
      aborted: true,
      operation: "documentSymbol",
      scope:
        "Cold public MCP request, followed by successful queries in the same runtime",
    };
  } finally {
    clearTimeout(timer);
  }
  results.arkts = await acceptLanguageSymbols({ call }, project);
  console.log("ArkTS five operations and precise ranges: passed");
  results.cpp = await acceptCppSymbols({ call }, project);
  await disconnect();
  await connect();
  results.after_restart = await acceptLanguageSymbols({ call }, project);
  console.log("Fresh MCP process with preserved state: passed");
  results.final_doctor = await call("deveco_doctor", {});
  const sdk = z
    .object({ default_sdk: z.object({ package_version: z.string().min(1) }) })
    .parse(results.final_doctor).default_sdk.package_version;
  for (const action of [
    "goToDefinition",
    "findReferences",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "goToImplementation",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ])
    receipts.add(
      `lsp.${action}`,
      [
        `Actual ArkTS ${action} executes through public stdio MCP in both LF and CRLF UTF-16 fixtures, before and after MCP restart.`,
        "Required symbol and legacy queries return nonempty results; call direction, cross-file ownership and repeated/class/nested call ranges are asserted against the source; legitimate empty queries remain empty.",
        "Native pull diagnostics detect and clear a real type error. C++ observations are kept separately and cannot qualify the ArkTS requirement.",
      ],
      { before: results.arkts, after: results.after_restart },
      { language: "arkts", sdk },
    );
  completed = true;
} catch (error) {
  results.error = errorResult(error);
  console.error(error);
} finally {
  try {
    await disconnect();
    if (completed) {
      const db = new Database(path.join(root, "state/state.sqlite"), {
        readonly: true,
      });
      try {
        const failed = (
          db
            .prepare("SELECT data FROM events WHERE kind='request_failed'")
            .all() as { data: string }[]
        )
          .map(
            (row) =>
              JSON.parse(row.data) as {
                tool: string;
                action?: string;
                code: string;
                stage: string;
              },
          )
          .filter(
            (event) =>
              event.tool === "lsp" &&
              event.action === "documentSymbol" &&
              event.code === "CANCELLED" &&
              event.stage === "worker",
          );
        assert.equal(
          failed.length,
          1,
          "Cancellation must reach the runtime worker, not just reject the client's local promise",
        );
        results.worker_cancellation = failed;
      } finally {
        db.close();
      }
    }
    closed = true;
  } catch (error) {
    results.close_error = errorResult(error);
  }
  const file = path.join(root, "evidence.json");
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Public stdio MCP -> worker -> real ArkTS SDK and clangd; LF/CRLF UTF-16 cross-file, same-file, class and nested call ranges; legacy queries, public cancellation, empty results and restart",
      },
      null,
      2,
    ),
  );
  const passed = finishAcceptance(file, tested, completed, closed);
  receipts.finish(passed);
  console.log(`Real LSP MCP acceptance: ${passed ? "passed" : "failed"}`);
}
