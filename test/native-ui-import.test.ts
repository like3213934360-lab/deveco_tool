import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { CpuPool } from "../src/core/cpu-pool.js";
import { tools } from "../src/core/contracts.js";
import { findInSavedTree, readUiTreeFile } from "../src/services/ui-import.js";
import { parseUiDump } from "../src/services/ui-parse.js";
import { Runtime } from "../src/services/runtime.js";
import { SavedUiTreeCache } from "../src/services/ui-import-cache.js";
import { UiIndex } from "../src/services/ui-tree.js";

function setup(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-ui-import-中文 空格-"),
    ),
    store = new StateStore(path.join(root, "state")),
    cpu = new CpuPool();
  t.after(async () => {
    await cpu.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, "tree.json"),
    raw = {
      attributes: {
        type: "WindowScene",
        id: "window",
        displayId: 1,
        bounds: "[0,0][100,100]",
      },
      children: [0, 1].map((i) => ({
        attributes: {
          type: "Button",
          id: `button-${i}`,
          text: "中文按钮",
          checked: i === 0,
          bounds: "[1,1][20,20]",
        },
      })),
    };
  fs.writeFileSync(file, JSON.stringify(raw));
  return { root, store, cpu, file, raw };
}
test("offline UI file and normalized artifact queries retain the same hierarchy, signatures and ambiguous counts", async (t) => {
  const f = setup(t),
    queries = [
      { id: "both", selector: { text: "中文", limit: 1 } },
      { id: "checked", selector: { checked: true, displayId: 1 } },
    ];
  const fromFile = await findInSavedTree(
    tools.ui_find.schema.parse({ tree_file: f.file, selectors: queries }),
    f.store,
    f.cpu,
  );
  const nodes = parseUiDump(JSON.stringify(f.raw)),
    artifact = f.store.artifact(
      "test",
      JSON.stringify(nodes.nodes),
      "application/json",
    );
  const fromArtifact = await findInSavedTree(
    tools.ui_find.schema.parse({
      tree_artifact_id: artifact.artifact_id,
      tree_format: "nodes",
      selectors: queries,
    }),
    f.store,
    f.cpu,
  );
  assert.equal(fromFile.source, "saved_tree");
  assert.equal(fromFile.device_state_verified, false);
  assert.equal("snapshot_id" in fromFile, false);
  assert.equal(fromFile.signature, nodes.signature);
  assert.equal(fromFile.structure_signature, fromArtifact.structure_signature);
  const schema = z.object({
    queries: z.array(
      z.object({
        id: z.string(),
        match_count: z.number(),
        matches: z.array(z.unknown()),
        truncated: z.boolean(),
      }),
    ),
  });
  const fileResult = schema.parse(fromFile),
    artifactResult = schema.parse(fromArtifact);
  assert.deepEqual(fileResult, artifactResult);
  assert.deepEqual(
    fileResult.queries.map((q) => [
      q.id,
      q.match_count,
      q.matches.length,
      q.truncated,
    ]),
    [
      ["both", 2, 1, true],
      ["checked", 1, 1, false],
    ],
  );
  fs.writeFileSync(
    f.file,
    JSON.stringify({
      attributes: { text: "changed", bounds: "[0,0][100,100]" },
    }),
  );
  const changed = await findInSavedTree(
    tools.ui_find.schema.parse({
      tree_file: f.file,
      selector: { text: "中文" },
    }),
    f.store,
    f.cpu,
  );
  assert.notEqual(changed.signature, fromFile.signature);
  assert.equal(
    z.object({ match_count: z.literal(0) }).parse(changed).match_count,
    0,
  );
});
test("saved UI sources reject conflicting device inputs, malformed hierarchies and unbounded or invalid files", async (t) => {
  const f = setup(t);
  for (const input of [
    { tree_file: f.file, target: "device" },
    { tree_file: f.file, snapshot_id: "11111111-1111-4111-8111-111111111111" },
    {
      tree_file: f.file,
      tree_artifact_id: "11111111-1111-4111-8111-111111111111",
    },
    { tree_format: "nodes" },
  ])
    assert.throws(() => tools.ui_find.schema.parse(input));
  for (const content of [
    "{broken",
    "null",
    "{}",
    JSON.stringify({ foo: "bar" }),
  ]) {
    fs.writeFileSync(f.file, content);
    await assert.rejects(
      findInSavedTree(
        tools.ui_find.schema.parse({ tree_file: f.file }),
        f.store,
        f.cpu,
      ),
    );
  }
  fs.writeFileSync(f.file, Buffer.from([0xff, 0xfe]));
  await assert.rejects(
    findInSavedTree(
      tools.ui_find.schema.parse({ tree_file: f.file }),
      f.store,
      f.cpu,
    ),
    { code: "UI_TREE_ENCODING_INVALID" },
  );
  await assert.rejects(readUiTreeFile("relative.json"), {
    code: "UI_TREE_PATH_INVALID",
  });
  await assert.rejects(readUiTreeFile(f.root), {
    code: "UI_TREE_FILE_INVALID",
  });
  fs.truncateSync(f.file, 32 * 1024 * 1024 + 1);
  await assert.rejects(readUiTreeFile(f.file), {
    code: "UI_TREE_FILE_INVALID",
  });
  const nodes = parseUiDump(JSON.stringify(f.raw)).nodes;
  for (const edited of [
    nodes.map((node, i) => (i === 1 ? { ...node, parent: 2 } : node)),
    nodes.map((node, i) => (i === 2 ? { ...node, depth: 4 } : node)),
    nodes.map((node) => ({ ...node, rect: { x1: 10, x2: 0, y1: 0, y2: 10 } })),
  ])
    assert.throws(() => parseUiDump(JSON.stringify(edited), "nodes"), {
      code: "UI_TREE_INVALID",
    });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readUiTreeFile(f.file, controller.signal), {
    name: "AbortError",
  });
});
test("large saved UI trees share the bounded CPU parser and match normalized artifact semantics", async (t) => {
  const f = setup(t),
    raw = {
      ...f.raw,
      children: Array.from({ length: 700 }, (_, i) => ({
        attributes: {
          type: "Button",
          id: `button-${i}`,
          text: "测".repeat(100),
          bounds: "[1,1][20,20]",
        },
      })),
    };
  fs.writeFileSync(f.file, JSON.stringify(raw));
  const result = await findInSavedTree(
    tools.ui_find.schema.parse({
      tree_file: f.file,
      selector: { key: "button-699" },
    }),
    f.store,
    f.cpu,
  );
  assert.equal(f.cpu.metrics.completed, 1);
  assert.equal(
    z.object({ match_count: z.literal(1) }).parse(result).match_count,
    1,
  );
  const nodes = parseUiDump(JSON.stringify(raw)),
    artifact = f.store.artifact(
      "test",
      JSON.stringify(nodes.nodes),
      "application/json",
    );
  const normalized = await findInSavedTree(
    tools.ui_find.schema.parse({
      tree_artifact_id: artifact.artifact_id,
      tree_format: "nodes",
      selector: { key: "button-699" },
    }),
    f.store,
    f.cpu,
  );
  assert.equal(f.cpu.metrics.completed, 2);
  assert.equal(normalized.signature, result.signature);
  const invalid = f.store.artifact("test", "not json", "text/plain");
  await assert.rejects(
    findInSavedTree(
      tools.ui_find.schema.parse({ tree_artifact_id: invalid.artifact_id }),
      f.store,
      f.cpu,
    ),
    { code: "UI_TREE_ARTIFACT_INVALID" },
  );
});
test("runtime offline UI queries never discover a device or use its cached live snapshot", async (t) => {
  const f = setup(t),
    previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = path.join(f.root, "runtime-state");
  const runtime = new Runtime();
  runtime.devices.target = async () => {
    throw new Error("Device discovery must not run");
  };
  try {
    const value = await runtime.call("ui_find", {
      tree_file: f.file,
      selector: { key: "button-1" },
    });
    assert.equal(
      z.object({ match_count: z.literal(1) }).parse(value).match_count,
      1,
    );
    assert.equal(runtime.processes.size, 0);
    const first = runtime.call("ui_find", { tree_file: f.file }),
      second = runtime.call("ui_find", { tree_file: f.file });
    await assert.rejects(runtime.call("ui_find", { tree_file: f.file }), {
      code: "UI_TREE_QUERY_BUSY",
      retryable: true,
    });
    await Promise.all([first, second]);
    await assert.doesNotReject(runtime.call("ui_find", { tree_file: f.file }));
    assert.equal(runtime.savedTrees.metrics.entries, 1);
    assert.equal(runtime.savedTrees.metrics.hits, 3);
  } finally {
    await runtime.close();
    assert.equal(runtime.savedTrees.metrics.entries, 0);
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
  }
});
test("saved UI cache uses freshly read content identity, preserves format boundaries and cannot bypass missing sources", async (t) => {
  const f = setup(t),
    cache = new SavedUiTreeCache();
  t.after(() => cache.close());
  const find = (input: unknown) =>
    findInSavedTree(
      tools.ui_find.schema.parse(input),
      f.store,
      f.cpu,
      undefined,
      cache,
    );
  const first = await find({
    tree_file: f.file,
    selector: { key: "button-1" },
  });
  assert.equal(cache.metrics.misses, 1);
  const second = await find({
    tree_file: f.file,
    selector: { key: "button-1" },
  });
  assert.deepEqual(second, first);
  assert.equal(cache.metrics.hits, 1);
  // Returned rectangles must not expose the cached node's mutable object.
  if ("matches" in second && second.matches[0]?.rect)
    second.matches[0].rect.x1 = 99;
  assert.deepEqual(
    await find({ tree_file: f.file, selector: { key: "button-1" } }),
    first,
  );
  const stat = fs.statSync(f.file),
    raw = fs.readFileSync(f.file, "utf8");
  fs.writeFileSync(f.file, raw.replaceAll("中文按钮", "内容更新"));
  fs.utimesSync(f.file, stat.atime, stat.mtime);
  assert.equal(fs.statSync(f.file).size, stat.size);
  const changed = await find({
    tree_file: f.file,
    selector: { text: "内容更新" },
  });
  assert.notEqual(changed.signature, first.signature);
  assert.equal(
    z.object({ match_count: z.literal(2) }).parse(changed).match_count,
    2,
  );
  await assert.rejects(find({ tree_file: f.file, tree_format: "nodes" }));
  const artifact = f.store.artifact(
    "test",
    fs.readFileSync(f.file),
    "application/json",
  );
  const hits = cache.metrics.hits;
  assert.equal(
    (await find({ tree_artifact_id: artifact.artifact_id })).signature,
    changed.signature,
  );
  assert.equal(cache.metrics.hits, hits + 1);
  fs.unlinkSync(path.join(f.store.root, "artifacts", artifact.artifact_id));
  await assert.rejects(find({ tree_artifact_id: artifact.artifact_id }));
  fs.unlinkSync(f.file);
  await assert.rejects(find({ tree_file: f.file }), {
    code: "UI_TREE_FILE_INVALID",
  });
  cache.close();
  assert.equal(cache.metrics.entries, 0);
  assert.equal(cache.metrics.estimated_bytes, 0);
});
test("saved UI cache bounds parsed trees and lazy indexes, evicts least recent content and releases idle memory", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = new SavedUiTreeCache(),
    parsed = parseUiDump(JSON.stringify({ attributes: { type: "Button" } })),
    index = new UiIndex(parsed.nodes);
  t.after(() => cache.close());
  cache.put("one", parsed, index, 100);
  cache.put("two", parsed, index, 100);
  assert.ok(cache.get("one"));
  cache.put("three", parsed, index, 100);
  assert.equal(cache.get("two"), undefined);
  assert.equal(cache.metrics.entries, 2);
  cache.put("oversized", parsed, index, cache.limits.estimated_bytes);
  assert.equal(cache.get("oversized"), undefined);
  assert.equal(cache.metrics.entries, 2);
  cache.put("large", parsed, index, cache.limits.estimated_bytes - 2048);
  assert.ok(cache.metrics.estimated_bytes <= cache.limits.estimated_bytes);
  assert.equal(cache.metrics.entries, 1);
  t.mock.timers.tick(cache.limits.idle_ms - 1);
  assert.equal(cache.metrics.entries, 1);
  assert.ok(cache.get("large"));
  t.mock.timers.tick(cache.limits.idle_ms - 1);
  assert.equal(cache.metrics.entries, 1);
  t.mock.timers.tick(1);
  assert.equal(cache.metrics.entries, 0);
  assert.equal(cache.metrics.estimated_bytes, 0);
  cache.close();
  assert.throws(() => cache.put("closed", parsed, index, 100), {
    code: "RUNTIME_STOPPING",
  });
});
test("saved UI previews bound repeated matches and retain full input as a readable artifact", async (t) => {
  const f = setup(t);
  fs.writeFileSync(
    f.file,
    JSON.stringify({
      attributes: {
        type: "Button",
        text: "测".repeat(5000),
        bounds: "[0,0][100,100]",
      },
    }),
  );
  const result = await findInSavedTree(
    tools.ui_find.schema.parse({
      tree_file: f.file,
      selectors: Array.from({ length: 32 }, (_, i) => ({
        id: String(i),
        selector: { type: "Button" },
      })),
    }),
    f.store,
    f.cpu,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 32 * 1024);
  const parsed = z
    .object({
      preview_truncated: z.literal(true),
      tree: z.object({ artifact_id: z.string() }),
      queries: z.array(
        z.object({ match_count: z.literal(1), truncated: z.literal(true) }),
      ),
    })
    .parse(result);
  const retained = f.store.readArtifact(parsed.tree.artifact_id);
  assert.equal(
    Buffer.from(retained.data, "base64").toString("utf8"),
    fs.readFileSync(f.file, "utf8"),
  );
});
