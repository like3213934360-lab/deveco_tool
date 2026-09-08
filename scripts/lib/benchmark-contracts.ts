import { z } from "zod";
import { requiredPerformance } from "./acceptance-requirements.js";
import { invariant } from "../../src/core/errors.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const assertionSchema = z.strictObject({ pointer: z.string().startsWith("/"), equals: z.unknown() });
export const benchmarkStepSchema = z.strictObject({
  tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()),
  assertions: z.array(assertionSchema).min(1),
  await_run: z.strictObject({ run_id_pointer: z.string().startsWith("/"), timeout_ms: z.number().int().min(1000).max(1200000).default(600000) }).optional(),
});
export const benchmarkPlanSchema = z.strictObject({
  format: z.literal(1), baseline_root: z.string().min(1), baseline_entry: z.string().min(1),
  baseline_commit: z.string().regex(/^[a-f0-9]{40}$/),
  environment: z.record(z.string(), z.string()).default({}),
  inputs: z.array(z.strictObject({ file: z.string().min(1), sha256: sha })).min(1),
  capabilities: z.array(z.strictObject({
    capability: z.enum(requiredPerformance), logical_input: z.record(z.string(), z.unknown()),
    native: z.array(benchmarkStepSchema).min(1), baseline: z.array(benchmarkStepSchema).min(1),
  })).length(requiredPerformance.length),
});
export function pointer(value: unknown, location: string): unknown {
  let current = value;
  for (const token of location.slice(1).split("/")) {
    invariant(current !== null && typeof current === "object", "BENCHMARK_ASSERTION_PATH", "Result assertion path does not exist");
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    invariant(Object.hasOwn(current, key), "BENCHMARK_ASSERTION_PATH", "Result assertion path does not exist");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export async function executeBenchmarkSteps(client: Client, steps: z.infer<typeof benchmarkStepSchema>[], signal?: AbortSignal) {
  const results: unknown[] = [];
  const call = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 180000, signal });
    invariant(!response.isError, "BENCHMARK_TOOL_FAILED", `Benchmark call failed: ${tool}`);
    if (response.structuredContent !== undefined) return response.structuredContent;
    const content = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(response.content);
    return JSON.parse(z.string().parse(content.find((item) => item.type === "text")?.text)) as unknown;
  };
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, "$result")) {
        const ref = z.strictObject({ $result: z.number().int().nonnegative(), pointer: z.string().startsWith("/") }).parse(record);
        invariant(ref.$result < results.length, "BENCHMARK_REFERENCE_INVALID", "Step references an unavailable previous result");
        return pointer(results[ref.$result], ref.pointer);
      }
      return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolve(item)]));
    }
    return value;
  };
  for (const step of steps) {
    let data = await call(step.tool, z.record(z.string(), z.unknown()).parse(resolve(step.arguments)));
    if (step.await_run) {
      const run_id = z.string().uuid().parse(pointer(data, step.await_run.run_id_pointer)), deadline = performance.now() + step.await_run.timeout_ms;
      for (;;) {
        signal?.throwIfAborted();
        invariant(performance.now() < deadline, "BENCHMARK_WORKFLOW_TIMEOUT", "Task did not complete; the benchmark will not repeat its effects");
        data = await call("workflow_run", { action: "status", run_id, wait_ms: Math.min(20000, Math.max(1, Math.floor(deadline - performance.now()))) });
        const state = z.object({ ok: z.literal(true), data: z.object({ run_id: z.string(), status: z.string() }) }).parse(data).data;
        invariant(state.run_id === run_id, "BENCHMARK_RUN_MISMATCH", "Workflow status belongs to another task");
        if (state.status === "succeeded") break;
        invariant(["queued", "running", "cancelling"].includes(state.status), "BENCHMARK_WORKFLOW_FAILED", "Task failed or needs reconciliation; no automatic replay is allowed");
      }
    }
    for (const assertion of step.assertions) invariant(JSON.stringify(pointer(data, assertion.pointer)) === JSON.stringify(assertion.equals), "BENCHMARK_RESULT_MISMATCH", `Benchmark result assertion failed: ${step.tool} ${assertion.pointer}`);
    results.push(data);
  }
  return results;
}
