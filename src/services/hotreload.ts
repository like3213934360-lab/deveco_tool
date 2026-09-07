import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { HvigorSession } from "./hvigor/session.js";
import { HotConfiguration, hotPaths } from "./hvigor/hot-config.js";
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
import { ProjectService, type Project } from "./project.js";
import { DeviceService } from "./device.js";
import { SignatureService } from "./signature.js";

type App = z.infer<typeof appSchema>;

export function sourceFiles(project: Project): Map<string, string> {
  return new Map(
    project.modules.flatMap((module) => {
      const root = path.join(module.root, "src");
      return fs.existsSync(root)
        ? walk(root).map((file) => [file, fileDigest(file)] as const)
        : [];
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
      if (["entry", "shared"].includes(types.get(name) ?? "")) {
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
  release: () => void;
  finished: Promise<void>;
  created: number;
}
export class HotReloadService {
  private readonly sessions = new Map<string, WatchSession>();
  private starting = 0;
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    readonly projects: ProjectService,
    readonly devices: DeviceService,
    readonly signatures: SignatureService,
  ) {}
  private key(project: Project) {
    return digest([project.root, project.product.name]);
  }
  async call(
    raw: unknown,
    project: Project,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const input = tools.hot_reload.schema.parse(raw),
      key = this.key(project);
    const session = this.sessions.get(key);
    if (input.action === "status")
      return session
        ? {
            active: session.connection.connected,
            project_path: project.root,
            product: project.product.name,
            target: session.target,
            created_at: new Date(session.created).toISOString(),
            log: this.store.artifact(
              currentTrace().run_id ?? "hot_reload",
              JSON.stringify(session.connection.log()),
              "application/json",
            ),
          }
        : { active: false };
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
          invariant(
            !session,
            "HOT_SESSION_EXISTS",
            "Stop the current watch before starting another",
          );
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
                    ["entry", "shared"].includes(
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
              const haps = this.projects
                .buildArtifacts(
                  project,
                  modules.map((m) => m.root),
                )
                .filter((a) => a.path.endsWith("-signed.hap"));
              invariant(
                haps.length === 1 && haps[0],
                "HOT_BASE_ARTIFACT_AMBIGUOUS",
                "Select one signed application module for hot reload",
              );
              await this.store.lease(
                `device:${target}`,
                () =>
                  this.devices.deploy(
                    target,
                    haps[0]!.path,
                    input.app!,
                    signal,
                  ),
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
                release: hold.resolve,
                finished,
                created: Date.now(),
              });
              return {
                active: true,
                target,
                project_path: project.root,
                baseline_sha256: haps[0].sha256,
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
            () => this.apply(session, input.files, signal),
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
      _: [watch ? "assembleHap" : "assembleDevHqf"],
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
      incremental: true,
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
    const changes = hotChanges(project, changed),
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
      let version = 2000000;
      if (fs.existsSync(patchFile)) {
        const old = z
          .object({
            app: z.object({
              bundleName: z.string(),
              versionCode: z.number(),
              patchVersionCode: z.number().int().nonnegative(),
            }),
          })
          .parse(readObject(patchFile));
        invariant(
          old.app.bundleName === app.bundle_name &&
            old.app.versionCode === appInfo.versionCode,
          "HOT_PATCH_BASE_CHANGED",
          "Existing patch belongs to a different application version",
        );
        version = old.app.patchVersionCode + 1;
      }
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
    const temporary = fs.mkdtempSync(path.join(this.store.root, "hot-patch-")),
      remote = `/data/local/tmp/deveco-hqf-${crypto.randomUUID()}`;
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
        await this.signatures.call(
          { action: "sign", file: unsigned, output: signed },
          project,
          signal,
        );
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
      await this.devices.shell(target, ["mkdir", "-p", remote], signal);
      const remoteFiles: string[] = [];
      for (const file of patches) {
        const dest = `${remote}/${path.basename(file)}`;
        await this.devices.command(
          ["-t", target, "file", "send", file, dest],
          signal,
        );
        remoteFiles.push(dest);
      }
      const receipt = await this.devices.shell(
        target,
        ["bm", "quickfix", "-a", "-f", ...remoteFiles, "-d", "-o"],
        signal,
        180000,
      );
      invariant(
        /succe(?:ss|ed)/i.test(receipt.stdout) &&
          !/fail|error:/i.test(receipt.stdout),
        "HOT_APPLY_UNCONFIRMED",
        "Device did not confirm quickfix application",
      );
      const after = (
        await this.devices.shell(target, ["pidof", app.bundle_name], signal)
      ).stdout.trim();
      invariant(
        after === before,
        "HOT_APP_RESTARTED",
        "Application process changed during hot reload",
      );
      this.devices.invalidate(target);
      session.files = current;
      return {
        applied: true,
        processPreserved: true,
        outcomeVerified: false,
        patch_versions: patchVersions,
        files: changed.length,
        receipt: this.store.artifact(
          currentTrace().run_id ?? "hot_reload",
          receipt.stdout,
        ),
        compile_log: this.store.artifact(
          currentTrace().run_id ?? "hot_reload",
          JSON.stringify(session.connection.log()),
          "application/json",
        ),
      };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
      await this.devices
        .shell(target, ["rm", "-rf", remote], undefined, 10000)
        .catch(() => {});
    }
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
