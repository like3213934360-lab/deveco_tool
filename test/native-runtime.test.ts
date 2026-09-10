import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { LanguageService } from "../src/services/lsp.js";
import {
  selectorSchema,
  flattenDump,
  selectNodes,
} from "../src/services/device.js";
import type { Project } from "../src/services/project.js";
import { hotChanges } from "../src/services/hotreload.js";
import { ToolError, errorResult } from "../src/core/errors.js";

const temporary = () =>
  fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-native-中文 空格-")),
  );
async function until(check: () => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for state");
    await delay(10);
  }
}
function fakeProject(root: string): Project {
  return {
    root,
    product: {
      name: "default",
      compatibleSdkVersion: "26.0.0",
      runtimeOS: "HarmonyOS",
    },
    modules: [],
    fingerprint: "fixture",
  };
}
test("MCP catalogs work without SDK discovery, invalid input is rejected, worker restarts cleanly", async () => {
  const root = temporary(),
    client = new Client({ name: "native-contract-test", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))],
      stderr: "ignore",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        DEVECO_STATE_DIR: root,
      },
    });
  try {
    await client.connect(transport);
    const instructions = client.getInstructions();
    assert.match(instructions ?? "", /first \.ets file/);
    assert.match(instructions ?? "", /arkts-grammar-standards\/recipes-core/);
    assert.match(instructions ?? "", /diagnostics first, then project_build/);
    assert.match(instructions ?? "", /explicit successful final assertion/);
    const catalog = await client.listTools();
    assert.equal(catalog.tools.length, 25);
    assert.ok(catalog.tools.every((tool) => tool.outputSchema));
    const workflows = await client.callTool({
      name: "workflow_catalog",
      arguments: {},
    });
    assert.notEqual(workflows.isError, true);
    assert.equal(fs.existsSync(path.join(root, "state.sqlite")), false);
    const invalid = await client.callTool({
      name: "workflow_run",
      arguments: { action: "status", run_id: "bad" },
    });
    assert.equal(invalid.isError, true);
    for (const options of [{ name: "invalid_name" }, { name: "" }, {}, { name: "Valid", extra: "rejected" }]) {
      const configure = await client.callTool({ name: "app_signature", arguments: { action: "configure", file: "descriptor.json", output: "signing", options } });
      assert.equal(configure.isError, true);
      assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(configure.structuredContent).error.code, "INVALID_ARGUMENT");
      assert.equal(fs.existsSync(path.join(root, "state.sqlite")), false, "Invalid signing configuration must be rejected before starting a runtime or durable effect");
    }
    const doctor = await client.callTool({
      name: "deveco_doctor",
      arguments: {},
    });
    assert.notEqual(doctor.isError, true);
    const telemetry = z.object({ data: z.object({ runtime: z.object({
      pid: z.number().int().positive(), rss_bytes: z.number().positive(),
      cpu: z.object({ user: z.number().nonnegative(), system: z.number().nonnegative() }),
      sdk: z.object({ pids: z.array(z.number()), process_starts: z.number() }),
      retained: z.object({ processes: z.number(), connections: z.number() }),
    }) }) }).parse(doctor.structuredContent).data.runtime;
    assert.equal(telemetry.pid, transport.pid);
    assert.notEqual(telemetry.pid, process.pid);
    assert.deepEqual(telemetry.sdk.pids, []);
    assert.equal(telemetry.sdk.process_starts, 0);
    assert.equal(telemetry.retained.processes, 0);
    assert.equal(telemetry.retained.connections, 0);
    assert.equal(fs.existsSync(path.join(root, "state.sqlite")), true);
    const restart = await client.callTool({
      name: "deveco_restart",
      arguments: {},
    });
    assert.notEqual(restart.isError, true);
    const again = await client.callTool({
      name: "deveco_doctor",
      arguments: {},
    });
    assert.notEqual(again.isError, true);
  } finally {
    await transport.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("MCP worker failures retain matching request telemetry after a successful next call and process exit", { timeout: 20000 }, async () => {
  const root = temporary(), project = path.join(root, "empty-project"), config = path.join(root, "config.json"), state = path.join(root, "state");
  fs.mkdirSync(project);
  fs.writeFileSync(config, "{}\n");
  const client = new Client({ name: "native-worker-failure-log-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))],
    cwd: root,
    stderr: "ignore",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH", "PROJECT_PATH"].includes(entry[0]))),
      DEVECO_CONFIG: config, DEVECO_STATE_DIR: state,
    },
  });
  const readEvents = () => {
    const db = new Database(path.join(state, "state.sqlite"), { readonly: true, fileMustExist: true });
    try {
      return z.array(z.object({ id: z.number(), kind: z.string(), data: z.string(), created: z.number() }))
        .parse(db.prepare("SELECT id,kind,data,created FROM events WHERE kind IN ('request_start','request_finish','request_failed') ORDER BY id").all())
        .map(row => ({ ...row, data: z.object({ request_id: z.string(), tool: z.string(), code: z.string().optional() }).parse(JSON.parse(row.data)) }));
    } finally { db.close(); }
  };
  try {
    await client.connect(transport);
    const pid = transport.pid;
    assert.ok(pid);
    // The existing empty directory passes the MCP schema and fails inside the Worker project service.
    const failure = await client.callTool({ name: "switch_cwd", arguments: { project_path: project } });
    assert.equal(failure.isError, true);
    const failed = z.object({ ok: z.literal(false), request_id: z.uuid(), error: z.object({ code: z.literal("PROJECT_INVALID") }) }).parse(failure.structuredContent);
    const success = await client.callTool({ name: "workflow_run", arguments: { action: "list" } });
    assert.notEqual(success.isError, true);
    const succeeded = z.object({ ok: z.literal(true), request_id: z.uuid() }).parse(success.structuredContent);
    assert.notEqual(succeeded.request_id, failed.request_id);
    await until(() => readEvents().length >= 4);
    const live = readEvents();
    assert.deepEqual(live.map(row => [row.kind, row.data.request_id, row.data.tool, row.data.code]), [
      ["request_start", failed.request_id, "switch_cwd", undefined],
      ["request_failed", failed.request_id, "switch_cwd", "PROJECT_INVALID"],
      ["request_start", succeeded.request_id, "workflow_run", undefined],
      ["request_finish", succeeded.request_id, "workflow_run", undefined],
    ]);
    await client.close();
    await until(() => {
      try { process.kill(pid, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; }
    });
    assert.deepEqual(readEvents(), live, "The exact request events must survive process exit");
  } finally {
    await transport.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP diagnostic calls reject a missing configured SDK without falling back to the machine installation", async () => {
  const root = temporary(), project = path.join(root, "application"), config = path.join(root, "config.json");
  // Traverse through Node's JavaScript copy implementation: the native recursive
  // fast path on Windows Node 22 did not create this Unicode destination in CI.
  fs.cpSync(fileURLToPath(new URL("../../test/fixtures/harmony-app", import.meta.url)), project, { recursive: true, filter: () => true });
  assert.equal(fs.realpathSync.native(project), project, "The missing-SDK test requires an existing canonical project");
  assert.ok(fs.statSync(path.join(project, "entry/src/main/ets/pages/Index.ets")).isFile());
  fs.writeFileSync(config, JSON.stringify({ clt: path.join(root, "absent-sdk") }));
  const client = new Client({ name: "native-missing-sdk-test", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))], stderr: "ignore",
      env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_"))),
        DEVECO_CONFIG: config, DEVECO_STATE_DIR: path.join(root, "state") },
    });
  try {
    await client.connect(transport);
    const file = "entry/src/main/ets/pages/Index.ets";
    for (const [name, input] of [
      ["arkts_check", { files: [file] }],
      ["lsp", { action: "diagnostics", file }],
      ["code_lint", { path: file }],
    ] as const) {
      const result = await client.callTool({ name, arguments: { project_path: project, ...input } });
      assert.equal(result.isError, true);
      const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(result.structuredContent).error;
      assert.equal(failure.code, "TOOLCHAIN_MISSING", `${name}: ${JSON.stringify(failure)}`);
    }
    const doctor = await client.callTool({ name: "deveco_doctor", arguments: {} });
    assert.notEqual(doctor.isError, true);
    const data = z.object({ data: z.object({
      toolchain: z.object({ error: z.object({ code: z.literal("TOOLCHAIN_MISSING") }) }),
      default_sdk: z.object({ error: z.object({ code: z.literal("TOOLCHAIN_MISSING") }) }),
      runtime: z.object({ sdk: z.object({ process_starts: z.literal(0), pids: z.array(z.number()).length(0) }) }),
    }) }).parse(doctor.structuredContent);
    assert.ok(data.data.toolchain.error);
  } finally {
    await transport.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP doctor exposes default SDK API metadata and reports missing or invalid fields independently of component detection", async () => {
  const root = temporary(), clt = path.join(root, "clt"), config = path.join(root, "config.json");
  const metadata = path.join(clt, "sdk/default/sdk-pkg.json");
  fs.mkdirSync(path.dirname(metadata), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ clt }));
  const client = new Client({ name: "native-default-sdk-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))], stderr: "ignore",
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_"))), DEVECO_CONFIG: config, DEVECO_STATE_DIR: path.join(root, "state") },
  });
  try {
    await client.connect(transport);
    const doctor = async () => {
      const result = await client.callTool({ name: "deveco_doctor", arguments: {} });
      assert.notEqual(result.isError, true);
      return z.object({ data: z.object({ default_sdk: z.unknown() }) }).parse(result.structuredContent).data.default_sdk;
    };
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(await doctor()).error.code, "SDK_METADATA_MISSING");
    fs.writeFileSync(metadata, JSON.stringify({ data: { apiVersion: "26", platformVersion: "26.0.0", version: "26.0.0.105" } }));
    assert.deepEqual(await doctor(), { api_level: 26, platform_version: "26.0.0", package_version: "26.0.0.105", metadata_path: metadata });
    fs.writeFileSync(metadata, JSON.stringify({ data: { apiVersion: "invalid", platformVersion: "26.0.0" } }));
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(await doctor()).error.code, "SDK_METADATA_INVALID");
    fs.writeFileSync(metadata, "invalid updated SDK metadata");
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(await doctor()).error.code, "SDK_METADATA_INVALID");
  } finally { await transport.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("managed processes bound output, handle spawn failures and confirm cancellation", async () => {
  const processes = new ProcessService(),
    controller = new AbortController();
  try {
    const result = await processes.run(
      {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(200000));process.stderr.write('y'.repeat(200000))",
        ],
      },
      { limitBytes: 4096 },
    );
    assert.equal(result.stdout.length, 4096);
    assert.equal(result.stderr.length, 4096);
    assert.equal(result.truncated, true);
    await assert.rejects(
      processes.run({
        executable: path.join(os.tmpdir(), "missing-deveco-executable"),
        args: [],
      }),
    );
    const pending = processes.run(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof ToolError && error.code === "CANCELLED",
    );
    assert.equal(processes.size, 0);
    await assert.rejects(
      processes.run(
        {
          executable: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
        },
        { timeoutMs: 50 },
      ),
      (error: unknown) =>
        error instanceof ToolError && error.code === "PROCESS_TIMEOUT",
    );
    assert.equal(processes.size, 0);
  } finally {
    await processes.close();
  }
});
for (const links of ["0", "1"])
  test(`LSP refreshes Unicode paths and filters every semantic declaration (links=${links})`, async () => {
    const root = temporary(),
      processes = new ProcessService(),
      language = new LanguageService(processes, (project) => ({
        executable: process.execPath,
        args: [
          fileURLToPath(new URL("./fixtures/native-lsp.js", import.meta.url)),
        ],
        cwd: project.root,
        env: { ...process.env, LOCATION_LINK: links },
      }));
    try {
      for (const file of ["Model.ets", "Implementation.ets", "Consumer.ets"])
        fs.writeFileSync(path.join(root, file), "original");
      const project = fakeProject(root);
      await language.request(project, { action: "hover", file: "Model.ets" });
      fs.writeFileSync(path.join(root, "Model.ets"), "updated");
      const hover = (await language.request(project, {
        action: "hover",
        file: "Consumer.ets",
      })) as { contents: string };
      assert.match(hover.contents, /updated/);
      const all = await language.request(project, {
        action: "references",
        file: "Model.ets",
        includeDeclaration: true,
      });
      assert.equal((all as unknown[]).length, 3);
      const usages = await language.request(project, {
        action: "references",
        file: "Model.ets",
        includeDeclaration: false,
      });
      assert.equal((usages as unknown[]).length, 1);
      assert.match(JSON.stringify(usages), /Consumer/);
      fs.rmSync(path.join(root, "Model.ets"));
      const closed = await language.request(project, {
        action: "hover",
        file: "Consumer.ets",
      });
      assert.doesNotMatch(JSON.stringify(closed), /Model\.ets/);
    } finally {
      await language.close();
      await processes.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
test("UI state participates in selectors and ambiguous matches are retained", () => {
  const nodes = flattenDump({
    attributes: { bounds: "[0,0][100,100]" },
    children: [
      {
        attributes: {
          bounds: "[1,1][40,40]",
          text: "测试",
          checked: "true",
          clickable: "true",
          enabled: "false",
        },
      },
      {
        attributes: {
          bounds: "[50,50][90,90]",
          text: "测试",
          checked: "false",
          enabled: "true",
        },
      },
    ],
  });
  assert.equal(
    selectNodes(nodes, selectorSchema.parse({ text: "测试" })).length,
    2,
  );
  assert.equal(
    selectNodes(
      nodes,
      selectorSchema.parse({ text: "测试", checked: false, enabled: true }),
    ).length,
    1,
  );
  assert.equal(nodes[0]?.checked, null);
});
test("LSP documents stay bounded and least recently used files are closed", async () => {
  const root = temporary(),
    processes = new ProcessService(),
    language = new LanguageService(
      processes,
      (project) => ({
        executable: process.execPath,
        args: [
          fileURLToPath(new URL("./fixtures/native-lsp.js", import.meta.url)),
        ],
        cwd: project.root,
      }),
      { request_ms: 3000, opened_files: 2 },
    );
  try {
    const project = fakeProject(root);
    for (const file of ["A.ets", "B.ets", "C.ets"])
      fs.writeFileSync(path.join(root, file), "source");
    for (const file of ["A.ets", "B.ets"])
      await language.request(project, { action: "hover", file });
    const third = await language.request(project, {
      action: "hover",
      file: "C.ets",
    });
    assert.doesNotMatch(JSON.stringify(third), /A\.ets/);
    assert.match(JSON.stringify(third), /B\.ets/);
    assert.match(JSON.stringify(third), /C\.ets/);
  } finally {
    await language.close();
    await processes.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("cancelling a queued LSP request does not let later requests bypass the active request", async () => {
  const root = temporary(),
    processes = new ProcessService(),
    language = new LanguageService(
      processes,
      (project) => ({
        executable: process.execPath,
        args: [
          fileURLToPath(new URL("./fixtures/native-lsp.js", import.meta.url)),
        ],
        cwd: project.root,
        env: { ...process.env, HOVER_DELAY_MS: "150" },
      }),
      { request_ms: 3000, opened_files: 2 },
    );
  try {
    const project = fakeProject(root);
    fs.writeFileSync(path.join(root, "A.ets"), "source");
    const first = language.request(project, { action: "hover", file: "A.ets" }),
      cancel = new AbortController(),
      queued = language.request(
        project,
        { action: "hover", file: "A.ets" },
        cancel.signal,
      );
    cancel.abort();
    await assert.rejects(queued);
    const third = language.request(project, { action: "hover", file: "A.ets" });
    for (const result of await Promise.all([first, third]))
      assert.equal(
        (
          JSON.parse((result as { contents: string }).contents) as {
            concurrent: number;
          }
        ).concurrent,
        1,
      );
  } finally {
    await language.close();
    await processes.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("workflow input is encrypted and lease ownership crosses processes", async () => {
  const root = temporary(),
    processes = new ProcessService();
  let store: StateStore | undefined;
  try {
    store = new StateStore(root);
    const run = store.create("test", { secret: "never-plaintext" }).run;
    assert.match(store.get(run.id).input, /never-plaintext/);
    assert.doesNotMatch(
      String(
        (store.db.prepare("SELECT input FROM runs").get() as { input: string })
          .input,
      ),
      /never-plaintext/,
    );
    const child = processes.spawn({
      executable: process.execPath,
      args: [
        fileURLToPath(
          new URL("./fixtures/native-state-peer.js", import.meta.url),
        ),
        root,
        "lease",
      ],
    });
    child.stdout?.resume();
    child.stderr?.resume();
    await until(() => fs.existsSync(path.join(root, "ready")));
    let acquired = false;
    const waiting = store.lease("project:shared", async () => {
      acquired = true;
    });
    await delay(100);
    assert.equal(acquired, false);
    await processes.terminate(child);
    await waiting;
    assert.equal(acquired, true);
  } finally {
    await processes.close();
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("hard interruption resumes from SQLite without repeating a completed effect", async (t) => {
  let stage = "initial",
    peerError = "";
  let peerState: () => unknown = () => null;
  const trace = (value: string) => {
    stage = value;
    if (process.env.DEVECO_TEST_RECOVERY_TRACE === "1")
      fs.writeSync(2, `recovery stage: ${stage}\n`);
  };
  trace("create-root");
  const root = temporary(),
    processes = new ProcessService();
  let store: StateStore | undefined, engine: WorkflowEngine | undefined;
  try {
    trace("spawn-peer");
    const child = processes.spawn({
      executable: process.execPath,
      args: [
        fileURLToPath(
          new URL("./fixtures/native-state-peer.js", import.meta.url),
        ),
        root,
        "run",
      ],
      env: { ...process.env, DEVECO_TEST_RECOVERY_TRACE: "1" },
    });
    peerState = () => ({
      pid: child.pid,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    });
    child.stdout?.resume();
    child.stderr?.resume();
    trace("wait-ready");
    child.stderr?.on("data", (chunk: Buffer) => {
      peerError = (peerError + chunk.toString()).slice(-8192);
    });
    await until(() => {
      const failure = path.join(root, "peer-error");
      if (fs.existsSync(failure)) assert.fail(fs.readFileSync(failure, "utf8"));
      assert.equal(
        child.exitCode,
        null,
        `Peer exited before readiness: ${peerError}`,
      );
      assert.equal(
        child.signalCode,
        null,
        `Peer terminated before readiness: ${peerError}`,
      );
      return fs.existsSync(path.join(root, "ready"));
    // This is fixture preparation (SQLite creation and durable checkpointing),
    // not the operation/recovery deadline. Loaded Windows runners can spend
    // over ten seconds reaching the interruption barrier; retain a finite cap.
    }, process.platform === "win32" ? 30000 : 10000);
    trace("terminate-peer");
    await processes.terminate(child);
    trace("open-store");
    store = new StateStore(root);
    trace("read-run");
    const id = fs.readFileSync(path.join(root, "run"), "utf8");
    assert.equal(store.get(id).status, "interrupted");
    const definition: WorkflowDefinition = {
      id: "restart",
      description: "restart",
      capabilities: [],
      completion: "done",
      resources: () => [],
      steps: [
        {
          id: "effect",
          kind: "effect",
          async execute() {
            throw new Error("Completed effect must never repeat");
          },
        },
        {
          id: "pause",
          kind: "read",
          async execute() {
            return { resumed: true };
          },
        },
      ],
    };
    engine = new WorkflowEngine(store, [definition], async () => {});
    trace("resume");
    await engine.resume(id);
    await until(() => store!.get(id).status === "succeeded");
    assert.equal(
      fs.readFileSync(path.join(root, "effects"), "utf8"),
      "effect\n",
    );
    trace("verified");
  } catch (error) {
    t.diagnostic(
      JSON.stringify({
        stage,
        peer: peerState(),
        stderr: peerError,
        error: errorResult(error),
        files: fs.readdirSync(root),
      }),
    );
    if (process.env.DEVECO_TEST_RECOVERY_TRACE === "1")
      fs.writeSync(
        2,
        `recovery error: ${error instanceof Error ? error.stack : String(error)}\n`,
      );
    throw error;
  } finally {
    trace("close-engine");
    await engine?.close();
    trace("close-processes");
    await processes.close();
    trace("close-store");
    store?.close();
    trace("remove-root");
    await fs.promises.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 40,
    });
    trace("done");
  }
});
test("HAR source changes propagate to consumers and native changes require cold deploy", () => {
  const root = temporary();
  try {
    const project = fakeProject(root);
    project.modules = ["entry", "sharedlib"].map((name) => ({
      name,
      root: path.join(root, name),
      target: "default",
    }));
    for (const module of project.modules) {
      fs.mkdirSync(path.join(module.root, "src/main"), { recursive: true });
      fs.writeFileSync(
        path.join(module.root, "src/main/module.json5"),
        JSON.stringify({
          module: { type: module.name === "entry" ? "entry" : "har" },
        }),
      );
      fs.writeFileSync(
        path.join(module.root, "oh-package.json5"),
        JSON.stringify({
          dependencies:
            module.name === "entry" ? { sharedlib: "file:../sharedlib" } : {},
        }),
      );
    }
    const file = path.join(root, "sharedlib/src/main/Shared.ets");
    fs.writeFileSync(file, "export const n = 1");
    assert.deepEqual([...hotChanges(project, [file]).keys()], ["entry"]);
    const cpp = path.join(root, "sharedlib/src/main/source.cpp");
    fs.writeFileSync(cpp, "int main(){}");
    assert.throws(() => hotChanges(project, [cpp]), /cold incremental/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
