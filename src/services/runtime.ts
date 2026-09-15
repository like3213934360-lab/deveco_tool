import { attachReviewImage } from "./ui-review-response.js";
import { captureCrashReference, readCrashSnapshot, supplementCrashSnapshot, diagnoseCrashSnapshot } from "./crash-reference.js";
import { evidenceArtifactSchema, verifyEvidenceArtifacts } from "./evidence-result.js";
import { WorkflowResponses } from "./workflow-response.js";
import { enrichBuildFailure, diagnosticTerms } from "./build-failure.js";
import { normalizeDiagnostics } from "./diagnostic-report.js";
import { captureSyncReceipt, synchronizeProject, type SyncPolicy } from "./project-sync.js";
import { resolveBuildReference, resolvePackageApplication, resolveProjectApplication } from "./application-input.js";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { domainRecipeCall } from "./domain-recipes.js";
import { DomainContentService } from "./domain-content.js";
import { DomainAcceptanceService } from "./domain-acceptance.js";
import { uiActionCapabilities } from "../core/ui-action-contract.js";
import { sourceHash, captureEvidenceIdentity, projectEvidenceIdentity, runtimeEvidenceIdentity } from "./evidence-identity.js";
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
  moduleTargetsSchema,
  appSchema,
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
  SettledEffectError,
} from "../core/errors.js";
import { fileDigest, digest, walk, destinationPath } from "../core/files.js";
import {
  discoverToolchain,
  installedSdkMetadata,
  component,
  type Component,
} from "../core/toolchain.js";
import { StateStore } from "../core/store.js";
import { stateSchemaRevision } from "../core/state-schema.js";
import { nativeOutcomeSchema } from "../core/ui-assertion.js";
import {
  captureFiles,
  capturedFileSchema,
  verifyCapturedFile,
} from "../core/captured-file.js";
import { CpuPool } from "../core/cpu-pool.js";
import { currentTrace } from "../core/trace.js";
import { signingDescriptorFiles } from "./signing-config.js";
import { ProcessService } from "../core/process.js";
import { PersistentProcessObserver } from "../core/process-observer.js";
import type {
  WorkflowEngine,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowStep,
  StepContext,
} from "../core/workflows.js";
import { ProjectService, inspectProject, projectTargets, type Project } from "./project.js";
import { DeviceService } from "./device.js";
import { VerificationService } from "./verification.js";
import { UiReviewService } from "./ui-review.js";
import { UiTestService } from "./ui-test.js";
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
import { buildPreflight } from "./build-preflight.js";
import { StorageService } from "./storage.js";
import { SkillService } from "./skills.js";
import { SkillWorkflowService } from "./skill-workflow.js";
import { inspectApplicationPackages } from "./package.js";
import { discoverAppRoutes, resolveAppRoute } from "./routes.js";
import {
  resolveNavigationGoal,
  validateFlowApplication,
  type NavigationChoice,
} from "./navigation.js";

const artifactsSchema = z.array(
  z.object({ path: z.string(), sha256: z.string(), bytes: z.number() }),
);

export class Runtime {
  readonly store = new StateStore();
  readonly storage = new StorageService(this.store);
  readonly skills = new SkillService(this.store);
  readonly skillWorkflows = new SkillWorkflowService(this.store, this.skills);
  readonly processes = new ProcessService(
    new PersistentProcessObserver(this.store),
  );
  readonly cpu = new CpuPool({}, (event) =>
    this.store.event(currentTrace().run_id ?? null, "cpu_parse", {
      ...currentTrace(),
      ...event,
    }),
  );
  readonly projects = new ProjectService(this.processes, undefined, this.store);
  readonly devices = new DeviceService(this.processes, this.store, this.cpu, target => this.tests.assertTaskTarget(target));
  readonly reviews = new UiReviewService(this.store);
  readonly verification = new VerificationService(this.store, this.devices, this.reviews);
  readonly diagnostics = new DiagnosticService(
    this.processes,
    this.store,
    this.cpu,
  );
  readonly flows = new FlowService(this.devices, this.store);
  readonly recordings = new RecordingService(this.store, this.devices);
  readonly tests = new UiTestService(this.store, this.devices, this.verification, this.reviews, target => this.recordings.assertTaskTarget(target), this.storage);
  readonly acceptance = new DomainAcceptanceService(this.store, id => this.tests.status(id));
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
        (context, workflow, outputs) => this.sealEvidence(context, workflow, outputs),
        () => digest(runtimeEvidenceIdentity()),
      );
    })());
  }
  private project(context: WorkflowContext) {
    return inspectProject(
      text(context.project_path, "project_path"),
      context.product,
      context.module_targets,
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
    try {
      const projectName =
          typeof record.project_path === "string"
            ? record.project_path
            : undefined,
        product = typeof record.product === "string" ? record.product : undefined;
      const buildReference = typeof record.build_run_id === "string"
        ? resolveBuildReference(this.store, record.build_run_id, { project_path: projectName, product,
            module_targets: moduleTargetsSchema.optional().parse(record.module_targets) }) : undefined;
      if (name === "project_create") {
        this.projects.prepareCreate(workflowInputs.project_create.parse(parameters));
        context.project_path = destinationPath(
          text(record.project_path, "project_path"),
        );
      } else if (buildReference || (name !== "app_deploy" && name !== "crash_diagnose")) {
        const project = buildReference?.project ?? this.projects.resolve(projectName, product, moduleTargetsSchema.optional().parse(record.module_targets));
        context.project_path = project.root;
        context.product = project.product.name;
        context.module_targets = projectTargets(project);
        context.project_hash = project.fingerprint;
        context.source_hash = sourceHash(project);
        if (buildReference) {
          context.build = buildReference.reference;
          context.requirements = buildReference.reference.requirements;
        }
        if (!buildReference && ["build_run", "build_deploy_verify"].includes(name))
          record.app = resolveProjectApplication(project, appSchema.optional().parse(record.app) ??
            (record.hot_reload ? this.hot.activeApplication(project) : undefined), z.array(z.string()).optional().parse(record.modules));
      }
      if (
        name === "app_deploy" ||
        name === "build_deploy_verify" ||
        name === "build_run" ||
        (name === "crash_diagnose" &&
          !record.source_run_id &&
          !record.log_file &&
          !record.log_artifact_id &&
          record.log_text === undefined)
      )
        context.target = await this.devices.target(
          typeof record.target === "string" ? record.target :
            record.hot_reload && context.project_path ? this.hot.activeTarget(this.project(context)) : undefined,
          signal,
        );
      if (name !== "crash_diagnose" || context.target)
        context.toolchain_hash = digest(discoverToolchain());
      if (name === "crash_diagnose" && typeof record.source_run_id === "string") {
        context.crash = captureCrashReference(this.store, record.source_run_id, id => this.tests.diagnosticLogs(id));
        context.input_artifacts = [context.crash.artifact_id];
      } else if (name === "crash_diagnose" && !context.target) {
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
      if (name === "app_deploy" || buildReference) {
        const input = name === "app_deploy" ? workflowInputs.app_deploy.parse(record) : undefined;
        const captured = await captureFiles(
          this.store,
          "workflow-input",
          buildReference?.reference.artifacts ?? (input && "packages" in input ? input.packages : []),
          signal,
        );
        context.deployment = captured;
        context.input_artifacts = captured.map((file) => file.artifact_id);
        record.app = await resolvePackageApplication(captured.map(file => file.path), appSchema.optional().parse(record.app), signal);
        if (!buildReference) record.packages = captured.map(file => ({ path: file.path, sha256: file.sha256 }));
      }
      if (name === "build_deploy_verify" && record.flow_id) {
        const input = workflowInputs.build_deploy_verify.parse(record);
        context.flow = this.flows.validateInputs(
          this.flows.read(this.project(context), input.flow_id!),
          input.variables,
        );
        invariant(
          context.flow.app.bundleName === appSchema.parse(record.app).bundle_name &&
            context.flow.app.module === appSchema.parse(record.app).module &&
            context.flow.app.ability === appSchema.parse(record.app).ability,
          "FLOW_APP_MISMATCH",
          "Saved flow targets a different application component",
        );
      }
      return context;
    } catch (error) {
      if (context.input_artifacts?.length) this.store.discardArtifacts("workflow-input", context.input_artifacts);
      throw error;
    }
  }
  private async sealEvidence(context: WorkflowContext, workflow: string, outputs: Record<string, unknown>) {
    const scope = { project_path: context.project_path, product: context.product, module_targets: context.module_targets,
      target: context.target, app: context.parameters.app, display_id: context.parameters.display_id as number | undefined };
    const identity = captureEvidenceIdentity(scope, context.requirements, !!context.toolchain_hash);
    if(context.runtime_sha256) invariant(context.runtime_sha256===digest(runtimeEvidenceIdentity()),"RUNTIME_CHANGED","Runtime or resource bytes changed during native execution");
    const artifacts: ReturnType<typeof evidenceArtifactSchema.parse>[] = [];
    for (const key of ["verify_artifacts","build_or_hot_apply","validate_artifact","prepare_installation"]) {
      if (!outputs[key]) continue;
      const value = this.output({run_id:currentTrace().run_id!,context,outputs,signal:new AbortController().signal},key);
      const record = Array.isArray(value) ? {} : object(value);
      const candidates = Array.isArray(value) ? value : record.artifacts ?? record.packages ?? object(record.result ?? {}).artifacts ?? [];
      for (const item of z.array(evidenceArtifactSchema).max(256).parse(candidates)) if(!artifacts.some(old=>old.path===item.path && old.sha256===item.sha256)) {
        // Temporary install copies have a deliberately shorter lifetime than
        // their native receipt. Never retain them again merely for acceptance.
        if(item.artifact_id && this.store.db.prepare("SELECT 1 FROM released_packages WHERE artifact_id=? AND run_id=?").get(item.artifact_id,currentTrace().run_id!))
          item.released_package={run_id:currentTrace().run_id!,artifact_id:item.artifact_id};
        artifacts.push(item);
      }
    }
    verifyEvidenceArtifacts(artifacts,this.store);
    if (context.source_hash && !["project_create", "project_sync", "native_operation"].includes(workflow))
      invariant(identity.source_sha256 === context.source_hash, "EVIDENCE_STALE", "Project sources changed during execution; native receipts are retained but this result is not current acceptance");
    if (context.toolchain_hash) invariant(identity.toolchain_sha256 === context.toolchain_hash, "TOOLCHAIN_CHANGED", "Toolchain changed during execution");
    const buildKey = workflow === "project_build" ? "build_project" : "build_or_hot_apply";
    if (outputs[buildKey]) {
      const result = object(this.output({ run_id: currentTrace().run_id!, context, outputs, signal: new AbortController().signal }, buildKey));
      if (result.input_identity) {
        const before = object(result.input_identity), current = context.project_path ? projectEvidenceIdentity(this.project(context)) : {};
        invariant(digest(before) === digest(current), "EVIDENCE_STALE", "Build inputs changed during or after the native command; rerun against current inputs");
      }
    }
    return { format: 1, identity, scope, artifacts, requirements: context.requirements, recorded_at: Date.now(), workflow,
      ...(context.build ? { build: { run_id: context.build.run_id, result_sha256: context.build.result_sha256, requirements: context.build.requirements } } : {}),
      definition_sha256: context.definition_sha256 ?? null,
      native_command_completed: true, business_verified: false,
      ...(context.crash ? { historical_source: context.crash, current_source_verified: false } : {}),
      meaning: context.crash ? "Historical retained-log analysis; neither current project/device state nor the failure's root cause is verified."
        : "Native completion for captured inputs. Use domain_acceptance or ui_test for requirement-specific evaluation." };
  }
  private async validate(context: WorkflowContext, workflow: string) {
    if (workflow === "native_operation" && String(context.parameters.tool).startsWith("emulator_")) await this.emulator.reconcileSessions();
    for (const file of context.input_files ?? []) invariant(fs.existsSync(file.path) && fileDigest(file.path) === file.sha256, "INPUT_CHANGED", "A captured operation input file changed");
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
      this.tests.assertTaskTarget(context.target);
      const recording = recordingTaskSchema.safeParse(context.parameters);
      if (
        ["ui_flow", "ui_record", "app_deploy", "build_run", "build_deploy_verify", "native_operation"].includes(
          workflow,
        )
      )
        this.recordings.assertTaskTarget(
          context.target,
          recording.success ? recording.data.draft.id : undefined,
        );
      if (!(workflow === "native_operation" && context.parameters.tool === "emulator_manage" && object(context.parameters.input).action === "stop")) await this.devices.target(context.target);
    }
    if (context.flow)
      invariant(
        digest(this.flows.read(this.project(context), context.flow.id)) === digest(context.flow) ||
          (!!currentTrace().run_id && this.store.operationMatches(currentTrace().run_id!, `execute_ui_path:flow:${context.flow.id}:save-repairs:private:save`, {
            before: digest(context.flow), after: digest(this.flows.read(this.project(context), context.flow.id)),
          })),
        "FLOW_CHANGED",
        "Saved flow changed after submission; start a new run",
      );
    // Confirmed installation consumes the temporary copies. Later launch/UI recovery
    // reuses the durable install receipt and must not require those deleted bytes.
    const runId = currentTrace().run_id;
    if (!runId || !this.store.confirmedInstallation(runId))
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
    const resumable = (id: string, execute: WorkflowStep["execute"]): WorkflowStep => effect(id, execute, execute);
    const read = (
      id: string,
      execute: WorkflowStep["execute"],
    ): WorkflowStep => ({ id, kind: "read", execute });
    const nativeOperation = async (call: StepContext, recovering = false) => {
        const input = object(call.context.parameters.input), name = call.context.parameters.tool;
        if (name === "app_signature") return this.signatures.call(input, call.context.project_path ? this.project(call.context) : undefined, call.signal);
        if (name === "emulator_manage") return this.emulator.manage(input, call.signal);
        if (name === "emulator_scenario") return this.emulator.scenario(input, call.signal);
        invariant(name === "hot_reload", "OPERATION_UNKNOWN", "Unknown native operation");
        return this.hot.call(input, this.project(call.context), call.signal, recovering);

    };
    definitions.push({
      id: "native_operation", description: "A fixed native signing, emulator or hot-patch operation",
      capabilities: [], completion: "The native service returns a verified result or a durable acknowledgement with explicit verification limits",
      resources: (context) => [
        ...(context.project_path ? [`project:${context.project_path}`] : []),
        ...(context.target ? [`device:${context.target}`] : []),
        ...(String(context.parameters.tool).startsWith("emulator_") ? ["emulator:inventory"] : []),
        ...(context.parameters.tool === "app_signature" && typeof object(context.parameters.input).team_id === "string" ? [`signing:${String(object(context.parameters.input).team_id)}`] : []),
        ...(typeof object(context.parameters.input).output === "string" ? [`file:${String(object(context.parameters.input).output)}`] : []),
      ],
      steps: [effect("execute_native_operation", nativeOperation, call => nativeOperation(call, true)), read("verify_native_outcome", async (call) => {
        const input = object(call.context.parameters.input);
        if (call.context.parameters.tool !== "emulator_scenario" || !input.verify)
          return { status: "not_requested", verified: false };
        const contract = nativeOutcomeSchema.parse(input.verify);
        const accepted = this.output(call, "execute_native_operation");
        invariant(object(accepted).commandAccepted === true, "EMULATOR_SCENARIO_UNCONFIRMED", "Outcome observation requires the completed scenario receipt");
        const started = Date.now();
        let observation: unknown, failure: ReturnType<typeof errorResult> | undefined;
        try {
          observation = await this.devices.verify(text(call.context.target, "target"), contract.assert, call.signal, contract.bundle_name);
          call.signal.throwIfAborted();
          invariant(object(observation).verified === true, "VERIFICATION_FAILED", "Application observation did not satisfy its assertion");
        } catch (error) { failure = errorResult(error); }
        const report = { run_id: call.run_id, target: call.context.target,
          scope: "captured_application_ui_assertion", contract,
          command_accepted: true, operation_sha256: digest(accepted),
          verified: !failure, observation: observation ?? null, error: failure ?? null,
          started_at: started, completed_at: Date.now() };
        const report_artifact = this.store.artifact(call.run_id, JSON.stringify(report), "application/json");
        if (failure) throw new ToolError(failure.code, failure.message, { ...report, report_artifact });
        return { ...report, report_artifact };
      })],
    });
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
        effect(
          "execute_ui_path",
          async (call) => {
            const input = uiTaskSchema.parse(call.context.parameters);
            if (input.kind === "route")
              return this.devices.launch(
                text(call.context.target, "target"),
                input.app,
                call.signal,
                true,
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
          },
          async (call) => {
            const input = uiTaskSchema.parse(call.context.parameters);
            return input.kind === "route"
              ? this.devices.reconcileLaunch(
                  text(call.context.target, "target"),
                  input.app,
                  call.signal,
                )
              : this.flows.run(this.project(call.context), call.context.flow!.id, text(call.context.target, "target"), input.variables, call.signal, call.context.flow);
          },
        ),
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
        resumable("stop_recording_app", async (call) => {
          const { draft } = recordingTaskSchema.parse(call.context.parameters);
          if (draft.start.mode === "attach") return { skipped: true };
          await this.devices.stopApplication(
            text(call.context.target, "target"),
            draft.app.bundleName,
            call.signal,
          );
          return { stopped: true };
        }),
        effect(
          "launch_recording_app",
          async (call) => {
            const { draft } = recordingTaskSchema.parse(
              call.context.parameters,
            );
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
                  true,
                );
          },
          async (call) => {
            const { draft } = recordingTaskSchema.parse(
              call.context.parameters,
            );
            return draft.start.mode === "attach"
              ? { skipped: true }
              : this.devices.reconcileLaunch(
                  text(call.context.target, "target"),
                  {
                    bundle_name: draft.app.bundleName,
                    module: draft.app.module,
                    ability: draft.app.ability,
                  },
                  call.signal,
                );
          },
        ),
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
      read("validate_sdk", async (call) => {
        const toolchain = discoverToolchain();
        component(toolchain, "hvigor");
        return this.projects.prepareCreate(workflowInputs.project_create.parse(call.context.parameters)).sdk;
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
    const sync = async (call: StepContext, policy: SyncPolicy, recovering = false, install = true) => {
      const project = this.project(call.context);
      return synchronizeProject({ store: this.store, run_id: call.run_id, project, policy, recovering, install,
        capture: () => captureSyncReceipt(project, discoverToolchain, () => this.projects.model(project)),
        synchronize: () => this.projects.sync(project, install, call.signal) });
    };
    const synchronize = async (call: StepContext, recovering = false) =>
      sync(call, "force", recovering, workflowInputs.project_sync.parse(call.context.parameters).install);
    define("project_sync", [
      effect("sync_project", synchronize, call => synchronize(call, true)),
      read("verify_model", async (call) => ({
        model: inspectProject(
          text(call.context.project_path, "project_path"),
          call.context.product,
          call.context.module_targets,
        ),
      })),
    ]);
    const syncBeforeBuild = async (call: StepContext, recovering = false) =>
      sync(call, workflowInputs.project_build.parse(call.context.parameters).sync, recovering);
    const preflight = async (call: StepContext, policy: z.infer<typeof workflowInputs.project_build>["preflight"], recovering: boolean) => {
      try {
        const project = this.project(call.context);
        return await buildPreflight(this.store, policy, () => this.diagnostics.arkts(project, undefined, call.signal), () => sourceHash(project), call.signal);
      } catch (error) {
        const failure = enrichBuildFailure(error, this.store, this.knowledge);
        // On the first attempt nothing after this boundary has been dispatched.
        // During reconciliation an earlier build/hot apply may already have run;
        // a failed fresh check cannot settle that earlier external operation.
        if (recovering) throw new ToolError("EFFECT_UNCERTAIN", "Fresh preflight prevents reconciliation of the earlier build or hot apply", { cause: errorResult(failure) });
        throw SettledEffectError.from(failure);
      }
    };
    const buildProject = async (call: StepContext, recovering = false) => {
      const input = workflowInputs.project_build.parse(call.context.parameters);
      const checked = await preflight(call, input.preflight, recovering);
      const project = this.project(call.context), input_identity = projectEvidenceIdentity(project);
      invariant(checked.status === "overridden" || ("source_identity" in checked && checked.source_identity === input_identity.source_sha256), "CHECK_EVIDENCE_STALE", "Inputs changed between ArkTS preflight and build");
      try { return { ...await this.projects.build(project, input, call.signal), preflight: checked, input_identity }; }
      catch (error) { throw enrichBuildFailure(error, this.store, this.knowledge); }
    };
    const build: WorkflowStep[] = [
      effect("sync_project", syncBeforeBuild, call => syncBeforeBuild(call, true)),
      effect("build_project", buildProject, call => buildProject(call, true)),
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
    const application = (call: StepContext) => appSchema.parse(call.context.parameters.app);
    const packages = (call: StepContext) => capturedFileSchema.array().parse(
      call.context.deployment ?? this.output(call, "prepare_installation"));
    const hot = (call: StepContext) => call.context.parameters.hot_reload === true;
    const skipHot = { skipped: true, reason: "hot patch preserves the running application" };
    const deploymentSteps: WorkflowStep[] = [
      read("validate_artifact", async call => hot(call) ? skipHot : {
        packages: packages(call),
        identity: await inspectApplicationPackages(packages(call).map(file => file.path), application(call), call.signal),
      }),
      effect("install_application", async call => hot(call) ? skipHot :
        this.devices.install(text(call.context.target, "target"), packages(call), application(call), call.signal, true),
        async call => hot(call) ? skipHot :
          this.devices.reconcileInstall(text(call.context.target, "target"), packages(call), application(call), call.signal)),
      effect("launch_application", async call => hot(call) ? skipHot :
        this.devices.launch(text(call.context.target, "target"), application(call), call.signal, true),
        async call => hot(call) ? skipHot :
          this.devices.reconcileLaunch(text(call.context.target, "target"), application(call), call.signal)),
      // Full launch and hot apply already perform the bounded startup check in
      // their durable service. Reuse that receipt; do not launch/check twice.
      read("verify_process", async call => this.verifyProcess(call)),
    ];
    define("app_deploy", deploymentSteps);
    const buildOrApply = async (call: StepContext, recovering = false) => {
      if (call.context.build) return {
        reused: true, build_run_id: call.context.build.run_id,
        artifacts: call.context.build.artifacts, input_identity: call.context.build.input_identity,
      };
      const record = call.context.parameters;
      const input = workflowInputs.project_build.parse({
        project_path: record.project_path, product: record.product, module_targets: record.module_targets,
        modules: record.modules, mode: record.mode, clean: record.clean, sync: record.sync, preflight: record.preflight,
      }), project = this.project(call.context);
      const checked = await preflight(call, input.preflight, recovering);
      const input_identity = projectEvidenceIdentity(project);
      invariant(checked.status === "overridden" || ("source_identity" in checked && checked.source_identity === input_identity.source_sha256), "CHECK_EVIDENCE_STALE", "Inputs changed between ArkTS preflight and build/apply");
      try { if (hot(call)) return {
        hot_reload: true, input_identity, preflight: checked,
        result: await this.hot.call({ action: "apply", target: call.context.target, app: application(call) }, project, call.signal, recovering),
      };
      return { ...await this.projects.buildApplication(project, input, call.signal), preflight: checked, input_identity };
      } catch (error) { throw enrichBuildFailure(error, this.store, this.knowledge); }
    };
    const syncBeforeDeploy = async (call: StepContext, recovering = false) => hot(call) || call.context.build
      ? { skipped: true, reason: hot(call) ? "hot patch" : "reusing a verified build" }
      : sync(call, call.context.parameters.sync as SyncPolicy ?? "auto", recovering);
    const buildAndDeploy: WorkflowStep[] = [
      effect("sync_project", syncBeforeDeploy, call => syncBeforeDeploy(call, true)),
      effect("build_or_hot_apply", buildOrApply, call => buildOrApply(call, true)),
      read("prepare_installation", async call => {
        if (hot(call)) return skipHot;
        if (call.context.deployment) return call.context.deployment;
        const artifacts = artifactsSchema.parse(object(this.output(call, "build_or_hot_apply")).artifacts)
          .filter(item => /-signed\.(hap|hsp)$/.test(item.path));
        invariant(artifacts.some(item => item.path.endsWith(".hap")), "DEPLOY_ARTIFACT_MISSING", "Build did not produce signed HAP packages");
        return captureFiles(this.store, call.run_id, artifacts, call.signal);
      }),
      ...deploymentSteps,
    ];
    define("build_run", buildAndDeploy);
    define("build_deploy_verify", [
      ...buildAndDeploy,
      resumable("execute_ui_path", async call => {
        const input = workflowInputs.build_deploy_verify.parse(call.context.parameters);
        return input.flow_id ? this.flows.run(this.project(call.context), input.flow_id,
          text(call.context.target, "target"), input.variables, call.signal, call.context.flow) : { skipped: true };
      }),
      read("final_assertion", async call => this.devices.verify(text(call.context.target, "target"),
        workflowInputs.build_deploy_verify.parse(call.context.parameters).assert,
        call.signal, application(call).bundle_name)),
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
          normalized: normalizeDiagnostics(this.project(call.context).root, evidence),
          compilationVerified: false,
          knowledge: this.knowledge.search(diagnosticTerms(evidence), 10),
        };
      }),
    ]);
    define("crash_diagnose", [
      read("collect_evidence", async (call) => {
        const input = workflowInputs.crash_diagnose.parse(
          call.context.parameters,
        );
        if (call.context.crash) {
          const captured = readCrashSnapshot(this.store, call.run_id, call.context.crash);
          const snapshot = await supplementCrashSnapshot(this.store, this.logs, call.run_id, captured, input.collect_missing === true, call.signal);
          const content = JSON.stringify(snapshot);
          return { source_snapshot: this.store.artifact(call.run_id, content, "application/json"), snapshot_sha256: createHash("sha256").update(content).digest("hex"),
            source_run_id: call.context.crash.run_id, historical: true };
        }
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
        if (call.context.crash) {
          const collected = z.object({ source_snapshot: z.object({ artifact_id: z.string().uuid() }), snapshot_sha256: z.string() }).parse(this.output(call, "collect_evidence"));
          return diagnoseCrashSnapshot(readCrashSnapshot(this.store, call.run_id, { run_id: call.context.crash.run_id,
            artifact_id: collected.source_snapshot.artifact_id, sha256: collected.snapshot_sha256 }));
        }
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
          knowledge: call.context.crash ? z.object({ findings: z.array(z.object({ artifact_id: z.string(), diagnosis: z.unknown() })) })
            .parse(parsed).findings.map(finding => ({ artifact_id: finding.artifact_id, ...this.knowledge.crashCases(finding.diagnosis) })) : this.knowledge.crashCases(parsed),
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
  private async verifyProcess(call: StepContext) {
    const launch = object(this.output(call, "launch_application") ?? {});
    const built = object(this.output(call, "build_or_hot_apply") ?? {});
    const startup = launch.startup_check ?? object(built.result ?? {}).startup_check;
    if (startup) {
      invariant(object(startup).process === "stable", "STARTUP_UNVERIFIED", "The durable startup check did not confirm process stability");
      return { processVerified: true, startup_check: startup, target: call.context.target,
        bundle_name: appSchema.parse(call.context.parameters.app).bundle_name, business_verified: false };
    }
    const app = appSchema.parse(call.context.parameters.app);
    const checked = await this.devices.checkStartup(text(call.context.target, "target"), app, call.signal);
    return {
      processVerified: true,
      startup_check: checked,
      target: call.context.target,
      bundle_name: app.bundle_name,
      business_verified: false,
    };
  }
  private async startOperation(name: "app_signature" | "hot_reload" | "emulator_manage" | "emulator_scenario", raw: unknown, project?: Project, signal?: AbortSignal) {
    if (name.startsWith("emulator_")) await this.emulator.reconcileSessions(signal);
    const { request_key, ...input } = object(tools[name].schema.parse(raw));
    const key = typeof request_key === "string" ? request_key : undefined, identity = { tool: name, input: structuredClone(input) };
    const previous = key ? this.store.byRequest(key) : undefined;
    if (previous) {
      invariant(previous.workflow === "native_operation" && previous.input_hash === digest(identity), "REQUEST_KEY_CONFLICT", "Request key already has different input");
      return { run_id: previous.id, status: previous.status, deduplicated: true };
    }
    const context: WorkflowContext = { parameters: { tool: name, input }, toolchain_hash: digest(discoverToolchain()) };
    if (project) {
      context.project_path = project.root; context.product = project.product.name;
      context.module_targets = projectTargets(project);
      input.project_path = project.root; input.product = project.product.name;
      // configure deliberately changes the project model. Its service journals the original model and publication.
      if (input.action !== "configure") { context.project_hash = project.fingerprint; context.source_hash = sourceHash(project); }
    }
    if (name === "hot_reload" && input.action === "apply" && !input.target && project) input.target = this.hot.activeTarget(project);
    if (name === "hot_reload" || typeof input.target === "string") {
      context.target = name === "emulator_manage" && input.action === "stop" && typeof input.target === "string"
        ? input.target : await this.devices.target(typeof input.target === "string" ? input.target : undefined, signal);
      input.target = context.target;
    }
    if (typeof input.file === "string") input.file = fs.realpathSync.native(path.resolve(input.file));
    if (typeof input.output === "string") input.output = destinationPath(input.output);
    if (name === "app_signature" && input.action === "sign" && project && Object.keys(object(input.options)).length === 0) input.options = this.signatures.projectOptions(project);
    const options = object(input.options ?? {});
    for (const key of ["keystoreFile", "appCertFile", "profileFile"]) if (typeof options[key] === "string") options[key] = fs.realpathSync.native(path.resolve(options[key]));
    const files = [input.file, ...Object.entries(options).filter(([key]) => ["keystoreFile", "appCertFile", "profileFile"].includes(key)).map(([, value]) => value)].filter((file): file is string => typeof file === "string");
    if (name === "app_signature" && input.action === "configure" && typeof input.file === "string") files.push(...signingDescriptorFiles(input.file));
    context.input_files = files.map((file) => { const absolute = fs.realpathSync.native(file); return { path: absolute, sha256: fileDigest(absolute) }; });
    return (await this.workflows()).start("native_operation", context, key, identity);
  }
  async call(
    name: ToolName,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    invariant(!this.stopping, "RUNTIME_STOPPING", "Runtime is stopping");
    signal?.throwIfAborted();
    switch (name) {
      case "domain_recipe": return domainRecipeCall(raw);
      case "domain_content": {
        const input = tools.domain_content.schema.parse(raw), content = new DomainContentService();
        return input.action === "read" ? content.read(input.uri) : content.catalog(input);
      }
      case "domain_acceptance": return this.acceptance.assess(raw);
      case "project_context": {
        const input = tools.project_context.schema.parse(raw), project = this.projects.resolve(input.project_path,input.product,input.module_targets);
        return { project_path: project.root, product: project.product.name, module_targets: projectTargets(project), immutable: true,
          scope_sha256: digest({project_path:project.root,product:project.product.name,module_targets:projectTargets(project)}),
          next_action: "Pass this explicit project_path/product/module_targets to each operation; resolving never mutates other calls." };
      }
      case "ui_query": {
        const input = tools.ui_query.schema.parse(raw);
        return this.call(({snapshot:"ui_snapshot",observe:"ui_observe",find:"ui_find",inspect:"ui_inspect"} as const)[input.action],input.query,signal);
      }
      case "maintenance": {
        const input = tools.maintenance.schema.parse(raw);
        invariant(input.action !== "restart", "HOST_RESTART_REQUIRED", "Restart is handled by the MCP transport");
        return this.call("workflow_run",input,signal);
      }
      case "signature_admin": return this.call("app_signature",raw,signal);
      case "emulator_admin": return this.call("emulator_manage",raw,signal);
      case "skill_manage": return this.skills.call(raw, signal);
      case "skill_workflow": {
        const input=tools[name].schema.parse(raw), result=this.skillWorkflows.call(input,signal);
        if(input.action==="archive" || (input.action==="transition" && input.phase==="cancelled")) {
          const value=object(result);
          return {run_id:value.run_id,status:value.status,phase:value.phase,revision:value.revision,verified:false,
            next_action:"Use skill_workflow read or maintenance export for retained documents and evidence"};
        }
        return result;
      }
      case "workflow_catalog": {
        const input = tools[name].schema.parse(raw);
        return input.action === "ui_actions" ? uiActionCapabilities() : workflowCatalog(
          input.action === "get" ? input.workflow : undefined,
        );
      }
      case "workflow_run": {
        const input = tools[name].schema.parse(raw);
        const responses = new WorkflowResponses(this.store, workflow =>
          workflow in workflowMetadata ? workflowMetadata[workflow as WorkflowName].completion : "Read the retained task contract for its completion scope.");
        const present = (id: string) => responses.present(this.store.get(id), "detail" in input ? input.detail : "summary");
        if (input.action === "read_result") return responses.read(text(input.run_id, "run_id"), input.section ?? "result", input.offset, input.limit, input.expected_sha256);
        if (input.action === "read_events") return responses.events(text(input.run_id, "run_id"), input.offset, input.limit);
        if (input.action === "capacity") return this.storage.capacity(input.additional_bytes);
        if (input.action === "cleanup_plan") return this.storage.plan(input.run_ids!);
        if (input.action === "cleanup_apply") return this.storage.apply(input.run_ids!, input.plan_hash!);
        if (input.action === "export") return this.storage.export(input.run_ids!, input.export_directory!, signal);
        if (input.action === "storage_receipt") return this.storage.receipt(input.receipt_id!);
        if (input.action === "read_artifact" && input.as === "image") {
          const { readImageArtifact } = await import("./artifact.js");
          signal?.throwIfAborted();
          return readImageArtifact(
            this.store,
            text(input.artifact_id, "artifact_id"),
          );
        }
        if (input.action === "read_artifact")
          return this.store.readArtifact(
            text(input.artifact_id, "artifact_id"),
            input.offset,
            input.limit,
          );
        const engine = await this.workflows();
        if (input.action === "list") {
          const runs = this.store.list(input.offset, input.limit ?? 20).map(run => input.detail === "full" ? responses.present(run, "full") : {
            run_id: run.id, workflow: run.workflow, status: run.status,
            created_at: new Date(run.created).toISOString(), updated_at: new Date(run.updated).toISOString(),
            read: { tool: "workflow_run", action: "status", run_id: run.id, wait_ms: 0 },
          }),
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
          const parameters = workflowInputs[input.workflow].parse(input.input);
          const identity = input.requirements ? { parameters, requirements: input.requirements } : parameters;
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
            await engine.status(previous.id, input.wait_ms, signal);
            return { ...present(previous.id), deduplicated: true };
          }
          const captured = await this.capture(input.workflow, parameters, signal);
          let submitted;
          try {
            if (input.requirements) {
              invariant(!captured.build || digest(input.requirements) === digest(captured.build.requirements ?? null),
                "BUILD_REQUIREMENTS_MISMATCH", "A reused build retains its original requirement bindings; create a fresh bound build for new requirements");
              captured.requirements = input.requirements;
            }
            submitted = engine.start(
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
          await engine.status(submitted.run_id, input.wait_ms, signal);
          return { ...present(submitted.run_id), deduplicated: submitted.deduplicated };
        }
        const id = text(input.run_id, "run_id");
        if (this.store.get(id).workflow === "skill_workflow") {
          invariant(input.action !== "resume" || !input.resume_input, "SKILL_WORKFLOW_RESUME_INPUT_INVALID", "Legacy guidance is read-only; use domain_recipe or export/archive the existing run");
          const current = this.skillWorkflows.read(id);
          if (input.action === "cancel") {
            if (!["completed", "cancelled"].includes(current.phase)) this.skillWorkflows.call({ action: "transition", run_id: id, expected_revision: current.revision, phase: "cancelled", rationale: "The client requested cancellation of this builtin workflow." }, signal);
            const archived=this.skillWorkflows.read(id);
            return { run_id: id, status: archived.status, phase: archived.phase, revision: archived.revision, verified: false };
          }
          return current;
        }
        if (this.store.get(id).workflow === "ui_test") {
          invariant(input.action !== "resume" || !input.resume_input, "UI_TEST_RESUME_INPUT_INVALID", "UI tests resume captured state; use ui_test replan for strategy changes");
          return this.tests.call({ action: input.action, test_id: id }, signal);
        }
        if (input.action === "status") {
          await engine.status(id, input.wait_ms, signal);
          return present(id);
        }
        if (input.action === "resume") {
          await engine.resume(id, input.resume_input);
          await engine.status(id, input.wait_ms, signal);
          return present(id);
        }
        await (this.store.get(id).workflow === "ui_record"
          ? this.recordings.cancel(id, () => engine.cancel(id), signal)
          : engine.cancel(id));
        return present(id);
      }
      case "switch_cwd":
        return this.projects.select(tools[name].schema.parse(raw).project_path);
      case "deveco_doctor": {
        const input = tools[name].schema.parse(raw);
        const { inspectUiDriver } = await import("./ui-driver.js");
        let toolchain: unknown, project: unknown, api_compatibility: unknown, default_sdk: unknown;
        try {
          const selected = discoverToolchain();
          toolchain = selected;
          try { default_sdk = installedSdkMetadata(selected); }
          catch (error) { default_sdk = { error: errorResult(error) }; }
        } catch (error) {
          toolchain = { error: errorResult(error) };
          default_sdk = { error: errorResult(error) };
        }
        try {
          api_compatibility = { versions: this.diagnostics.versions() };
        } catch (error) {
          api_compatibility = { error: errorResult(error) };
        }
        try {
          project = this.projects.resolve(input.project_path, input.product, input.module_targets);
        } catch (error) {
          const failure = errorResult(error);
          if (failure.code !== "PROJECT_REQUIRED") project = { error: failure };
        }
        return {
          release,
          execution_protocol: protocolVersion,
          state_schema_revision: stateSchemaRevision,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          state_dir: this.store.root,
          toolchain,
          default_sdk,
          api_compatibility,
          lsp_capabilities: this.diagnostics.lsp.capabilityReport(),
          ui_action_capabilities: uiActionCapabilities(),
          project: project ?? null,
          ui_driver: await inspectUiDriver(this.devices, input.target, signal),
          processes: this.processes.size,
          parsers: this.cpu.metrics,
          ui_cache: this.devices.cacheMetrics,
          saved_ui_cache: this.savedTrees.metrics,
          runtime: {
            pid: process.pid,
            cpu: process.cpuUsage(),
            rss_bytes: process.memoryUsage().rss,
            retained: await this.lifecycleMetrics(),
            sdk: {
              ...this.processes.metrics,
              pids: [...new Set([...this.processes.metrics.pids, ...this.hot.processIds])],
            },
          },
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
          this.projects.resolve(input.project_path, input.product, input.module_targets),
          input.files,
          signal,
        );
      }
      case "code_lint": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product, input.module_targets);
        return this.store.lease(
          `project:${project.root}`,
          () => this.diagnostics.lint(project, input, signal),
          signal,
        );
      }
      case "lsp": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product, input.module_targets);
        return this.diagnostics.lsp.request(project, input, signal);
      }
      case "check_cpp_files": {
        const input = tools[name].schema.parse(raw),
          project = this.projects.resolve(input.project_path, input.product, input.module_targets),
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
          project = this.projects.resolve(input.project_path, input.product, input.module_targets);
        if (!["inspect", "verify", "certificates", "devices"].includes(input.action)) return this.startOperation("app_signature", input, project, signal);
        return this.signatures.call(input, project, signal);
      }
      case "hot_reload": {
        const input = tools[name].schema.parse(raw);
        if (input.action === "status") return this.hot.status(this.projects.resolveSelection(input.project_path, input.product, input.module_targets));
        if (["start", "apply"].includes(input.action)) return this.startOperation("hot_reload", input, this.projects.resolve(input.project_path, input.product, input.module_targets), signal);
        return this.hot.call(
          input,
          this.projects.resolve(input.project_path, input.product, input.module_targets),
          signal,
        );
      }
      case "emulator_manage": {
        const input = tools[name].schema.parse(raw);
        return ["list", "images", "license_view"].includes(input.action) ? this.emulator.manage(input, signal) : this.startOperation(name, input, undefined, signal);
      }
      case "emulator_scenario": return this.startOperation(name, raw, undefined, signal);
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
              !input.module_targets &&
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
              (previous.workflow ===
                (input.action === "record_start" ? "ui_record" : "ui_flow") ||
                (input.action === "navigate" &&
                  input.goal &&
                  previous.workflow === "ui_record")) &&
                previous.input_hash === digest(identity),
              "REQUEST_KEY_CONFLICT",
              "Request key already has different input",
            );
            return {
              run_id: previous.id,
              status: previous.status,
              deduplicated: true,
              ...(previous.workflow === "ui_record"
                ? { recording_id: previous.id }
                : {}),
              ...(input.action === "navigate" &&
              previous.workflow === "ui_record"
                ? { navigation: "recording" }
                : {}),
            };
          }
        }
        if (input.action === "list") return { flows: this.flows.list(this.projects.resolveSelection(input.project_path, input.product, input.module_targets)) };
        const project = this.projects.resolve(
          input.project_path,
          input.product,
          input.module_targets,
        );
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
          module_targets: projectTargets(project),
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
          choice = {
            kind: "recording",
            draft: flowSchema.parse({
              version: 2,
              id: input.id,
              name: input.name,
              app: {
                bundleName: route.app.bundle_name,
                module: route.app.module,
                ability: route.app.ability,
              },
              start: { mode: input.mode ?? "restart" },
              steps: [],
            }),
          };
        } else if (input.action === "navigate") {
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
        if (choice.kind === "recording") {
          invariant(
            !input.assert &&
              !input.flow &&
              !input.replace &&
              Object.keys(input.parameters).length === 0 &&
              Object.keys(input.variables).length === 0,
            "RECORDING_INPUT_INVALID",
            "An unmatched goal starts an empty recording; provide its final assertion with record_stop and no replay inputs",
          );
          const { draft } = choice;
          this.flows.assertAvailable(project, draft.id);
          context.parameters = recordingTaskSchema.parse({ draft });
          context.target = await this.devices.target(input.target, signal);
          const run = (await this.workflows()).start(
            "ui_record",
            context,
            request_key,
            identity,
          );
          return {
            ...run,
            recording_id: run.run_id,
            ...(input.action === "navigate" ? { navigation: "recording" } : {}),
          };
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
        let capture = input.capture;
        if (inspection?.display_id !== undefined && (inspection.screenshot || inspection.capture)) {
          const display = Number(inspection.display_id);
          invariant(Number.isSafeInteger(display) && display >= 0, "DISPLAY_INVALID", "Image capture requires a numeric display ID");
          invariant(capture?.display_id === undefined || capture.display_id === display, "DISPLAY_SCOPE_MISMATCH", "Tree and screenshot display selections disagree");
          capture = { format: "png", ...capture, display_id: display };
        }
        if ("mode" in input && input.mode === "image")
          return {
            screenshot: await this.devices.screenshot(
              target,
              capture,
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
                      capture,
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
            async () => {
              // Both operations are reads under the same device lease. Wait
              // for both cleanup paths even if one fails or is cancelled;
              // releasing early would let a tap race the remaining capture.
              const [found, screenshot] = await Promise.allSettled([
                query(),
                this.devices.screenshot(target, input.capture, signal),
              ]);
              if (found.status === "rejected") throw found.reason;
              if (screenshot.status === "rejected") throw screenshot.reason;
              return { ...found.value, screenshot: screenshot.value };
            },
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
        return attachReviewImage(await this.verification.verify(
          await this.devices.target(input.target, signal), input, signal,
        ), this.store, this.reviews, signal);
      }
      case "ui_review": {
        const input = tools[name].schema.parse(raw);
        if (input.action === "list") return this.reviews.list(input.offset, input.limit);
        if (input.action === "status") return attachReviewImage(this.reviews.status(input.review_id), this.store, this.reviews, signal);
        if (input.action === "cancel") return this.reviews.cancel(input.review_id);
        return this.reviews.complete(input.review_id, input);
      }
      case "ui_test":
        return attachReviewImage(await this.tests.call(tools[name].schema.parse(raw), signal), this.store, this.reviews, signal);
      case "deveco_restart":
        throw new Error("Runtime restart is dispatched by the MCP host");
    }
  }
  close(): Promise<{ closed: boolean }> {
    return (this.shutdown ??= this.closeServices());
  }
  async lifecycleMetrics() {
    const processes = this.processes.metrics, lsp = this.diagnostics.lsp.metrics, cpu = this.cpu.metrics;
    return {
      tasks: (this.engine ? (await this.engine).activeCount : 0) + cpu.active + cpu.queued + lsp.active_requests,
      listeners: processes.listeners,
      connections: lsp.connections + processes.sessions,
      processes: processes.processes,
      cache_entries: this.devices.cacheMetrics.snapshots + this.savedTrees.metrics.entries,
      workers: cpu.workers,
      process_starts: processes.process_starts,
      scope: "Owned workflow/parser/LSP work, process listeners and sessions, LSP connections, UI caches and parser workers. This is not a count of all V8 objects or SDK internals.",
    };
  }
  private async closeServices() {
    this.stopping = true;
    const errors: unknown[] = [];
    for (const close of [
      async () => {
        if (this.engine) await (await this.engine).close();
      },
      () => this.recordings.close(),
      () => this.tests.close(),
      () => this.reviews.close(),
      () => this.hot.close(),
      () => this.emulator.close(),
      () => this.diagnostics.lsp.close(),
      () => this.auth.close(),
      () => this.devices.close(),
      () => this.savedTrees.close(),
      () => this.cpu.close(),
      () => this.processes.close(),
      () => this.knowledge.close(),
      () => this.skillWorkflows.close(),
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
