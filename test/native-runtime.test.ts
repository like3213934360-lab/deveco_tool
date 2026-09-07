import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
import { ToolError } from "../src/core/errors.js";

const temporary = () =>
  fs.realpathSync(
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
    const doctor = await client.callTool({
      name: "deveco_doctor",
      arguments: {},
    });
    assert.notEqual(doctor.isError, true);
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
test("hard interruption resumes from SQLite without repeating a completed effect", async () => {
  const trace = (stage: string) => {
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
    });
    child.stdout?.resume();
    child.stderr?.resume();
    trace("wait-ready");
    await until(() => fs.existsSync(path.join(root, "ready")));
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
  } finally {
    trace("close-engine");
    await engine?.close();
    trace("close-processes");
    await processes.close();
    trace("close-store");
    store?.close();
    trace("remove-root");
    fs.rmSync(root, { recursive: true, force: true });
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
