// Native adaptation of deveco-cli project validators; see provenance/SOURCES.md.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inside, readObject } from "../core/files.js";
import { invariant } from "../core/errors.js";
import type { Project } from "./project.js";
import type { CheckDiagnostic } from "./checker.js";

type Scope = Pick<Project, "root" | "modules">;
const names = z.array(z.object({ name: z.string().min(1) }));
const permissionDefinitions = z.object({
  definePermissions: z
    .array(z.object({ name: z.string(), grantMode: z.string() }))
    .min(1),
});
const route = z
  .object({
    name: z.string().min(1),
    pageSourceFile: z.string().min(1),
    buildFunction: z.string().min(1),
    data: z.unknown().optional(),
    customData: z.unknown().optional(),
  })
  .strict();
const manifest = z.object({
  module: z.object({
    routerMap: z.string().optional(),
    definePermissions: names.optional(),
    requestPermissions: z
      .array(
        z.object({
          name: z.string().min(1),
          reason: z.unknown().optional(),
          usedScene: z
            .object({
              abilities: z.array(z.string()).optional(),
              when: z.string().optional(),
            })
            .nullable()
            .optional(),
        }),
      )
      .optional(),
  }),
});

export function checkerMetadata(project: Scope, sdk: string) {
  const diagnostics: CheckDiagnostic[] = [],
    resources = new Set<string>(),
    indexedKinds = new Set<string>(),
    routes: { profile: string; page: string; builder: string }[] = [];
  let bytes = 0,
    entries = 0,
    resourceRoots = 0;
  const diagnostic = (
    file: string,
    rule: string,
    message: string,
    severity: "error" | "warning" = "error",
  ) =>
    diagnostics.push({
      file: path.relative(project.root, file),
      line: 1,
      column: 1,
      severity,
      rule,
      message,
    });
  const canonical = (file: string) =>
    inside(fs.realpathSync.native(project.root), fs.realpathSync.native(file));
  const read = (file: string) => {
    const resolved = canonical(file),
      stat = fs.statSync(resolved);
    bytes += stat.size;
    invariant(
      stat.isFile() && stat.size <= 1024 * 1024 && bytes <= 32 * 1024 * 1024,
      "CHECK_METADATA_LIMIT",
      "Metadata is limited to 1 MiB per file and 32 MiB per check",
    );
    return readObject(resolved);
  };
  const children = (directory: string) => {
    if (!fs.existsSync(directory)) return [];
    const result = fs.readdirSync(canonical(directory), {
      withFileTypes: true,
    });
    entries += result.length;
    invariant(
      entries <= 100000,
      "CHECK_METADATA_LIMIT",
      "Metadata scan exceeds 100000 entries",
    );
    return result;
  };
  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const resourceRootPaths = [
    ...new Set([
      path.join(project.root, "AppScope/resources"),
      ...project.modules.map((module) =>
        path.join(module.root, "src/main/resources"),
      ),
    ]),
  ];
  for (const root of resourceRootPaths) {
    if (!fs.existsSync(root)) continue;
    resourceRoots++;
    for (const qualifier of children(root)) {
      if (
        !qualifier.isDirectory() ||
        ["rawfile", "resfile"].includes(qualifier.name)
      )
        continue;
      const directory = path.join(root, qualifier.name);
      for (const kind of children(directory)) {
        if (!kind.isDirectory()) continue;
        const kindPath = path.join(directory, kind.name);
        if (!["element", "media", "profile"].includes(kind.name)) {
          diagnostic(
            kindPath,
            "resource-dir-name",
            `Invalid resource directory '${kind.name}' inside '${qualifier.name}'; use element, media or profile. rawfile and resfile belong at the resources root.`,
          );
          continue;
        }
        for (const entry of children(kindPath)) {
          if (!entry.isFile()) continue;
          if (kind.name !== "element") {
            indexedKinds.add(kind.name);
            resources.add(`${kind.name}.${path.parse(entry.name).name}`);
            continue;
          }
          if (!entry.name.endsWith(".json")) continue;
          const file = path.join(kindPath, entry.name);
          try {
            for (const [name, rows] of Object.entries(read(file))) {
              const values = names.parse(rows);
              indexedKinds.add(name);
              for (const row of values) resources.add(`${name}.${row.name}`);
            }
          } catch (error) {
            diagnostic(
              file,
              "resource-element-invalid",
              `Cannot index element resources: ${errorMessage(error)}`,
            );
          }
        }
      }
    }
  }
  const permissionFile = path.join(
    sdk,
    "default/openharmony/toolchains/lib/PermissionDefinitions.json",
  );
  let sdkPermissions: Map<string, string> | undefined;
  if (fs.existsSync(permissionFile)) {
    const stat = fs.statSync(permissionFile);
    invariant(
      stat.isFile() && stat.size <= 8 * 1024 * 1024,
      "CHECK_PERMISSION_DEFINITIONS_INVALID",
      "SDK permission definitions must be a regular file no larger than 8 MiB",
    );
    const definitions = permissionDefinitions.safeParse(
      readObject(permissionFile),
    );
    invariant(
      definitions.success,
      "CHECK_PERMISSION_DEFINITIONS_INVALID",
      "SDK permission definitions have an unsupported structure",
    );
    sdkPermissions = new Map(
      definitions.data.definePermissions.map((row) => [
        row.name,
        row.grantMode,
      ]),
    );
  }
  for (const module of project.modules) {
    const file = path.join(module.root, "src/main/module.json5");
    if (!fs.existsSync(file)) continue;
    let config: z.infer<typeof manifest>["module"];
    try {
      config = manifest.parse(read(file)).module;
    } catch (error) {
      diagnostic(file, "module-metadata-invalid", errorMessage(error));
      continue;
    }
    if (sdkPermissions) {
      const custom = new Set(config.definePermissions?.map((row) => row.name));
      for (const permission of config.requestPermissions ?? []) {
        const mode = sdkPermissions.get(permission.name);
        if (!mode && !custom.has(permission.name)) {
          diagnostic(
            file,
            "permission-name-exists",
            `Unknown permission '${permission.name}'; it is absent from the SDK and this module's definePermissions.`,
          );
          continue;
        }
        if (mode !== "user_grant") continue;
        const reason = permission.reason;
        if (
          typeof reason !== "string" ||
          !/^\$string:[A-Za-z0-9_]+$/.test(reason)
        )
          diagnostic(
            file,
            "permission-reason-required",
            `Permission '${permission.name}' requires a reason referencing a $string: resource.`,
          );
        else if (!resources.has(`string.${reason.slice(8)}`))
          diagnostic(
            file,
            "permission-reason-resource",
            `Permission '${permission.name}' references missing reason resource '${reason}'.`,
          );
        const scene = permission.usedScene;
        if (!scene || (!scene.abilities?.length && scene.when === undefined))
          diagnostic(
            file,
            "permission-usedscene-recommended",
            `Permission '${permission.name}' has no usedScene; declare its abilities and when it is used.`,
            "warning",
          );
      }
    }
    if (config.routerMap === undefined) continue;
    let profile = file;
    try {
      invariant(
        /^\$profile:[A-Za-z0-9_-]+$/.test(config.routerMap),
        "ROUTE_MAP_INVALID",
        "module.routerMap must reference a profile resource",
      );
      profile = path.join(
        module.root,
        "src/main/resources/base/profile",
        config.routerMap.slice(9) + ".json",
      );
      const raw = read(profile);
      const rows = z.array(z.unknown()).parse(raw.routerMap);
      for (let index = 0; index < rows.length; index++) {
        const parsed = route.safeParse(rows[index]);
        if (!parsed.success) {
          diagnostic(
            profile,
            "route-map-schema",
            `routerMap[${index}] requires name, pageSourceFile and buildFunction and permits only data and customData in addition: ${parsed.error.message}`,
          );
          continue;
        }
        const value = parsed.data;
        try {
          invariant(
            !path.isAbsolute(value.pageSourceFile) &&
              !/[\\:\x00-\x1f]/.test(value.pageSourceFile),
            "ROUTE_MAP_INVALID",
            "pageSourceFile must be module-relative",
          );
          const page = inside(module.root, value.pageSourceFile);
          invariant(
            /(?<!\.d)\.(?:ets|ts)$/.test(page) &&
              fs.existsSync(page) &&
              fs.statSync(page).isFile(),
            "ROUTE_MAP_INVALID",
            "The route page source does not exist or is not an application source",
          );
          inside(fs.realpathSync.native(module.root), canonical(page));
          routes.push({
            profile: path.relative(project.root, profile),
            page: fs.realpathSync.native(page),
            builder: value.buildFunction,
          });
        } catch (error) {
          diagnostic(
            profile,
            "route-map-page-source",
            `routerMap[${index}]: ${errorMessage(error)}`,
          );
        }
      }
    } catch (error) {
      diagnostic(profile, "route-map-profile-invalid", errorMessage(error));
    }
  }
  return {
    diagnostics,
    resources,
    indexedKinds,
    routes,
    checks: {
      project_metadata: "executed" as const,
      permissions: sdkPermissions
        ? ("executed" as const)
        : ("unavailable" as const),
      app_resources: resourceRoots
        ? ("executed" as const)
        : ("unavailable" as const),
    },
  };
}
