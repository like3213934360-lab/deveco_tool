import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ProcessService } from "../core/process.js";
import {
  discoverToolchain,
  component,
  toolCommand,
} from "../core/toolchain.js";
import { invariant } from "../core/errors.js";
import { privateDirectory, readObject, atomicWrite } from "../core/files.js";
import { StateStore } from "../core/store.js";
import type { Project } from "./project.js";
import { ProjectService } from "./project.js";
import { LanguageService } from "./lsp.js";
import { z } from "zod";
import { StringDecoder } from "node:string_decoder";
import { apiReport } from "../core/csv.js";

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
  ) {
    this.lsp = new LanguageService(processes);
  }
  async arkts(
    project: Project,
    files?: string[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const directory = path.join(this.store.root, "tmp", crypto.randomUUID());
    privateDirectory(directory);
    const input = path.join(directory, "input.json"),
      output = path.join(directory, "output.json");
    atomicWrite(
      input,
      JSON.stringify({
        project_path: project.root,
        product: project.product.name,
        files,
      }),
    );
    try {
      await this.processes.run(
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
        fs.existsSync(output),
        "CHECKER_NO_RESULT",
        "SDK checker did not return a result",
      );
      return JSON.parse(fs.readFileSync(output, "utf8")) as unknown;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  async lint(
    project: Project,
    input: {
      path?: string;
      fix?: boolean;
      incremental?: boolean;
      config_path?: string;
    },
    signal?: AbortSignal,
  ) {
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
      directory = path.join(this.store.root, "tmp", crypto.randomUUID());
    privateDirectory(directory);
    const report = path.join(directory, "report.json");
    const args = [
      toolchain.sdk,
      "--config",
      path.resolve(project.root, input.config_path ?? "code-linter.json5"),
      "--product",
      project.product.name,
      "--format",
      "json",
      "--output",
      report,
    ];
    if (input.fix) args.push("--fix");
    if (input.incremental) args.push("--incremental");
    args.push(path.resolve(project.root, input.path ?? "."));
    try {
      const command = toolCommand(toolchain, "linter", args, project.root);
      command.env = {
        ...command.env,
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
      const result = await this.processes.run(command, {
        signal,
        timeoutMs: 180000,
        allowFailure: true,
      });
      invariant(
        fs.existsSync(report),
        "LINT_NOT_EXECUTED",
        `Linter produced no report: ${result.stderr || result.stdout}`,
      );
      const parsed = z
        .array(z.record(z.string(), z.unknown()))
        .parse(JSON.parse(fs.readFileSync(report, "utf8")) as unknown);
      invariant(
        result.exitCode === 0 || parsed.length > 0,
        "LINT_TOOL_FAILED",
        "Linter failed without diagnostic findings",
      );
      return {
        checkKind: "linter",
        compilationVerified: false,
        exitCode: result.exitCode,
        report: parsed,
        artifact: this.store.artifact(
          "diagnostics",
          fs.readFileSync(report),
          "application/json",
        ),
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
      directory = path.join(this.store.root, "tmp", crypto.randomUUID());
    privateDirectory(directory);
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
      const files = input.files.map((file) => path.resolve(project.root, file));
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
    try {
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
            artifact: this.store.artifact("compatibility", csv, "text/csv"),
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
          "compatibility",
          JSON.stringify(findings),
          "application/json",
        ),
        reports: parsed.map((report) => report.artifact),
        log: result.log,
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}
