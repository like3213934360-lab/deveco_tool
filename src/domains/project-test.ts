import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { invariant, ToolError } from "../core/errors.js";
import { run } from "../core/proc.js";
import { toolCommand, sdkInfo } from "../core/toolchain.js";
import { fileSha256, walk } from "../core/files.js";
import { BuildOutputParser, inspectProject } from "./project.js";
import { openHdcTarget } from "../core/hdc-target.js";

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

/** SDK report generation can log an error yet exit zero. Scan once without loading the build log. */
export async function sdkCoverageFailure(logFile: string): Promise<string | undefined> {
  const stream = fs.createReadStream(logFile, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (/getInitCoverageData failed,\s*(?:SyntaxError|Error):/.test(line)) return line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 1200);
    }
  } finally { lines.close(); stream.destroy(); }
  return undefined;
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
  let target: string | undefined;
  if (input.kind === "instrument") {
    invariant(input.allow_data_reset === true, "DATA_RESET_REQUIRED", "SDK onDeviceTest uninstalls the application before testing and erases its data", undefined,
      "Use a dedicated test application and explicitly pass allow_data_reset=true");
    const { resolveTarget } = await import("./device.js");
    target = await resolveTarget(input.target, signal);
  }
  const reports = modules.map((m) => ({ module: m.name,
    result: path.join(m.root, `.test/default/intermediates/${kind}/coverage_data/test_result.txt`),
    coverage: path.join(m.root, `.test/default/outputs/${kind}/reports/coverageReport.json`) }));
  const before = new Map(reports.flatMap((r) => [r.result, r.coverage]).map((f) => [f, fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs]));
  const args = [input.kind === "local" ? "test" : "onDeviceTest", "-p", `module=${modules.map((m) => m.name).join(",")}`, "-p", `coverage=${input.coverage ?? true}`, "--no-daemon", ...(input.coverage !== false ? ["--no-parallel"] : [])];
  if (input.scope?.length) {
    invariant(input.scope.every((s) => /^[A-Za-z]\w*(?:#\w+)?$/.test(s)), "INVALID_INPUT", "scope entries must be suite or suite#method");
    args.push("-p", `scope=${input.scope.join(",")}`);
  }
  const log = artifactPath(), started = Date.now();
  const parser = new BuildOutputParser(project.root, 10);
  let compileFailed = false;
  let execution, route: Awaited<ReturnType<typeof openHdcTarget>> | undefined;
  try {
    if (target) route = await openHdcTarget(target);
    try {
      execution = await run(toolCommand("hvigor", args, project.root, route ? { OHOS_HDC_SERVER_PORT: String(route.port) } : undefined),
        { signal, timeoutMs: input.timeout_ms ?? 600000, logFile: log.file, allowFailure: true, onLine: (line) => {
          parser.line(line);
          if (/\bCOMPILE RESULT:\s*FAIL\b/.test(line)) compileFailed = true;
        } });
      route?.assertHealthy();
    } finally { await route?.close(); }
  }
  catch (error) {
    const artifact = fs.existsSync(log.file) ? await commitArtifact(log.id, log.file, "text/plain", jobId)
      : await saveArtifact(String(error), "text/plain", jobId);
    if (error instanceof ToolError) throw new ToolError(error.code, error.message, { ...error.details, log_artifact: artifact.artifact_id, target, routing: route?.routing });
    throw error;
  }
  const logArtifact = await commitArtifact(log.id, log.file, "text/plain", jobId);
  const context = { target, routing: route?.routing, log_artifact: logArtifact.artifact_id };
  const build = parser.finish();
  const compileTask = build.failed_tasks?.some((task) => /@(?:Compile\w*|UnitTestArkTS)$/.test(task));
  if (compileFailed || execution.code !== 0 && compileTask) {
    throw new ToolError("BUILD_FAILED", "SDK test compilation failed; tests did not complete", {
      ...context, stage: "compile", exit_code: execution.code, counts: build.counts,
      diagnostics: build.diagnostics.filter((d) => d.severity === "error").slice(0, 10), failed_tasks: build.failed_tasks,
    }, "Fix the compiler diagnostics before running tests again; read the full SDK log with job read artifact_id=" + logArtifact.artifact_id);
  }
  const coverageError = input.coverage !== false ? await sdkCoverageFailure(log.file) : undefined;
  const results = [];
  for (const report of reports) {
    const stat = fs.statSync(report.result, { throwIfNoEntry: false });
    const fresh = stat && stat.mtimeMs >= started - 1000 && stat.mtimeMs !== before.get(report.result);
    if (!fresh && execution.code !== 0) {
      throw new ToolError("TEST_EXECUTION_FAILED", "SDK test command failed before producing a fresh report", {
        ...context, module: report.module, exit_code: execution.code, failed_tasks: build.failed_tasks,
        diagnostics: build.diagnostics.filter((d) => d.severity === "error").slice(0, 10),
      }, "Read the SDK log to identify the failed task; no test result is verified");
    }
    invariant(fresh, "TEST_REPORT_MISSING", "SDK did not produce a fresh test report", { ...context, module: report.module, exit_code: execution.code });
    const raw = fs.readFileSync(report.result, "utf8");
    const artifact = await saveArtifact(raw, "text/plain", jobId);
    let parsed;
    try { parsed = parseTestReport(raw); }
    catch (error) { throw new ToolError("TEST_REPORT_INVALID", "SDK report accounting is incomplete", { report_artifact: artifact.artifact_id, log_artifact: logArtifact.artifact_id, reason: String(error) }); }
    let coverage;
    if (input.coverage !== false) {
      invariant(!coverageError, "SDK_COVERAGE_FAILED", "SDK coverage generation failed, regardless of its build exit code", { ...context, module: report.module, counts: parsed.counts, report_artifact: artifact.artifact_id, sdk_error: coverageError,
        init_coverage: path.join(path.dirname(path.dirname(report.result)), "init_coverage.json") }, "Inspect the SDK generator error; do not repair generated JSON or treat a clean retry as resolving the original fault");
      const cstat = fs.statSync(report.coverage, { throwIfNoEntry: false });
      invariant(cstat && cstat.mtimeMs >= started - 1000 && cstat.mtimeMs !== before.get(report.coverage), "TEST_REPORT_MISSING", "SDK did not produce fresh coverage", { ...context, module: report.module, counts: parsed.counts, report_artifact: artifact.artifact_id });
      const rawCoverage = fs.readFileSync(report.coverage, "utf8");
      let data;
      try { data = JSON.parse(rawCoverage); }
      catch (error) { throw new ToolError("TEST_REPORT_INVALID", "SDK coverage report is invalid JSON", { ...context, module: report.module, reason: String(error), coverage_file: report.coverage }); }
      invariant(data && data.summary && Array.isArray(data.files), "TEST_REPORT_INVALID", "Unrecognized SDK coverage report");
      coverage = { summary: data.summary, sha256: await fileSha256(report.coverage), artifact_id: (await saveArtifact(rawCoverage, "application/json", jobId)).artifact_id };
    }
    results.push({ module: report.module, ...parsed, report_artifact: artifact.artifact_id, coverage });
  }
  const counts = results.reduce((sum, r) => ({ total: sum.total + r.counts.total, passed: sum.passed + r.counts.passed,
    failed: sum.failed + r.counts.failed, errors: sum.errors + r.counts.errors, ignored: sum.ignored + r.counts.ignored }), { total: 0, passed: 0, failed: 0, errors: 0, ignored: 0 });
  invariant(!route || route.routing.commands > 0, "EVIDENCE_MISSING", "SDK produced reports without executing through the selected HDC target", { target, log_artifact: logArtifact.artifact_id });
  const executed = results.flatMap((r) => r.cases);
  const scopeMatches = !input.scope?.length || (executed.every((c) => input.scope!.some((s) => s === c.suite || s === `${c.suite}#${c.name}`)) && input.scope.every((s) => executed.some((c) => s === c.suite || s === `${c.suite}#${c.name}`)));
  const verdict = execution.code !== 0 || counts.failed || counts.errors ? "failed"
    : !scopeMatches || counts.total === 0 || counts.ignored || (input.expected_tests !== undefined && counts.total !== input.expected_tests) ? "inconclusive" : "passed";
  return { verdict, kind: input.kind, scope_matches: scopeMatches, counts, discovered, expected_tests: input.expected_tests, results, sdk: sdkInfo(), target,
    routing: route?.routing,
    coverage_build: input.coverage !== false ? "serial" : undefined, data_reset: input.kind === "instrument", elapsed_ms: execution.elapsedMs, exit_code: execution.code, log_artifact: logArtifact.artifact_id };
}
