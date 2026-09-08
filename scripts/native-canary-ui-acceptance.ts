import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { ToolError, invariant, errorResult } from "../src/core/errors.js";
import { flowSchema } from "../src/core/contracts.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Exercise only an explicitly prepared, already deployed canary through MCP/Worker.
 * Every output directory is new. Failed mutation stages stop; saved run IDs enable inspection. */
const [root, preparedRoot, signingRoot, state] = z
  .tuple([
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
  ])
  .parse(process.argv.slice(2))
  .map((value) => path.resolve(value)) as [string, string, string, string];
assert.equal(fs.existsSync(root), false);
const prepared = z
  .object({
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(path.join(preparedRoot, "prepared.json"), "utf8"),
    ) as unknown,
  );
const journal = z
  .object({
    operations: z.object({
      preflight: z.object({ result: z.object({ target: z.string() }) }),
      deploy: z.object({ status: z.literal("succeeded") }),
    }),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(
        path.join(signingRoot, "operations.private.json"),
        "utf8",
      ),
    ) as unknown,
  );
const target = journal.operations.preflight.result.target,
  flowId = `canary-${randomUUID().slice(0, 8)}`;
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity(),
  installation = fileURLToPath(new URL("../../", import.meta.url));
const observations: {
  name: string;
  result?: unknown;
  error?: unknown;
  elapsed_ms: number;
}[] = [];
let client: Client | undefined,
  transport: StdioClientTransport | undefined,
  recordingId: string | undefined,
  replayId: string | undefined;
const save = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        flow_id: flowId,
        recording_id: recordingId,
        replay_id: replayId,
        observations,
      },
      null,
      2,
    ),
  );
async function observe<T>(name: string, task: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await task();
    observations.push({ name, result, elapsed_ms: performance.now() - start });
    console.log(`${name}: passed`);
    return result;
  } catch (error) {
    observations.push({
      name,
      error: errorResult(error),
      elapsed_ms: performance.now() - start,
    });
    console.log(`${name}: failed`);
    throw error;
  } finally {
    save();
  }
}
async function call(name: string, args: Record<string, unknown>) {
  invariant(client, "CLIENT_MISSING", "Connect MCP first");
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (result.isError) {
    const error = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.unknown().optional(),
        }),
      })
      .parse(result.structuredContent).error;
    throw new ToolError(error.code, error.message, error.details);
  }
  return z
    .object({ ok: z.literal(true), data: z.unknown() })
    .parse(result.structuredContent).data;
}
async function connect() {
  client = new Client({ name: "native-canary-ui-acceptance", version: "1" });
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
            !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]),
        ),
      ),
      DEVECO_STATE_DIR: state,
      DEVECO_CONFIG: path.join(root, "config.json"),
    },
  });
  transport.stderr?.on("data", () => {});
  await client.connect(transport);
  return { connected: true };
}
async function disconnect() {
  try {
    await client?.close();
  } finally {
    await transport?.close();
    client = undefined;
    transport = undefined;
  }
  return { closed: true };
}
async function settle(id: string, expected: string) {
  const deadline = performance.now() + 120000;
  while (performance.now() < deadline) {
    const status = z
      .object({ status: z.string(), error: z.unknown().optional() })
      .parse(
        await call("workflow_run", {
          action: "status",
          run_id: id,
          wait_ms: 1000,
        }),
      );
    if (status.status === expected) return { status: status.status };
    invariant(
      ["queued", "running", "cancelling"].includes(status.status),
      "CANARY_WORKFLOW_FAILED",
      `Canary task ended in ${status.status}`,
    );
  }
  throw new ToolError(
    "CANARY_TIMEOUT",
    "Inspect persisted run ID before retrying",
  );
}
const selector = (key: string, text?: string) => ({
  key,
  bundle_name: prepared.bundle_name,
  ...(text === undefined ? {} : { text, textMode: "exact" }),
});
const assertion = {
  visible: selector("mcp-status", "中文验收完成"),
  timeoutMs: 10000,
};
try {
  await observe("connect", connect);
  await observe("signed_profile_identity", async () => {
    const receipt = z
      .object({
        operations: z.object({
          sign: z.object({
            result: z.object({ path: z.string(), sha256: z.string() }),
          }),
          debug_profile: z
            .object({ result: z.object({ sha256: z.string() }) })
            .optional(),
          profile: z
            .object({ result: z.object({ sha256: z.string() }).optional() })
            .optional(),
        }),
      })
      .parse(
        JSON.parse(
          fs.readFileSync(
            path.join(signingRoot, "operations.private.json"),
            "utf8",
          ),
        ) as unknown,
      );
    const result = z
      .object({
        verified: z.literal(true),
        profile_sha256: z.string(),
        certificate_chain_sha256: z.string(),
      })
      .parse(
        await call("app_signature", {
          action: "verify",
          file: receipt.operations.sign.result.path,
        }),
      );
    assert.equal(
      result.profile_sha256,
      (
        receipt.operations.debug_profile?.result ??
        receipt.operations.profile?.result
      )?.sha256,
    );
    return result;
  });
  await observe("record_start", async () => {
    const result = z.object({ recording_id: z.string() }).parse(
      await call("ui_flow", {
        action: "record_start",
        project_path: prepared.project_path,
        target,
        id: flowId,
        name: "专用中文输入验收",
        route: { module: prepared.module, ability: prepared.ability },
        mode: "restart",
        request_key: `${flowId}:record`,
      }),
    );
    recordingId = result.recording_id;
    save();
    return settle(recordingId, "needs_input");
  });
  await observe("initial_assertion", () =>
    call("verify_ui", {
      target,
      assert: {
        visible: selector("mcp-status", "MCP 验收就绪"),
        timeoutMs: 10000,
      },
    }),
  );
  await observe("chinese_input", () =>
    call("ui_control", {
      target,
      operation: {
        action: "inputText",
        selector: selector("mcp-input"),
        text: "中文验收完成",
      },
    }),
  );
  await observe("confirm_tap", () =>
    call("ui_tap", { target, selector: selector("mcp-confirm") }),
  );
  await observe("final_assertion", () =>
    call("verify_ui", { target, assert: assertion }),
  );
  await observe("record_save", async () => {
    await call("ui_flow", {
      action: "record_stop",
      recording_id: recordingId,
      assert: assertion,
    });
    return settle(recordingId!, "succeeded");
  });
  const flow = await observe("recorded_flow", async () => {
    const saved = flowSchema.parse(
      await call("ui_flow", {
        action: "read",
        project_path: prepared.project_path,
        id: flowId,
      }),
    );
    assert.equal(saved.steps.length, 2);
    assert.equal(saved.steps[0]?.value, "${input1}");
    assert.equal(saved.variables.input1?.secret, true);
    return saved;
  });
  await observe("mcp_close", disconnect);
  await observe("mcp_restart", connect);
  await observe("flow_persisted", async () => {
    const saved = flowSchema.parse(
      await call("ui_flow", {
        action: "read",
        project_path: prepared.project_path,
        id: flowId,
      }),
    );
    assert.equal(digest(saved), digest(flow));
    return { sha256: digest(saved) };
  });
  await observe("flow_replay", async () => {
    const result = z.object({ run_id: z.string() }).parse(
      await call("ui_flow", {
        action: "run",
        project_path: prepared.project_path,
        target,
        id: flowId,
        variables: { input1: "中文验收完成" },
        request_key: `${flowId}:replay`,
      }),
    );
    replayId = result.run_id;
    save();
    return settle(replayId, "succeeded");
  });
  await observe("replay_assertion", () =>
    call("verify_ui", { target, assert: assertion }),
  );
  await observe("screenshot_evidence", () =>
    call("ui_snapshot", { target, mode: "image" }),
  );
} catch {
  process.exitCode = 1;
} finally {
  await observe("close", disconnect);
}
