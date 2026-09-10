// Derived from the MIT deveco-code checker; see provenance/SOURCES.md.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type ts from "typescript";
import type { ModuleTargets } from "../core/contracts.js";
import { inspectProject } from "./project.js";
import { discoverToolchain } from "../core/toolchain.js";
import { invariant, object } from "../core/errors.js";
import { digest, readObject } from "../core/files.js";
import {
  checkerSources,
  checkerRouterPages,
  checkerSdkEnvironment,
} from "./checker-project.js";
import { checkerMetadata } from "./checker-metadata.js";
import { checkerSyntax, type ArkSyntax } from "./checker-syntax.js";
import { checkerModel } from "./checker-model.js";
import { z } from "zod";
export interface CheckDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  rule: string;
}
interface SdkChecker {
  compilerOptions: ts.CompilerOptions;
  etsStandaloneChecker(
    files: Record<string, string>,
    logger: Record<string, (...args: unknown[]) => void>,
    configuration: Record<string, unknown>,
  ): void;
}
export function parseDiagnostics(
  lines: string[],
  root: string,
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];
  let location: Omit<CheckDiagnostic, "message" | "rule"> | undefined;
  for (const raw of lines.flatMap((line) => line.split("\n"))) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const match = /ArkTS:(ERROR|WARN)\s+File:\s+(.+?):(\d+):(\d+)/.exec(line);
    if (match) {
      location = {
        file: path.relative(root, match[2]!),
        line: Number(match[3]),
        column: Number(match[4]),
        severity: match[1] === "ERROR" ? "error" : "warning",
      };
      continue;
    }
    if (
      location &&
      line.trim() &&
      !line.includes("ArkTS:") &&
      !line.includes("For details about")
    ) {
      const rule = /^(.+?)\s*\(([a-z][\w-]+)\)\s*$/.exec(line.trim());
      diagnostics.push({
        ...location,
        message: rule?.[1] ?? line.trim(),
        rule: rule?.[2] ?? "",
      });
      location = undefined;
    }
  }
  return diagnostics;
}
export async function staticCheck(input: {
  project_path: string;
  product?: string;
  module_targets?: ModuleTargets;
  files?: string[];
  cache_path: string;
}) {
  const project = inspectProject(
      input.project_path,
      input.product,
      input.module_targets,
    ),
    toolchain = discoverToolchain();
  const loader = path.join(
    toolchain.sdk,
    "default/openharmony/ets/build-tools/ets-loader",
  );
  const scope = checkerSources(project, input.files),
    files = scope.files;
  const { etsRoots, externalApiPaths } = checkerSdkEnvironment(toolchain.sdk);
  // The SDK reads these variables while its modules are being initialized.
  // This function runs in the owned checker child, never the MCP runtime Worker.
  process.env.compileMode = "moduleJson";
  process.env.externalApiPaths = externalApiPaths;
  const require = createRequire(import.meta.url);
  const checker = require(
    path.join(loader, "lib/ets_checker.js"),
  ) as SdkChecker;
  invariant(
    typeof checker.etsStandaloneChecker === "function",
    "CHECKER_PROTOCOL_UNSUPPORTED",
    "SDK standalone checker is unavailable",
  );
  const main = object(require(path.join(loader, "main.js")) as unknown);
  Object.assign(object(main.partialUpdateConfig), {
    executeArkTSLinter: true,
    standardArkTSLinter: true,
  });
  const mainConfig = object(main.projectConfig);
  if (Array.isArray(main.globalModulePaths) && !mainConfig.globalModulePaths)
    mainConfig.globalModulePaths = main.globalModulePaths;
  // The installed SDK gates @since warnings on the usage source file. An SDK
  // root here suppresses real app compatibility warnings (API 12 canary).
  mainConfig.projectRootPath = project.root;
  const version = project.product.compatibleSdkVersion;
  const parseVersion = (value: string | number): number => {
    if (typeof value === "number") return value;
    if (/^\d+$/.test(value)) return Number(value);
    const parenthesis = /\((\d+)\)$/.exec(value);
    if (parenthesis) return Number(parenthesis[1]);
    const [major, minor, patch] = value.split(".").map(Number);
    return major! * 10000 + minor! * 100 + patch!;
  };
  const sdkConfiguration = {
    runtimeOS: project.product.runtimeOS,
    compatibleSdkVersion: parseVersion(version),
    originCompatibleSdkVersion: version,
    targetSdkVersion: project.product.targetSdkVersion,
  };
  const cachePath = path.join(
    input.cache_path,
    digest(sdkConfiguration),
    "cache",
  );
  fs.mkdirSync(cachePath, { recursive: true });
  const lines: string[] = [];
  let logBytes = 0;
  const capture = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    logBytes += Buffer.byteLength(line);
    invariant(
      logBytes <= 8 * 1024 * 1024,
      "CHECKER_OUTPUT_LIMIT",
      "SDK checker log exceeded 8 MiB; narrow the file selection",
    );
    lines.push(line);
  };
  checker.etsStandaloneChecker(
    Object.fromEntries(files.map((file, index) => [`file_${index}`, file])),
    { debug: capture, info: capture, warn: capture, error: capture },
    {
      globalModulePaths: etsRoots
        .flatMap((root) =>
          ["api", "arkts", "kits"].map((name) => path.join(root, name)),
        )
        .filter((file) => fs.existsSync(file)),
      projectPath: project.root,
      modulePath: project.root,
      cachePath,
      aceModuleJsonPath: path.join(
        project.modules[0]!.root,
        "src/main/module.json5",
      ),
      compileMode: "esmodule",
      etsLoaderPath: loader,
      packageManagerType: "ohpm",
      packageDir: "oh_modules",
      ...sdkConfiguration,
      compileSdkVersion: sdkConfiguration.compatibleSdkVersion,
      minAPIVersion: sdkConfiguration.compatibleSdkVersion,
      // Keep the original product version string. HarmonyOS SDK comparison
      // distinguishes "6.1.0(23)" from the bare integer 23.
      sdkInfo: JSON.stringify(sdkConfiguration),
      bundleType: "",
      compilerTypes: [],
      resolveModulePaths: [],
    },
  );
  const selected = new Set(files);
  const diagnostics = parseDiagnostics(lines, project.root).filter((item) =>
    selected.has(path.resolve(project.root, item.file)),
  );
  const syntax = require(
    require.resolve("typescript", { paths: [loader] }),
  ) as ArkSyntax;
  invariant(
    typeof syntax.isStructDeclaration === "function" &&
      typeof syntax.isEtsComponentExpression === "function",
    "CHECKER_PROTOCOL_UNSUPPORTED",
    "SDK syntax parser does not expose ArkTS structs",
  );
  const componentMap = z
    .object({
      BUILDIN_CONTAINER_COMPONENT: z.set(z.string()),
      INNER_COMPONENT_NAMES: z.set(z.string()),
    })
    .parse(require(path.join(loader, "lib/component_map.js")) as unknown);
  const components = {
    containers: componentMap.BUILDIN_CONTAINER_COMPONENT,
    builtins: componentMap.INNER_COMPONENT_NAMES,
  };
  // The SDK's sixth parser argument supplies ArkUI components, builder contexts
  // and UI callback syntax. Without it Navigation bodies split from attributes.
  z.object({
    ets: z.object({
      components: z.array(z.string()).min(1),
      render: z.object({
        method: z.array(z.string()),
        decorator: z.array(z.string()),
      }),
    }),
  }).parse(checker.compilerOptions);
  const metadata = checkerMetadata(project, toolchain.sdk);
  diagnostics.push(...metadata.diagnostics);
  const parsedSources = new Map<string, ts.SourceFile>();
  let parsedBytes = 0;
  const sourceFile = (file: string) => {
    const existing = parsedSources.get(file);
    if (existing) return existing;
    const selected = checkerSources(project, [file]).files[0]!;
    const canonical = parsedSources.get(selected);
    if (canonical) return canonical;
    parsedBytes += fs.statSync(selected).size;
    invariant(
      parsedBytes <= 64 * 1024 * 1024,
      "CHECK_SOURCE_LIMIT",
      "Selected sources and referenced project declarations exceed 64 MiB; narrow the project scope",
    );
    const source = syntax.createSourceFile(
      selected,
      fs.readFileSync(selected, "utf8"),
      syntax.ScriptTarget.Latest,
      true,
      selected.endsWith(".ets") ? syntax.ScriptKind.ETS : syntax.ScriptKind.TS,
      checker.compilerOptions,
    );
    parsedSources.set(selected, source);
    return source;
  };
  const resourcesFile = path.join(
    toolchain.sdk,
    "default/openharmony/previewer/common/resources/entry/resources.txt",
  );
  const resourceNames = fs.existsSync(resourcesFile)
    ? new Set(
        fs
          .readFileSync(resourcesFile, "utf8")
          .split("\n")
          .flatMap((line) => {
            const match = /^id:\d+,\s*'[^']*'\s+'([^']+)'/.exec(line);
            return match ? [match[1]!] : [];
          }),
      )
    : null;
  const stateFields = new Map<string, Set<string>>();
  for (const file of files) {
    const source = sourceFile(file);
    diagnostics.push(
      ...checkerSyntax(syntax, source, project.root, components).diagnostics,
    );
    const states = new Set<string>();
    stateFields.set(file, states);
    const visit = (node: ts.Node): void => {
      if (
        syntax.isPropertyDeclaration(node) &&
        syntax.isIdentifier(node.name)
      ) {
        const decorators = syntax.canHaveDecorators(node)
          ? syntax.getDecorators(node)
          : undefined;
        if (
          decorators?.some((decorator) =>
            /@(?:State|Link|Prop|ObjectLink|Local|Param|Provide|Consume|StorageLink|StorageProp|LocalStorageLink|LocalStorageProp)\b/.test(
              decorator.getText(source),
            ),
          )
        )
          states.add(node.name.text);
      }
      if (
        syntax.isCallExpression(node) &&
        syntax.isIdentifier(node.expression) &&
        node.expression.text === "$r" &&
        node.arguments[0] &&
        syntax.isStringLiteral(node.arguments[0])
      ) {
        const match = /^sys\.(media|symbol)\.(.+)$/.exec(
          node.arguments[0].text,
        );
        const appMatch = /^app\.([a-z]+)\.([A-Za-z0-9_]+)$/.exec(
          node.arguments[0].text,
        );
        if (
          (match && resourceNames && !resourceNames.has(match[2]!)) ||
          (appMatch &&
            metadata.indexedKinds.has(appMatch[1]!) &&
            !metadata.resources.has(`${appMatch[1]}.${appMatch[2]}`))
        ) {
          const at = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          diagnostics.push({
            file: path.relative(project.root, file),
            line: at.line + 1,
            column: at.character + 1,
            severity: "error",
            message: `Unknown ${appMatch ? "application" : "system"} resource ${node.arguments[0].text}`,
            rule: appMatch ? "app-resource-name-check" : "resource-name-check",
          });
        }
      }
      syntax.forEachChild(node, visit);
    };
    visit(source);
  }
  diagnostics.push(
    ...checkerRouterPages(project, (file) =>
      checkerSyntax(
        syntax,
        sourceFile(file),
        project.root,
        components,
      ).pageEntry(),
    ),
  );
  for (const route of metadata.routes) {
    if (
      !checkerSyntax(
        syntax,
        sourceFile(route.page),
        project.root,
        components,
      ).hasExportedBuilder(route.builder)
    )
      diagnostics.push({
        file: route.profile,
        line: 1,
        column: 1,
        severity: "error",
        rule: "route-map-build-function-missing",
        message: `Route builder '${route.builder}' must be an exported @Builder function in '${path.relative(project.root, route.page)}'.`,
      });
  }
  // Selected callers need declarations in their sibling application files.
  // Keep diagnostics scoped to those callers and all reads within source limits.
  for (const file of new Set([
    ...checkerSources(project, undefined, true).files,
    ...files,
  ]))
    sourceFile(file);
  const moduleEntries = new Map<string, string>();
  for (const module of project.modules) {
    const manifest = path.join(module.root, "oh-package.json5");
    if (!fs.existsSync(manifest)) continue;
    const metadata = z
      .object({ name: z.string().optional(), main: z.string().optional() })
      .parse(readObject(manifest));
    if (metadata.name && metadata.main)
      moduleEntries.set(
        metadata.name,
        path.resolve(module.root, metadata.main),
      );
  }
  diagnostics.push(
    ...checkerModel(
      syntax,
      parsedSources,
      files,
      project.root,
      components.builtins,
      moduleEntries,
    ),
  );
  const hvigorFile = path.join(project.root, "hvigor/hvigor-config.json5"),
    packageFile = path.join(project.root, "oh-package.json5");
  if (fs.existsSync(hvigorFile) && fs.existsSync(packageFile)) {
    const left = readObject(hvigorFile).modelVersion,
      right = readObject(packageFile).modelVersion;
    if (left && right && left !== right)
      diagnostics.push({
        file: "hvigor/hvigor-config.json5",
        line: 1,
        column: 1,
        severity: "error",
        message: "modelVersion values differ",
        rule: "model-version-consistency",
      });
  }
  const filtered = diagnostics.filter((item) => {
    if (item.message.includes("the current Mode is FA")) return false;
    const name = /^Cannot find name '(\$[^']+)'/.exec(item.message)?.[1];
    if (name?.startsWith("$$")) return false;
    return !(
      name?.startsWith("$") &&
      stateFields.get(path.resolve(project.root, item.file))?.has(name.slice(1))
    );
  });
  return {
    success: !filtered.some((item) => item.severity === "error"),
    checkKind: "static-precheck",
    compilationVerified: false,
    checked_file_count: files.length,
    scan: {
      mode: scope.mode,
      source_roots: scope.roots.map((root) =>
        path.relative(project.root, root),
      ),
      source_bytes: scope.bytes,
    },
    checks: {
      ...metadata.checks,
      arkui_syntax: "executed",
      sdk: "executed",
      system_resources: resourceNames ? "executed" : "unavailable",
      router_pages: "executed",
      model_version:
        fs.existsSync(hvigorFile) && fs.existsSync(packageFile)
          ? "executed"
          : "unavailable",
    },
    diagnostics: filtered,
    sdkConfiguration,
    summary: {
      errorCount: filtered.filter((item) => item.severity === "error").length,
      warnCount: filtered.filter((item) => item.severity === "warning").length,
    },
  };
}
