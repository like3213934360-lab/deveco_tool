import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { verifyDistribution } from "./lib/distribution.js";
import { invariant, errorResult } from "../src/core/errors.js";
import { release } from "../src/core/config.js";

const [directory, destination] = process.argv.slice(2);
invariant(
  directory && destination,
  "INSTALLATION_ARGUMENT",
  "Provide the clean installation and a new evidence directory",
);
const installation = path.resolve(directory),
  output = path.resolve(destination);
invariant(
  !fs.existsSync(output),
  "OUTPUT_EXISTS",
  "Use a new evidence directory",
);
fs.mkdirSync(output, { recursive: true });
const results: { name: string; passed: true; elapsed_ms: number }[] = [];
let transport: StdioClientTransport | undefined, client: Client | undefined;
let identity: ReturnType<typeof verifyDistribution> | undefined;
let stderr = "",
  closed = false;
async function check<T>(name: string, action: () => Promise<T> | T) {
  const started = performance.now(),
    result = await action();
  results.push({ name, passed: true, elapsed_ms: performance.now() - started });
  return result;
}
async function call(name: string, args: Record<string, unknown>) {
  invariant(client, "CLIENT_MISSING", "MCP client is not connected");
  const result = await client.callTool({ name, arguments: args });
  invariant(
    !result.isError,
    "INSTALLATION_TOOL_FAILED",
    `${name}: ${JSON.stringify(result.structuredContent)}`,
  );
  const data = z
    .object({ ok: z.literal(true), data: z.unknown() })
    .parse(result.structuredContent);
  return data.data;
}
async function connect() {
  client = new Client({ name: "native-installation-acceptance", version: "1" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installation, "dist/src/cli.js")],
    cwd: installation,
    stderr: "pipe",
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined &&
            !entry[0].startsWith("DEVECO_") &&
            !["NODE_PATH", "NODE_OPTIONS"].includes(entry[0]),
        ),
      ),
      DEVECO_STATE_DIR: path.join(output, "state"),
      DEVECO_CONFIG: path.join(output, "config.json"),
    },
  });
  transport.stderr?.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString("utf8")).slice(-32768);
  });
  await client.connect(transport);
  invariant(
    client.getServerVersion()?.version === release,
    "INSTALLATION_VERSION",
    "Installed server version differs from the package",
  );
}
async function disconnect() {
  await client?.close();
  await transport?.close();
  client = undefined;
  transport = undefined;
}
try {
  identity = await check("sealed-installed-files-and-native-lock", () =>
    verifyDistribution(installation, true),
  );
  invariant(
    fs.existsSync(path.join(installation, "node_modules")),
    "INSTALLATION_DEPENDENCIES",
    "Run npm ci --omit=dev before acceptance",
  );
  for (const dependency of [
    "typescript",
    "@deveco/deveco-cli",
    "@deveco-codegenie/mcp",
  ])
    invariant(
      !fs.existsSync(path.join(installation, "node_modules", dependency)),
      "INSTALLATION_LEGACY_DEPENDENCY",
      `Forbidden installed dependency: ${dependency}`,
    );
  fs.writeFileSync(path.join(output, "config.json"), "{}\n");
  await check("compiled-entry-mcp-handshake", connect);
  await check(
    "25-structured-tools-and-eight-workflows-without-worker-state",
    async () => {
      const catalog = await client!.listTools();
      invariant(
        catalog.tools.length === 25 &&
          catalog.tools.every((tool) => tool.outputSchema),
        "INSTALLATION_CATALOG",
        "Tool catalog is incomplete",
      );
      const graph = z
        .object({ workflows: z.array(z.unknown()).length(8) })
        .parse(await call("workflow_catalog", {}));
      invariant(
        graph.workflows.length === 8 &&
          !fs.existsSync(path.join(output, "state/state.sqlite")),
        "INSTALLATION_EAGER_STATE",
        "Static catalog must not initialize worker storage",
      );
    },
  );
  await check("worker-native-sqlite-and-doctor", () =>
    call("deveco_doctor", {}),
  );
  await check("packaged-local-document-index-and-archive", async () => {
    const docs = z
      .object({
        total: z.number().positive(),
        entries: z.array(z.object({ id: z.string() })).min(1),
      })
      .parse(
        await call("harmony_knowledge", {
          action: "catalog",
          kind: "docs",
          limit: 1,
        }),
      );
    const read = z.object({ content: z.string().min(1) }).parse(
      await call("harmony_knowledge", {
        action: "read",
        kind: "docs",
        id: docs.entries[0]!.id,
        limit: 200,
      }),
    );
    invariant(
      read.content.length <= 200,
      "INSTALLATION_DOCUMENT_BOUND",
      "Read exceeded its requested bound",
    );
  });
  const startArgs = {
    action: "start",
    workflow: "crash_diagnose",
    request_key: "clean-installation-check",
    input: {
      log_text:
        "Reason: Error: installation fixture\nat Test.onPageShow (entry/src/main/ets/pages/Index.ets:1:1)\n",
    },
  };
  const run = await check("langgraph-workflow-submission", async () =>
    z
      .object({ run_id: z.string().uuid() })
      .parse(await call("workflow_run", startArgs)),
  );
  const completed = await check("langgraph-workflow-completion", async () => {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const status = z
        .object({ status: z.string(), result: z.unknown() })
        .parse(
          await call("workflow_run", {
            action: "status",
            run_id: run.run_id,
            wait_ms: 5000,
          }),
        );
      if (status.status === "succeeded") return status;
      invariant(
        ["queued", "running"].includes(status.status),
        "INSTALLATION_WORKFLOW",
        `Workflow stopped as ${status.status}`,
      );
    }
    throw new Error("Installation workflow timed out");
  });
  await check("entire-mcp-process-restart", async () => {
    await disconnect();
    await connect();
  });
  await check(
    "sqlite-result-persists-and-request-key-deduplicates",
    async () => {
      const restored = z
        .object({ status: z.literal("succeeded"), result: z.unknown() })
        .parse(
          await call("workflow_run", { action: "status", run_id: run.run_id }),
        );
      invariant(
        JSON.stringify(restored.result) === JSON.stringify(completed.result),
        "INSTALLATION_PERSISTENCE",
        "Workflow result changed across server restart",
      );
      const duplicate = z
        .object({
          run_id: z.literal(run.run_id),
          deduplicated: z.literal(true),
        })
        .parse(await call("workflow_run", startArgs));
      invariant(
        duplicate.deduplicated,
        "INSTALLATION_DEDUPLICATION",
        "Request key was not deduplicated",
      );
    },
  );
  await check("shutdown-and-unchanged-distribution", async () => {
    await disconnect();
    closed = true;
    invariant(
      verifyDistribution(installation, true).manifest_sha256 ===
        identity!.manifest_sha256,
      "INSTALLATION_CHANGED",
      "Installation bytes changed during acceptance",
    );
  });
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        passed: true,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        identity,
        results,
        closed,
        scope:
          "Clean compiled distribution installation, MCP, local resource lookup and completed-workflow persistence; no SDK/device or release acceptance implied",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: true, cases: results.length, output }));
} catch (error) {
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        passed: false,
        node: process.version,
        platform: process.platform,
        identity,
        results,
        closed,
        error: errorResult(error),
      },
      null,
      2,
    ) + "\n",
  );
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
} finally {
  await disconnect();
  fs.writeFileSync(path.join(output, "mcp-stderr.log"), stderr);
}
