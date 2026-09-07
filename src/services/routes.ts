import path from "node:path";
import { Script } from "node:vm";
import { z } from "zod";
import {
  appSchema,
  routeRequestSchema,
  wantParametersSchema,
  type ApplicationTarget,
} from "../core/contracts.js";
import { digest, inside, readObject } from "../core/files.js";
import { invariant, ToolError } from "../core/errors.js";
import type { Project } from "./project.js";

// Protocol references: OpenHarmony docs, application-models/app-uri-config.md and tools/aa-tool.md.
// App manifest skills are OS intent declarations; no AI Skill package is loaded here.
const uriSchema = z
  .object({
    scheme: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9+.-]*$/)
      .optional(),
    type: z
      .string()
      .regex(/^(?:[^\s/*]+|\*)\/(?:[^\s/*]+|\*)$/)
      .optional(),
    host: z.string().optional(),
    port: z
      .union([
        z.string().regex(/^\d{1,5}$/),
        z.number().int().min(1).max(65535),
      ])
      .optional(),
    path: z.string().max(4096).optional(),
    pathStartWith: z.string().max(4096).optional(),
    pathRegex: z.string().max(1024).optional(),
    linkFeature: z.string().optional(),
  })
  .refine(
    (value) =>
      [value.path, value.pathStartWith, value.pathRegex].filter(
        (v) => v !== undefined,
      ).length <= 1,
    "URI path, pathStartWith and pathRegex are mutually exclusive",
  )
  .refine(
    (value) => value.scheme !== undefined || value.type !== undefined,
    "A URI filter needs a scheme or MIME type",
  )
  .refine(
    (value) =>
      value.port === undefined ||
      (Number(value.port) > 0 && Number(value.port) <= 65535),
    "Invalid URI port",
  );
type UriPattern = z.infer<typeof uriSchema>;
const manifestSchema = z.object({
  module: z.object({
    name: z.string().min(1),
    type: z.enum(["entry", "feature", "har", "shared"]),
    abilities: z
      .array(
        z.object({
          name: z.string().min(1),
          exported: z.boolean().default(false),
          skills: z
            .array(
              z.object({
                actions: z.array(z.string().min(1)).max(128).default([]),
                entities: z.array(z.string().min(1)).max(32).default([]),
                uris: z.array(uriSchema).max(128).default([]),
              }),
            )
            .max(128)
            .default([]),
        }),
      )
      .max(256)
      .default([]),
  }),
});
export interface AppRoute {
  id: string;
  kind: "ability" | "action" | "link" | "mime";
  app: ApplicationTarget;
  exported: boolean;
  source: string;
  uri_pattern?: UriPattern;
  requires_uri: boolean;
  requires_mime_type: boolean;
}
export interface RouteCatalog {
  project_path: string;
  product: string;
  bundle_name: string;
  routes: AppRoute[];
}
const uriPath = (value: string) => value.replace(/^\//, "");
const regexMatcher = new Script("new RegExp(pattern).test(value)");
function matchesUri(pattern: UriPattern, uri: string): boolean {
  let actual: URL;
  try {
    actual = new URL(uri);
  } catch {
    return false;
  }
  if (actual.username || actual.password) return false;
  if (actual.protocol.slice(0, -1) !== pattern.scheme?.toLowerCase())
    return false;
  if (pattern.host && actual.hostname !== pattern.host.toLowerCase())
    return false;
  // URL normalizes default HTTP(S) ports away. Compare the effective port.
  const port =
    actual.port ||
    (actual.protocol === "https:"
      ? "443"
      : actual.protocol === "http:"
        ? "80"
        : "");
  if (pattern.port !== undefined && port !== String(pattern.port)) return false;
  const value = uriPath(actual.pathname);
  if (pattern.path !== undefined && value !== uriPath(pattern.path))
    return false;
  if (
    pattern.pathStartWith !== undefined &&
    !value.startsWith(uriPath(pattern.pathStartWith))
  )
    return false;
  if (pattern.pathRegex !== undefined) {
    try {
      // A project's regular expression cannot monopolize the runtime worker.
      return (
        regexMatcher.runInNewContext(
          { pattern: pattern.pathRegex, value },
          { timeout: 25 },
        ) === true
      );
    } catch {
      throw new ToolError(
        "ROUTE_PATTERN_INVALID",
        "Manifest URI expression is invalid or exceeded its execution budget",
      );
    }
  }
  return true;
}
function concreteUri(pattern: UriPattern): string | undefined {
  if (
    !pattern.scheme ||
    !pattern.host ||
    pattern.pathStartWith !== undefined ||
    pattern.pathRegex !== undefined
  )
    return undefined;
  return `${pattern.scheme}://${pattern.host}${pattern.port !== undefined ? `:${pattern.port}` : ""}${pattern.path !== undefined ? `/${uriPath(pattern.path)}` : ""}`;
}
function matchesMime(pattern: string, actual: string): boolean {
  const wanted = pattern.split("/"),
    received = actual.split("/");
  return wanted.every(
    (part, index) => part === "*" || part === received[index],
  );
}

export function discoverAppRoutes(project: Project): RouteCatalog {
  const bundle = z
    .object({ app: z.object({ bundleName: appSchema.shape.bundle_name }) })
    .parse(readObject(path.join(project.root, "AppScope/app.json5")))
    .app.bundleName;
  const routes: AppRoute[] = [];
  for (const module of project.modules) {
    const file = inside(
      project.root,
      path.join(module.root, "src/main/module.json5"),
    );
    const manifest = manifestSchema.parse(readObject(file)).module;
    if (manifest.type === "har" || manifest.type === "shared") continue;
    for (const ability of manifest.abilities) {
      const base = {
        bundle_name: bundle,
        module: manifest.name,
        ability: ability.name,
      };
      const add = (
        kind: AppRoute["kind"],
        app: ApplicationTarget,
        pattern?: UriPattern,
      ) => {
        const identity = { kind, app, pattern };
        const id = `${kind}-${digest(identity).slice(0, 24)}`;
        if (routes.some((route) => route.id === id)) return;
        invariant(
          routes.length < 4096,
          "ROUTE_CATALOG_TOO_LARGE",
          "At most 4096 declared app routes",
        );
        routes.push({
          id,
          kind,
          app,
          exported: ability.exported,
          source: path.relative(project.root, file),
          ...(pattern ? { uri_pattern: pattern } : {}),
          requires_uri: kind === "link" && app.uri === undefined,
          requires_mime_type: !!pattern?.type && app.mime_type === undefined,
        });
      };
      add("ability", base);
      for (const skill of ability.skills) {
        const actions = skill.actions.filter(
          (action) => action !== "action.system.home",
        );
        if (skill.uris.length) {
          for (const pattern of skill.uris)
            for (const action of actions.length ? actions : [undefined]) {
              const uri = concreteUri(pattern);
              add(
                pattern.scheme ? "link" : "mime",
                {
                  ...base,
                  ...(action ? { action } : {}),
                  entities: skill.entities,
                  ...(uri ? { uri } : {}),
                  ...(pattern.type && !pattern.type.includes("*")
                    ? { mime_type: pattern.type }
                    : {}),
                },
                pattern,
              );
            }
        } else
          for (const action of actions)
            add("action", { ...base, action, entities: skill.entities });
      }
    }
  }
  return {
    project_path: project.root,
    product: project.product.name,
    bundle_name: bundle,
    routes,
  };
}
export function resolveAppRoute(
  catalog: RouteCatalog,
  raw: unknown,
  parameters: unknown = {},
): AppRoute {
  const request = routeRequestSchema.parse(raw);
  const candidates = catalog.routes.filter((route) => {
    if (request.id && route.id !== request.id) return false;
    if (request.module && route.app.module !== request.module) return false;
    if (request.ability && route.app.ability !== request.ability) return false;
    if (request.action && route.app.action !== request.action) return false;
    if (
      !request.id &&
      request.ability &&
      !request.action &&
      !request.uri &&
      !request.mime_type &&
      route.kind !== "ability"
    )
      return false;
    if (
      request.mime_type &&
      (!route.uri_pattern?.type ||
        !matchesMime(route.uri_pattern.type, request.mime_type))
    )
      return false;
    return (
      !request.uri ||
      (!!route.uri_pattern && matchesUri(route.uri_pattern, request.uri))
    );
  });
  invariant(
    candidates.length > 0,
    "ROUTE_NOT_FOUND",
    "No declared route satisfies every requested field",
  );
  if (candidates.length !== 1)
    throw new ToolError("ROUTE_AMBIGUOUS", "Specify one declared route", {
      route_ids: candidates.map((route) => route.id),
    });
  const route = candidates[0]!;
  invariant(
    route.exported,
    "ROUTE_NOT_EXPORTED",
    "The selected ability is not exported for aa launch",
  );
  invariant(
    !route.requires_uri || request.uri,
    "ROUTE_URI_REQUIRED",
    "A URI pattern needs an explicit matching URI",
  );
  invariant(
    !route.requires_mime_type || request.mime_type,
    "ROUTE_MIME_REQUIRED",
    "A wildcard MIME filter needs an explicit matching MIME type",
  );
  return {
    ...route,
    app: appSchema.parse({
      ...route.app,
      ...(request.uri ? { uri: request.uri } : {}),
      ...(request.mime_type ? { mime_type: request.mime_type } : {}),
      parameters: wantParametersSchema.parse(parameters),
    }),
  };
}
