import crypto from "node:crypto";
import { flowError } from "./domain.mjs";
import { readHarmonyAppModel } from "./target-resolver.mjs";

const HOME_ACTIONS = new Set(["action.system.home"]);

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function routeId(kind, parts) {
  const readable = parts.join("-").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  const digest = crypto.createHash("sha256").update(`${kind}\0${parts.join("\0")}`).digest("hex").slice(0, 8);
  return `${kind}-${readable || "target"}-${digest}`;
}

function uriCandidate(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.scheme !== "string" || !raw.scheme.trim()) return null;
  const scheme = raw.scheme.trim();
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  const port = raw.port === undefined ? "" : String(raw.port).trim();
  const exactPath = typeof raw.path === "string" ? raw.path.trim() : "";
  const prefixPath = typeof raw.pathStartWith === "string" ? raw.pathStartWith.trim() : "";
  const dynamic = typeof raw.pathRegex === "string" && raw.pathRegex.trim();
  const path = exactPath || prefixPath;
  const authority = host ? `//${host}${port ? `:${port}` : ""}` : "";
  const renderedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return {
    pattern: {
      scheme, ...(host ? { host } : {}), ...(port ? { port } : {}),
      ...(exactPath ? { path: exactPath } : {}),
      ...(prefixPath ? { pathStartWith: prefixPath } : {}),
      ...(dynamic ? { pathRegex: raw.pathRegex.trim() } : {}),
      ...(raw.linkFeature ? { linkFeature: raw.linkFeature } : {}),
    },
    uri: dynamic && !path ? null : `${scheme}:${authority}${renderedPath}`,
    requiresExplicitUri: Boolean(dynamic),
  };
}

/** Discover only routes declared by standard HarmonyOS manifests; never infer app-specific params. */
export function discoverAppRoutes(projectPath) {
  const model = readHarmonyAppModel(projectPath);
  const routes = [];
  for (const module of model.modules) {
    for (const ability of module.abilities) {
      const app = { bundleName: model.bundleName, module: module.name, ability: ability.name };
      routes.push({
        id: routeId("ability", [module.name, ability.name]),
        kind: "ability",
        name: `${module.name}/${ability.name}`,
        app,
        exported: ability.exported === true,
        launchable: true,
        source: module.moduleFile,
      });
      const skills = Array.isArray(ability.skills) ? ability.skills : [];
      skills.forEach((skill, skillIndex) => {
        const actions = strings(skill?.actions).filter((action) => !HOME_ACTIONS.has(action));
        const entities = strings(skill?.entities);
        const uris = Array.isArray(skill?.uris) ? skill.uris.map(uriCandidate).filter(Boolean) : [];
        uris.forEach((uri, uriIndex) => {
          const action = actions.includes("ohos.want.action.viewData")
            ? "ohos.want.action.viewData"
            : actions[0];
          routes.push({
            id: routeId("link", [module.name, ability.name, String(skillIndex), String(uriIndex), JSON.stringify(uri.pattern)]),
            kind: "link",
            name: uri.uri ?? `${uri.pattern.scheme}:${uri.pattern.pathRegex}`,
            app,
            ...(action ? { action } : {}),
            ...(entities.length ? { entities } : {}),
            uri: uri.uri,
            uriPattern: uri.pattern,
            requiresExplicitUri: uri.requiresExplicitUri,
            launchable: Boolean(uri.uri) && !uri.requiresExplicitUri,
            source: module.moduleFile,
          });
        });
        if (!uris.length) {
          for (const action of actions) {
            routes.push({
              id: routeId("action", [module.name, ability.name, action]),
              kind: "action",
              name: action,
              app,
              action,
              ...(entities.length ? { entities } : {}),
              launchable: true,
              source: module.moduleFile,
            });
          }
        }
      });
    }
  }
  return { projectPath: model.projectPath, bundleName: model.bundleName, routes };
}

export function selectAppRoute(catalog, input = {}) {
  const routes = catalog.routes;
  if (input.route_id) {
    const route = routes.find((candidate) => candidate.id === input.route_id);
    if (!route) throw flowError(`Declared app route was not found: ${input.route_id}`, "FLOW_ROUTE_NOT_FOUND");
    return route;
  }
  const explicit = routes.filter((route) => {
    // An Ability-only request means exactly the ordinary Ability launch route. Without this
    // guard the same Ability's action and App Link declarations also match, making the safest
    // and most common direct-launch request look ambiguous.
    if (input.ability && !input.route_action && !input.uri && route.kind !== "ability") return false;
    if (input.ability && route.app.ability !== input.ability) return false;
    if (input.route_action && route.action !== input.route_action) return false;
    if (input.uri) {
      try {
        const actual = new URL(input.uri);
        if (route.kind !== "link" || route.uriPattern.scheme !== actual.protocol.slice(0, -1)) return false;
        if (route.uriPattern.host && route.uriPattern.host !== actual.hostname) return false;
        if (route.uriPattern.path && `/${route.uriPattern.path.replace(/^\/+/, "")}` !== actual.pathname) return false;
        if (route.uriPattern.pathStartWith
          && !actual.pathname.startsWith(`/${route.uriPattern.pathStartWith.replace(/^\/+/, "")}`)) return false;
        if (route.uriPattern.pathRegex && !(new RegExp(route.uriPattern.pathRegex).test(actual.pathname))) return false;
      } catch {
        return false;
      }
    }
    return Boolean(input.ability || input.route_action || input.uri);
  });
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) {
    throw flowError(`Route request matches several declared targets: ${explicit.map((route) => route.id).join(", ")}`, "FLOW_ROUTE_AMBIGUOUS");
  }
  return null;
}
