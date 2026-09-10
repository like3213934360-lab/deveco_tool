import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";

const issue = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  rule: z.string(),
});
const metadata = z.object({
  success: z.boolean(),
  checkKind: z.literal("static-precheck"),
  compilationVerified: z.literal(false),
  checked_file_count: z.number().int().positive(),
  scan: z.object({
    mode: z.enum(["project", "files"]),
    source_roots: z.array(z.string()),
    source_bytes: z.number().int().nonnegative(),
  }),
  checks: z.object({
    project_metadata: z.literal("executed"),
    permissions: z.enum(["executed", "unavailable"]),
    app_resources: z.enum(["executed", "unavailable"]),
    arkui_syntax: z.literal("executed"),
    sdk: z.literal("executed"),
    system_resources: z.enum(["executed", "unavailable"]),
    router_pages: z.literal("executed"),
    model_version: z.enum(["executed", "unavailable"]),
  }),
  sdkConfiguration: z.object({
    runtimeOS: z.enum(["HarmonyOS", "OpenHarmony"]),
    compatibleSdkVersion: z.number().int().positive(),
    originCompatibleSdkVersion: z.union([z.string(), z.number()]),
    targetSdkVersion: z.union([z.string(), z.number()]).optional(),
  }),
  summary: z.object({
    errorCount: z.number().int().nonnegative(),
    warnCount: z.number().int().nonnegative(),
  }),
});
const rawReport = metadata.extend({ diagnostics: z.array(issue).max(100000) });
export const checkerPreviewSchema = metadata.extend({
  diagnostics: z
    .array(
      issue.extend({
        file: z.string().max(1024),
        message: z.string().max(2048),
        rule: z.string().max(256),
        truncated: z.boolean(),
      }),
    )
    .max(50),
  truncated: z.boolean(),
});

/** Validate the entire child result before previewing; a clipped tail cannot hide invalid diagnostics or a false success flag. */
export function parseCheckerReport(
  content: string,
): z.infer<typeof checkerPreviewSchema> {
  invariant(
    Buffer.byteLength(content) <= 16 * 1024 * 1024,
    "CHECKER_REPORT_TOO_LARGE",
    "Static preflight report exceeds 16 MiB",
  );
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    throw new ToolError(
      "CHECKER_REPORT_INVALID",
      "Static preflight report is not JSON",
    );
  }
  const parsed = rawReport.safeParse(input);
  invariant(
    parsed.success,
    "CHECKER_REPORT_INVALID",
    "Invalid static preflight report contract",
  );
  const { diagnostics, ...result } = parsed.data;
  const errors = diagnostics.filter((row) => row.severity === "error").length;
  invariant(
    result.summary.errorCount === errors &&
      result.summary.warnCount === diagnostics.length - errors &&
      result.success === (errors === 0),
    "CHECKER_REPORT_INVALID",
    "Static preflight counts or success flag disagree with diagnostics",
  );
  const preview: z.infer<typeof checkerPreviewSchema>["diagnostics"] = [];
  const clip = (value: string, max: number) =>
    value.length <= max ? value : value.slice(0, max).toWellFormed();
  let bytes = 2;
  for (const item of diagnostics) {
    if (preview.length === 50) break;
    const row = {
      ...item,
      file: clip(item.file, 1024),
      message: clip(item.message, 2048),
      rule: clip(item.rule, 256),
      truncated:
        item.file.length > 1024 ||
        item.message.length > 2048 ||
        item.rule.length > 256,
    };
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes > 24 * 1024) break;
    preview.push(row);
  }
  return {
    ...result,
    diagnostics: preview,
    truncated:
      preview.length < diagnostics.length ||
      preview.some((row) => row.truncated),
  };
}
