import fs from "node:fs";
import path from "node:path";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { invariant, ToolError } from "../core/errors.js";
import { run } from "../core/proc.js";
import { toolCommand, sdkInfo } from "../core/toolchain.js";
import { fileSha256, walk } from "../core/files.js";
import { inspectProject } from "./project.js";

export interface ProjectTestInput {
  project: string; product?: string; kind: "local" | "instrument"; modules?: string[]; scope?: string[];
  coverage?: boolean; target?: string; timeout_ms?: number; allow_data_reset?: boolean; expected_tests?: number;
}
export interface TestCase { suite: string; name: string; outcome: "passed" | "failed" | "error" | "ignored"; detail: string }

/** Parse the SDK's test_result.txt, cross-checking case results against its final accounting. */
export function parseTestReport(text: string) {
  const cases: TestCase[] = [];
  let suite = "", name = "", detail: string[] = [];
  const status = { Success: "passed", Failure: "failed", Error: "error", Ignore: "ignored" } as const;
  const summaries = [...text.matchAll(/^Tests run:\s*(\d+),\s*Failure:\s*(\d+),\s*Error:\s*(\d+),\s*Pass:\s*(\d+),\s*Ignore:\s*(\d+)\s*$/gm)];
  invariant(summaries.length === 1, "TEST_REPORT_INVALID", "Expected exactly one completed SDK test summary");
  for (const line of text.replaceAll("\r", "").split("\n")) {
    if (line.startsWith("class=")) suite = line.slice(6);
    else if (line.startsWith("test=")) {
      invariant(!name, "TEST_REPORT_INVALID", "A test started without finishing the preceding test");
      name = line.slice(5); detail = [];
    } else if (line.startsWith("result=")) {
      const outcome = status[line.slice(7) as keyof typeof status];
      invariant(suite && name && outcome, "TEST_REPORT_INVALID", "Unrecognized or orphaned test result");
      cases.push({ suite, name, outcome, detail: detail.join("\n") }); name = "";
    } else if (!line.startsWith("Tests run:") && name) detail.push(line);
  }
  invariant(!name, "TEST_REPORT_INVALID", "Unfinished test in SDK report");
  const [total, failed, errors, passed, ignored] = summaries[0]!.slice(1).map(Number) as [number, number, number, number, number];
  const counts = { total, passed, failed, errors, ignored };
  invariant(total === cases.length && total === passed + failed + errors + ignored
    && passed === cases.filter((c) => c.outcome === "passed").length && failed === cases.filter((c) => c.outcome === "failed").length
    && errors === cases.filter((c) => c.outcome === "error").length && ignored === cases.filter((c) => c.outcome === "ignored").length,
  "TEST_REPORT_INVALID", "SDK case results and summary disagree", { counts, cases: cases.length });
  return { counts, cases, verdict: failed || errors ? "failed" : !total || ignored ? "inconclusive" : "passed" };
}

/** Execute SDK tasks without treating BUILD SUCCESSFUL or exit zero as a test pass. */
export async function runProjectTests(input: ProjectTestInput, signal: AbortSignal, jobId?: string) {
  const project = inspectProject(input.project, input.product);
  invariant(project.product === "default", "CAPABILITY_UNAVAILABLE", "SDK test tasks support only the default product");
  invariant(input.kind !== "local" || process.platform !== "linux", "CAPABILITY_UNAVAILABLE", "The installed SDK Local Test previewer is not supported on Linux");
  const kind = input.kind === "local" ? "test" : "ohosTest";
  const modules = input.modules ? project.modules.filter((m) => input.modules!.includes(m.name))
    : project.modules.filter((m) => fs.existsSync(path.join(m.root, `src/${kind}`)));
  invariant(modules.length && (!input.modules || modules.length === new Set(input.modules).size), "INVALID_INPUT", "Select existing modules containing test sources");
  const discovered = modules.map((m) => ({ module: m.name, files: [...walk(path.join(m.root, `src/${kind}`))].filter((f) => /\.test\.ets$/.test(f)).map((f) => path.relative(project.root, f)) }));
  invariant(discovered.every((m) => m.files.length), "TESTS_MISSING", "Every selected module must contain test sources", { discovered });
  if (input.kind === "instrument") {
    invariant(input.allow_data_reset === true, "DATA_RESET_REQUIRED", "SDK onDeviceTest uninstalls the application before testing and erases its data", undefined,
      "Use a dedicated test application and explicitly pass allow_data_reset=true");
    const { listTargets, resolveTarget } = await import("./device.js");
    const target = await resolveTarget(input.target, signal), targets = await listTargets(signal);
    invariant(targets.length === 1 && targets[0] === target, "CAPABILITY_UNAVAILABLE", "SDK onDeviceTest has no target selector; exactly the selected device must be connected", { target, connected: targets });
  }
  const reports = modules.map((m) => ({ module: m.name,
    result: path.join(m.root, `.test/default/intermediates/${kind}/coverage_data/test_result.txt`),
    coverage: path.join(m.root, `.test/default/outputs/${kind}/reports/coverageReport.json`) }));
  const before = new Map(reports.flatMap((r) => [r.result, r.coverage]).map((f) => [f, fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs]));
  const args = [input.kind === "local" ? "test" : "onDeviceTest", "-p", `module=${modules.map((m) => m.name).join(",")}`, "-p", `coverage=${input.coverage ?? true}`, "--no-daemon"];
  if (input.scope?.length) {
    invariant(input.scope.every((s) => /^[A-Za-z]\w*(?:#\w+)?$/.test(s)), "INVALID_INPUT", "scope entries must be suite or suite#method");
    args.push("-p", `scope=${input.scope.join(",")}`);
  }
  const log = artifactPath(), started = Date.now();
  let execution;
  try { execution = await run(toolCommand("hvigor", args, project.root), { signal, timeoutMs: input.timeout_ms ?? 600000, logFile: log.file, allowFailure: true }); }
  catch (error) {
    const artifact = await commitArtifact(log.id, log.file, "text/plain", jobId);
    if (error instanceof ToolError) throw new ToolError(error.code, error.message, { ...error.details, log_artifact: artifact.artifact_id });
    throw error;
  }
  const logArtifact = await commitArtifact(log.id, log.file, "text/plain", jobId);
  const results = [];
  for (const report of reports) {
    const stat = fs.statSync(report.result, { throwIfNoEntry: false });
    invariant(stat && stat.mtimeMs >= started - 1000 && stat.mtimeMs !== before.get(report.result), "TEST_REPORT_MISSING", "SDK did not produce a fresh test report", { module: report.module, exit_code: execution.code, log_artifact: logArtifact.artifact_id });
    const raw = fs.readFileSync(report.result, "utf8");
    const artifact = await saveArtifact(raw, "text/plain", jobId);
    let parsed;
    try { parsed = parseTestReport(raw); }
    catch (error) { throw new ToolError("TEST_REPORT_INVALID", "SDK report accounting is incomplete", { report_artifact: artifact.artifact_id, log_artifact: logArtifact.artifact_id, reason: String(error) }); }
    let coverage;
    if (input.coverage !== false) {
      const cstat = fs.statSync(report.coverage, { throwIfNoEntry: false });
      invariant(cstat && cstat.mtimeMs >= started - 1000 && cstat.mtimeMs !== before.get(report.coverage), "TEST_REPORT_MISSING", "SDK did not produce fresh coverage", { module: report.module, counts: parsed.counts, report_artifact: artifact.artifact_id, log_artifact: logArtifact.artifact_id });
      const rawCoverage = fs.readFileSync(report.coverage, "utf8"), data = JSON.parse(rawCoverage);
      invariant(data.summary && Array.isArray(data.files), "TEST_REPORT_INVALID", "Unrecognized SDK coverage report");
      coverage = { summary: data.summary, sha256: await fileSha256(report.coverage), artifact_id: (await saveArtifact(rawCoverage, "application/json", jobId)).artifact_id };
    }
    results.push({ module: report.module, ...parsed, report_artifact: artifact.artifact_id, coverage });
  }
  const counts = results.reduce((sum, r) => ({ total: sum.total + r.counts.total, passed: sum.passed + r.counts.passed,
    failed: sum.failed + r.counts.failed, errors: sum.errors + r.counts.errors, ignored: sum.ignored + r.counts.ignored }), { total: 0, passed: 0, failed: 0, errors: 0, ignored: 0 });
  const executed = results.flatMap((r) => r.cases);
  const scopeMatches = !input.scope?.length || (executed.every((c) => input.scope!.some((s) => s === c.suite || s === `${c.suite}#${c.name}`)) && input.scope.every((s) => executed.some((c) => s === c.suite || s === `${c.suite}#${c.name}`)));
  const verdict = execution.code !== 0 || counts.failed || counts.errors ? "failed"
    : !scopeMatches || counts.total === 0 || counts.ignored || (input.expected_tests !== undefined && counts.total !== input.expected_tests) ? "inconclusive" : "passed";
  return { verdict, kind: input.kind, scope_matches: scopeMatches, counts, discovered, expected_tests: input.expected_tests, results, sdk: sdkInfo(), target: input.target,
    data_reset: input.kind === "instrument", elapsed_ms: execution.elapsedMs, exit_code: execution.code, log_artifact: logArtifact.artifact_id };
}
