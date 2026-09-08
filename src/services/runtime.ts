import fs from "node:fs";
import { inspectSnapshot } from "./ui-inspection.js";
import { findInSavedTree } from "./ui-import.js";
import { SavedUiTreeCache } from "./ui-import-cache.js";
import path from "node:path";
import { z } from "zod";
import {
  tools,
  workflowInputs,
  flowSchema,
  uiTaskSchema,
  recordingTaskSchema,
  type ToolName,
  type WorkflowName,
} from "../core/contracts.js";
import { workflowCatalog, workflowMetadata } from "../core/catalog.js";
import { configuration, release, protocolVersion } from "../core/config.js";
import {
  errorResult,
  invariant,
  object,
  text,
  ToolError,
} from "../core/errors.js";
import { fileDigest, digest, walk, destinationPath } from "../core/files.js";
import {
  discoverToolchain,
  component,
  type Component,
} from "../core/toolchain.js";
import { StateStore } from "../core/store.js";
import {
  captureFiles,
  capturedFileSchema,
  verifyCapturedFile,
} from "../core/captured-file.js";
import { CpuPool } from "../core/cpu-pool.js";
import { currentTrace } from "../core/trace.js";
import { ProcessService } from "../core/process.js";
import { PersistentProcessObserver } from "../core/process-observer.js";
import type {
  WorkflowEngine,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowStep,
  StepContext,
} from "../core/workflows.js";
import { ProjectService, inspectProject, type Project } from "./project.js";
import { DeviceService } from "./device.js";
import { DiagnosticService } from "./diagnostics.js";
import { parseCrash } from "./crash.js";
import { FlowService } from "./flow.js";
import { RecordingService } from "./recording.js";
import { LogService, readLogFile } from "./logs.js";
import { AuthService } from "./auth.js";
import { KnowledgeService } from "./knowledge.js";
import { SignatureService } from "./signature.js";
import { EmulatorService } from "./emulator.js";
import { HotReloadService } from "./hotreload.js";
import { inspectApplicationPackages } from "./package.js";
import { discoverAppRoutes, resolveAppRoute } from "./routes.js";
import {
  resolveNavigationGoal,
  validateFlowApplication,
  type NavigationChoice,
} from "./navigation.js";

function sourceHash(project: Project) {
  return digest(
    walk(project.root)
      .filter(
        (file) =>
          !file.includes(`${path.sep}.arkpilot${path.sep}`) &&
          !["patch.json", "oh-package-lock.json5"].includes(
            path.basename(file),
          ),
      )
      .map((file) => [path.relative(project.root, file), fileDigest(file)]),
  );
}
const artifactsSchema = z.array(
  z.object({ path: z.string(), sha256: z.string(), bytes: z.number() }),
);

export class Runtime {
  readonly store = new StateStore();
  readonly processes = new ProcessService(
    new PersistentProcessObserver(this.store),
  );
  readonly cpu = new CpuPool({}, (event) =>
    this.store.event(currentTrace().run_id ?? null, "cpu_parse", {
      ...currentTrace(),
      ...event,
    }),
  );
  readonly projects = new ProjectService(this.processes);
  readonly devices = new DeviceService(this.processes, this.store, this.cpu);
  readonly diagnostics = new DiagnosticService(
    this.processes,
    this.store,
    this.cpu,
  );
  readonly flows = new FlowService(this.devices, this.store);
  readonly recordings = new RecordingService(this.store, this.devices);
  readonly logs = new LogService(this.devices, this.store);
  readonly auth = new AuthService(this.store, this.processes);
  readonly knowledge = new KnowledgeService(this.store, this.auth);
  readonly signatures = new SignatureService(
    this.processes,
    this.store,
    this.auth,
  );
  readonly emulator = new EmulatorService(this.processes, this.store);
  readonly hot = new HotReloadService(
    this.processes,
    this.store,
    this.projects,
    this.devices,
    this.signatures,
    (target) => this.recordings.assertTaskTarget(target),
  );
  private engine?: Promise<WorkflowEngine>;
  private stopping = false;
  private shutdown?: Promise<{ closed: boolean }>;
  private savedTreeQueries = 0;
  readonly savedTrees = new SavedUiTreeCache();
  private workflows() {
    return (this.engine ??= (async () => {
      const { WorkflowEngine } = await import("../core/workflows.js");
      return new WorkflowEngine(
        this.store,
        this.definitions(),
        (context, workflow) => this.validate(context, workflow),
      );
    })());
  }
  private project(context: WorkflowContext) {
    return inspectProject(
      text(context.project_path, "project_path"),
      context.product,
    );
  }
  private output(call: StepContext, node: string): unknown {
    const result = call.outputs[node];
    if (!result || typeof result !== "object" || !("result_artifact" in result))
      return result;
    const reference = z
      .object({
        result_artifact: z.object({
          artifact_id: z.string(),
          bytes: z.number().max(8 * 1024 * 1024),
        }),
      })
      .parse(result).result_artifact;
    return JSON.parse(
      this.artifactText(reference.artifact_id, reference.bytes),
    ) as unknown;
  }
  private artifactText(id: string, max = 8 * 1024 * 1024) {
    const first = this.store.readArtifact(id, 0, 65536);
    invariant(
      first.bytes <= max,
      "ARTIFACT_TOO_LARGE",
      "Artifact exceeds this operation limit",
    );
    const chunks = [Buffer.from(first.data, "base64")];
    for (let offset = first.next_offset; offset < first.bytes;) {
      const part = this.store.readArtifact(id, offset, 65536);
      chunks.push(Buffer.from(part.data, "base64"));
      offset = part.next_offset;
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  private async capture(
    name: WorkflowName,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<WorkflowContext> {
    const parameters = workflowInputs[name].parse(raw),
      record = object(parameters),
      context: WorkflowContext = { parameters: record };
    const projectName =
        typeof record.project_path === "string"
          ? record.project_path
          : undefined,
      product = typeof record.product === "string" ? record.product : undefined;
    if (name === "project_create") {
      context.project_path = destinationPath(
        text(record.project_path, "project_path"),
      );
    } else if (name !== "app_deploy" && name !== "crash_diagnose") {
      const project = this.projects.resolve(projectName, product);
      context.project_path = project.root;
      context.product = project.product.name;
      context.project_hash = project.fingerprint;
      context.source_hash = sourceHash(project);
    }
    if (
      name === "app_deploy" ||
      name === "build_deploy_verify" ||
      (name === "crash_diagnose" &&
        !record.log_file &&
        !record.log_artifact_id &&
        record.log_text === undefined)
    )
      context.target = await this.devices.target(
        typeof record.target === "string" ? record.target : undefined,
        signal,
      );
    if (name !== "crash_diagnose" || context.target)
      context.toolchain_hash = digest(discoverToolchain());
    if (name === "crash_diagnose" && !context.target) {
      const input = workflowInputs.crash_diagnose.parse(record),
        content = input.log_file
          ? await readLogFile(input.log_file)
          : input.log_text !== undefined
            ? Buffer.from(input.log_text)
            : Buffer.from(
                this.artifactText(
                  text(input.log_artifact_id, "log_artifact_id"),
                ),
              );
      invariant(
        content.toString("utf8").trim(),
        "CRASH_EVIDENCE_MISSING",
        "Crash log is empty",
      );
      signal?.throwIfAborted();
      const artifact = this.store.artifact("workflow-input", content);
      context.input_artifacts = [artifact.artifact_id];
      delete record.log_file;
      delete record.log_text;
      record.log_artifact_id = artifact.artifact_id;
    }
    if (name === "app_deploy") {
      const input = workflowInputs.app_deploy.parse(record);
      const captured = await captureFiles(
        this.store,
        "workflow-input",
        input.packages,
        signal,
      );
      context.deployment = captured;
      context.input_artifacts = captured.map((file) => file.artifact_id);
      record.packages = captured.map((file) => ({
        path: file.path,
        sha256: file.sha256,
      }));
    }
    if (name === "build_deploy_verify" && record.flow_id) {
      const input = workflowInputs.build_deploy_verify.parse(record);
      context.flow = this.flows.validateInputs(
        this.flows.read(this.project(context), input.flow_id!),
        input.variables,
      );
      invariant(
        context.flow.app.bundleName === input.app.bundle_name &&
          (!input.app.module || context.flow.app.module === input.app.module) &&
          context.flow.app.ability === input.app.ability,
        "FLOW_APP_MISMATCH",
        "Saved flow targets a different application component",
      );
    }
    return context;
  }
  private async validate(context: WorkflowContext, workflow: string) {
    if (context.toolchain_hash)
      invariant(
        digest(discoverToolchain()) === context.toolchain_hash,
        "TOOLCHAIN_CHANGED",
        "Selected toolchain changed; start a new run",
      );
    if (context.project_hash) {
      const project = this.project(context);
      invariant(
        project.fingerprint === context.project_hash,
        "PROJECT_CHANGED",
        "Captured project configuration changed; start a new run",
      );
      invariant(
        sourceHash(project) === context.source_hash,
        "SOURCE_CHANGED",
        "Captured project sources changed; start a new run",
      );
    }
    if (context.target) {
      const recording = recordingTaskSchema.safeParse(context.parameters);
      if (
        ["ui_flow", "ui_record", "app_deploy", "build_deploy_verify"].includes(
          workflow,
        )
      )
        this.recordings.assertTaskTarget(
          context.target,
          recording.success ? recording.data.draft.id : undefined,
        );
      await this.devices.target(context.target);
    }
    if (context.flow)
      invariant(
        digest(this.flows.read(this.project(context), context.flow.id)) ===
          digest(context.flow),
        "FLOW_CHANGED",
        "Saved flow changed after submission; start a new run",
      );
    for (const file of context.deployment ?? []) await verifyCapturedFile(file);
  }
  private definitions(): WorkflowDefinition[] {
    const definitions: WorkflowDefinition[] = [];
    const define = (id: WorkflowName, steps: WorkflowStep[]) =>
      definitions.push({
        id,
        ...workflowMetadata[id],
        steps,
        resources: (context) => [
          ...(context.project_path ? [`project:${context.project_path}`] : []),
          ...(context.target ? [`device:${context.target}`] : []),
        ],
      });
    const effect = (
      id: string,
      execute: WorkflowStep["execute"],
      reconcile?: WorkflowStep["reconcile"],
    ): WorkflowStep => ({ id, kind: "effect", execute, reconcile });
    const read = (
      id: string,
      execute: WorkflowStep["execute"],
    ): WorkflowStep => ({ id, kind: "read", execute });
    // Existing saved flows and declared navigation are fixed internal jobs, managed
    // through workflow_run. They do not add a client-supplied workflow DSL/catalog entry.
    definitions.push({
      id: "ui_flow",
      description:
        "Execute a captured saved flow or a declared application route",
      capabilities: ["hdc", "uitest"],
      completion:
        "The original final assertion passes within the captured application",
      resources: (context) => [
        `project:${text(context.project_path, "project_path")}`,
        `device:${text(context.target, "target")}`,
      ],
      steps: [
        read("validate_ui_input", async (call) => {
          const input = uiTaskSchema.parse(call.context.parameters);
          if (input.kind === "flow") {
            invariant(
              call.context.flow,
              "FLOW_REQUIRED",
              "Captured flow is missing",
            );
            this.flows.validateInputs(call.context.flow, input.variables);
          }
          return { valid: true, kind: input.kind };
        }),
        effect("execute_ui_path", async (call) => {
          const input = uiTaskSchema.parse(call.context.parameters);
          if (input.kind === "route")
            return this.devices.launch(
              text(call.context.target, "target"),
              input.app,
              call.signal,
            );
          invariant(
            call.context.flow,
            "FLOW_REQUIRED",
            "Captured flow is missing",
          );
          return this.flows.run(
            this.project(call.context),
            call.context.flow.id,
            text(call.context.target, "target"),
            input.variables,
            call.signal,
            call.context.flow,
          );
        }),
        read("final_assertion", async (call) => {
          const input = uiTaskSchema.parse(call.context.parameters);
          const assertion =
            input.kind === "route" ? input.assert : call.context.flow?.assert;
          invariant(
            assertion,
            "FLOW_ASSERT_REQUIRED",
            "A final assertion is required",
          );
          return this.devices.verify(
            text(call.context.target, "target"),
            assertion,
            call.signal,
            input.kind === "route"
              ? input.app.bundle_name
              : call.context.flow!.app.bundleName,
          );
        }),
      ],
    });
    definitions.push({
      id: "ui_record",
      description:
        "Record accepted UI actions, wait for a declared final assertion, then save a validated flow",
      capabilities: ["hdc", "uitest"],
      completion:
        "Every recorded action has a durable receipt and the original final assertion passes before saving",
      resources: (context) => [
        `project:${text(context.project_path, "project_path")}`,
        `device:${text(context.target, "target")}`,
      ],
      steps: [
        read("initialize_recording", async (call) => {
          const { draft } = recordingTaskSchema.parse(call.context.parameters);
          this.flows.assertAvailable(this.project(call.context), draft.id);
          return this.recordings.initialize(
            call.run_id,
            text(call.context.target, "target"),
            draft,
          );
        }),
        effect("stop_recording_app", async (call) => {
          const { draft } = recordingTaskSchema.parse(call.context.parameters);
          if (draft.start.mode === "attach") return { skipped: true };
          await this.devices.shell(
            text(call.context.target, "target"),
            ["aa", "force-stop", draft.app.bundleName],
            call.signal,
          );
          return { stopped: true };
        }),
        effect("launch_recording_app", async (call) => {
          const { draft } = recordingTaskSchema.parse(call.context.parameters);
          return draft.start.mode === "attach"
            ? { skipped: true }
            : this.devices.launch(
                text(call.context.target, "target"),
                {
                  bundle_name: draft.app.bundleName,
                  module: draft.app.module,
                  ability: draft.app.ability,
                },
                call.signal,
              );
        }),
        read("recording_ready", async (call) => {
          const { draft } = recordingTaskSchema.parse(call.context.parameters);
          await this.devices.verify(
            text(call.context.target, "target"),
            { visible: { bundle_name: draft.app.bundleName }, timeoutMs: 5000 },
            call.signal,
            draft.app.bundleName,
          );
          return this.recordings.activate(call.run_id);
        }),
        {
          id: "await_recording_assertion",
          kind: "input",
          execute: async (call) => this.recordings.ready(call.run_id),
        },
        read("verify_recorded_outcome", async (call) => {
          const flow = this.recordings.flow(call.run_id);
          return this.devices.verify(
            text(call.context.target, "target"),
            flow.assert!,
            call.signal,
            flow.app.bundleName,
          );
        }),
        effect(
          "save_recorded_flow",
          async (call) =>
            this.flows.save(
              this.project(call.context),
              this.recordings.flow(call.run_id),
            ),
          async (call) => {
            const flow = this.recordings.flow(call.run_id);
            try {
              return digest(
                this.flows.read(this.project(call.context), flow.id),
              ) === digest(flow)
                ? { id: flow.id, saved: true }
                : undefined;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
              throw error;
            }
          },
        ),
        read("complete_recording", async (call) =>
          this.recordings.finish(call.run_id),
        ),
      ],
    });
    define("project_create", [
      read("validate_sdk", async () => {
        const toolchain = discoverToolchain();
        component(toolchain, "hvigor");
        return { sdk: toolchain.sdk, version: toolchain.version };
      }),
      effect(
        "create_project",
        async (call) =>
          this.projects.create(
            workflowInputs.project_create.parse(call.context.parameters),
            call.signal,
            call.run_id,
          ),
        async (call) =>
          this.projects.reconcileCreate(
            workflowInputs.project_create.parse(call.context.parameters),
            call.run_id,
          ),
      ),
      read("verify_project", async (call) => ({
        valid: true,
        project: inspectProject(
          text(call.context.project_path, "project_path"),
        ),
      })),
    ]);
    define("project_sync", [
      effect("sync_project", async (call) =>
        this.projects.sync(
          this.project(call.context),
          workflowInputs.project_sync.parse(call.context.parameters).install,
          call.signal,
        ),
      ),
      read("verify_model", async (call) => ({
        model: inspectProject(
          text(call.context.project_path, "project_path"),
          call.context.product,
        ),
      })),
    ]);
    const build: WorkflowStep[] = [
      effect("sync_project", async (call) =>
        call.context.parameters.sync
          ? this.projects.sync(this.project(call.context), true, call.signal)
          : { skipped: true },
      ),
      effect("build_project", async (call) =>
        this.projects.build(
          this.project(call.context),
          workflowInputs.project_build.parse(call.context.parameters),
          call.signal,
        ),
      ),
    ];
    const verifyArtifacts = read("verify_artifacts", async (call) => {
      const list = artifactsSchema.parse(
        object(this.output(call, "build_project")).artifacts,
      );
      for (const artifact of list)
        invariant(
          fileDigest(artifact.path) === artifact.sha256,
          "ARTIFACT_CHANGED",
          "Build artifact changed before verification",
        );
      return { artifacts: list };
    });
    define("project_build", [...build, verifyArtifacts]);
    define("app_deploy", [
      read("validate_artifact", async (call) => {
        const input = workflowInputs.app_deploy.parse(call.context.parameters);
        return {
          packages: capturedFileSchema.array().parse(call.context.deployment),
          identity: await inspectApplicationPackages(
            capturedFileSchema
              .array()
              .parse(call.context.deployment)
              .map((file) => file.path),
            input.app,
            call.signal,
          ),
        };
      }),
      effect("install_application", async (call) => {
        const input = workflowInputs.app_deploy.parse(call.context.parameters);
        return this.devices.install(
          text(call.context.target, "target"),
          capturedFileSchema.array().parse(call.context.deployment),
          input.app,
          call.signal,
        );
      }),
      effect("launch_application", async (call) => {
        const input = workflowInputs.app_deploy.parse(call.context.parameters);
        return this.devices.launch(
          text(call.context.target, "target"),
          input.app,
          call.signal,
        );
      }),
      read("verify_process", async (call) => this.verifyProcess(call)),
    ]);
    define("build_deploy_verify", [
      effect("build_or_hot_apply", async (call) => {
        const input = workflowInputs.build_deploy_verify.parse(
            call.context.parameters,
          ),
          project = this.project(call.context);
        if (input.hot_reload)
          return {
            hot_reload: true,
            result: await this.hot.call(
              { action: "apply", target: call.context.target },
              project,
              call.signal,
            ),
          };
        if (input.sync) await this.projects.sync(project, true, call.signal);
        return this.projects.buildApplication(project, input, call.signal);
      }),
      read("prepare_installation", async (call) => {
        const input = workflowInputs.build_deploy_verify.parse(
          call.context.parameters,
        );
        if (input.hot_reload)
          return { skipped: true, reason: "hot patch already applied" };
        const artifacts = artifactsSchema
          .parse(object(this.output(call, "build_or_hot_apply")).artifacts)
          .filter((a) => /-signed\.(hap|hsp)$/.test(a.path));
        invariant(
          artifacts.length > 0,
          "DEPLOY_ARTIFACT_MISSING",
          "Build did not produce signed application packages",
        );
        return captureFiles(this.store, call.run_id, artifacts, call.signal);
      }),
      effect("install_application", async (call) => {
        const input = workflowInputs.build_deploy_verify.parse(
          call.context.parameters,
        );
        if (input.hot_reload)
          return { skipped: true, reason: "hot patch already applied" };
        return this.devices.install(
          text(call.context.target, "target"),
          capturedFileSchema
            .array()
            .parse(this.output(call, "prepare_installation")),
          input.app,
          call.signal,
        );
      }),
      effect("launch_application", async (call) => {
        const input = workflowInputs.build_deploy_verify.parse(
          call.context.parameters,
        );
        if (input.hot_reload)
          return {
            skipped: true,
            reason: "hot patch preserves the running process",
          };
        return this.devices.launch(
          text(call.context.target, "target"),
          input.app,
          call.signal,
        );
      }),
      effect("execute_ui_path", async (call) => {
        const input = workflowInputs.build_deploy_verify.parse(
          call.context.parameters,
        );
        return input.flow_id
          ? this.flows.run(
              this.project(call.context),
              input.flow_id,
              text(call.context.target, "target"),
              input.variables,
              call.signal,
              call.context.flow,
            )
          : { skipped: true };
      }),
      read("final_assertion", async (call) =>
        this.devices.verify(
          text(call.context.target, "target"),
          workflowInputs.build_deploy_verify.parse(call.context.parameters)
            .assert,
          call.signal,
          workflowInputs.build_deploy_verify.parse(call.context.parameters).app
            .bundle_name,
        ),
      ),
    ]);
    define("code_diagnose", [
      read("collect_diagnostics", async (call) => {
        const input = workflowInputs.code_diagnose.parse(
            call.context.parameters,
          ),
          project = this.project(call.context),
          reports: Record<string, unknown> = {};
        for (const check of input.checks) {
          if (check === "arkts")
            reports[check] = await this.diagnostics.arkts(
              project,
              input.files,
              call.signal,
            );
          else if (check === "linter")
            reports[check] = await this.diagnostics.lint(
              project,
              {},
              call.signal,
            );
          else {
            const files =
              input.files ??
              walk(
                project.root,
                new Set(check === "cpp" ? [".cpp", ".c"] : [".ets"]),
              );
            invariant(
              files.length > 0,
              "DIAGNOSTICS_FILES_REQUIRED",
              "No matching source files",
            );
            const results: unknown[] = [];
            for (const file of files)
              results.push(
                await this.diagnostics.lsp.request(
                  project,
                  {
                    action: "diagnostics",
                    file,
                    language: check === "cpp" ? "cpp" : "arkts",
                  },
                  call.signal,
                ),
              );
            reports[check] = results;
          }
        }
        return reports;
      }),
      read("classify_and_match", async (call) => {
        const evidence = this.output(call, "collect_diagnostics");
        return {
          reports: evidence,
          compilationVerified: false,
          knowledge: this.knowledge.search(this.diagnosticTerms(evidence), 10),
        };
      }),
    ]);
    define("crash_diagnose", [
      read("collect_evidence", async (call) => {
        const input = workflowInputs.crash_diagnose.parse(
          call.context.parameters,
        );
        if (input.log_artifact_id)
          return { artifact: { artifact_id: input.log_artifact_id } };
        if (input.faultlog_name)
          return this.logs.fetch(
            text(call.context.target, "target"),
            input.faultlog_name,
            call.signal,
          );
        return this.logs.collect(
          text(call.context.target, "target"),
          {
            kind: input.kind ?? "crash",
            lines: input.lines ?? 4000,
            bundle_name: input.kind === "hilog" ? undefined : input.bundle_name,
            max_age_minutes: input.max_age_minutes,
          },
          call.signal,
        );
      }),
      read("parse_crash", async (call) => {
        const evidence = z
            .object({
              artifact: z.object({ artifact_id: z.string() }),
              truncated: z.boolean().optional(),
              selection_complete: z.boolean().optional(),
            })
            .parse(this.output(call, "collect_evidence")),
          input = workflowInputs.crash_diagnose.parse(call.context.parameters);
        const content = this.artifactText(evidence.artifact.artifact_id);
        const options = {
          bundle_name: input.bundle_name,
          process_hint: input.process_hint,
          truncated: evidence.truncated,
          selection_complete: evidence.selection_complete,
          faultlog_name: input.faultlog_name,
        };
        return content.length >= 128 * 1024
          ? this.cpu.run({ kind: "crash", content, options }, call.signal)
          : parseCrash(content, options);
      }),
      read("match_cases", async (call) => {
        const parsed = this.output(call, "parse_crash");
        return {
          diagnosis: parsed,
          knowledge: this.knowledge.search(String(object(parsed).kind), 10),
        };
      }),
    ]);
    define("api_compatibility", [
      effect("scan_compatibility", async (call) =>
        this.diagnostics.compatibility(
          this.project(call.context),
          workflowInputs.api_compatibility.parse(call.context.parameters),
          call.signal,
        ),
      ),
      read("normalize_report", async (call) =>
        this.output(call, "scan_compatibility"),
      ),
    ]);
    return definitions;
  }
  private diagnosticTerms(value: unknown) {
    const json = JSON.stringify(value);
    return (
      [
        ...new Set(
          json.match(/(?:arkts-[a-z-]+|[A-Za-z]+Error|TS\d{3,5})/g) ?? [],
        ),
      ]
        .slice(0, 6)
        .join(" ") || "ArkTS diagnostics"
    );
  }
  private async verifyProcess(call: StepContext) {
    const input = workflowInputs.app_deploy.parse(call.context.parameters),
      result = await this.devices.shell(
        text(call.context.target, "target"),
        ["pidof", input.app.bundle_name],
        call.signal,
      );
    invariant(
      /^\d+(?:\s+\d+)*$/.test(result.stdout.trim()),
      "APP_NOT_RUNNING",
      "Application process was not found",
    );
    return {
      processVerified: true,
      target: call.context.target,
      bundle_name: input.app.bundle_name,
    };
  }
  async call(
    name: ToolName,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    invariant(!this.stopping, "RUNTIME_STOPPING", "Runtime is stopping");
    signal?.throwIfAborted();
    switch (name) {
      case "workflow_catalog": {
        const input = tools[name].schema.parse(raw);
        return workflowCatalog(
          input.action === "get" ? input.workflow : undefined,
        );
      }
      case "workflow_run": {
        const input = tools[name].schema.parse(raw);
        if (input.action === "read_artifact")
          return this.store.readArtifact(
            text(input.artifact_id, "artifact_id"),
            input.offset,
            input.limit,
          );
        const engine = await this.workflows();
        if (input.action === "list") {
          const runs = engine.list(input.offset, input.limit ?? 100),
            total = this.store.runCount(),
            next = input.offset + runs.length;
          return {
            runs,
            total,
            offset: input.offset,
            next_offset: next < total ? next : null,
          };
        }
        if (input.action === "start") {
          invariant(
            input.workflow && input.input,
            "WORKFLOW_INPUT_REQUIRED",
            "workflow and input are required",
          );
          const identity = workflowInputs[input.workflow].parse(input.input);
          const previous = input.request_key
            ? this.store.byRequest(input.request_key)
            : undefined;
          if (previous) {
            invariant(
              previous.workflow === input.workflow &&
                previous.input_hash === digest(identity),
              "REQUEST_KEY_CONFLICT",
              "Request key already has different input",
            );
            return {
              run_id: previous.id,
              status: previous.status,
              deduplicated: true,
            };
          }
          const captured = await this.capture(input.workflow, identity, signal);
          try {
            return engine.start(
              input.workflow,
              captured,
              input.request_key,
              identity,
            );
          } finally {
            // Concurrent submissions can both capture files before one wins
            // the request-key transaction. Only unbound copies are discarded;
            // the winning run already owns its evidence in that transaction.
            if (captured.input_artifacts?.length)
              this.store.discardArtifacts(
                "workflow-input",
                captured.input_artifacts,
              );
          }
        }
        const id = text(input.run_id, "run_id");
        if (input.action === "status") return engine.status(id, input.wait_ms);
        if (input.action === "resume")
          return engine.resume(id, input.resume_input);
        return this.store.get(id).workflow === "ui_record"
          ? this.recordings.cancel(id, () => engine.cancel(id), signal)
          : engine.cancel(id);
      }
      case "switch_cwd":
        return this.projects.select(tools[name].schema.parse(raw).project_path);
      case "deveco_doctor": {
        const input = tools[name].schema.parse(raw);
        let toolchain: unknown, project: unknown, api_compatibility: unknown;
        try {
          toolchain = discoverToolchain();
        } catch (error) {
          toolchain = { error: errorResult(error) };
        }
        try {
          api_compatibility = { versions: this.diagnostics.versions() };
        } catch (error) {
          api_compatibility = { error: errorResult(error) };
        }
        try {
          project = this.projects.resolve(input.project_path, input.product);
        } catch (error) {
          const failure = errorResult(error);
          if (failure.code !== "PROJECT_REQUIRED") project = { error: failure };
        }
        return {
          release,
          execution_protocol: protocolVersion,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          state_dir: this.store.root,
          toolchain,
          api_compatibility,
          project: project ?? null,
          processes: this.processes.size,
          parsers: this.cpu.metrics,
          ui_cache: this.devices.cacheMetrics,
          saved_ui_cache: this.savedTrees.metrics,
          recovery_required: this.store
            .externalGuards()
            .map(({ id, kind, run_id, metadata }) => ({
              id,
              kind,
              run_id,
              metadata: JSON.parse(metadata) as unknown,
            })),
          validation:
            "Component detection only. See release evidence for tested platform/device capabilities.",
        };
      }
      case "harmony_auth": {
        const input = tools[name].schema.parse(raw);
        if (input.action === "login")
          return this.auth.login(input.provider, input.open_browser);
        if (input.action === "status") return this.auth.status(input.provider);
        if (input.action === "logout") return this.auth.logout(input.provider);
        invariant(
          input.provider === "developer",
          "AUTH_PROVIDER_INVALID",
          "Teams belong to developer authentication",
        );
        return this.auth.teams(signal);
      }
      case "harmony_knowledge": {
        const input = tools[name].schema.parse(raw);
        if (input.source === "cloud") {
          invariant(
            input.action === "search",
            "CLOUD_ACTION_INVALID",
            "Cloud supports explicit search",
          );
          return this.knowledge.cloud(text(input.query, "query"), signal);
        }
        if (input.action === "catalog")
          return this.knowledge.catalog(
            input.offset,
            input.limit ?? 50,
            input.kind,
            input.catalog,
          );
        if (input.action === "search")
          return this.knowledge.search(
            text(input.query, "query"),
            input.limit ?? 20,
            input.kind,
            input.catalog,
            input.offset,
          );
        return this.knowledge.read(
          text(input.id, "id"),
          input.offset,
          input.limit ?? 16384,
        );
      }
      case "arkts_check": {
        const input = tools[name].schema.parse(raw);
        return this.diagnostics.arkts(
          this.projects.resolve(input.project_path, input.product),
          input.files,
          signal,
        );
      }
      case "code_lint": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product);
        return this.store.lease(
          `project:${project.root}`,
          () => this.diagnostics.lint(project, input, signal),
          signal,
        );
      }
      case "lsp": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product);
        return this.diagnostics.lsp.request(project, input, signal);
      }
      case "check_cpp_files": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product),
          reports: unknown[] = [];
        for (const file of input.files)
          reports.push(
            await this.diagnostics.lsp.request(
              project,
              {
                action: "diagnostics",
                language: "cpp",
                file,
                abi: input.abi,
                mode: input.mode,
              },
              signal,
            ),
          );
        return { reports };
      }
      case "device_info": {
        const input = tools[name].schema.parse(raw);
        return input.list
          ? { targets: await this.devices.targets(signal) }
          : this.devices.info(input.target, signal);
      }
      case "hdc_log": {
        const input = tools[name].schema.parse(raw),
          target = await this.devices.target(input.target, signal);
        return this.store.lease(
          `device:${target}`,
          async () => {
            if (input.action === "probe")
              return this.logs.probe(target, input, signal);
            if (input.action === "fetch")
              return this.logs.fetch(target, input.faultlog_name!, signal);
            if (input.action === "clear")
              return this.logs.clear(target, signal);
            return this.logs.collect(target, input, signal);
          },
          signal,
        );
      }
      case "app_signature": {
        const input = tools[name].schema.parse(raw);
        let project: Project | undefined;
        if (
          input.project_path ||
          input.action === "inspect" ||
          input.action === "configure" ||
          (input.action === "sign" && Object.keys(input.options).length === 0)
        )
          project = this.projects.resolve(input.project_path, input.product);
        return this.signatures.call(input, project, signal);
      }
      case "hot_reload": {
        const input = tools[name].schema.parse(raw);
        return this.hot.call(
          input,
          this.projects.resolve(input.project_path, input.product),
          signal,
        );
      }
      case "emulator_manage":
        return this.emulator.manage(raw, signal);
      case "emulator_scenario":
        return this.emulator.scenario(raw, signal);
      case "ui_flow": {
        const input = tools[name].schema.parse(raw);
        invariant(
          !input.goal || input.action === "navigate",
          "FLOW_INPUT_CONFLICT",
          "Goal is only accepted by navigate",
        );
        const { request_key, ...identity } = input;
        const recordingFollowup = [
          "record_status",
          "record_stop",
          "record_cancel",
        ].includes(input.action);
        if (!recordingFollowup)
          invariant(
            !input.recording_id,
            "RECORDING_INPUT_INVALID",
            "recording_id is only accepted for recording status, stop or cancel",
          );
        if (input.action !== "record_start")
          invariant(
            !input.name && !input.mode,
            "RECORDING_INPUT_INVALID",
            "name and mode are only accepted by record_start",
          );
        if (
          ["record_status", "record_stop", "record_cancel"].includes(
            input.action,
          )
        ) {
          invariant(
            !input.id &&
              !input.flow &&
              !input.route &&
              !input.project_path &&
              !input.product &&
              !input.target &&
              !input.replace &&
              !request_key &&
              Object.keys(input.variables).length === 0 &&
              Object.keys(input.parameters).length === 0 &&
              (input.action === "record_stop" || !input.assert),
            "RECORDING_INPUT_INVALID",
            "A recording follow-up uses its captured project, product and device; only record_stop accepts assert",
          );
          const id = text(input.recording_id, "recording_id"),
            record = this.store.get(id);
          invariant(
            record.workflow === "ui_record",
            "RECORDING_RUN_INVALID",
            "Run is not a UI recording",
          );
          const engine = await this.workflows();
          if (input.action === "record_status")
            return {
              ...(await engine.status(id)),
              recording: this.recordings.statusIfInitialized(id),
            };
          if (input.action === "record_cancel")
            return this.recordings.cancel(id, () => engine.cancel(id), signal);
          await this.recordings.seal(id, input.assert, signal);
          if (
            [
              "queued",
              "running",
              "cancelling",
              "succeeded",
              "cancelled",
            ].includes(this.store.get(id).status)
          )
            return engine.status(id);
          return engine.resume(id, { action: "recheck" });
        }
        if (
          (input.action === "run" ||
            input.action === "navigate" ||
            input.action === "record_start") &&
          request_key
        ) {
          const previous = this.store.byRequest(request_key);
          if (previous) {
            invariant(
              previous.workflow ===
                (input.action === "record_start" ? "ui_record" : "ui_flow") &&
                previous.input_hash === digest(identity),
              "REQUEST_KEY_CONFLICT",
              "Request key already has different input",
            );
            return {
              run_id: previous.id,
              status: previous.status,
              deduplicated: true,
              ...(input.action === "record_start"
                ? { recording_id: previous.id }
                : {}),
            };
          }
        }
        const project = this.projects.resolve(
          input.project_path,
          input.product,
        );
        if (input.action === "list") return { flows: this.flows.list(project) };
        if (input.action === "read")
          return this.flows.read(project, text(input.id, "id"));
        if (input.action === "validate")
          return { valid: true, flow: flowSchema.parse(input.flow) };
        if (input.action === "save")
          return this.flows.save(project, input.flow, input.replace);
        if (input.action === "delete")
          return this.flows.delete(project, text(input.id, "id"));
        if (input.action === "routes") return discoverAppRoutes(project);
        invariant(
          input.action === "run" ||
            input.action === "navigate" ||
            input.action === "record_start",
          "UI_ACTION_INVALID",
          "Unknown UI task action",
        );
        const context: WorkflowContext = {
          parameters: {},
          project_path: project.root,
          product: project.product.name,
          project_hash: project.fingerprint,
          source_hash: sourceHash(project),
          toolchain_hash: digest(discoverToolchain()),
        };
        let choice: NavigationChoice;
        const catalog = discoverAppRoutes(project);
        if (input.action === "record_start") {
          invariant(
            input.route &&
              input.id &&
              input.name &&
              !input.assert &&
              !input.flow &&
              !input.replace &&
              Object.keys(input.parameters).length === 0 &&
              Object.keys(input.variables).length === 0,
            "RECORDING_INPUT_INVALID",
            "Recording requires id, name and an ability route; start with no steps, variables or assertion",
          );
          const route = resolveAppRoute(catalog, input.route);
          invariant(
            route.kind === "ability",
            "RECORDING_ROUTE_INVALID",
            "Saved recordings currently start at an explicit ability",
          );
          const draft = flowSchema.parse({
            version: 1,
            id: input.id,
            name: input.name,
            app: {
              bundleName: route.app.bundle_name,
              module: route.app.module,
              ability: route.app.ability,
            },
            start: { mode: input.mode ?? "restart" },
            steps: [],
          });
          this.flows.assertAvailable(project, draft.id);
          context.parameters = recordingTaskSchema.parse({ draft });
          context.target = await this.devices.target(input.target, signal);
          const run = (await this.workflows()).start(
            "ui_record",
            context,
            request_key,
            identity,
          );
          return { ...run, recording_id: run.run_id };
        }
        if (input.action === "navigate") {
          invariant(
            [input.route, input.id, input.goal].filter(
              (value) => value !== undefined,
            ).length === 1,
            "ROUTE_INPUT_REQUIRED",
            "Navigation requires exactly one route, saved flow ID or goal",
          );
          choice = input.route
            ? {
                kind: "route",
                route: resolveAppRoute(catalog, input.route, input.parameters),
              }
            : input.id
              ? { kind: "flow", id: input.id }
              : resolveNavigationGoal(
                  catalog,
                  this.flows
                    .list(project)
                    .flatMap((flow) =>
                      "app" in flow && flow.app && flow.name
                        ? [{ id: flow.id, name: flow.name, app: flow.app }]
                        : [],
                    ),
                  input.goal!,
                  input.parameters,
                );
        } else {
          invariant(
            !input.route,
            "FLOW_INPUT_CONFLICT",
            "Saved replay does not accept route overrides",
          );
          choice = { kind: "flow", id: text(input.id, "id") };
        }
        if (choice.kind === "route") {
          invariant(
            input.assert,
            "ROUTE_INPUT_REQUIRED",
            "Direct navigation requires an explicit final assertion",
          );
          invariant(
            Object.keys(input.variables).length === 0,
            "FLOW_INPUT_CONFLICT",
            "Direct routes accept Want parameters, not saved-flow variables",
          );
          context.parameters = uiTaskSchema.parse({
            kind: "route",
            app: choice.route.app,
            assert: input.assert,
          });
        } else {
          invariant(
            !input.route &&
              !input.assert &&
              Object.keys(input.parameters).length === 0,
            "FLOW_INPUT_CONFLICT",
            "Saved replay uses its original assertion and does not accept route overrides",
          );
          context.flow = this.flows.validateInputs(
            this.flows.read(project, choice.id),
            input.variables,
          );
          validateFlowApplication(catalog, context.flow);
          context.parameters = uiTaskSchema.parse({
            kind: "flow",
            variables: input.variables,
          });
        }
        context.target = await this.devices.target(input.target, signal);
        return (await this.workflows()).start(
          "ui_flow",
          context,
          request_key,
          identity,
        );
      }
      case "ui_snapshot":
      case "ui_inspect": {
        const inspection =
            name === "ui_inspect"
              ? tools.ui_inspect.schema.parse(raw)
              : undefined,
          input = inspection ?? tools.ui_snapshot.schema.parse(raw),
          target = await this.devices.target(input.target, signal);
        if ("mode" in input && input.mode === "image")
          return {
            screenshot: await this.devices.screenshot(
              target,
              input.capture,
              signal,
            ),
          };
        return this.store.lease(
          `device:${target}`,
          async () => {
            const snapshot = await this.devices.snapshot(target, signal);
            return {
              snapshot_id: snapshot.id,
              node_count: snapshot.nodes.length,
              signature: snapshot.signature,
              structure_signature: snapshot.structureSignature,
              ...(inspection ? inspectSnapshot(snapshot, inspection) : {}),
              tree: {
                format: "nodes",
                ...this.store.artifact(
                  currentTrace().run_id ?? "ui",
                  JSON.stringify(snapshot.nodes),
                  "application/json",
                ),
              },
              ...((
                "mode" in input
                  ? input.mode === "both"
                  : input.screenshot || input.capture
              )
                ? {
                    screenshot: await this.devices.screenshot(
                      target,
                      input.capture,
                      signal,
                    ),
                  }
                : {}),
            };
          },
          signal,
        );
      }
      case "ui_observe":
      case "ui_find": {
        const input = tools[name].schema.parse(raw);
        if (
          ("tree_file" in input && input.tree_file) ||
          ("tree_artifact_id" in input && input.tree_artifact_id)
        ) {
          if (this.savedTreeQueries >= 2)
            throw new ToolError(
              "UI_TREE_QUERY_BUSY",
              "At most two saved UI tree reads/parses may run concurrently",
              null,
              true,
            );
          this.savedTreeQueries++;
          try {
            return await findInSavedTree(
              input,
              this.store,
              this.cpu,
              signal,
              this.savedTrees,
            );
          } finally {
            this.savedTreeQueries--;
          }
        }
        const target = await this.devices.target(input.target, signal),
          snapshotId =
            "snapshot_id" in input && typeof input.snapshot_id === "string"
              ? input.snapshot_id
              : undefined;
        const query = () =>
          input.selectors
            ? this.devices.findMany(target, input.selectors, snapshotId, signal)
            : this.devices.find(
                target,
                input.selector ?? {},
                snapshotId,
                signal,
              );
        if ("capture" in input && input.capture)
          return this.store.lease(
            `device:${target}`,
            async () => ({
              ...(await query()),
              screenshot: await this.devices.screenshot(
                target,
                input.capture,
                signal,
              ),
            }),
            signal,
          );
        return query();
      }
      case "ui_tap": {
        const input = tools[name].schema.parse(raw);
        return this.recordings.control(
          await this.devices.target(input.target, signal),
          { action: "click", selector: input.selector },
          signal,
        );
      }
      case "ui_control": {
        const input = tools[name].schema.parse(raw);
        return this.recordings.control(
          await this.devices.target(input.target, signal),
          input.operation,
          signal,
        );
      }
      case "verify_ui": {
        const input = tools[name].schema.parse(raw);
        return this.devices.verify(
          await this.devices.target(input.target, signal),
          input.assert,
          signal,
        );
      }
      case "deveco_restart":
        throw new Error("Runtime restart is dispatched by the MCP host");
    }
  }
  close(): Promise<{ closed: boolean }> {
    return (this.shutdown ??= this.closeServices());
  }
  private async closeServices() {
    this.stopping = true;
    const errors: unknown[] = [];
    for (const close of [
      async () => {
        if (this.engine) await (await this.engine).close();
      },
      () => this.recordings.close(),
      () => this.hot.close(),
      () => this.emulator.close(),
      () => this.diagnostics.lsp.close(),
      () => this.auth.close(),
      () => this.devices.close(),
      () => this.savedTrees.close(),
      () => this.cpu.close(),
      () => this.processes.close(),
      () => this.knowledge.close(),
      () => this.store.close(),
    ])
      try {
        await close();
      } catch (error) {
        errors.push(errorResult(error));
      }
    if (errors.length)
      throw new ToolError(
        "CANCEL_UNCONFIRMED",
        "Runtime cleanup did not confirm every operation stopped",
        { errors },
      );
    return { closed: true };
  }
}
