import { assertNoHotWatch } from "./hvigor/hot-config.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { configuration, resourceRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import {
  atomicWrite,
  digest,
  destinationPath,
  fileDigest,
  inside,
  readObject,
  walk,
} from "../core/files.js";
import {
  discoverToolchain,
  toolCommand,
  type Toolchain,
} from "../core/toolchain.js";
import {
  ProcessService,
  type Command,
  type ProcessOptions,
  type ProcessResult,
} from "../core/process.js";
import { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import { ManagedCommand } from "../core/managed-command.js";
import { BuildDiagnostics } from "../core/build-diagnostics.js";
import { readPackageMetadata } from "./package.js";
import { moduleTargetsSchema, projectAppNameSchema, projectBundleNameSchema, projectCompatibleApiSchema, projectTargetApiSchema, type ModuleTargets, type ProjectCreateInput } from "../core/contracts.js";

const sdkVersion = z.union([
  z.number().int().positive(),
  z.string().regex(/^(?:\d+|\d+\.\d+\.\d+(?:\(\d+\))?)$/),
]);
/** HarmonyOS build profiles require the SDK's platform spelling, not a bare
 * API integer. Read the installed version map so upstream releases supply the
 * mapping; never invent a platform version for an unknown API. */
function runtimeSdkVersion(toolchain: Toolchain, api: number, compileApi: number, platformVersion: string): string {
  if (api === compileApi) return sdkVersion.and(z.string()).parse(platformVersion);
  const file = path.join(toolchain.sdk, "default/hms/ets/build-tools/ts-checker-hooks/sdkApiVersionMap.json");
  invariant(fs.existsSync(file), "SDK_API_MAPPING_UNAVAILABLE", "The installed SDK does not provide its HarmonyOS runtime API version map");
  const versions = z.record(z.string(), z.array(z.string())).parse(readObject(file));
  const candidates = new Set(Object.values(versions).flat().filter((value) => {
    const match = /^(\d+)\.\d+\.\d+(?:\((\d+)\))?(?![\s\S])/.exec(value);
    return match && Number(match[2] ?? match[1]) === api;
  }));
  invariant(candidates.size === 1, "SDK_API_MAPPING_UNAVAILABLE", `Installed SDK must declare exactly one HarmonyOS platform version for API ${api}`);
  return [...candidates][0]!;
}
const productSchema = z.object({
  name: z.string().min(1),
  compileSdkVersion: sdkVersion.optional(),
  compatibleSdkVersion: sdkVersion,
  targetSdkVersion: sdkVersion.optional(),
  runtimeOS: z.enum(["HarmonyOS", "OpenHarmony"]).default("HarmonyOS"),
  signingConfig: z.string().optional(),
});
const profileSchema = z.object({
  app: z.object({
    compileSdkVersion: sdkVersion.optional(),
    compatibleSdkVersion: sdkVersion.optional(),
    targetSdkVersion: sdkVersion.optional(),
    products: z
      .array(
        productSchema.extend({ compatibleSdkVersion: sdkVersion.optional() }),
      )
      .min(1),
  }),
  modules: z
    .array(
      z.object({
        name: z.string().min(1),
        srcPath: z.string().min(1),
        targets: z
          .array(
            z.object({
              name: z.string(),
              applyToProducts: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});
const syncedSchema = z.object({
  project_path: z.string(),
  synced: z.literal(true),
  elapsedMs: z.number(),
  model: z.object({ product: z.string(), modules: z.array(z.string()) }),
});
const builtSchema = z.object({
  success: z.literal(true),
  compilationVerified: z.literal(true),
  product: z.string(),
  artifacts: z.array(
    z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  ),
  diagnostics: z.object({
    counts: z.partialRecord(
      z.enum([
        "compilerError",
        "sdkCompatibility",
        "deprecatedApi",
        "dependencyBundling",
        "sourceMaps",
      ]),
      z.number(),
    ),
    examples: z.array(
      z.object({
        category: z.enum([
          "compilerError",
          "sdkCompatibility",
          "deprecatedApi",
          "dependencyBundling",
          "sourceMaps",
        ]),
        location: z.string().nullable(),
        message: z.string(),
      }),
    ),
    exampleLimits: z.object({
      compilerError: z.number(),
      sdkCompatibility: z.number(),
      deprecatedApi: z.number(),
      dependencyBundling: z.number(),
      sourceMaps: z.number(),
    }),
    scope: z.string(),
  }),
  elapsedMs: z.number(),
  output: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  log: z.unknown().optional(),
});
export interface ProjectSelection {
  root: string;
  product: z.infer<typeof productSchema>;
  modules: { name: string; root: string; target: string }[];
}
export interface Project extends ProjectSelection {
  fingerprint: string;
}
/** Persist the resolved selection, including implicit defaults, independently of the caller's object. */
export function projectTargets(project: ProjectSelection): ModuleTargets {
  return Object.fromEntries(project.modules.map((module) => [module.name, module.target]));
}
function readProjectProfile(candidate: string) {
  const root = fs.realpathSync.native(path.resolve(candidate));
  const file = path.join(root, "build-profile.json5");
  invariant(
    fs.existsSync(file),
    "PROJECT_INVALID",
    "build-profile.json5 is required",
  );
  const profile = profileSchema.parse(readObject(file));
  return { root, profile, file };
}
function inspectSelection(
  candidate: string,
  productName?: string,
  moduleTargets?: ModuleTargets,
): ProjectSelection {
  const { root, profile } = readProjectProfile(candidate);
  const requested = moduleTargetsSchema.parse(moduleTargets ?? {});
  for (const name of Object.keys(requested)) invariant(profile.modules.some((module) => module.name === name), "MODULE_INVALID", `Unknown module in module_targets: ${name}`);
  const selected = productName
    ? profile.app.products.find((item) => item.name === productName)
    : (profile.app.products.find((item) => item.name === "default") ??
      (profile.app.products.length === 1
        ? profile.app.products[0]
        : undefined));
  invariant(
    selected,
    "PRODUCT_AMBIGUOUS",
    "Specify exactly one existing product",
  );
  const product = productSchema.parse({
    ...selected,
    compileSdkVersion: selected.compileSdkVersion ?? profile.app.compileSdkVersion,
    compatibleSdkVersion:
      selected.compatibleSdkVersion ?? profile.app.compatibleSdkVersion,
    targetSdkVersion: selected.targetSdkVersion ?? profile.app.targetSdkVersion,
  });
  const modules = profile.modules
    .map((item) => {
      const targets = item.targets?.filter(
        (target) =>
          !target.applyToProducts ||
          target.applyToProducts.includes(product.name),
      ) ?? [{ name: "default" }];
      const explicit = Object.hasOwn(requested, item.name) ? requested[item.name] : undefined;
      if (explicit !== undefined) invariant(targets.some((target) => target.name === explicit), "TARGET_INVALID", `Target ${item.name}@${explicit} does not apply to product ${product.name}`);
      if (targets.length === 0) return undefined;
      const target =
        explicit !== undefined ? targets.find((target) => target.name === explicit) :
          (targets.find((target) => target.name === "default") ??
          (targets.length === 1 ? targets[0] : undefined));
      invariant(
        target,
        "TARGET_AMBIGUOUS",
        `Module ${item.name} has ambiguous targets for product ${product.name}; provide module_targets`,
      );
      const moduleRoot = fs.realpathSync.native(inside(root, item.srcPath));
      inside(root, moduleRoot);
      return { name: item.name, root: moduleRoot, target: target.name };
    })
    .filter(
      (module): module is { name: string; root: string; target: string } =>
        module !== undefined,
    );
  invariant(
    modules.length > 0,
    "PRODUCT_HAS_NO_MODULES",
    "No modules apply to the selected product",
  );
  return { root, product, modules };
}
export function inspectProject(candidate: string, productName?: string, moduleTargets?: ModuleTargets): Project {
  const selection = inspectSelection(candidate, productName, moduleTargets),
    { root, modules } = selection;
  const files = [
    path.join(root, "build-profile.json5"),
    path.join(root, "AppScope/app.json5"),
    path.join(root, "oh-package.json5"),
    path.join(root, "hvigor/hvigor-config.json5"),
    ...modules.flatMap((item) =>
      [
        "src/main/module.json5",
        "build-profile.json5",
        "oh-package.json5",
        "hvigorfile.ts",
      ].map((relative) => path.join(item.root, relative)),
    ),
  ].filter((item) => fs.existsSync(item));
  return {
    ...selection,
    fingerprint: digest({ files: files.map((file) => [file, fileDigest(file)]), product: selection.product.name, module_targets: projectTargets(selection) }),
  };
}
export class ProjectService {
  private selected: string | undefined = configuration().default_project;
  constructor(
    readonly processes: ProcessService,
    private readonly toolchain: () => Toolchain = discoverToolchain,
    private readonly store?: StateStore,
  ) {}
  private async runCommand<T>(
    name: string,
    command: Command,
    options: Pick<ProcessOptions, "signal" | "timeoutMs" | "onOutput">,
    collect: (result: ProcessResult) => T,
    decode: (value: unknown) => T,
    files: (value: T) => readonly string[],
    mapFailure?: (error: ToolError) => ToolError,
  ): Promise<T> {
    const trace = currentTrace();
    if (this.store && trace.run_id && trace.node)
      return new ManagedCommand(this.store, this.processes).run(
        name,
        command,
        options,
        collect,
        decode,
        files,
        mapFailure,
      );
    try {
      return collect(await this.processes.run(command, options));
    } catch (error) {
      throw error instanceof ToolError && mapFailure
        ? mapFailure(error)
        : error;
    }
  }
  select(root: string) {
    // Selecting a project does not pick a product. A later operation must name
    // one when the project has several products and no unambiguous default.
    const project = readProjectProfile(root);
    this.selected = project.root;
    return { project_path: project.root };
  }
  resolve(root?: string, product?: string, moduleTargets?: ModuleTargets): Project {
    invariant(
      root || this.selected,
      "PROJECT_REQUIRED",
      "Specify project_path or switch_cwd",
    );
    return inspectProject(root || this.selected!, product, moduleTargets);
  }
  /** Read-only catalogs/session lookups need a current, validated selection,
   * but never consume build inputs. Tasks and language sessions use resolve()
   * to capture the full content fingerprint before they are submitted. */
  resolveSelection(root?: string, product?: string, moduleTargets?: ModuleTargets): ProjectSelection {
    invariant(root || this.selected, "PROJECT_REQUIRED", "Specify project_path or switch_cwd");
    return inspectSelection(root || this.selected!, product, moduleTargets);
  }
  async create(
    input: ProjectCreateInput,
    signal?: AbortSignal,
    operationId: string = crypto.randomUUID(),
  ) {
    signal?.throwIfAborted();
    const toolchain = this.toolchain();
    invariant(
      projectAppNameSchema.safeParse(input.app_name).success,
      "APP_NAME_INVALID",
      "Invalid application name",
    );
    invariant(
      projectBundleNameSchema.safeParse(input.bundle_name).success,
      "BUNDLE_INVALID",
      "Bundle name must contain 7–128 ASCII characters in at least three dot-separated segments, with no empty segments or edge underscores",
    );
    const root = destinationPath(input.project_path);
    const metadata = z
      .object({
        apiVersion: z.string(),
        platformVersion: z.string(),
        version: z.string(),
      })
      .parse(readObject(path.join(toolchain.sdk, "default/sdk-pkg.json")).data);
    const available = [
      metadata.apiVersion,
      metadata.platformVersion,
      `${metadata.platformVersion}(${metadata.apiVersion})`,
    ];
    invariant(
      available.includes(String(input.sdk_version)),
      "SDK_VERSION_UNAVAILABLE",
      `Requested SDK version is unavailable; installed API is ${metadata.apiVersion}`,
    );
    const compileApi = Number(metadata.apiVersion);
    invariant(Number.isSafeInteger(compileApi) && compileApi >= 8, "SDK_METADATA_INVALID", "Installed SDK metadata must declare a valid compile API");
    const targetApi = input.target_api ?? compileApi;
    const compatibleApi = input.compatible_api ?? targetApi;
    invariant(
      projectCompatibleApiSchema.safeParse(compatibleApi).success &&
        projectTargetApiSchema.safeParse(targetApi).success &&
        compatibleApi <= targetApi && targetApi <= compileApi,
      "SDK_API_RANGE_INVALID",
      `API levels must satisfy minimum compatible <= target <= installed compile API ${compileApi}`,
    );
    const targetVersion = runtimeSdkVersion(toolchain, targetApi, compileApi, metadata.platformVersion);
    const compatibleVersion = compatibleApi === targetApi ? targetVersion : runtimeSdkVersion(toolchain, compatibleApi, compileApi, metadata.platformVersion);
    fs.mkdirSync(path.dirname(root), { recursive: true });
    try {
      // The successful mkdir is the exclusive claim. An existence pre-check
      // followed by cp would merge with a directory created by another writer.
      fs.mkdirSync(root, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new ToolError(
          "PROJECT_EXISTS",
          "Project directory already exists; no files were changed",
        );
      throw error;
    }
    const receiptFile = path.join(root, ".deveco-mcp/create.json");
    const receipt = {
      operation_id: operationId,
      input_hash: digest({ ...input, project_path: root }),
    };
    atomicWrite(
      receiptFile,
      JSON.stringify({ ...receipt, status: "started" }),
      false,
    );
    const templateRoot = path.join(resourceRoot, "templates/application");
    // Copy children into the exclusively claimed root. Copying the template
    // directory itself would conflict with that root under errorOnExist.
    for (const entry of await fs.promises.readdir(templateRoot))
      await fs.promises.cp(
        path.join(templateRoot, entry),
        path.join(root, entry),
        {
          recursive: true,
          errorOnExist: true,
          force: false,
          filter: () => {
            signal?.throwIfAborted();
            return true;
          },
        },
      );
    signal?.throwIfAborted();
    for (const file of walk(root)) {
      if (path.basename(file) === "gitignore.txt")
        fs.renameSync(file, path.join(path.dirname(file), ".gitignore"));
    }
    const identity = readObject(path.join(root, "AppScope/app.json5"));
    identity.app = {
      ...z.record(z.string(), z.unknown()).parse(identity.app),
      bundleName: input.bundle_name,
    };
    atomicWrite(
      path.join(root, "AppScope/app.json5"),
      JSON.stringify(identity, null, 2),
    );
    atomicWrite(
      path.join(root, "AppScope/resources/base/element/string.json"),
      JSON.stringify(
        { string: [{ name: "app_name", value: input.app_name }] },
        null,
        2,
      ),
    );
    const profile = readObject(path.join(root, "build-profile.json5"));
    const app = z.record(z.string(), z.unknown()).parse(profile.app);
    app.products = [
      {
        name: "default",
        compileSdkVersion: metadata.platformVersion,
        compatibleSdkVersion: compatibleVersion,
        targetSdkVersion: targetVersion,
        runtimeOS: "HarmonyOS",
        buildOption: {
          strictMode: { caseSensitiveCheck: true, useNormalizedOHMUrl: true },
        },
      },
    ];
    profile.app = app;
    atomicWrite(
      path.join(root, "build-profile.json5"),
      JSON.stringify(profile, null, 2),
    );
    for (const relative of ["oh-package.json5", "hvigor/hvigor-config.json5"]) {
      const file = path.join(root, relative),
        config = readObject(file);
      config.modelVersion = metadata.platformVersion;
      atomicWrite(file, JSON.stringify(config, null, 2));
    }
    signal?.throwIfAborted();
    const project = inspectProject(root);
    const files = walk(root)
      .filter((file) => file !== receiptFile)
      .map((file) => ({
        file: path.relative(root, file).replaceAll("\\", "/"),
        sha256: fileDigest(file),
      }));
    atomicWrite(
      receiptFile,
      JSON.stringify({ ...receipt, status: "completed", files }),
    );
    return project;
  }
  reconcileCreate(
    input: ProjectCreateInput,
    operationId: string,
  ): Project | undefined {
    const root = destinationPath(input.project_path),
      receiptFile = path.join(root, ".deveco-mcp/create.json");
    if (!fs.existsSync(receiptFile)) return undefined;
    const parsed = z
      .object({
        operation_id: z.string(),
        input_hash: z.string(),
        status: z.literal("completed"),
        files: z
          .array(z.object({ file: z.string(), sha256: z.string() }))
          .min(1)
          .max(10000),
      })
      .safeParse(readObject(receiptFile));
    if (
      !parsed.success ||
      parsed.data.operation_id !== operationId ||
      parsed.data.input_hash !== digest({ ...input, project_path: root })
    )
      return undefined;
    for (const entry of parsed.data.files) {
      const file = inside(root, entry.file);
      if (
        !fs.existsSync(file) ||
        fs.lstatSync(file).isSymbolicLink() ||
        !fs.statSync(file).isFile() ||
        fileDigest(file) !== entry.sha256
      )
        return undefined;
      inside(root, fs.realpathSync.native(file));
    }
    return inspectProject(root);
  }
  async sync(project: Project, install = true, signal?: AbortSignal) {
    assertNoHotWatch(project);
    const toolchain = this.toolchain();
    if (install)
      await this.runCommand(
        "ohpm_install",
        toolCommand(toolchain, "ohpm", ["install", "--all"], project.root),
        { signal, timeoutMs: 600000 },
        () => ({ installed: true }),
        (value) => z.object({ installed: z.boolean() }).parse(value),
        () =>
          walk(project.root).filter(
            (file) => path.basename(file) === "oh-package-lock.json5",
          ),
      );
    return this.runCommand(
      "hvigor_sync",
      toolCommand(
        toolchain,
        "hvigor",
        [
          "--sync",
          "--no-daemon",
          "-p",
          `product=${project.product.name}`,
          "--analyze=normal",
          "--parallel",
          "--incremental",
        ],
        project.root,
      ),
      { signal, timeoutMs: 600000 },
      (result) => {
        const model = this.model(project);
        return syncedSchema.parse({
          project_path: project.root,
          synced: true,
          elapsedMs: result.elapsedMs,
          model: {
            product: project.product.name,
            modules: Object.keys(model).filter((key) =>
              key.startsWith("ohos-module-"),
            ),
          },
        });
      },
      (value) => syncedSchema.parse(value),
      () => [path.join(project.root, ".hvigor/outputs/sync/output.json")],
    );
  }
  async build(
    project: Project,
    input: {
      modules?: string[];
      module_targets?: ModuleTargets;
      mode?: string;
      clean?: boolean;
      task?: string;
      hotReload?: boolean;
      deviceType?: string;
    },
    signal?: AbortSignal,
  ) {
    assertNoHotWatch(project);
    const toolchain = this.toolchain();
    let modules = input.modules
      ? project.modules.filter((module) => input.modules!.includes(module.name))
      : project.modules;
    invariant(
      modules.length > 0 &&
        (!input.modules || modules.length === new Set(input.modules).size),
      "MODULE_INVALID",
      "Unknown or empty module selection",
    );
    const task = input.task ?? "assembleHap";
    // The SDK rejects non-HAR module selectors for assembleApp. Product packaging
    // chooses its own configured targets; do not silently ignore caller selectors.
    invariant(task !== "assembleApp" || (!input.modules && Object.keys(input.module_targets ?? {}).length === 0),
      "APP_TARGET_SELECTION_UNSUPPORTED", "assembleApp packages the product's configured targets; use assembleHap/Har/Hsp for explicit module or target selection");
    invariant(
      [
        "assembleHap",
        "assembleHar",
        "assembleHsp",
        "assembleApp",
        "compileNative",
      ].includes(task),
      "BUILD_TASK_INVALID",
      "Unsupported build task",
    );
    const kinds: Record<string, readonly string[]> = {
      assembleHap: ["entry", "feature"],
      assembleHar: ["har"],
      assembleHsp: ["shared"],
    };
    const supported = kinds[task];
    if (supported) {
      const matching = modules.filter((module) =>
        supported.includes(this.moduleType(module)),
      );
      invariant(
        matching.length > 0 &&
          (!input.modules || matching.length === modules.length),
        "MODULE_TASK_MISMATCH",
        "Selected module types do not support this build task",
      );
      modules = matching;
    }
    const args = [
      "--no-daemon",
      "--mode",
      task === "assembleApp" ? "project" : "module",
      "-p",
      `product=${project.product.name}`,
      "-p",
      `buildMode=${input.mode ?? "debug"}`,
    ];
    if (task !== "assembleApp")
      args.push(
        "-p",
        `module=${modules.map((module) => `${module.name}@${module.target}`).join(",")}`,
      );
    if (input.mode !== "release") args.push("-p", "debuggable=true");
    if (input.hotReload) {
      invariant(
        input.deviceType && /^[a-z][a-z0-9_]{0,31}$/.test(input.deviceType),
        "DEVICE_TYPE_REQUIRED",
        "Hot reload requires the captured device type",
      );
      args.push(
        "-p",
        "hotReload=true",
        "-p",
        `requiredDeviceType=${input.deviceType}`,
      );
    }
    args.push(
      ...(input.clean ? ["clean", task] : [task]),
      "--parallel",
      "--incremental",
    );
    const diagnostics = new BuildDiagnostics();
    return this.runCommand(
      `hvigor_${task}_${digest(modules.map((module) => module.name))}`,
      toolCommand(toolchain, "hvigor", args, project.root),
      {
        signal,
        timeoutMs: 1200000,
        onOutput: (name, chunk) => diagnostics.push(name, chunk),
      },
      (result) => {
        const artifacts =
          task === "compileNative"
            ? []
            : this.buildArtifacts(
                project,
                modules.map((module) => module.root),
                task,
              );
        if (task !== "compileNative")
          invariant(
            artifacts.length > 0,
            "BUILD_ARTIFACT_MISSING",
            "Build returned without a matching artifact",
          );
        return builtSchema.parse({
          success: true,
          compilationVerified: true,
          product: project.product.name,
          artifacts,
          diagnostics: diagnostics.finish(),
          elapsedMs: result.elapsedMs,
          output: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          log: result.log,
        });
      },
      (value) => builtSchema.parse(value),
      (value) => value.artifacts.map((artifact) => artifact.path),
      (error) =>
        error.code === "PROCESS_FAILED"
          ? new ToolError(
              "PROJECT_BUILD_FAILED",
              "Native compiler/build failed",
              { execution: error.details, diagnostics: diagnostics.finish() },
            )
          : error,
    );
  }
  private moduleType(module: Project["modules"][number]): string {
    return z
      .object({
        module: z.object({
          type: z.enum(["entry", "feature", "har", "shared"]),
        }),
      })
      .parse(readObject(path.join(module.root, "src/main/module.json5"))).module
      .type;
  }
  async buildApplication(
    project: Project,
    input: { modules?: string[]; mode?: string; clean?: boolean },
    signal?: AbortSignal,
  ) {
    const selected = input.modules
      ? project.modules.filter((module) => input.modules!.includes(module.name))
      : project.modules;
    invariant(
      selected.length > 0 &&
        (!input.modules || selected.length === new Set(input.modules).size),
      "MODULE_INVALID",
      "Unknown or empty module selection",
    );
    const haps = selected.filter((module) =>
      ["entry", "feature"].includes(this.moduleType(module)),
    );
    invariant(
      haps.length > 0,
      "DEPLOY_ARTIFACT_MISSING",
      "Select at least one launchable application module",
    );
    const result = await this.build(
      project,
      {
        ...input,
        modules: haps.map((module) => module.name),
        task: "assembleHap",
      },
      signal,
    );
    const artifacts = [...result.artifacts],
      built = new Set<string>(),
      pending = new Set<string>(),
      reports: { modules: string[]; elapsedMs: number }[] = [];
    // Respect explicitly requested HSPs and derive other shared dependencies
    // from the actual compiled package model, including transitive HSPs.
    for (const module of selected)
      if (input.modules && this.moduleType(module) === "shared")
        pending.add(module.name);
    let inspected = 0;
    for (;;) {
      while (inspected < artifacts.length) {
        const metadata = await readPackageMetadata(
          artifacts[inspected++]!.path,
          signal,
        );
        if (metadata.module.type === "shared") built.add(metadata.module.name);
        for (const dependency of metadata.module.dependencies) {
          invariant(
            !dependency.bundleName ||
              dependency.bundleName === metadata.app.bundleName,
            "DEPLOY_DEPENDENCY_UNAVAILABLE",
            "Application uses an external shared bundle that must be installed separately",
          );
          if (!built.has(dependency.moduleName))
            pending.add(dependency.moduleName);
        }
      }
      const names = [...pending].filter((name) => !built.has(name));
      pending.clear();
      if (!names.length) break;
      invariant(
        built.size + names.length <= 64,
        "PACKAGE_COUNT_INVALID",
        "Application shared dependency graph exceeds 64 modules",
      );
      for (const name of names) {
        const module = project.modules.find((module) => module.name === name);
        invariant(
          module && this.moduleType(module) === "shared",
          "DEPLOY_DEPENDENCY_UNAVAILABLE",
          `No selected-product HSP source exists for dependency ${name}`,
        );
      }
      const shared = await this.build(
        project,
        { ...input, modules: names, task: "assembleHsp" },
        signal,
      );
      for (const name of names) built.add(name);
      artifacts.push(...shared.artifacts);
      reports.push({ modules: names, elapsedMs: shared.elapsedMs });
    }
    return { ...result, artifacts, dependency_builds: reports };
  }
  model(project: Project): Record<string, unknown> {
    const file = path.join(project.root, ".hvigor/outputs/sync/output.json");
    invariant(
      fs.existsSync(file),
      "SYNC_MODEL_MISSING",
      "Synchronize the project to generate its SDK model",
    );
    const model = readObject(file);
    invariant(
      z.object({ SELECT_PRODUCT_NAME: z.string() }).parse(model["ohos-project"])
        .SELECT_PRODUCT_NAME === project.product.name,
      "SYNC_MODEL_PRODUCT_MISMATCH",
      "SDK model belongs to another product; synchronize this product",
    );
    for (const module of project.modules) {
      const item = z
        .object({ TARGETS: z.record(z.string(), z.unknown()) })
        .parse(model[`ohos-module-${module.name}`]);
      invariant(
        item.TARGETS[module.target],
        "SYNC_MODEL_TARGET_MISSING",
        `SDK model has no target ${module.name}@${module.target}`,
      );
    }
    return model;
  }
  buildArtifacts(
    project: Project,
    roots = project.modules.map((module) => module.root),
    task = "assembleHap",
  ): { path: string; sha256: string; bytes: number }[] {
    const model = this.model(project);
    const files: string[] = [];
    const suffix: Record<string, string> = {
        assembleHap: ".hap",
        assembleHar: ".har",
        assembleHsp: ".hsp",
        assembleApp: ".app",
      },
      extension = suffix[task];
    invariant(extension, "BUILD_TASK_INVALID", "Unsupported artifact task");
    const outputs: { directory: string; metadata?: string }[] = [];
    if (task === "assembleApp") {
      const info = z
        .object({ BUILD_PATH: z.object({ OUTPUT_PATH: z.string() }) })
        .parse(model["ohos-project"]);
      outputs.push({
        directory: inside(project.root, info.BUILD_PATH.OUTPUT_PATH),
      });
    } else
      for (const module of project.modules.filter((m) =>
        roots.includes(m.root),
      )) {
        const info = z
          .object({
            TARGETS: z.record(
              z.string(),
              z.object({
                BUILD_PATH: z.object({
                  OUTPUT_PATH: z.string(),
                  OUTPUT_METADATA_JSON: z.string().optional(),
                }),
              }),
            ),
          })
          .parse(model[`ohos-module-${module.name}`]).TARGETS[module.target]!;
        outputs.push({
          directory: inside(project.root, info.BUILD_PATH.OUTPUT_PATH),
          metadata: info.BUILD_PATH.OUTPUT_METADATA_JSON,
        });
      }
    for (const output of outputs) {
      if (task === "assembleHap" && output.metadata) {
        const metadata = inside(project.root, output.metadata);
        invariant(
          fs.existsSync(metadata),
          "BUILD_METADATA_MISSING",
          "Native HAP output metadata is missing",
        );
        const entries = z
          .array(z.object({ hapName: z.string(), isSigned: z.boolean() }))
          .parse(JSON.parse(fs.readFileSync(metadata, "utf8")) as unknown);
        for (const entry of entries) {
          const file = inside(output.directory, entry.hapName);
          invariant(
            fs.existsSync(file) && file.endsWith(extension),
            "BUILD_ARTIFACT_MISSING",
            "SDK metadata references a missing artifact",
          );
          files.push(file);
        }
      } else if (fs.existsSync(output.directory))
        for (const entry of fs.readdirSync(output.directory, {
          withFileTypes: true,
        }))
          if (entry.isFile() && entry.name.endsWith(extension))
            files.push(path.join(output.directory, entry.name));
    }
    return files.map((file) => ({
      path: file,
      sha256: fileDigest(file),
      bytes: fs.statSync(file).size,
    }));
  }
}
