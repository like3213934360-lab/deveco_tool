import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { inspectProject } from "../src/services/project.js";
import { discoverAppRoutes, resolveAppRoute } from "../src/services/routes.js";
import {
  resolveNavigationGoal,
  validateFlowApplication,
} from "../src/services/navigation.js";
import { atomicWrite } from "../src/core/files.js";
import { Runtime } from "../src/services/runtime.js";
import { flowSchema, appSchema } from "../src/core/contracts.js";
import type { ProcessResult } from "../src/core/process.js";

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-routes-")),
  );
  const project = path.join(root, "project");
  atomicWrite(
    path.join(project, "build-profile.json5"),
    JSON.stringify({
      app: {
        products: [
          { name: "default", compatibleSdkVersion: 26 },
          { name: "other", compatibleSdkVersion: 26 },
        ],
      },
      modules: ["entry", "feature", "excluded"].map((name) => ({
        name,
        srcPath: name,
        targets: [
          {
            name: "default",
            applyToProducts: [name === "excluded" ? "other" : "default"],
          },
        ],
      })),
    }),
  );
  atomicWrite(
    path.join(project, "AppScope/app.json5"),
    JSON.stringify({ app: { bundleName: "com.example.routes" } }),
  );
  const manifest = (name: string, abilities: unknown[], mainElement?: string) =>
    atomicWrite(
      path.join(project, name, "src/main/module.json5"),
      JSON.stringify({
        module: {
          name,
          type: name === "entry" ? "entry" : "feature",
          ...(mainElement ? { mainElement } : {}),
          abilities,
        },
      }),
    );
  manifest("entry", [
    {
      name: "MainAbility",
      exported: true,
      skills: [
        { actions: ["action.system.home"], entities: ["entity.system.home"] },
        { actions: ["example.action"], entities: ["example.entity"] },
        {
          actions: ["ohos.want.action.viewData"],
          uris: [
            {
              scheme: "https",
              host: "example.com",
              port: "443",
              path: "exact",
            },
            {
              scheme: "https",
              host: "example.com",
              port: "8443",
              path: "exact",
            },
            { scheme: "sample", host: "app", pathRegex: "^items/[0-9]+$" },
            { scheme: "sample", host: "app", pathStartWith: "prefix/" },
          ],
        },
      ],
    },
    { name: "PrivateAbility", exported: false },
  ]);
  manifest("feature", [{ name: "MainAbility", exported: true }]);
  manifest("excluded", [{ name: "ExcludedAbility", exported: true }]);
  return {
    root,
    project,
    manifest,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
test("navigation goals preserve route priority, ambiguity, URI case and product-scoped saved flows", () => {
  const f = fixture();
  try {
    const catalog = discoverAppRoutes(inspectProject(f.project));
    const flow = (
      id: string,
      name: string,
      module = "entry",
      bundleName = catalog.bundle_name,
    ) => ({
      id,
      name,
      app: { module, bundleName, ability: "MainAbility" },
    });
    assert.equal(
      resolveNavigationGoal(
        catalog,
        [flow("direct", "example.action")],
        "example.action",
      ).kind,
      "route",
    );
    assert.throws(
      () =>
        resolveNavigationGoal(
          catalog,
          [flow("main", "MainAbility")],
          "MainAbility",
        ),
      { code: "ROUTE_AMBIGUOUS" },
    );
    assert.throws(() => resolveNavigationGoal(catalog, [], "PrivateAbility"), {
      code: "ROUTE_NOT_EXPORTED",
    });
    const dynamic = resolveNavigationGoal(catalog, [], "sample://app/items/42");
    assert.equal(dynamic.kind, "route");
    if (dynamic.kind === "route")
      assert.equal(dynamic.route.app.uri, "sample://app/items/42");
    assert.throws(
      () =>
        resolveNavigationGoal(
          catalog,
          [flow("uri", "sample://app/ITEMS/42")],
          "sample://app/ITEMS/42",
        ),
      { code: "ROUTE_NOT_FOUND" },
    );
    assert.throws(() => resolveNavigationGoal(catalog, [], "?!"), {
      code: "NAVIGATION_GOAL_INVALID",
    });
    const unknown = resolveNavigationGoal(
      catalog,
      [flow("blank", "!!!")],
      "unknown",
    );
    assert.equal(unknown.kind, "recording");
    if (unknown.kind === "recording") {
      assert.equal(unknown.draft.app.module, "entry");
      assert.equal(unknown.draft.name, "unknown");
      assert.deepEqual(unknown.draft.steps, []);
      assert.equal(unknown.draft.assert, undefined);
    }
    const flows = [
      flow("home-settings", "打开 设置"),
      flow("home-account", "打开账号"),
      flow("wrong-product", "设置", "excluded"),
      flow("wrong-app", "设置", "entry", "com.other"),
    ];
    assert.deepEqual(resolveNavigationGoal(catalog, flows, "打开_设置"), {
      kind: "flow",
      id: "home-settings",
    });
    assert.deepEqual(resolveNavigationGoal(catalog, flows, "设置"), {
      kind: "flow",
      id: "home-settings",
    });
    assert.throws(
      () =>
        resolveNavigationGoal(
          catalog,
          [
            flow("settings-a", "打开设置页面"),
            flow("settings-b", "打开设置面板"),
          ],
          "打开设置",
        ),
      { code: "FLOW_AMBIGUOUS" },
    );
    assert.equal(
      resolveNavigationGoal(
        catalog,
        [flow("excluded", "设置", "excluded")],
        "设置",
      ).kind,
      "recording",
    );
    const saved = flowSchema.parse({
      version: 1,
      ...flow("private", "Private"),
      start: { mode: "attach" },
      steps: [],
      assert: { visible: { text: "Done" } },
    });
    saved.app.ability = "PrivateAbility";
    validateFlowApplication(catalog, saved);
    saved.start.mode = "restart";
    assert.throws(() => validateFlowApplication(catalog, saved), {
      code: "FLOW_APP_MISMATCH",
    });
  } finally {
    f.close();
  }
});
test("automatic recording selects declared home then mainElement and refuses ambiguous or absent exported entries", () => {
  const f = fixture();
  try {
    const choose = (product = "default") =>
      resolveNavigationGoal(
        discoverAppRoutes(inspectProject(f.project, product)),
        [],
        "新的导航目标",
      );
    const ability = (name: string, home = false) => ({
      name,
      exported: true,
      skills: home
        ? [
            {
              actions: ["action.system.home"],
              entities: ["entity.system.home"],
            },
          ]
        : [],
    });
    f.manifest("entry", [ability("Home", true), ability("Main")], "Main");
    const home = choose();
    assert.equal(home.kind, "recording");
    if (home.kind === "recording") assert.equal(home.draft.app.ability, "Home");
    f.manifest(
      "entry",
      [ability("Home", true), ability("AnotherHome", true)],
      "Home",
    );
    assert.throws(choose, { code: "RECORDING_ENTRY_AMBIGUOUS" });
    f.manifest(
      "entry",
      [
        {
          ...ability("UnpairedHome"),
          skills: [{ actions: ["action.system.home"] }],
        },
        ability("Main"),
      ],
      "Main",
    );
    const main = choose();
    assert.equal(main.kind, "recording");
    if (main.kind === "recording") assert.equal(main.draft.app.ability, "Main");
    f.manifest("entry", [ability("A"), ability("B")]);
    assert.throws(choose, { code: "RECORDING_ENTRY_AMBIGUOUS" });
    f.manifest("entry", [{ name: "Private", exported: false }], "Private");
    const unique = choose();
    assert.equal(unique.kind, "recording");
    if (unique.kind === "recording")
      assert.equal(unique.draft.app.module, "feature");
    f.manifest("feature", []);
    assert.throws(choose, { code: "RECORDING_ENTRY_MISSING" });
    const other = choose("other");
    assert.equal(other.kind, "recording");
    if (other.kind === "recording")
      assert.equal(other.draft.app.module, "excluded");
  } finally {
    f.close();
  }
});
test("automatic recording keeps the complete goal and uses a stable ID scoped to product and entry", () => {
  const f = fixture();
  try {
    const catalog = discoverAppRoutes(inspectProject(f.project));
    const goal = "新".repeat(512);
    const choice = resolveNavigationGoal(catalog, [], goal);
    assert.equal(choice.kind, "recording");
    if (choice.kind !== "recording") throw new Error("Expected recording");
    assert.equal(choice.draft.name, goal);
    assert.equal(choice.draft.start.mode, "restart");
    assert.match(choice.draft.id, /^navigation-[a-f0-9]{24}$/);
    assert.deepEqual(resolveNavigationGoal(catalog, [], ` ${goal} `), choice);
    for (const modified of [
      { ...catalog, product: "other-product" },
      {
        ...catalog,
        routes: catalog.routes.map((route) => ({
          ...route,
          app: { ...route.app, ability: `Other${route.app.ability}` },
        })),
      },
    ]) {
      const different = resolveNavigationGoal(modified, [], goal);
      assert.equal(different.kind, "recording");
      if (different.kind === "recording")
        assert.notEqual(different.draft.id, choice.draft.id);
    }
  } finally {
    f.close();
  }
});
test("native routes honor product/module declarations, explicit field intersections and aa export visibility", () => {
  const f = fixture();
  try {
    const project = inspectProject(f.project),
      catalog = discoverAppRoutes(project);
    assert.ok(catalog.routes.some((route) => route.app.module === "feature"));
    assert.ok(!catalog.routes.some((route) => route.app.module === "excluded"));
    assert.throws(() => resolveAppRoute(catalog, { ability: "MainAbility" }), {
      code: "ROUTE_AMBIGUOUS",
    });
    const ability = resolveAppRoute(catalog, {
      ability: "MainAbility",
      module: "entry",
    });
    assert.equal(ability.kind, "ability");
    assert.throws(
      () => resolveAppRoute(catalog, { id: ability.id, module: "feature" }),
      { code: "ROUTE_NOT_FOUND" },
    );
    assert.throws(
      () => resolveAppRoute(catalog, { ability: "PrivateAbility" }),
      { code: "ROUTE_NOT_EXPORTED" },
    );
    const action = resolveAppRoute(
      catalog,
      { action: "example.action" },
      { count: 2, enabled: true, title: "中文" },
    );
    assert.deepEqual(action.app.entities, ["example.entity"]);
    assert.equal(action.app.parameters?.count, 2);
    assert.deepEqual(discoverAppRoutes(project), catalog);
    const before = project.fingerprint;
    atomicWrite(
      path.join(f.project, "AppScope/app.json5"),
      JSON.stringify({ app: { bundleName: "com.example.changed" } }),
    );
    assert.notEqual(inspectProject(f.project).fingerprint, before);
  } finally {
    f.close();
  }
});
test("native URI selection distinguishes ports and matches manifest regex paths without a leading slash", () => {
  const f = fixture();
  try {
    const catalog = discoverAppRoutes(inspectProject(f.project));
    const standard = resolveAppRoute(catalog, {
      uri: "https://example.com/exact?item=2",
    });
    const alternate = resolveAppRoute(catalog, {
      uri: "https://example.com:8443/exact",
    });
    assert.notEqual(standard.id, alternate.id);
    assert.throws(
      () => resolveAppRoute(catalog, { uri: "https://example.com:7443/exact" }),
      { code: "ROUTE_NOT_FOUND" },
    );
    assert.throws(
      () =>
        resolveAppRoute(catalog, {
          uri: "https://user:password@example.com/exact",
        }),
      { code: "ROUTE_NOT_FOUND" },
    );
    const dynamic = resolveAppRoute(catalog, { uri: "sample://app/items/42" });
    assert.equal(dynamic.app.uri, "sample://app/items/42");
    assert.throws(() => resolveAppRoute(catalog, { id: dynamic.id }), {
      code: "ROUTE_URI_REQUIRED",
    });
    assert.throws(
      () =>
        resolveAppRoute(catalog, {
          id: dynamic.id,
          uri: "sample://app/items/no",
        }),
      { code: "ROUTE_NOT_FOUND" },
    );
    const prefix = catalog.routes.find(
      (route) => route.uri_pattern?.pathStartWith,
    );
    assert.ok(prefix);
    assert.throws(() => resolveAppRoute(catalog, { id: prefix.id }), {
      code: "ROUTE_URI_REQUIRED",
    });
    assert.equal(
      resolveAppRoute(catalog, { uri: "sample://app/prefix/child" }).id,
      prefix.id,
    );
    f.manifest("entry", [
      {
        name: "MainAbility",
        exported: true,
        skills: [
          { uris: [{ scheme: "test", host: "host", pathRegex: "^(a+)+$" }] },
        ],
      },
    ]);
    const hostile = discoverAppRoutes(inspectProject(f.project));
    const start = performance.now();
    assert.throws(
      () =>
        resolveAppRoute(hostile, { uri: `test://host/${"a".repeat(100)}!` }),
      { code: "ROUTE_PATTERN_INVALID" },
    );
    assert.ok(performance.now() - start < 1000);
  } finally {
    f.close();
  }
});
test("MIME-only manifest filters remain discoverable and wildcard filters require a concrete type", () => {
  const f = fixture();
  try {
    f.manifest("entry", [
      {
        name: "MainAbility",
        exported: true,
        skills: [
          {
            actions: ["open"],
            uris: [{ type: "image/*" }, { type: "application/pdf" }],
          },
        ],
      },
    ]);
    const catalog = discoverAppRoutes(inspectProject(f.project));
    const image = catalog.routes.find(
      (route) => route.uri_pattern?.type === "image/*",
    );
    assert.ok(image);
    assert.throws(() => resolveAppRoute(catalog, { id: image.id }), {
      code: "ROUTE_MIME_REQUIRED",
    });
    assert.equal(
      resolveAppRoute(catalog, { mime_type: "image/png" }).app.mime_type,
      "image/png",
    );
    assert.throws(
      () => resolveAppRoute(catalog, { id: image.id, mime_type: "text/plain" }),
      { code: "ROUTE_NOT_FOUND" },
    );
    const pdf = catalog.routes.find(
      (route) => route.uri_pattern?.type === "application/pdf",
    );
    assert.ok(pdf);
    assert.equal(
      resolveAppRoute(catalog, { id: pdf.id }).app.mime_type,
      "application/pdf",
    );
  } finally {
    f.close();
  }
});

const receipt = (stdout: string): ProcessResult => ({
  stdout,
  stderr: "",
  elapsedMs: 1,
  pid: null,
  exitCode: 0,
  signal: null,
  truncated: false,
});
async function runtimeFixture() {
  const f = fixture();
  const old = {
    config: process.env.DEVECO_CONFIG,
    state: process.env.DEVECO_STATE_DIR,
  };
  const config = path.join(f.root, "config.json");
  atomicWrite(
    config,
    JSON.stringify({
      clt: path.join(f.root, "clt"),
      default_project: f.project,
    }),
  );
  process.env.DEVECO_CONFIG = config;
  fs.mkdirSync(path.join(f.root, "clt"));
  process.env.DEVECO_STATE_DIR = path.join(f.root, "state");
  const runtime = new Runtime();
  let closed = false;
  const closeRuntime = async () => {
    if (!closed) {
      closed = true;
      await runtime.close();
    }
  };
  return {
    ...f,
    runtime,
    closeRuntime,
    async close() {
      await closeRuntime();
      if (old.config === undefined) delete process.env.DEVECO_CONFIG;
      else process.env.DEVECO_CONFIG = old.config;
      if (old.state === undefined) delete process.env.DEVECO_STATE_DIR;
      else process.env.DEVECO_STATE_DIR = old.state;
      f.close();
    },
  };
}
async function settled(runtime: Runtime, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = z
      .object({ status: z.string(), result: z.unknown().optional() })
      .parse(
        await runtime.call("workflow_run", {
          action: "status",
          run_id: id,
          wait_ms: 100,
        }),
      );
    if (!["queued", "running", "cancelling"].includes(result.status))
      return result;
  }
  throw new Error("UI task did not settle");
}
test("native aa launch encodes typed Want arguments and rejects unsupported values before device execution", async (t) => {
  const f = await runtimeFixture();
  try {
    const calls: string[][] = [];
    t.mock.method(
      f.runtime.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls.push(args);
        return receipt(
          args[0] === "aa" ? "start ability successfully." : "1234",
        );
      },
    );
    const app = appSchema.parse({
      bundle_name: "com.example.routes",
      module: "entry",
      ability: "MainAbility",
      action: "view",
      entities: ["entity"],
      uri: "sample://app/items/42",
      parameters: { z: "中文 ' quoted", empty: "", enabled: false, count: 7 },
    });
    const result = await f.runtime.devices.launch("device", app);
    assert.equal(result.processVerified, true);
    assert.deepEqual(calls[0], [
      "aa",
      "start",
      "-b",
      "com.example.routes",
      "-a",
      "MainAbility",
      "-m",
      "entry",
      "-U",
      "sample://app/items/42",
      "-A",
      "view",
      "-e",
      "entity",
      "--pi",
      "count",
      "7",
      "--psn",
      "empty",
      "--pb",
      "enabled",
      "false",
      "--ps",
      "z",
      "中文 ' quoted",
    ]);
    for (const value of [-1, 1.5, 4294967296, "-option", "a\0b"]) {
      await assert.rejects(
        f.runtime.devices.launch("device", { ...app, parameters: { value } }),
      );
    }
    assert.equal(calls.length, 2);
  } finally {
    await f.close();
  }
});
test("goal navigation captures a saved flow and rejects ignored overrides before any device operation", async (t) => {
  const f = await runtimeFixture();
  try {
    let targets = 0,
      launches = 0,
      replays = 0;
    t.mock.method(f.runtime.devices, "target", async () => {
      targets++;
      return "device";
    });
    t.mock.method(f.runtime.devices, "launch", async () => {
      launches++;
      return {
        started: true,
        processVerified: true,
        outcomeVerified: false,
        bundle_name: "com.example.routes",
        target: "device",
      };
    });
    t.mock.method(f.runtime.devices, "verify", async () => ({
      verified: true,
    }));
    t.mock.method(
      f.runtime.flows,
      "run",
      async (
        ...[, , , variables, , captured]: Parameters<typeof f.runtime.flows.run>
      ) => {
        replays++;
        assert.equal(captured?.id, "settings");
        assert.equal(captured?.assert?.visible?.text, "Settings");
        assert.deepEqual(variables, {});
        return {
          id: "settings",
          verified: true,
          steps: [],
          repairSaved: false,
        };
      },
    );
    const flow = flowSchema.parse({
      version: 1,
      id: "settings",
      name: "打开设置",
      app: {
        bundleName: "com.example.routes",
        module: "entry",
        ability: "MainAbility",
      },
      start: { mode: "attach" },
      steps: [],
      assert: { visible: { text: "Settings" } },
    });
    await f.runtime.flows.save(inspectProject(f.project), flow);
    for (const input of [
      { goal: "MainAbility", assert: { visible: { text: "Done" } } },
      { goal: "example.action" },
      {
        goal: "example.action",
        variables: { ignored: "no" },
        assert: { visible: { text: "Done" } },
      },
      { goal: "设置", assert: { visible: { text: "Override" } } },
      { id: "settings", parameters: { ignored: "no" } },
      { goal: "设置", id: "settings" },
      { goal: "unknown", parameters: { ignored: "no" } },
      { goal: "unknown", variables: { ignored: "no" } },
      { goal: "unknown", assert: { visible: { text: "Done" } } },
      { goal: "unknown", replace: true },
      { goal: "unknown", flow },
    ])
      await assert.rejects(
        f.runtime.call("ui_flow", { action: "navigate", ...input }),
      );
    assert.equal(targets, 0);
    assert.equal(f.runtime.store.runCount(), 0);
    const input = {
      action: "navigate",
      goal: "设置",
      request_key: "goal-settings",
    };
    const run = z
      .object({ run_id: z.string() })
      .parse(await f.runtime.call("ui_flow", input));
    assert.equal((await settled(f.runtime, run.run_id)).status, "succeeded");
    assert.equal(replays, 1);
    assert.equal(launches, 0);
    // A replay request retains its resolved flow even when the saved name changes.
    const targetsBeforeDuplicate = targets;
    await f.runtime.flows.save(
      inspectProject(f.project),
      { ...flow, name: "Renamed" },
      true,
    );
    assert.equal(
      z
        .object({ deduplicated: z.boolean() })
        .parse(await f.runtime.call("ui_flow", input)).deduplicated,
      true,
    );
    assert.equal(targets, targetsBeforeDuplicate);
    const routeRun = z.object({ run_id: z.string() }).parse(
      await f.runtime.call("ui_flow", {
        action: "navigate",
        goal: "example.action",
        assert: { visible: { text: "Done" } },
      }),
    );
    assert.equal(
      (await settled(f.runtime, routeRun.run_id)).status,
      "succeeded",
    );
    assert.equal(launches, 1);
  } finally {
    await f.close();
  }
});
test("navigation persists before launch, deduplicates and rechecks only the final assertion after restart", async (t) => {
  const f = await runtimeFixture();
  try {
    t.mock.method(f.runtime.devices, "target", async () => "device");
    let launches = 0,
      verified = false;
    t.mock.method(f.runtime.devices, "launch", async () => {
      launches++;
      assert.equal(f.runtime.store.runCount(), 1);
      return {
        started: true,
        processVerified: true,
        outcomeVerified: false,
        bundle_name: "com.example.routes",
        target: "device",
      };
    });
    t.mock.method(
      f.runtime.devices,
      "verify",
      async (
        ...[_target, _assertion, _signal, bundle]: Parameters<
          typeof f.runtime.devices.verify
        >
      ) => {
        assert.equal(bundle, "com.example.routes");
        if (!verified) throw new Error("UI outcome not yet visible");
        return { verified: true };
      },
    );
    const input = {
      action: "navigate",
      route: { module: "entry", ability: "MainAbility" },
      assert: { visible: { text: "Done" } },
      request_key: "navigation-once",
    };
    const started = z
      .object({ run_id: z.string() })
      .parse(await f.runtime.call("ui_flow", input));
    assert.equal((await settled(f.runtime, started.run_id)).status, "failed");
    assert.equal(
      z
        .object({ run_id: z.string(), deduplicated: z.boolean() })
        .parse(await f.runtime.call("ui_flow", input)).deduplicated,
      true,
    );
    await assert.rejects(
      f.runtime.call("ui_flow", {
        ...input,
        assert: { visible: { text: "Changed" } },
      }),
      { code: "REQUEST_KEY_CONFLICT" },
    );
    // Release execution handles and reopen the database as a fresh MCP runtime.
    await f.closeRuntime();
    const second = new Runtime();
    try {
      t.mock.method(second.devices, "target", async () => "device");
      t.mock.method(second.devices, "launch", async () => {
        throw new Error("Recorded launch must not repeat");
      });
      t.mock.method(
        second.devices,
        "verify",
        async (
          ...[_target, _assertion, _signal, bundle]: Parameters<
            typeof f.runtime.devices.verify
          >
        ) => {
          assert.equal(bundle, "com.example.routes");
          return { verified: true };
        },
      );
      verified = true;
      await second.call("workflow_run", {
        action: "resume",
        run_id: started.run_id,
      });
      assert.equal((await settled(second, started.run_id)).status, "succeeded");
      assert.equal(launches, 1);
    } finally {
      await second.close();
    }
  } finally {
    await f.close();
  }
});
test("a lost navigation receipt remains uncertain on resume and does not blindly relaunch", async (t) => {
  const f = await runtimeFixture();
  try {
    t.mock.method(f.runtime.devices, "target", async () => "device");
    let launches = 0;
    t.mock.method(f.runtime.devices, "launch", async () => {
      launches++;
      throw new Error("Launch response lost");
    });
    const run = z.object({ run_id: z.string() }).parse(
      await f.runtime.call("ui_flow", {
        action: "navigate",
        route: { module: "entry", ability: "MainAbility" },
        assert: { visible: { text: "Done" } },
      }),
    );
    assert.equal((await settled(f.runtime, run.run_id)).status, "needs_input");
    await f.runtime.call("workflow_run", {
      action: "resume",
      run_id: run.run_id,
      resume_input: { action: "recheck" },
    });
    assert.equal((await settled(f.runtime, run.run_id)).status, "needs_input");
    assert.equal(launches, 1);
  } finally {
    await f.close();
  }
});
test("saved UI jobs capture flow contents, reject concurrent edits and propagate cancellation", async (t) => {
  const f = await runtimeFixture();
  try {
    t.mock.method(f.runtime.devices, "target", async () => "device");
    const project = inspectProject(f.project),
      flow = flowSchema.parse({
        version: 1,
        id: "saved",
        name: "Saved",
        app: {
          bundleName: "com.example.routes",
          module: "entry",
          ability: "MainAbility",
        },
        start: { mode: "attach" },
        steps: [],
        assert: { visible: { text: "Done" } },
      });
    await f.runtime.flows.save(project, flow);
    let executions = 0,
      cancellationObserved = false;
    const gate = Promise.withResolvers<void>();
    const lease = f.runtime.store.lease(
      `project:${project.root}`,
      async () => gate.promise,
    );
    await delay(10);
    t.mock.method(
      f.runtime.flows,
      "run",
      async (
        ...[_project, _id, _target, _variables, signal, captured]: Parameters<
          typeof f.runtime.flows.run
        >
      ) => {
        executions++;
        assert.deepEqual(captured, flow);
        try {
          await delay(10000, undefined, { signal });
        } finally {
          cancellationObserved = signal?.aborted === true;
        }
        throw new Error("Cancellation did not propagate");
      },
    );
    const changed = z
      .object({ run_id: z.string() })
      .parse(await f.runtime.call("ui_flow", { action: "run", id: "saved" }));
    atomicWrite(
      path.join(f.project, ".arkpilot/flows/saved.json"),
      JSON.stringify({ ...flow, name: "Externally modified" }),
    );
    gate.resolve();
    await lease;
    assert.equal((await settled(f.runtime, changed.run_id)).status, "failed");
    assert.equal(executions, 0);
    await f.runtime.flows.save(project, flow, true);
    const running = z
      .object({ run_id: z.string() })
      .parse(await f.runtime.call("ui_flow", { action: "run", id: "saved" }));
    for (let n = 0; n < 100 && executions === 0; n++) await delay(10);
    assert.equal(executions, 1);
    await f.runtime.call("workflow_run", {
      action: "cancel",
      run_id: running.run_id,
    });
    assert.equal(
      (await settled(f.runtime, running.run_id)).status,
      "needs_input",
    );
    assert.equal(cancellationObserved, true);
    assert.equal(f.runtime.store.uncertainOperations(running.run_id).length, 1);
    await assert.rejects(
      f.runtime.call("workflow_run", {
        action: "cancel",
        run_id: running.run_id,
      }),
      { code: "EFFECT_UNCERTAIN" },
    );
  } finally {
    await f.close();
  }
});
