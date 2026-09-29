import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readJson5 } from "../core/files.js";

/*
 * ArkTS language server project model (initializationOptions.modules), same shape DevEco Studio and
 * deveco-cli send. Without it the server cannot resolve HMS kits (@kit.UIDesignKit...) or
 * cross-module imports (@module:...), so hover/definition/diagnostics on real multi-module apps
 * degrade to false errors. Built from build-profile.json5, module.json5, main_pages.json,
 * oh_modules/.ohpm/lock.json5 and the SDK's sdk-pkg.json — read-only, no project changes.
 */

const unix = (p: string) => p.split(path.sep).join("/");
const deviceCode: Record<string, number> = { liteWearable: 1, wearable: 2, tv: 3, car: 4, phone: 5, default: 5, smartVision: 6, tablet: 7, router: 8, pc: 9, "2in1": 10 };

interface DepInfo { name: string; version: string; registryType: string; resolved: string }

function readJsonSafe(file: string): any {
  try { return readJson5(file); } catch { return undefined; }
}

/** Dependencies of one module from the ohpm lock file (the resolved graph hvigor uses). */
function lockDependencies(lock: any, name: string, key: "dependencies" | "dynamicDependencies" | "devDependencies"): DepInfo[] {
  const modules = lock?.modules ?? {};
  const entry = Object.entries(modules).find(([, v]: [string, any]) => (name === "." ? !v?.name : v?.name === name))?.[1] as any;
  const deps = entry?.[key] ?? {};
  return Object.entries(deps).map(([dep, v]: [string, any]) => {
    const version = String(v?.version ?? "");
    const store = lock?.packages?.[`${dep}@${version}`]?.storePath;
    const local = version.startsWith("file:");
    return { name: dep, version: local ? version.slice(5) : version, registryType: local ? "local" : "ohpm", resolved: store ?? "" };
  });
}

export function arktsModuleModels(root: string, sdk: string) {
  const profile = readJsonSafe(path.join(root, "build-profile.json5")) ?? {};
  const product = profile.app?.products?.[0] ?? {};
  const compat = String(product.compatibleSdkVersion ?? profile.app?.compatibleSdkVersion ?? "");
  const [compatVersion, compatLevel] = /^(.*)\((\d+)\)$/.exec(compat)?.slice(1) ?? [compat, compat];
  const pkg = readJsonSafe(path.join(sdk, "default", "sdk-pkg.json"))?.data ?? {};
  const api = Number.parseInt(String(pkg.apiVersion ?? ""), 10);
  const compileSdkLevel = api >= 26 && pkg.platformVersion ? String(pkg.platformVersion) : String(pkg.apiVersion ?? "");
  const lock = readJsonSafe(path.join(root, "oh_modules", ".ohpm", "lock.json5"));
  const rootDeps = lock ? [...lockDependencies(lock, ".", "dependencies"), ...lockDependencies(lock, ".", "devDependencies")] : [];
  const paths = {
    aceLoaderPath: unix(path.join(sdk, "default/openharmony/ets/build-tools/ets-loader")),
    sdkJsPath: unix(path.join(sdk, "default/openharmony/ets/api")),
    hosSdkPath: unix(path.join(sdk, "default/hms")),
  };
  const models = [];
  for (const m of profile.modules ?? []) {
    if (typeof m?.name !== "string" || typeof m?.srcPath !== "string") continue;
    const modulePath = unix(path.resolve(root, m.srcPath));
    const manifest = readJsonSafe(path.join(modulePath, "src/main/module.json5"))?.module ?? {};
    const pages = readJsonSafe(path.join(modulePath, "src/main/resources/base/profile/main_pages.json"))?.src ?? [];
    const deps = lock ? [...lockDependencies(lock, m.name, "dependencies"), ...lockDependencies(lock, m.name, "devDependencies"), ...rootDeps] : [];
    const dyn = lock ? lockDependencies(lock, m.name, "dynamicDependencies") : [];
    models.push({
      deviceType: (manifest.deviceTypes ?? ["default"]).map((t: string) => deviceCode[t] ?? 0),
      ...paths,
      modulePath,
      jsComponentType: "declarative",
      compatibleSdkVersion: compatVersion, compatibleSdkLevel: compatLevel,
      compileSdkLevel, compileSdkVersion: String(pkg.version ?? ""), compileSdkType: String(pkg.releaseType ?? "Release"),
      syscap: { NDeviceSysCaps: [], addedSysCaps: [] },
      apiType: "stageMode", runtimeOs: "HarmonyOS",
      moduleName: m.name, moduleType: m.name, packageName: m.name,
      compileMode: "jsbundle", crossPlatform: false, ignoreCrossPlatform: false, packageManagerType: "ohpm",
      permissions: (manifest.requestPermissions ?? []).map((p: { name?: string }) => p.name).filter(Boolean),
      testPermissions: [],
      buildProfileParam: {
        productName: "default", buildModeName: "debug", targetName: "default", arkTSVersion: "1.1",
        resourceDirectories: [unix(path.join(modulePath, "src/main/resources"))], targetESVersion: "ES2021", maxFlowDepth: 2000,
        caseSensitiveCheck: true, tsImportSendable: false, compatibleSdkVersionStage: "", useNormalizedOHMUrl: true,
        reExportCheckMode: "noCheck", skipOhModulesLint: false, byteCodeHar: true, obfuscationRuleOptionsEnable: false,
        enableStrictCheckOHModules: false, sourceRoots: [],
      },
      appParam: { bundleType: "app" },
      projectType: "OHOS", projectName: path.basename(root),
      moduleDependencies: {
        modulePath,
        dependencies: Object.fromEntries(deps.map((d) => [d.name, d])),
        dynamicDependencies: Object.fromEntries(dyn.map((d) => [d.name, d])),
      },
      moduleJsonParam: { pagesFileName: "main_pages.json", metaDataList: [], pages },
      globalDeclarationFiles: [],
    });
  }
  return { models, lock: !!lock, dependencyMap: fs.existsSync(path.join(root, ".hvigor", "dependencyMap")) };
}

export function arktsInitializationOptions(root: string, sdk: string, stateDir: string, serverPath?: string) {
  const { models } = arktsModuleModels(root, sdk);
  return {
    // The server takes its workspace from here (not from the top-level rootUri).
    rootUri: pathToFileURL(root).href,
    lspServerWorkspacePath: serverPath ? unix(path.dirname(path.dirname(serverPath))) : "",
    modules: models,
    clientType: "intellij",
    indexingDataLocation: unix(path.join(stateDir, "lsp-index", Buffer.from(root).toString("base64url").slice(-40))),
    completionSortSetting: { enableRecentlyUsed: false, enableCompletionSortByType: true, maxValidCompletionItemsCount: 50, enableCompletionFunctionParameter: false, enableIndexModuleRootDirEtsFile: false },
    gutterIconsSetting: { overriddenEnable: true, overridingEnable: true, implementedEnable: true, implementingEnable: true },
    inlayHintsSetting: { typeSetting: {}, parameterNames: {} },
    lspMaxOldSpaceSize: "2048",
    projectType: "OHOS",
    loggerPath: unix(path.join(stateDir, "lsp-log")),
  };
}
