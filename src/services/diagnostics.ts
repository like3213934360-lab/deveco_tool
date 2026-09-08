import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessService } from "../core/process.js";
import {
  discoverToolchain,
  component,
  toolCommand,
} from "../core/toolchain.js";
import { invariant, ToolError, errorResult } from "../core/errors.js";
import { readObject, atomicWrite } from "../core/files.js";
import { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import { NativeDirectory } from "../core/native-directory.js";
import type { Project } from "./project.js";
import { ProjectService, projectTargets } from "./project.js";
import { LanguageService } from "./lsp.js";
import { z } from "zod";
import { StringDecoder } from "node:string_decoder";
import { apiReport } from "../core/csv.js";
import type { CpuPool } from "../core/cpu-pool.js";
import { parseLintReport } from "./lint-report.js";
import { lintInput } from "./lint-input.js";
import { parseCheckerReport } from "./checker-report.js";

export function apiVersions(scanner: string): string[] {
  const directory = path.join(path.dirname(scanner), "resources/apiChange");
  invariant(
    fs.existsSync(directory),
    "API_VERSION_DATA_MISSING",
    "API scanner change data is missing",
  );
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".json"));
  invariant(
    files.length > 0,
    "API_VERSION_DATA_EMPTY",
    "API scanner has no version change data",
  );
  for (const file of files)
    invariant(
      /^HarmonyOS_\d+\.\d+\.\d+\(\d+\)_(?:Release|Beta\d+)\.json$/.test(
        file.name,
      ) && fs.statSync(path.join(directory, file.name)).size > 0,
      "API_VERSION_DATA_INVALID",
      `Unrecognized or empty API change data: ${file.name}`,
    );
  // The modern scanner declares API 12 as its initial source without a change
  // file. Do not invent later versions or report this baseline for empty data.
  return [
    ...new Set([
      "HarmonyOS_5.0.0(12)_Release",
      ...files.map((file) => file.name.slice(0, -5)),
    ]),
  ].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export class DiagnosticService {
  readonly lsp: LanguageService;
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    readonly cpu?: CpuPool,
  ) {
    this.lsp = new LanguageService(processes, undefined, undefined, store);
  }
  async arkts(
    project: Project,
    files?: string[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const scope = new NativeDirectory(this.store, 16 * 1024 * 1024),
      directory = scope.file;
    return scope.execute(async (signal) => {
      const input = path.join(directory, "input.json"),
        output = path.join(directory, "output.json");
      atomicWrite(
        input,
        JSON.stringify({
          project_path: project.root,
          product: project.product.name,
          module_targets: projectTargets(project),
          files,
          cache_path: path.join(directory, "checker-cache"),
        }),
      );
      const result = await this.processes.run(
        {
          executable: component(discoverToolchain(), "node"),
          args: [
            fileURLToPath(new URL("../cli.js", import.meta.url)),
            "internal-check",
            input,
            output,
          ],
        },
        { signal, timeoutMs: 180000 },
      );
      invariant(
        result.exitCode === 0 && result.signal === null,
        "CHECKER_EXECUTION_FAILED",
        "SDK checker did not exit successfully",
      );
      invariant(
        fs.existsSync(output),
        "CHECKER_NO_RESULT",
        "SDK checker did not return a result",
      );
      const stat = await fs.promises.lstat(output);
      invariant(
        stat.isFile() && stat.size <= 16 * 1024 * 1024,
        "CHECKER_REPORT_INVALID",
        "Expected a regular static preflight report no larger than 16 MiB",
      );
      const content = await fs.promises.readFile(output, {
        encoding: "utf8",
        signal,
      });
      invariant(
        content.length <= 256 * 1024 || this.cpu,
        "CPU_POOL_REQUIRED",
        "Large diagnostic reports require the bounded parser pool",
      );
      const parsed =
        content.length > 256 * 1024
          ? await this.cpu!.run({ kind: "checker", content }, signal)
          : parseCheckerReport(content);
      signal.throwIfAborted();
      return {
        ...parsed,
        artifact: this.store.artifact(
          currentTrace().run_id ?? "diagnostics",
          content,
          "application/json",
        ),
      };
    }, signal);
  }
  async lint(
    project: Project,
    input: {
      path?: string;
      fix?: boolean;
      incremental?: boolean;
      config_path?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ) {
    const validated = await lintInput(project.root, input, signal);
    if (input.incremental)
      await this.processes.run(
        {
          executable: "git",
          args: ["rev-parse", "--is-inside-work-tree"],
          cwd: project.root,
        },
        { signal },
      );
    const toolchain = discoverToolchain(),
      scope = new NativeDirectory(this.store, 32 * 1024 * 1024),
      directory = scope.file;
    return scope.execute(async (signal) => {
      const report = path.join(directory, "report.json");
      const args = [
        ...(toolchain.kind === "clt" ? [toolchain.sdk] : []),
        "--config",
        validated.config,
        "--product",
        project.product.name,
        "--format",
        "json",
        "--output",
        report,
      ];
      if (input.fix) args.push("--fix");
      if (input.incremental) args.push("--incremental");
      args.push(validated.target);
      const command = toolCommand(toolchain, "linter", args, project.root);
      command.env = {
        ...command.env,
        // Select the current file-report contract, independent of IDE variables
        // inherited by the MCP host. This is the SDK's declared mode switch.
        isPlugin: "false",
        debuggerTriggerCodeLinter: "false",
        fixKeys: "",
        targets: "",
        isTooManyFiles: "false",
        logPath: path.join(directory, "codelinter.log"),
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
        PATH: [
          path.dirname(component(toolchain, "node")),
          toolchain.components.java
            ? path.dirname(toolchain.components.java)
            : "",
          process.env.PATH ?? "",
        ]
          .filter(Boolean)
          .join(path.delimiter),
      };
      // The current native CmdPrinter prints execution errors in ANSI red but
      // can still return 0 and write []. Inspect every chunk, including output
      // discarded from the bounded process tail. Code findings stay in JSON.
      const tails = { stdout: "", stderr: "" };
      let executionError = false;
      const result = await this.processes.run(command, {
        signal,
        timeoutMs: 180000,
        allowFailure: true,
        onOutput: (stream, chunk) => {
          const text = tails[stream] + chunk.toString("utf8");
          if (text.includes("\u001b[31m")) executionError = true;
          tails[stream] = text.slice(-8);
        },
      });
      // Keep bounded evidence for SDK engines before deleting their directory.
      const native_logs: {
        name: string;
        original_bytes: number;
        truncated: boolean;
        artifact: ReturnType<StateStore["artifact"]>;
      }[] = [];
      for (const name of [
        "codelinter.log",
        "arkPerfCheck.log",
        "hpauditor.log",
      ]) {
        const file = path.join(directory, name);
        if (!fs.existsSync(file)) continue;
        const stat = await fs.promises.lstat(file);
        invariant(
          stat.isFile(),
          "LINT_LOG_INVALID",
          "Expected a regular native log",
        );
        const handle = await fs.promises.open(file, "r"),
          data = Buffer.alloc(Math.min(stat.size, 65536));
        try {
          let read = 0;
          while (read < data.length) {
            const { bytesRead } = await handle.read(
              data,
              read,
              data.length - read,
              stat.size - data.length + read,
            );
            invariant(
              bytesRead > 0,
              "LINT_LOG_CHANGED",
              "Native log changed after process exit",
            );
            read += bytesRead;
          }
        } finally {
          await handle.close();
        }
        native_logs.push({
          name,
          original_bytes: stat.size,
          truncated: stat.size > data.length,
          artifact: this.store.artifact(
            currentTrace().run_id ?? "diagnostics",
            data,
          ),
        });
      }
      if (!fs.existsSync(report))
        throw new ToolError("LINT_NOT_EXECUTED", "Linter produced no report", {
          exit_code: result.exitCode,
          process_log: result.log,
          native_logs,
        });
      const stat = await fs.promises.lstat(report);
      invariant(
        stat.isFile(),
        "LINT_REPORT_INVALID",
        "Expected a regular linter report file",
      );
      invariant(
        stat.size <= 16 * 1024 * 1024,
        "LINT_REPORT_TOO_LARGE",
        "Expected a regular report file no larger than 16 MiB",
      );
      const content = await fs.promises.readFile(report, {
        encoding: "utf8",
        signal,
      });
      invariant(
        content.length <= 256 * 1024 || this.cpu,
        "CPU_POOL_REQUIRED",
        "Large diagnostic reports require the bounded parser pool",
      );
      let parsed: ReturnType<typeof parseLintReport>;
      try {
        parsed =
          content.length > 256 * 1024
            ? await this.cpu!.run(
                { kind: "lint", content, limit: input.limit ?? 50 },
                signal,
              )
            : parseLintReport(content, input.limit);
      } catch (error) {
        signal.throwIfAborted();
        const failure = errorResult(error);
        throw new ToolError(failure.code, failure.message, {
          artifact: this.store.artifact(
            currentTrace().run_id ?? "diagnostics",
            content,
            "application/json",
          ),
          process_log: result.log,
          native_logs,
        });
      }
      const artifact = this.store.artifact(
        currentTrace().run_id ?? "diagnostics",
        content,
        "application/json",
      );
      // No --exit-on is requested: modern native reports findings with exit 0.
      // A nonzero exit must never be converted to success by partial findings.
      if (result.exitCode !== 0 || result.signal !== null || executionError)
        throw new ToolError(
          "LINT_TOOL_FAILED",
          "Linter reported an execution failure; findings may be incomplete",
          {
            exit_code: result.exitCode,
            execution_error: executionError,
            summary: parsed.summary,
            artifact,
            process_log: result.log,
            native_logs,
          },
        );
      return {
        checkKind: "linter",
        compilationVerified: false,
        ruleCoverageVerified: false,
        exitCode: result.exitCode,
        ...parsed,
        artifact,
        native_logs,
      };
    }, signal);
  }
  versions(): string[] {
    return apiVersions(component(discoverToolchain(), "apiscan"));
  }
  async compatibility(
    project: Project,
    input: {
      source_version: string;
      target_version: string;
      files?: string[];
      modules?: string[];
    },
    signal?: AbortSignal,
  ) {
    const versions = this.versions();
    invariant(
      versions.includes(input.source_version) &&
        versions.includes(input.target_version),
      "API_VERSION_INVALID",
      "Choose source and target from available versions",
    );
    invariant(
      versions.indexOf(input.target_version) >
        versions.indexOf(input.source_version),
      "API_VERSION_ORDER",
      "Target must be later than source",
    );
    invariant(
      !(input.files && input.modules),
      "API_SCOPE_CONFLICT",
      "Select files or modules",
    );
    const toolchain = discoverToolchain(),
      scope = new NativeDirectory(this.store, 32 * 1024 * 1024),
      directory = scope.file;
    return scope.execute(async (signal) => {
      const args = [
        "--startVersion",
        input.source_version,
        "--endVersion",
        input.target_version,
        "--outputPath",
        directory,
        "--sdkPath",
        toolchain.sdk,
        "--nodePath",
        component(toolchain, "node"),
      ];
      if (input.files) {
        const files = input.files.map((file) =>
          path.resolve(project.root, file),
        );
        for (const file of files)
          invariant(fs.existsSync(file), "SOURCE_MISSING", file);
        const ets = files.filter((file) => file.endsWith(".ets")),
          cpp = files.filter((file) => /\.(c|cpp)$/.test(file));
        invariant(
          ets.length + cpp.length === files.length,
          "API_EXTENSION_INVALID",
          "API scan supports .ets/.c/.cpp",
        );
        if (ets.length) args.push("--arkTsFiles", ets.join(","));
        if (cpp.length) args.push("--cppFiles", cpp.join(","));
      } else if (input.modules) {
        const selected = project.modules.filter((module) =>
          input.modules!.includes(module.name),
        );
        invariant(
          selected.length === new Set(input.modules).size,
          "MODULE_INVALID",
          "Unknown modules",
        );
        args.push(
          "--modulePaths",
          selected.map((module) => module.root).join(","),
        );
      } else args.push("--projectPath", project.root);
      await new ProjectService(this.processes).build(
        project,
        { modules: input.modules, task: "compileNative" },
        signal,
      );
      const streams = new Map<
        string,
        { decoder: StringDecoder; tail: string }
      >();
      let failure: string | undefined,
        completed = false;
      const result = await this.processes.run(
        toolCommand(
          toolchain,
          "apiscan",
          args,
          path.dirname(component(toolchain, "apiscan")),
        ),
        {
          signal,
          timeoutMs: 600000,
          onOutput: (name, chunk) => {
            const stream = streams.get(name) ?? {
              decoder: new StringDecoder("utf8"),
              tail: "",
            };
            stream.tail += stream.decoder.write(chunk);
            failure ??=
              /(?:error\[\d+\]|Failed to (?:scan|compile)|(?:ArkTS|C\+\+) scan error)[^\r\n]{0,1000}/i.exec(
                stream.tail,
              )?.[0];
            completed ||= /API change scan completed, took: [\d.]+ s/.test(
              stream.tail,
            );
            stream.tail = stream.tail.slice(-2048);
            streams.set(name, stream);
          },
        },
      );
      invariant(
        !failure,
        "API_SCAN_FAILED",
        failure ?? "Native API scanner failed",
      );
      invariant(
        completed,
        "API_SCAN_UNCONFIRMED",
        "Native API scanner did not report completion",
      );
      const reports = fs
        .readdirSync(directory)
        .filter((file) => file.endsWith(".csv"));
      invariant(
        reports.length > 0,
        "API_SCAN_UNCONFIRMED",
        "Scanner did not produce its declared report",
      );
      const parsed = reports.map((file) => {
          const source = path.join(directory, file);
          invariant(
            fs.statSync(source).size <= 16 * 1024 * 1024,
            "API_REPORT_TOO_LARGE",
            "API report exceeds 16 MiB",
          );
          const csv = fs.readFileSync(source, "utf8");
          return {
            findings: apiReport(csv),
            artifact: this.store.artifact(
              currentTrace().run_id ?? "compatibility",
              csv,
              "text/csv",
            ),
          };
        }),
        findings = parsed.flatMap((report) => report.findings);
      return {
        scanExecuted: true,
        source_version: input.source_version,
        target_version: input.target_version,
        affected_locations: findings.length,
        findings: findings.slice(0, 100),
        normalized_report: this.store.artifact(
          currentTrace().run_id ?? "compatibility",
          JSON.stringify(findings),
          "application/json",
        ),
        reports: parsed.map((report) => report.artifact),
        log: result.log,
      };
    }, signal);
  }
}
