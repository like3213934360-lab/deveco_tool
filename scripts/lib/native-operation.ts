import fs from "node:fs";
import { z } from "zod";
import type { Runtime } from "../../src/services/runtime.js";
import { atomicWrite, digest } from "../../src/core/files.js";
import { invariant, ToolError } from "../../src/core/errors.js";

const receiptSchema = z.strictObject({
  format: z.literal(1), input_sha256: z.string(), request_key: z.string(),
  run_id: z.string().uuid().optional(), status: z.string(),
});
/** Private acceptance receipt. Reopening only observes the same task; it never
 * resumes, cancels or submits a second effect after an ambiguous response. */
export async function nativeOperation(runtime: Pick<Runtime, "call">, tool: "app_signature" | "hot_reload" | "emulator_manage" | "emulator_scenario", input: Record<string, unknown>, file: string, timeoutMs = 600000): Promise<unknown> {
  invariant(!Object.hasOwn(input, "request_key"), "ACCEPTANCE_REQUEST_KEY", "Acceptance owns its persistent request key");
  const identity = digest({ tool, input });
  const existed = fs.existsSync(file);
  const receipt = existed
    ? receiptSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
    : receiptSchema.parse({ format: 1, input_sha256: identity, request_key: `acceptance:${digest({ file, identity })}`, status: "prepared" });
  invariant(receipt.input_sha256 === identity, "ACCEPTANCE_INPUT_CHANGED", "Recorded operation input changed");
  const save = () => atomicWrite(file, JSON.stringify(receipt, null, 2));
  if (!receipt.run_id) {
    invariant(!existed, "ACCEPTANCE_SUBMISSION_UNKNOWN", "Submission may have reached the runtime; reconcile the recorded request key before proceeding");
    save();
    const submitted = z.object({ run_id: z.string().uuid(), status: z.string() }).parse(await runtime.call(tool, { ...input, request_key: receipt.request_key }));
    receipt.run_id = submitted.run_id; receipt.status = submitted.status; save();
  }
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const status = z.object({ run_id: z.string(), status: z.string(), result: z.unknown(), error: z.unknown().optional() }).parse(await runtime.call("workflow_run", { action: "status", run_id: receipt.run_id, wait_ms: Math.min(20000, Math.max(1, Math.floor(deadline - performance.now()))) }));
    invariant(status.run_id === receipt.run_id, "ACCEPTANCE_RUN_MISMATCH", "Status belongs to another operation");
    receipt.status = status.status; save();
    if (status.status === "succeeded") {
      let result = z.object({ execute_native_operation: z.unknown() }).parse(status.result).execute_native_operation;
      if (result && typeof result === "object" && "result_artifact" in result) {
        const ref = z.object({ result_artifact: z.object({ artifact_id: z.string().uuid(), bytes: z.number().int().positive().max(8 * 1024 * 1024) }) }).parse(result).result_artifact;
        const chunks: Buffer[] = [];
        for (let offset = 0; offset < ref.bytes;) {
          const page = z.object({ bytes: z.number(), data: z.string(), next_offset: z.number().int() }).parse(await runtime.call("workflow_run", { action: "read_artifact", artifact_id: ref.artifact_id, offset, limit: 65536 }));
          const chunk = Buffer.from(page.data, "base64");
          invariant(page.bytes === ref.bytes && page.next_offset === offset + chunk.length && page.next_offset > offset && page.next_offset <= ref.bytes, "ACCEPTANCE_ARTIFACT_INVALID", "Result artifact pagination changed");
          chunks.push(chunk); offset = page.next_offset;
        }
        result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      }
      return result;
    }
    if (["failed", "cancelled", "needs_input", "interrupted"].includes(status.status)) throw new ToolError("ACCEPTANCE_OPERATION_INCOMPLETE", "Native operation did not complete; inspect its durable task before any further effect", { run_id: receipt.run_id, status: status.status });
    invariant(["queued", "running", "cancelling"].includes(status.status), "ACCEPTANCE_STATUS_UNKNOWN", "Unknown operation status");
  }
  throw new ToolError("ACCEPTANCE_OPERATION_TIMEOUT", "Task remains observable; timeout does not authorize repeating the effect", { run_id: receipt.run_id });
}
