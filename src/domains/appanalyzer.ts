import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { artifactDir, artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { inside } from "../core/files.js";
import { run } from "../core/proc.js";
import { toolCommand, toolchain } from "../core/toolchain.js";
import { deviceSummary } from "./device.js";
import { checkedCommand, parseForeground } from "./device-controls.js";

const uxOptions = {
  scenes: z.array(z.enum(["S14", "S15", "S16", "S17", "S18"])).min(1).max(5).optional(),
  packages: z.array(z.string().min(1)).min(1).max(20).optional(),
};
export const analyzerOptions = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ux"), ...uxOptions }).strict(),
  z.object({ mode: z.literal("power") }).strict(),
  z.object({ mode: z.literal("auto"), scope: z.enum(["ux", "power", "both"]), minutes: z.number().int().min(5).max(240).optional(), ...uxOptions }).strict(),
]).superRefine((value, ctx) => {
  if (value.mode === "power") return;
  if (value.mode === "auto" && value.scope === "power" && (value.scenes || value.packages))
    ctx.addIssue({ code: "custom", message: "UX scenes and packages require UX analysis" });
  if (value.scenes && value.packages && !value.scenes.includes("S18"))
    ctx.addIssue({ code: "custom", message: "HAP icon analysis requires scene S18" });
});

const reportSchema = z.object({
  reportVersion: z.string().min(1), taskId: z.string().min(1), bundleName: z.string(),
  uxIssues: z.array(z.record(z.string(), z.unknown())).optional(), powerIssues: z.array(z.record(z.string(), z.unknown())).optional(),
});

export function analyzerReport(raw: string, bundle: string, scope: "ux" | "power" | "both") {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) { throw new ToolError("EVIDENCE_MISSING", "AppAnalyzer result.json is not valid JSON", { cause: errorResult(error) }); }
  const result = reportSchema.safeParse(value);
  invariant(result.success && result.data.bundleName === bundle, "EVIDENCE_MISSING", "AppAnalyzer report is invalid or belongs to a different bundle");
  const { uxIssues, powerIssues, taskId, reportVersion } = result.data;
  invariant((scope === "power" || uxIssues) && (scope === "ux" || powerIssues), "EVIDENCE_MISSING", "AppAnalyzer report is missing the requested issue arrays", { scope });
  const issueCount = (scope !== "power" ? uxIssues!.length : 0) + (scope !== "ux" ? powerIssues!.length : 0);
  return { verdict: issueCount ? "failed" as const : "passed" as const, task_id: taskId, report_version: reportVersion,
    ux_issues: uxIssues?.length, power_issues: powerIssues?.length };
}

export async function analyzeApp(project: { root: string; bundleName: string }, target: string, options: unknown, signal: AbortSignal, jobId?: string) {
  const selected = analyzerOptions.parse(options), toolchainInfo = toolchain();
  invariant(toolchainInfo.components.appanalyzer, "CAPABILITY_UNAVAILABLE", "The selected CLT does not contain AppAnalyzer", undefined, "Use doctor to check the CLT installation");
  invariant(process.platform !== "win32", "CAPABILITY_UNAVAILABLE", "AppAnalyzer batch launcher needs Windows execution support");
  const scope = selected.mode === "auto" ? selected.scope : selected.mode;
  const scenes = selected.mode === "power" ? undefined : selected.scenes;
  const packages = selected.mode === "power" ? undefined : selected.packages?.map((entry) => {
    const file = inside(project.root, entry);
    invariant(file.endsWith(".hap") && !file.includes(",") && fs.lstatSync(file, { throwIfNoEntry: false })?.isFile(),
      "INVALID_INPUT", "Pass an existing project HAP path without a comma", { file });
    inside(fs.realpathSync(project.root), fs.realpathSync(file));
    return file;
  });
  if (scope !== "ux") {
    const help = await run(toolCommand("appanalyzer", selected.mode === "power" ? ["-h"] : ["autoAnalyze", "-h"], project.root), { signal, timeoutMs: 10000 });
    const capability = selected.mode === "power" ? /\bpowerAnalyze\b/ : /\bD04\b/;
    invariant(capability.test(help.stdout + help.stderr), "CAPABILITY_UNAVAILABLE", "The selected AppAnalyzer does not advertise the requested power check");
  }
  if (scope !== "ux") invariant(!(await deviceSummary(target, signal)).emulator, "CAPABILITY_UNAVAILABLE", "AppAnalyzer power checks require a physical device");
  const foreground = parseForeground(await checkedCommand(target, ["aa", "dump", "-l"], signal));
  invariant(foreground.some((entry) => entry.bundle === project.bundleName), "CONFLICT", "Open the selected app in the foreground before AppAnalyzer", { bundle: project.bundleName });
  const mode = { ux: "uxAnalyze", power: "powerAnalyze", auto: "autoAnalyze" }[selected.mode];
  const minutes = selected.mode === "auto" ? selected.minutes ?? 10 : undefined;
  const output = fs.mkdtempSync(path.join(artifactDir(), "appanalyzer-")), log = artifactPath();
  try {
    const ux = scenes ? [...new Set(scenes)] : ["D03"];
    const scene = (scope === "power" ? ["D04"] : scope === "both" ? [...ux, "D04"] : ux).join(",");
    const args = [mode, "-b", project.bundleName, "-p", project.root, "-d", target, "-s", scene, "-o", output,
      ...(minutes === undefined ? [] : ["-t", String(minutes)]), ...(packages ? ["-m", [...new Set(packages)].join(",")] : [])];
    const result = await run(toolCommand("appanalyzer", args, project.root), { signal, allowFailure: true, timeoutMs: ((minutes ?? 3) + 5) * 60000, logFile: log.file });
    invariant(result.code === 0, "APPANALYZER_FAILED", "AppAnalyzer exited unsuccessfully", { exit_code: result.code });
    const base = path.join(output, "appanalyzer");
    invariant(fs.lstatSync(base, { throwIfNoEntry: false })?.isDirectory(), "EVIDENCE_MISSING", "AppAnalyzer output directory is missing");
    const directories = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{8}_\d{6}$/.test(entry.name));
    invariant(directories.length === 1, "EVIDENCE_MISSING", "Expected one new AppAnalyzer report directory", { count: directories.length });
    const directory = path.join(base, directories[0]!.name), report = path.join(directory, "result.json");
    const stat = fs.lstatSync(report, { throwIfNoEntry: false });
    invariant(stat?.isFile() && stat.size > 0 && stat.size <= 32 * 1024 * 1024, "EVIDENCE_MISSING", "AppAnalyzer did not produce a complete bounded result.json");
    const raw = fs.readFileSync(report, "utf8"), summary = analyzerReport(raw, project.bundleName, scope);
    const data = await saveArtifact(raw, "application/json", jobId);
    const zip = path.join(directory, "report.zip"), zipInfo = fs.lstatSync(zip, { throwIfNoEntry: false });
    let archive;
    if (zipInfo?.isFile() && zipInfo.size > 0) {
      archive = artifactPath("application/zip");
      fs.renameSync(zip, archive.file);
      await commitArtifact(archive.id, archive.file, "application/zip", jobId);
    }
    return { ...summary, scope, mode: selected.mode, scenes: scene.split(","), report_artifact: data.artifact_id, archive_artifact: archive?.id,
      log_artifact: (await commitArtifact(log.id, log.file, "text/plain", jobId)).artifact_id };
  } catch (error) {
    const artifact = fs.existsSync(log.file) ? await commitArtifact(log.id, log.file, "text/plain", jobId) : undefined;
    const detail = errorResult(error);
    throw new ToolError(detail.code, detail.message, { ...detail.details, log_artifact: artifact?.artifact_id });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}
