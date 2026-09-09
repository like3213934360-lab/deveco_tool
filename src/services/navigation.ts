import { flowSchema, type Flow } from "../core/contracts.js";
import { digest } from "../core/files.js";
import { invariant, ToolError } from "../core/errors.js";
import { resolveAppRoute, type AppRoute, type RouteCatalog } from "./routes.js";

export interface SavedFlowSummary {
  id: string;
  name: string;
  app: Flow["app"];
}
export type NavigationChoice =
  | { kind: "route"; route: AppRoute }
  | { kind: "flow"; id: string }
  | { kind: "recording"; draft: Flow };

const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
const compact = (value: string) => value.replace(/[\p{P}\p{S}\s_]+/gu, "");

/** Goal text only selects declared capabilities; it never becomes executable code or a generated UI plan. */
export function resolveNavigationGoal(
  catalog: RouteCatalog,
  flows: SavedFlowSummary[],
  goal: string,
  parameters: unknown = {},
): NavigationChoice {
  const wanted = normalize(goal),
    condensed = compact(wanted);
  invariant(
    condensed.length > 0,
    "NAVIGATION_GOAL_INVALID",
    "Goal needs a meaningful name or URI",
  );
  // URI paths are case-sensitive. Use the manifest matcher, not natural-language normalization.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(goal.trim()))
    return {
      kind: "route",
      route: resolveAppRoute(catalog, { uri: goal.trim() }, parameters),
    };
  const routes = catalog.routes.filter(
    (route) =>
      route.id === goal.trim() ||
      (route.kind === "ability" && normalize(route.app.ability) === wanted) ||
      (route.app.action && normalize(route.app.action) === wanted) ||
      (route.app.mime_type && normalize(route.app.mime_type) === wanted),
  );
  if (routes.length > 1)
    throw new ToolError(
      "ROUTE_AMBIGUOUS",
      "Goal matches multiple app routes; provide an explicit route",
      {
        route_ids: routes.map((route) => route.id),
      },
    );
  if (routes[0])
    return {
      kind: "route",
      route: resolveAppRoute(catalog, { id: routes[0].id }, parameters),
    };

  const terms = wanted
    .split(/[\p{P}\p{S}\s_]+/u)
    .filter((term) => term.length >= 2);
  const candidates = flows
    .filter(
      (flow) =>
        flow.app.bundleName === catalog.bundle_name &&
        catalog.routes.some(
          (route) =>
            route.kind === "ability" &&
            route.app.module === flow.app.module &&
            route.app.ability === flow.app.ability,
        ),
    )
    .map((flow) => {
      let score = 0;
      for (const raw of [flow.id, flow.name]) {
        const label = normalize(raw),
          labelCompact = compact(label);
        if (label === wanted) score = Math.max(score, 100);
        else if (labelCompact && labelCompact === condensed)
          score = Math.max(score, 95);
        else if (
          labelCompact.length >= 2 &&
          condensed.length >= 2 &&
          (labelCompact.includes(condensed) || condensed.includes(labelCompact))
        )
          score = Math.max(
            score,
            70 +
              Math.round(
                (Math.min(labelCompact.length, condensed.length) /
                  Math.max(labelCompact.length, condensed.length)) *
                  20,
              ),
          );
        else if (terms.length)
          score = Math.max(
            score,
            (terms.filter((term) => label.includes(term)).length /
              terms.length) *
              60,
          );
      }
      return { id: flow.id, score };
    })
    .filter((candidate) => candidate.score >= 60)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = candidates[0];
  if (!selected) {
    const abilities = catalog.routes.filter(
      (route) => route.kind === "ability" && route.exported,
    );
    const home = abilities.filter((route) => route.entry_point === "home"),
      main = abilities.filter((route) => route.entry_point === "main"),
      entries = home.length ? home : main.length ? main : abilities;
    if (entries.length !== 1)
      throw new ToolError(
        entries.length
          ? "RECORDING_ENTRY_AMBIGUOUS"
          : "RECORDING_ENTRY_MISSING",
        "Unknown goal needs one exported entry; inspect routes and use record_start with an explicit ability",
        {
          product: catalog.product,
          route_ids: entries.map((route) => route.id),
        },
      );
    const app = entries[0]!.app;
    return {
      kind: "recording",
      draft: flowSchema.parse({
        version: 1,
        id: `navigation-${digest({
          goal: wanted,
          product: catalog.product,
          bundle: catalog.bundle_name,
          module: app.module,
          ability: app.ability,
        }).slice(0, 24)}`,
        name: goal.trim(),
        app: {
          bundleName: app.bundle_name,
          module: app.module,
          ability: app.ability,
        },
        start: { mode: "restart" },
        steps: [],
      }),
    };
  }
  if (candidates[1] && selected.score - candidates[1].score < 10)
    throw new ToolError(
      "FLOW_AMBIGUOUS",
      "Goal matches multiple saved flows; provide an explicit flow ID",
      {
        candidates: candidates.slice(0, 10),
      },
    );
  return { kind: "flow", id: selected.id };
}

export function validateFlowApplication(
  catalog: RouteCatalog,
  flow: Flow,
): void {
  invariant(
    flow.app.bundleName === catalog.bundle_name &&
      catalog.routes.some(
        (route) =>
          route.kind === "ability" &&
          route.app.module === flow.app.module &&
          route.app.ability === flow.app.ability &&
          (flow.start.mode === "attach" || route.exported),
      ),
    "FLOW_APP_MISMATCH",
    "Saved flow must target an ability in the selected project/product; restart requires an exported ability",
  );
}
