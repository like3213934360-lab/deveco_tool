import { z } from "zod";
import { digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";

// The frozen pre-migration gateway only generated signing configuration. It
// did not expose the new read-only inspect operation. This is an audited,
// exact-contract exception, never a caller-selected waiver for a slow tool.
export const baselineAbsenceSchema = z.strictObject({
  commit: z.literal("aab1405b51e00e4036bdc8f18ae4229835de77b0"),
  tool: z.literal("app_signature"),
  input_schema_sha256: z.literal("124a1f18235f92083b33c3163c8542a334f24df4b80eaa01626d2d42115be68d"),
  reason: z.literal("new_read_only_inspect_action"),
});
export function confirmBaselineAbsence(commit: string, tools: { name: string; inputSchema: unknown }[]) {
  const matching = tools.filter((tool) => tool.name === "app_signature");
  invariant(matching.length === 1, "BENCHMARK_BASELINE_CONTRACT", "The audited baseline signing tool must occur exactly once");
  return baselineAbsenceSchema.parse({ commit, tool: "app_signature", input_schema_sha256: digest(matching[0]!.inputSchema), reason: "new_read_only_inspect_action" });
}
