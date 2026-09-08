import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { captureFile, capturedFileSchema, verifyCapturedFile } from "../core/captured-file.js";
import { DeviceEffectJournal, type DeviceReceipt } from "./device-effect.js";
import { withTrace } from "../core/trace.js";
import { z } from "zod";
import { HvigorSession } from "./hvigor/session.js";
import { HotConfiguration, hotPaths, assertNoHotWatch } from "./hvigor/hot-config.js";
import type { BuildOptions } from "./hvigor/protocol.js";
import { appSchema, tools } from "../core/contracts.js";
import { invariant, object, ToolError } from "../core/errors.js";
import {
  atomicWrite,
  digest,
  fileDigest,
  inside,
  privateDirectory,
  readObject,
  walk,
} from "../core/files.js";
import {
  discoverToolchain,
  component,
  type Toolchain,
} from "../core/toolchain.js";
import { ProcessService } from "../core/process.js";
import { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import { ProjectService, projectTargets, type Project, type ProjectSelection } from "./project.js";
import { DeviceService } from "./device.js";
import { SignatureService } from "./signature.js";
import { inspectApplicationPackages, readPackageMetadata } from "./package.js";

type App = z.infer<typeof appSchema>;

function hotModuleType(module: Project["modules"][number]): string {
  return z.object({ module: z.object({ type: z.string() }) })
    .parse(readObject(path.join(module.root, "src/main/module.json5"))).module.type;
}

/** HSPs need their own assembly task, while both entry and feature produce HAPs. */
export function hotBaselineTasks(modules: Project["modules"]): BuildOptions["_"] {
  const types = modules.map(hotModuleType);
  invariant(types.length > 0 && types.every((type) => ["entry", "feature", "shared"].includes(type)),
    "HOT_MODULE_INVALID", "Watch modules must be entry, feature or shared modules");
  return [
    ...(types.some((type) => type !== "shared") ? ["assembleHap" as const] : []),
    ...(types.includes("shared") ? ["assembleHsp" as const] : []),
  ];
}

/** Read the selected target's outputs and reject missing or stale module identities
 * before any device effect. The complete shared dependency set travels together. */
export async function hotBaselinePackages(projects: ProjectService, project: Project, modules: Project["modules"], app: App, signal?: AbortSignal) {
  const packages: { path: string; sha256: string; bytes: number }[] = [];
  const metadata: Awaited<ReturnType<typeof readPackageMetadata>>[] = [];
  for (const module of modules) {
    const type = hotModuleType(module), shared = type === "shared";
    const artifacts = projects.buildArtifacts(project, [module.root], shared ? "assembleHsp" : "assembleHap")
      .filter((artifact) => artifact.path.endsWith(shared ? "-signed.hsp" : "-signed.hap"));
    invariant(artifacts.length === 1, "HOT_BASE_ARTIFACT_AMBIGUOUS", `Expected one signed baseline for ${module.name}@${module.target}`);
    const artifact = artifacts[0]!, identity = await readPackageMetadata(artifact.path, signal);
    invariant(identity.module.name === module.name && identity.module.type === type,
      "HOT_BASE_MODULE_MISMATCH", "Watch baseline does not match its selected module");
    packages.push(artifact);
    metadata.push(identity);
  }
  await inspectApplicationPackages(packages.map((artifact) => artifact.path), app, signal);
  for (const item of metadata) for (const dependency of item.module.dependencies) {
    invariant((!dependency.bundleName || dependency.bundleName === app.bundle_name) &&
      metadata.some((other) => other.module.type === "shared" && other.module.name === dependency.moduleName),
      "HOT_BASE_DEPENDENCY_MISSING", "Include every application HSP dependency in the watch module selection");
  }
  return packages;
}

/** A package set has one patch version, even after only one module changed. */
export function nextHotPatchVersion(modules: Project["modules"], app: { bundleName: string; versionCode: number }): number {
  let version = 2000000;
  for (const module of modules) {
    const patchFile = path.join(module.root, "patch.json");
    if (!fs.existsSync(patchFile)) continue;
    const old = z.object({ app: z.object({
      bundleName: z.string(), versionCode: z.number(),
      patchVersionCode: z.number().int().nonnegative().max(2147483646),
    }) }).parse(readObject(patchFile));
    invariant(old.app.bundleName === app.bundleName && old.app.versionCode === app.versionCode,
      "HOT_PATCH_BASE_CHANGED", "Existing patch belongs to a different application version");
    version = Math.max(version, old.app.patchVersionCode + 1);
  }
  return version;
}

export function sourceFiles(project: Project): Map<string, string> {
  return new Map(
    project.modules.flatMap((module) => {
      const root = path.join(module.root, "src");
      // Libraries commonly expose Index.ets beside oh-package.json5. Such
      // sources still belong to the watch baseline even though they are outside src.
      const files = new Set([
        ...(fs.existsSync(root) ? walk(root) : []),
        ...walk(module.root, new Set([".ets", ".ts"]))
          .filter((file) => file !== path.join(module.root, "hvigorfile.ts")),
      ]);
      return [...files].map((file) => [file, fileDigest(file)] as const);
    }),
  );
}
export function assertHotSourcesUnchanged(
  project: Project,
  baseline: Map<string, string>,
) {
  invariant(
    digest([...sourceFiles(project)]) === digest([...baseline]),
    "HOT_SOURCE_CHANGED",
    "Sources changed during compilation; rebuild from a stable source baseline before deploying",
  );
}
export function hotChanges(
  project: Project,
  files: string[],
): Map<string, string[]> {
  const types = new Map(
    project.modules.map((m) => [
      m.name,
      z
        .string()
        .parse(
          object(readObject(path.join(m.root, "src/main/module.json5")).module)
            .type,
        ),
    ]),
  );
  const reverse = new Map<string, string[]>();
  for (const module of project.modules) {
    const dependencies = object(
      readObject(path.join(module.root, "oh-package.json5")).dependencies ?? {},
    );
    for (const value of Object.values(dependencies)) {
      if (
        typeof value !== "string" ||
        (!value.startsWith("file:") && !value.startsWith("."))
      )
        continue;
      const root = path.resolve(module.root, value.replace(/^file:/, "")),
        dependency = project.modules.find((m) => m.root === root);
      if (!dependency) continue;
      reverse.set(dependency.name, [
        ...(reverse.get(dependency.name) ?? []),
        module.name,
      ]);
    }
  }
  const result = new Map<string, string[]>();
  for (const input of files) {
    const file = fs.realpathSync.native(inside(project.root, input));
    invariant(
      /\.(ets|ts)$/.test(file),
      "COLD_DEPLOY_REQUIRED",
      `This changed file requires a cold incremental build/deploy: ${file}`,
    );
    const owner = project.modules
      .filter((m) => file.startsWith(m.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
    invariant(owner, "HOT_FILE_UNMAPPED", "Changed file has no project module");
    const pending = [owner.name],
      seen = new Set<string>();
    let consumers = 0;
    while (pending.length) {
      const name = pending.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      if (["entry", "feature", "shared"].includes(types.get(name) ?? "")) {
        result.set(name, [...(result.get(name) ?? []), file]);
        consumers++;
      } else pending.push(...(reverse.get(name) ?? []));
    }
    invariant(
      consumers > 0,
      "HOT_FILE_UNMAPPED",
      "No runnable consumer for changed source",
    );
  }
  return result;
}
interface WatchSession {
  project: Project;
  target: string;
  deviceType: string;
  app: App;
  modules: Project["modules"];
  connection: HvigorSession;
  configuration: HotConfiguration;
  toolchain: Toolchain;
  guard: ReturnType<StateStore["trackExternalSession"]>;
  files: Map<string, string>;
  patchedFiles: Set<string>;
  release: () => void;
  finished: Promise<void>;
  created: number;
  lastUsed: number;
  startedRun?: string;
}
const readyPatchSchema = z.object({
  target: z.string(), app: appSchema, before_pid: z.string(),
  sources: z.array(z.tuple([z.string(), z.string()])),
  patched_files: z.array(z.string()).min(1),
  patches: z.array(capturedFileSchema).min(1).max(64),
  patch_versions: z.record(z.string(), z.number()), changed_files: z.number(),
  toolchain_hash: z.string(), compile_log: z.object({ artifact_id: z.string(), bytes: z.number(), mime: z.string() }).passthrough(),
});
type ReadyPatch = z.infer<typeof readyPatchSchema>;
export class HotReloadService {
  private readonly sessions = new Map<string, WatchSession>();
  private starting = 0;
  private readonly idleTimer: NodeJS.Timeout;
  private sweeping = false;
  private closing = false;
  get processIds(): number[] {
    return [...new Set([...this.sessions.values()].flatMap(({ connection }) =>
      [connection.identity.pid, connection.identity.worker_pid].filter((pid): pid is number => typeof pid === "number"),
    ))];
  }
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    readonly projects: ProjectService,
    readonly devices: DeviceService,
    readonly signatures: SignatureService,
    private readonly assertDeviceIdle: (target: string) => void,
  ) {
    this.idleTimer = setInterval(() => { void this.reapIdle(); }, 60000);
    this.idleTimer.unref();
  }
  private async reapIdle() {
    if (this.sweeping || this.closing) return;
    this.sweeping = true;
    try {
      for (const [key, session] of this.sessions) {
        if (Date.now() - session.lastUsed < 30 * 60000) continue;
        await this.store.lease(`project:${session.project.root}`, async () => {
          if (!this.closing && this.sessions.get(key) === session && Date.now() - session.lastUsed >= 30 * 60000) await this.stop(key, session);
        });
      }
    } catch (error) {
      try { this.store.event(null, "hot_idle_cleanup_failed", { message: error instanceof Error ? error.message : "Watch cleanup failed" }); } catch { /* Retain ownership if cleanup is unconfirmed. */ }
    } finally { this.sweeping = false; }
  }
  activeTarget(project: Project): string | undefined { return this.sessions.get(this.key(project))?.target; }
  private key(project: ProjectSelection) {
    return digest([project.root, project.product.name, projectTargets(project)]);
  }
  status(project: ProjectSelection) {
    const session = this.sessions.get(this.key(project));
    if (!session) return { active: false };
    session.lastUsed = Date.now();
    return {
      active: session.connection.connected,
      project_path: project.root,
      product: project.product.name,
      module_targets: projectTargets(project),
      target: session.target,
      created_at: new Date(session.created).toISOString(),
      log: this.store.artifact(
        currentTrace().run_id ?? "hot_reload",
        JSON.stringify(session.connection.log()),
        "application/json",
      ),
    };
  }
  async call(
    raw: unknown,
    project: Project,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const input = tools.hot_reload.schema.parse(raw),
      key = this.key(project);
    const session = this.sessions.get(key);
    if (session) session.lastUsed = Date.now();
    if (input.action === "status") return this.status(project);
    if (input.action === "stop" && !session) {
      // A restarted runtime may restore generated config only after both the
      // previous runtime and every recorded owned SDK process are absent.
      for (const guard of this.store
        .externalGuards()
        .filter(
          (item) =>
            item.kind === "hvigor_watch" &&
            (JSON.parse(item.resources) as string[]).includes(
              `project:${project.root}`,
            ),
        )) {
        this.store.recoverExternalSession(guard.id, (kind, metadata) => {
          invariant(
            kind === "hvigor_watch",
            "SESSION_NOT_RECOVERABLE",
            "Unexpected SDK session kind",
          );
          const identity = z
            .strictObject({
              pid: z.number().int().positive(),
              worker_pid: z.number().int().positive(),
            })
            .parse(metadata);
          for (const pid of [
            identity.pid,
            identity.worker_pid,
            ...(process.platform === "win32" ? [] : [-identity.pid]),
          ]) {
            let absent = false;
            try {
              process.kill(pid, 0);
            } catch (error) {
              absent = (error as NodeJS.ErrnoException).code === "ESRCH";
            }
            invariant(
              absent,
              "CANCEL_UNCONFIRMED",
              "An owned SDK process is still running or cannot be verified",
            );
          }
        });
      }
    }
    return this.store.lease(
      `project:${project.root}`,
      async () => {
        const session = this.sessions.get(key);
        if (input.action === "stop") {
          if (!session) {
            HotConfiguration.recover(project);
            return { active: false, configuration_recovered: true };
          }
          await this.stop(key, session);
          return { active: false, closureAcknowledged: true };
        }
        if (input.action === "start") {
          if (session?.startedRun && session.startedRun === currentTrace().run_id) return { active: session.connection.connected, target: session.target, project_path: project.root, recovered: true };
          invariant(
            !session,
            "HOT_SESSION_EXISTS",
            "Stop the current watch before starting another",
          );
          // A peer owns watch for its entire session but releases project after
          // startup. Never hold project while waiting for that peer's watch lock:
          // its apply/stop operations need project to make progress.
          assertNoHotWatch(project);
          invariant(
            this.sessions.size + this.starting < 4,
            "HOT_SESSION_LIMIT",
            "At most four watch sessions",
          );
          invariant(
            input.app,
            "HOT_APP_REQUIRED",
            "Starting watch requires an application",
          );
          this.starting++;
          try {
            const target = await this.devices.target(input.target, signal),
              modules = input.modules
                ? project.modules.filter((m) => input.modules!.includes(m.name))
                : project.modules.filter((m) =>
                    ["entry", "feature", "shared"].includes(
                      String(
                        object(
                          readObject(path.join(m.root, "src/main/module.json5"))
                            .module,
                        ).type,
                      ),
                    ),
                  );
            invariant(
              modules.length > 0 &&
                (!input.modules ||
                  modules.length === new Set(input.modules).size),
              "HOT_MODULE_INVALID",
              "Invalid runnable module selection",
            );
            hotBaselineTasks(modules);
            this.assertDeviceIdle(target);
            this.signatures.projectOptions(project); // Fail before building/installing if patch signing cannot work.
            const deviceType = (
              await this.devices.shell(
                target,
                ["param", "get", "const.product.devicetype"],
                signal,
              )
            ).stdout.trim();
            invariant(
              /^[a-z][a-z0-9_]{0,31}$/.test(deviceType),
              "DEVICE_TYPE_UNAVAILABLE",
              "Device did not report a usable toolchain device type",
            );
            const hold = Promise.withResolvers<void>(),
              acquired = Promise.withResolvers<void>();
            const finished = this.store.lease(
              `watch:${project.root}`,
              async () => {
                acquired.resolve();
                await hold.promise;
              },
              signal,
            );
            void finished.catch(acquired.reject);
            await acquired.promise;
            let connection: HvigorSession | undefined;
            let configuration: HotConfiguration | undefined;
            let guard:
              ReturnType<StateStore["trackExternalSession"]> | undefined;
            try {
              await this.projects.sync(project, true, signal);
              configuration = HotConfiguration.prepare(project, modules);
              const toolchain = discoverToolchain();
              connection = await HvigorSession.open(
                this.processes,
                toolchain,
                project.root,
                signal,
              );
              guard = this.store.trackExternalSession(
                "hvigor_watch",
                [`project:${project.root}`, `watch:${project.root}`],
                connection.identity,
              );
              const baseline = sourceFiles(project);
              await connection.build(
                this.options(project, modules, true, deviceType, toolchain.sdk),
                signal,
              );
              assertHotSourcesUnchanged(project, baseline);
              const packages = await hotBaselinePackages(this.projects, project, modules, input.app, signal);
              await this.store.lease(
                `device:${target}`,
                () => {
                  // A recording can start in another project/process during the
                  // baseline build. Recheck only after acquiring the device.
                  this.assertDeviceIdle(target);
                  return this.devices.deploy(
                    target,
                    packages.map((artifact) => artifact.path),
                    input.app!,
                    signal,
                  );
                },
                signal,
              );
              this.sessions.set(key, {
                project,
                target,
                deviceType,
                app: input.app,
                modules,
                connection,
                configuration,
                toolchain,
                guard,
                // Edits made during device installation belong to the next patch,
                // not to the already compiled and installed baseline.
                files: baseline,
                patchedFiles: new Set(),
                release: hold.resolve,
                finished,
                created: Date.now(),
                lastUsed: Date.now(),
                startedRun: currentTrace().run_id,
              });
              return {
                active: true,
                target,
                project_path: project.root,
                baseline_packages: packages,
              };
            } catch (error) {
              try {
                if (connection) await connection.stop();
                configuration?.restore();
                guard?.confirmClosed();
              } catch (stopError) {
                guard?.unconfirmed();
                throw stopError;
              } finally {
                hold.resolve();
                await finished;
              }
              throw error;
            }
          } finally {
            this.starting--;
          }
        }
        const prepared = await this.store.readPrivateMemo("hot-ready", { project: project.root, product: project.product.name, module_targets: projectTargets(project) }, (value) => readyPatchSchema.parse(value));
        if (prepared) return this.finishApply(project, prepared, signal);
        invariant(
          session,
          "HOT_SESSION_REQUIRED",
          "Start a native watch session before applying",
        );
        invariant(
          session.project.fingerprint === project.fingerprint,
          "HOT_PROJECT_CHANGED",
          "Project configuration changed; restart the watch",
        );
        invariant(
          !input.target || input.target === session.target,
          "HOT_TARGET_CHANGED",
          "Watch target cannot change",
        );
        try {
          return await this.store.lease(
            `device:${session.target}`,
            () => {
              this.assertDeviceIdle(session.target);
              return this.apply(session, input.files, signal);
            },
            signal,
          );
        } catch (error) {
          if (!session.connection.connected) await this.stop(key, session);
          throw error;
        }
      },
      signal,
    );
  }
  private options(
    project: Project,
    modules: Project["modules"],
    watch: boolean,
    deviceType: string,
    sdk: string,
  ): BuildOptions {
    return {
      _: watch ? hotBaselineTasks(modules) : ["assembleDevHqf"],
      mode: "module",
      daemon: true,
      ...(watch ? { watch: true, hotReloadBuild: true } : { hotCompile: true }),
      prop: [
        `module=${modules.map((m) => `${m.name}@${m.target}`).join(",")}`,
        `product=${project.product.name}`,
        "debuggable=true",
        "hotReload=true",
        `requiredDeviceType=${deviceType}`,
      ],
      parallel: true,
      // An on-disk UP-TO-DATE result cannot recreate a previous process's watch
      // workers. Every new baseline must execute the SDK's watch compile tasks.
      incremental: !watch,
      analyze: "normal",
      env: { DEVECO_SDK_HOME: sdk },
    };
  }
  private async apply(
    session: WatchSession,
    requested: string[] | undefined,
    signal?: AbortSignal,
  ) {
    invariant(
      digest(discoverToolchain()) === digest(session.toolchain),
      "HOT_TOOLCHAIN_CHANGED",
      "Toolchain changed since the watch baseline; stop and restart the session",
    );
    const { project, target, app } = session,
      current = sourceFiles(project),
      changed = [
        ...new Set([...current.keys(), ...session.files.keys()]),
      ].filter((file) => current.get(file) !== session.files.get(file));
    invariant(
      changed.length > 0,
      "HOT_NO_CHANGES",
      "No source changes since the last successful apply",
    );
    if (requested) {
      const supplied = new Set(
        requested.map((file) => inside(project.root, file)),
      );
      invariant(
        changed.every((file) => supplied.has(file)),
        "HOT_CHANGED_FILES_INCOMPLETE",
        "Supply every change or omit files to detect them",
      );
    }
    invariant(
      changed.every((file) => current.has(file) && session.files.has(file)),
      "COLD_DEPLOY_REQUIRED",
      "Added or removed files require cold incremental deployment",
    );
    // Each HQF replaces that module's previous patch against the installed
    // baseline. Retain earlier changed files, including explicit reversions,
    // so a later edit cannot silently restore a previously patched HAR body.
    const patchedFiles = [...new Set([...session.patchedFiles, ...changed])];
    const changes = hotChanges(project, patchedFiles),
      modules = project.modules.filter((m) => changes.has(m.name));
    invariant(
      modules.every((m) => session.modules.some((w) => w.name === m.name)),
      "HOT_MODULE_NOT_WATCHED",
      "A changed consumer is outside this watch session",
    );
    const appInfo = z
      .object({
        bundleName: z.string(),
        versionCode: z.number().int().positive(),
      })
      .parse(
        object(readObject(path.join(project.root, "AppScope/app.json5")).app),
      );
    invariant(
      appInfo.bundleName === app.bundle_name,
      "HOT_BUNDLE_MISMATCH",
      "Watch application does not match the project",
    );
    const version = nextHotPatchVersion(session.modules, appInfo);
    const patchVersions: Record<string, number> = {};
    for (const module of modules) {
      const entries = changes.get(module.name)!,
        base = path.join(
          module.root,
          "build",
          project.product.name,
          "intermediates",
        );
      for (const [file, data] of [
        [
          path.join(base, "hotReload/changedFileList.json"),
          {
            modifiedFilesV2: entries.map((filePath) => ({
              filePath,
              belongProjectPath: project.root,
            })),
          },
        ],
        [
          path.join(base, "patch", module.target, "changedFileList.json"),
          {
            resources: { resFile: [], rawFile: [] },
            modifiedFiles: entries.map((file) =>
              path
                .relative(path.join(module.root, "src/main/ets"), file)
                .replaceAll("\\", "/"),
            ),
          },
        ],
      ] as const) {
        privateDirectory(path.dirname(file));
        atomicWrite(file, JSON.stringify(data));
      }
      const patchFile = path.join(module.root, "patch.json");
      patchVersions[module.name] = version;
      atomicWrite(
        patchFile,
        JSON.stringify({
          app: { ...appInfo, patchVersionCode: version },
          module: { name: module.name, type: "hotreload" },
        }),
      );
    }
    // A success frame is insufficient: old output must never be signed as a new patch.
    for (const module of modules)
      fs.rmSync(hotPaths(project, module).abc, { force: true });
    await session.connection.build(
      this.options(
        project,
        session.modules,
        false,
        session.deviceType,
        session.toolchain.sdk,
      ),
      signal,
    );
    const temporary = fs.mkdtempSync(path.join(this.store.root, "hot-patch-"));
    try {
      const toolchain = session.toolchain,
        packer = path.join(
          path.dirname(component(toolchain, "signer")),
          "app_packing_tool.jar",
        );
      invariant(
        fs.existsSync(packer),
        "CAPABILITY_UNAVAILABLE",
        "SDK HQF packer is missing",
      );
      const patches: string[] = [];
      for (const module of modules) {
        const abc = path.join(
          module.root,
          "build",
          project.product.name,
          "intermediates/hotReload/patchAbcPath/ets/modules.abc",
        );
        invariant(
          fs.existsSync(abc) && fs.statSync(abc).size > 0,
          "HOT_PATCH_MISSING",
          "SDK did not produce a patch ABC",
        );
        const unsigned = path.join(temporary, `${module.name}-unsigned.hqf`),
          signed = path.join(temporary, `${module.name}-signed.hqf`);
        await this.processes.run(
          {
            executable: component(toolchain, "java"),
            args: [
              "-jar",
              packer,
              "--mode",
              "hqf",
              "--json-path",
              path.join(module.root, "patch.json"),
              "--ets-path",
              path.dirname(abc),
              "--out-path",
              unsigned,
              "--force",
              "true",
            ],
            cwd: project.root,
          },
          { signal, timeoutMs: 120000 },
        );
        await withTrace({ node: `${currentTrace().node ?? "hot"}:sign:${module.name}` }, () => this.signatures.call(
          { action: "sign", file: unsigned, output: signed }, project, signal,
        ));
        patches.push(signed);
      }
      const before = (
        await this.devices.shell(target, ["pidof", app.bundle_name], signal)
      ).stdout.trim();
      invariant(
        /^\d+(?:\s+\d+)*$/.test(before),
        "HOT_APP_NOT_RUNNING",
        "Application must already be running",
      );
      assertHotSourcesUnchanged(project, current);
      const retained: ReadyPatch["patches"] = [];
      for (const file of patches) retained.push(await captureFile(this.store, currentTrace().run_id ?? "hot_reload", file, undefined, signal));
      const prepared = await this.store.privateMemo("hot-ready", { project: project.root, product: project.product.name, module_targets: projectTargets(project) }, async () => ({
        target, app, before_pid: before, sources: [...current], patched_files: patchedFiles, patches: retained,
        patch_versions: patchVersions, changed_files: changed.length, toolchain_hash: digest(toolchain),
        compile_log: this.store.artifact(currentTrace().run_id ?? "hot_reload", JSON.stringify(session.connection.log()), "application/json"),
      }), (value) => readyPatchSchema.parse(value));
      return await this.finishApply(project, prepared, signal);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  private async finishApply(project: Project, prepared: ReadyPatch, signal?: AbortSignal) {
    invariant(digest(discoverToolchain()) === prepared.toolchain_hash, "HOT_TOOLCHAIN_CHANGED", "Prepared patch belongs to another toolchain");
    assertHotSourcesUnchanged(project, new Map(prepared.sources));
    const { target, app } = prepared;
    return this.store.lease(`device:${target}`, async () => {
      this.assertDeviceIdle(target);
      for (const file of prepared.patches) await verifyCapturedFile(file, signal);
      const trace = currentTrace(), remote = `/data/local/tmp/deveco-hqf-${digest({ state: this.store.root, run: trace.run_id, node: trace.node, prepared })}`;
      const remoteFiles = prepared.patches.map((file, index) => `${remote}/${index}-${file.sha256}.hqf`);
      const durable = !!trace.run_id && !!trace.node;
      const dispatched = durable && this.store.operationState(trace.run_id!, `${trace.node}:device:quickfix`) !== undefined;
      if (!dispatched) {
        const pid = (await this.devices.shell(target, ["pidof", app.bundle_name], signal)).stdout.trim();
        invariant(pid === prepared.before_pid, "HOT_APP_RESTARTED", "Prepared patch requires the original application process");
        await this.devices.shell(target, ["sh", "-c", `test ! -L '${remote}' && { test -d '${remote}' || mkdir -m 700 '${remote}'; }`], signal);
        for (const [index, file] of prepared.patches.entries()) {
          await this.devices.command(["-t", target, "file", "send", file.path, remoteFiles[index]!], signal);
          const hash = (await this.devices.shell(target, ["sha256sum", remoteFiles[index]!], signal)).stdout.trim().split(/\s+/)[0];
          invariant(hash === file.sha256, "HOT_UPLOAD_CHANGED", "Device patch digest did not match its captured artifact");
        }
      }
      const args = ["bm", "quickfix", "-a", "-f", ...remoteFiles, "-d", "-o"];
      const accept = (receipt: DeviceReceipt) => {
        if (receipt.exitCode !== 0 || !/succe(?:ss|ed)/i.test(receipt.stdout) || /fail|error:/i.test(receipt.stdout)) {
          throw new ToolError("HOT_APPLY_UNCONFIRMED", "Device did not confirm quickfix application", {
            exitCode: receipt.exitCode,
            receipt: this.store.artifact(trace.run_id ?? "hot_reload", receipt.stdout),
          });
        }
        return { accepted: true, stdout: receipt.stdout };
      };
      const receipt = durable ? await new DeviceEffectJournal(this.store, this.devices).run(target, "quickfix", args, accept, signal, false, 180000)
        : accept(await this.devices.shell(target, args, signal, 180000));
      invariant(receipt, "HOT_APPLY_UNCONFIRMED", "Quickfix has no matching completion receipt");
      // Never remove an uncertain operation's files. The device journal commits before this cleanup.
      await this.devices.shell(target, ["rm", "-rf", remote], undefined, 10000).catch(() => {});
      const after = (await this.devices.shell(target, ["pidof", app.bundle_name], signal)).stdout.trim();
      invariant(after === prepared.before_pid, "HOT_APP_RESTARTED", "Application process changed during hot reload");
      this.devices.invalidate(target);
      const session = this.sessions.get(this.key(project));
      if (session) { session.files = new Map(prepared.sources); session.patchedFiles = new Set(prepared.patched_files); session.lastUsed = Date.now(); }
      return { applied: true, processPreserved: true, outcomeVerified: false, patch_versions: prepared.patch_versions,
        files: prepared.changed_files, receipt: this.store.artifact(trace.run_id ?? "hot_reload", receipt.stdout), compile_log: prepared.compile_log };
    }, signal);
  }

  private async stop(key: string, session: WatchSession) {
    try {
      await session.connection.stop();
      session.configuration.restore();
      session.guard.confirmClosed();
    } catch (error) {
      session.guard.unconfirmed();
      throw error;
    }
    session.release();
    await session.finished;
    this.sessions.delete(key);
  }
  async close() {
    this.closing = true;
    clearInterval(this.idleTimer);
    const results = await Promise.allSettled(
      [...this.sessions].map(([key, session]) => this.stop(key, session)),
    );
    for (const session of this.sessions.values()) {
      session.guard.unconfirmed();
      session.release();
      await session.finished;
    }
    this.sessions.clear();
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
