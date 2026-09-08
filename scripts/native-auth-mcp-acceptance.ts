import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { invariant, ToolError } from "../src/core/errors.js";
import { release } from "../src/core/config.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Read-only live authentication acceptance over the production MCP/Worker path.
 * An optional existing state directory reuses a completed browser login. Never
 * copies credentials into evidence or creates/deletes cloud signing assets. */
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const provider = z.enum(["developer", "codegenie"]).parse(process.argv[3]);
const state = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(root, "state");
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
if (process.argv[4]) assert.ok(fs.existsSync(path.join(state, "state.sqlite")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const tested = evidenceIdentity();
const installation = fileURLToPath(new URL("../../", import.meta.url));
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error_code?: string;
}[] = [];
const statusSchema = z.object({
  provider: z.enum(["developer", "codegenie"]),
  logged_in: z.boolean(),
  login_pending: z.boolean(),
  error: z.object({ code: z.string() }).optional(),
  callback: z
    .object({
      received: z.number(),
      rejected: z.number(),
      accepted: z.boolean(),
      last_rejection: z.string().optional(),
    })
    .optional(),
});
let client: Client | undefined, transport: StdioClientTransport | undefined;
let completed = false, runtimeClosed = false, mcpClosed = false;
let failed = false,
  stderrBytes = 0;
let callback: z.infer<typeof statusSchema>["callback"];
const artifactSchema = z.object({
  artifact_id: z.string().uuid(),
  bytes: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024),
  mime: z.string(),
});
let firstKnowledgeArtifact:
  | {
      reference: z.infer<typeof artifactSchema>;
      prefix: string;
      sha256: string;
    }
  | undefined;
async function observe<T>(
  name: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const started = performance.now();
  try {
    const result = await action();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    failed = true;
    const code = error instanceof ToolError ? error.code : "ACCEPTANCE_FAILED";
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error_code: code,
    });
    process.stdout.write(`${name}: failed (${code})\n`);
    return undefined;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify(
        { tested, provider, observations, callback, stderr_bytes: stderrBytes },
        null,
        2,
      ),
    );
  }
}
async function call(name: string, args: Record<string, unknown>) {
  invariant(client, "CLIENT_MISSING", "MCP is not connected");
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .parse(result.structuredContent);
    throw new ToolError(
      error.error.code,
      "MCP tool failed during authentication acceptance",
    );
  }
  return z
    .object({ ok: z.literal(true), data: z.unknown() })
    .parse(result.structuredContent).data;
}
async function connect() {
  client = new Client({ name: "native-auth-acceptance", version: "1" });
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
  transport.stderr?.on("data", (data: Buffer) => {
    stderrBytes += data.byteLength;
  });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, release);
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
async function status() {
  const result = statusSchema.parse(
    await call("harmony_auth", { action: "status", provider }),
  );
  assert.equal(result.provider, provider);
  if (result.callback) {
    if (
      result.callback.received > 0 &&
      JSON.stringify(result.callback) !== JSON.stringify(callback)
    )
      process.stdout.write(
        JSON.stringify({ callback: result.callback }) + "\n",
      );
    callback = result.callback;
  }
  return result;
}
async function inventories() {
  if (provider !== "developer") return;
  const inventory = z
    .object({
      teams: z.array(z.object({ id: z.string().min(1), name: z.string() })),
    })
    .parse(await call("harmony_auth", { action: "teams", provider }));
  const counts: { certificates: number; devices: number }[] = [];
  for (const team of inventory.teams) {
    const certificates = z
      .object({ certificates: z.array(z.object({ id: z.string() })) })
      .parse(
        await call("app_signature", {
          action: "certificates",
          team_id: team.id,
        }),
      );
    const devices = z
      .object({ devices: z.array(z.object({ id: z.string() })) })
      .parse(
        await call("app_signature", { action: "devices", team_id: team.id }),
      );
    counts.push({
      certificates: certificates.certificates.length,
      devices: devices.devices.length,
    });
  }
  return { teams: inventory.teams.length, inventories: counts };
}
async function readKnowledgeArtifact(
  reference: z.infer<typeof artifactSchema>,
  prefix: string,
) {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < reference.bytes) {
    const page = z
      .object({
        artifact_id: z.string(),
        bytes: z.number().int(),
        mime: z.string(),
        offset: z.number().int(),
        next_offset: z.number().int(),
        encoding: z.literal("base64"),
        data: z.string(),
      })
      .parse(
        await call("workflow_run", {
          action: "read_artifact",
          artifact_id: reference.artifact_id,
          offset,
          // An unaligned byte boundary also exercises split UTF-8 characters.
          limit: 32749,
        }),
      );
    assert.equal(page.artifact_id, reference.artifact_id);
    assert.equal(page.bytes, reference.bytes);
    assert.equal(page.mime, reference.mime);
    assert.equal(page.offset, offset);
    const chunk = Buffer.from(page.data, "base64");
    assert.ok(chunk.length > 0 && chunk.length <= 32749);
    assert.equal(page.next_offset, offset + chunk.length);
    assert.ok(page.next_offset <= reference.bytes);
    chunks.push(chunk);
    offset = page.next_offset;
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, reference.bytes);
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.ok(content.length > 16384);
  assert.equal(content.slice(0, 16384), prefix);
  return {
    bytes: bytes.length,
    characters: content.length,
    pages: chunks.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
async function knowledgeQuery() {
  const result = z
    .object({
      source: z.literal("cloud"),
      content: z.string().min(1).max(16384),
      artifact: artifactSchema.optional(),
    })
    .parse(
      await call("harmony_knowledge", {
        action: "search",
        source: "cloud",
        query: "ArkTS 中如何声明 const 变量？",
      }),
    );
  const artifact = result.artifact
    ? await readKnowledgeArtifact(result.artifact, result.content)
    : undefined;
  if (result.artifact && artifact && !firstKnowledgeArtifact)
    firstKnowledgeArtifact = {
      reference: result.artifact,
      prefix: result.content,
      sha256: artifact.sha256,
    };
  return {
    source: result.source,
    characters: result.content.length,
    content_sha256: digest(result.content),
    ...(artifact ? { artifact } : {}),
  };
}
try {
  await observe("compiled_mcp_handshake", async () => {
    await connect();
    return { version: release };
  });
  const authenticated = await observe("browser_authentication", async () => {
    if (!(await status()).logged_in) {
      assert.equal(
        process.argv[4],
        undefined,
        "Existing state must already be authenticated",
      );
      const result = z.object({ login_url: z.string().url() }).parse(
        await call("harmony_auth", {
          action: "login",
          provider,
          open_browser: false,
        }),
      );
      process.stdout.write(
        JSON.stringify({ login_url: result.login_url }) + "\n",
      );
      for (;;) {
        const current = await status();
        if (current.logged_in) break;
        if (current.error)
          throw new ToolError(current.error.code, "Browser login failed");
        invariant(
          current.login_pending,
          "LOGIN_INCOMPLETE",
          "Login ended without credentials",
        );
        await delay(500);
      }
    }
    return { logged_in: true };
  });
  if (authenticated) {
    if (provider === "developer")
      await observe("cloud_inventories", inventories);
    else await observe("cloud_knowledge_query", knowledgeQuery);
    await observe("worker_restart", async () => {
      const closed = z
        .object({ closed: z.literal(true) })
        .parse(await call("deveco_restart", {}));
      assert.equal((await status()).logged_in, true);
      return closed;
    });
    await observe("server_restart", async () => {
      await disconnect();
      await connect();
      assert.equal((await status()).logged_in, true);
      return { logged_in: true };
    });
    if (provider === "developer")
      await observe("cloud_inventories_after_restart", inventories);
    else await observe("cloud_knowledge_after_restart", knowledgeQuery);
    if (firstKnowledgeArtifact)
      await observe("knowledge_artifact_after_restart", async () => {
        invariant(
          firstKnowledgeArtifact,
          "ARTIFACT_MISSING",
          "No prior artifact",
        );
        const artifact = await readKnowledgeArtifact(
          firstKnowledgeArtifact.reference,
          firstKnowledgeArtifact.prefix,
        );
        assert.equal(artifact.sha256, firstKnowledgeArtifact.sha256);
        return artifact;
      });
    await observe("provider_separation", async () => {
      const other = provider === "developer" ? "codegenie" : "developer";
      const current = statusSchema.parse(
        await call("harmony_auth", { action: "status", provider: other }),
      );
      assert.equal(current.provider, other);
      // Fresh state proves one login does not authenticate the other provider.
      if (!process.argv[4]) assert.equal(current.logged_in, false);
      if (other === "codegenie" && !current.logged_in) {
        await assert.rejects(
          call("harmony_knowledge", {
            action: "search",
            source: "cloud",
            query: "ArkTS const",
          }),
          { code: "AUTH_REQUIRED" },
        );
      }
      return { provider: other, logged_in: current.logged_in };
    });
  }
  completed = true;
} finally {
  if (client)
    await observe("runtime_shutdown", async () => {
      const result = z.object({ closed: z.literal(true) }).parse(await call("deveco_restart", {}));
      runtimeClosed = result.closed;
      return result;
    });
  await observe("mcp_shutdown", async () => {
    await disconnect();
    mcpClosed = true;
    return { closed: true };
  });
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !failed, runtimeClosed && mcpClosed);
}
