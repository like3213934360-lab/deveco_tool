import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { faultlogNameSchema } from "../src/core/contracts.js";
import { faultlogBundle } from "../src/services/faultlog-format.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { ToolError, errorResult, invariant } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Read an explicitly selected real faultlog over MCP, verify its reported
 * exception against original bytes, then reopen the persisted task. No device
 * mutation, log clearing, authentication or application launch. Private data
 * stays in the new evidence directory; stdout contains step names only. */
const root = path.resolve(z.string().min(1).parse(process.argv[2])),
  target = z.string().min(1).parse(process.argv[3]),
  name = faultlogNameSchema.parse(process.argv[4]);
const expectedKnowledge = z.enum(["candidate_patterns", "unlisted_subtype"]).parse(process.argv[5] ?? "candidate_patterns");
assert.equal(fs.existsSync(root), false, "Evidence directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const installation = fileURLToPath(new URL("../../", import.meta.url)),
  tested = evidenceIdentity(),
  bundle = faultlogBundle(name);
assert.ok(
  bundle,
  "Select a named application JS crash with an attributable bundle",
);
atomicWrite(path.join(root, "config.json"), "{}\n");
let client: Client | undefined, transport: StdioClientTransport | undefined;
let finished = false,
  failure: unknown;
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
const save = () =>
  atomicWrite(
    path.join(root, "evidence.private.json"),
    JSON.stringify(
      {
        tested,
        passed: finished && failure === undefined,
        error: failure,
        target,
        faultlog_name: name,
        expected_knowledge_status: expectedKnowledge,
        scope:
          "Read-only named real faultlog, source evidence comparison, runtime case matching, MCP/CPU Worker path and persisted result/artifact after reconnect. No root-cause fix or application outcome proof.",
        observations,
      },
      null,
      2,
    ) + "\n",
  );
async function observe<T>(name: string, task: () => Promise<T>) {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    console.log(name + ": passed");
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    console.log(name + ": failed");
    throw error;
  } finally {
    save();
  }
}
async function connect() {
  client = new Client({ name: "native-crash-acceptance", version: "1" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installation, "dist/src/cli.js"), "mcp"],
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
      DEVECO_CONFIG: path.join(root, "config.json"),
      DEVECO_STATE_DIR: path.join(root, "state"),
    },
  });
  transport.stderr?.on("data", () => {});
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
async function call(name: string, arguments_: Record<string, unknown>) {
  invariant(client, "CLIENT_MISSING", "MCP connection is missing");
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .parse(result.structuredContent);
    throw new ToolError(
      error.error.code,
      "MCP rejected crash acceptance operation",
    );
  }
  return z
    .object({ ok: z.literal(true), data: z.unknown() })
    .parse(result.structuredContent).data;
}
async function readArtifact(id: string) {
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const part = z
      .object({
        data: z.string(),
        encoding: z.literal("base64"),
        bytes: z.number().int().min(1).max(262144),
        next_offset: z.number().int(),
      })
      .parse(
        await call("workflow_run", {
          action: "read_artifact",
          artifact_id: id,
          offset,
          limit: 65536,
        }),
      );
    const bytes = Buffer.from(part.data, "base64");
    assert.equal(part.next_offset, offset + bytes.length);
    assert.ok(bytes.length > 0 && part.next_offset <= part.bytes);
    parts.push(bytes);
    offset = part.next_offset;
    if (offset === part.bytes) return Buffer.concat(parts);
  }
}
const statusSchema = z.object({ status: z.string(), result: z.unknown() });
async function wait(runId: string) {
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    const result = statusSchema.parse(
      await call("workflow_run", {
        action: "status",
        run_id: runId,
        wait_ms: 1000,
      }),
    );
    if (result.status === "succeeded") return result;
    assert.ok(
      ["queued", "running"].includes(result.status),
      "Crash workflow failed",
    );
  }
  throw new ToolError("ACCEPTANCE_TIMEOUT", "Crash workflow did not finish");
}
try {
  await connect();
  await observe("named_faultlog_inventory", async () => {
    const result = z
      .object({
        files: z.array(z.object({ name: z.string() })),
        complete: z.boolean(),
        warnings: z.array(z.unknown()),
      })
      .passthrough()
      .parse(
        await call("hdc_log", {
          action: "probe",
          target,
          bundle_name: bundle,
          max_age_minutes: 0,
          limit: 100,
        }),
      );
    assert.ok(result.files.some((file) => file.name === name));
    return result;
  });
  const fetched = await observe("named_faultlog_fetch", async () => {
    const result = z
      .object({
        faultlog_name: z.literal(name),
        read_method: z.enum(["shell_head", "hdc_file_recv"]),
        truncated: z.literal(false),
        artifact: z.object({
          artifact_id: z.string(),
          bytes: z.number().positive(),
        }),
      })
      .passthrough()
      .parse(
        await call("hdc_log", { action: "fetch", target, faultlog_name: name }),
      );
    return result;
  });
  const bytes = await readArtifact(fetched.artifact.artifact_id);
  fs.writeFileSync(path.join(root, "faultlog.private.txt"), bytes, {
    mode: 0o600,
  });
  const content = bytes.toString("utf8"),
    expectedKind =
      /^Error name:\s*(\w+Error)\s*$/m.exec(content)?.[1] ??
      /^Error name:\s*(Error)\s*$/m.exec(content)?.[1],
    expectedMessage = /^Error message:\s*(.*)$/m.exec(content)?.[1],
    expectedCode = /^Error code:\s*(.*)$/m.exec(content)?.[1];
  assert.ok(
    expectedKind && expectedMessage,
    "Selected file must contain a reported JS exception",
  );
  const input = { target, faultlog_name: name, bundle_name: bundle };
  const submitted = await observe("crash_workflow_submit", () =>
    call("workflow_run", {
      action: "start",
      workflow: "crash_diagnose",
      request_key: "named-real-fault",
      input,
    }),
  );
  const { run_id } = z.object({ run_id: z.string() }).parse(submitted);
  const completed = await observe(
    "crash_original_evidence_and_cases",
    async () => {
      const status = await wait(run_id);
      const output = z.object({ match_cases: z.unknown() }).parse(status.result);
      const artifact = z.object({ result_artifact: z.object({
        artifact_id: z.string(), bytes: z.number().int().positive(), mime: z.string(),
      }) }).safeParse(output.match_cases);
      if (artifact.success) {
        const data = await readArtifact(artifact.data.result_artifact.artifact_id);
        assert.equal(data.length, artifact.data.result_artifact.bytes);
        output.match_cases = JSON.parse(data.toString("utf8")) as unknown;
      }
      const result = z
        .object({
          match_cases: z.object({
            diagnosis: z.object({
              status: z.literal("detected"),
              kind: z.literal(expectedKind),
              error_message: z.literal(expectedMessage),
              error_code: z.string().nullable(),
              bundle: z.literal(bundle),
              frames: z.array(z.string()).min(1),
              suspected_location: z.object({
                file: z.string().min(1),
                line: z.number().positive(),
                column: z.number().nullable(),
                raw: z.string(),
                file_verified: z.literal(false),
              }),
              event_count: z.literal(1),
              diagnosisComplete: z.literal(false),
            }),
            knowledge: z.object({
              source: z.literal("local"),
              status: z.literal(expectedKnowledge),
              matches: z
                .array(
                  z.object({
                    source_id: z.string().startsWith("arkts-runtime-fix/"),
                    source_line: z.number().positive(),
                    root_cause_verified: z.literal(false),
                  }),
                )
                .min(expectedKnowledge === "candidate_patterns" ? 1 : 0),
              references: z
                .array(
                  z.object({
                    source: z.literal("deveco-code"),
                    commit: z.string().regex(/^[a-f0-9]{40}$/),
                    sha256: z.string().regex(/^[a-f0-9]{64}$/),
                  }),
                )
                .min(1),
            }),
          }),
        })
        .parse(output);
      const location = result.match_cases.diagnosis.suspected_location;
      if (expectedKnowledge === "unlisted_subtype") assert.equal(result.match_cases.knowledge.matches.length, 0);
      assert.ok(content.includes(location.raw));
      assert.ok(location.raw.includes(location.file + ":" + location.line));
      if (expectedCode)
        assert.equal(result.match_cases.diagnosis.error_code, expectedCode);
      return {
        status,
        cpu_path_expected: content.length >= 128 * 1024,
        artifact_sha256: digest(bytes),
      };
    },
  );
  await observe("duplicate_submission", async () => {
    const duplicate = z.object({ run_id: z.literal(run_id) }).parse(
      await call("workflow_run", {
        action: "start",
        workflow: "crash_diagnose",
        request_key: "named-real-fault",
        input,
      }),
    );
    return duplicate;
  });
  await disconnect();
  await connect();
  await observe("persisted_result_and_artifact_after_reconnect", async () => {
    const reopened = statusSchema.parse(
      await call("workflow_run", { action: "status", run_id }),
    );
    assert.deepEqual(reopened, completed.status);
    assert.deepEqual(await readArtifact(fetched.artifact.artifact_id), bytes);
    return { run_id, status: reopened.status, artifact_sha256: digest(bytes) };
  });
  const after = evidenceIdentity();
  for (const field of [
    "runtime_sha256",
    "compiled_sha256",
    "package_lock_sha256",
    "resource_manifest_sha256",
    "upstream_lock_sha256",
  ] as const)
    assert.equal(after[field], tested[field]);
  finished = true;
} catch (error) {
  failure = errorResult(error);
  console.log("crash_acceptance: failed");
  process.exitCode = 1;
} finally {
  await disconnect();
  save();
}
