import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2])),
  target = z.string().min(1).parse(process.argv[3]);
assert.equal(fs.existsSync(root), false, "Evidence directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const tested = evidenceIdentity(),
  runtime = new Runtime(),
  toolchain = discoverToolchain();
const observations: {
  name: string;
  elapsed_ms: number;
  passed: boolean;
  result?: unknown;
  error?: unknown;
}[] = [];
let failed = false;
let capturedTree:
  | {
      snapshot_id: string;
      signature: string;
      node_count: number;
      tree: { format: "nodes"; artifact_id: string };
    }
  | undefined;
const save = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        target,
        toolchain,
        scope:
          "Read-only device properties, UI query/assertion and logs. No installation, input, log clearing, launch or application outcome acceptance.",
        observations,
      },
      null,
      2,
    ) + "\n",
  );
async function observe(name: string, task: () => Promise<unknown>) {
  const started = performance.now();
  try {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      passed: true,
      result: await task(),
    });
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      passed: false,
      error: errorResult(error),
    });
  }
  observations[observations.length - 1]!.elapsed_ms =
    performance.now() - started;
  console.log(
    `${name}: ${observations[observations.length - 1]!.passed ? "passed" : "failed"}`,
  );
  save();
}
try {
  await observe("ui_driver_readonly_detection", async () => {
    const result = await runtime.call("deveco_doctor", { target });
    const driver = z
      .object({
        ui_driver: z
          .object({
            status: z.literal("detected"),
            target: z.literal(target),
            architecture: z.string().min(1),
            uitest_version: z.string().min(1),
            operation_verified: z.literal(false),
            text_input: z.object({
              status: z.literal("component_detected"),
              component: z.string().min(1),
            }),
          })
          .passthrough(),
      })
      .parse(result).ui_driver;
    return driver;
  });
  await observe("device_properties", async () => {
    const result = await runtime.call("device_info", { target });
    z.object({ properties: z.record(z.string(), z.string()) }).parse(result);
    return result;
  });
  await observe("ui_snapshot", async () => {
    capturedTree = z
      .object({
        node_count: z.number().positive(),
        snapshot_id: z.string(),
        signature: z.string(),
        tree: z.object({ format: z.literal("nodes"), artifact_id: z.string() }),
      })
      .passthrough()
      .parse(await runtime.call("ui_snapshot", { target, mode: "tree" }));
    return capturedTree;
  });
  await observe("ui_saved_tree_offline_queries", async () => {
    assert.ok(capturedTree);
    const artifact = capturedTree.tree.artifact_id,
      parts: Buffer[] = [];
    for (let offset = 0; ;) {
      const part = runtime.store.readArtifact(artifact, offset);
      parts.push(Buffer.from(part.data, "base64"));
      offset = part.next_offset;
      if (offset >= part.bytes) break;
    }
    const file = path.join(root, "saved-ui-nodes.json");
    fs.writeFileSync(file, Buffer.concat(parts));
    const oldTarget = runtime.devices.target;
    runtime.devices.target = async () => {
      throw new Error("Offline tree query attempted device discovery");
    };
    try {
      const query = { tree_format: "nodes", selector: { type: "WindowScene" } },
        artifactResult = await runtime.call("ui_find", {
          ...query,
          tree_artifact_id: artifact,
        }),
        fileResult = await runtime.call("ui_find", {
          ...query,
          tree_file: file,
        });
      const schema = z.object({
        source: z.literal("saved_tree"),
        device_state_verified: z.literal(false),
        node_count: z.literal(capturedTree.node_count),
        signature: z.literal(capturedTree.signature),
        match_count: z.number().positive(),
        matches: z.array(z.unknown()),
      });
      assert.deepEqual(schema.parse(artifactResult), schema.parse(fileResult));
      return { artifact: artifactResult, file: fileResult };
    } finally {
      runtime.devices.target = oldTarget;
    }
  });
  await observe("ui_jpeg_native_resize", async () => {
    const result = z
      .object({
        screenshot: z
          .object({
            format: z.literal("jpeg"),
            width: z.literal(640),
            height: z.number().positive(),
            native_width: z.number().positive(),
            native_height: z.number().positive(),
            artifact: z.object({ artifact_id: z.string() }),
          })
          .passthrough(),
      })
      .parse(
        await runtime.call("ui_snapshot", { target, capture: { width: 640 } }),
      );
    assert.equal(
      result.screenshot.height,
      Math.max(
        1,
        Math.round(
          (result.screenshot.native_height * 640) /
            result.screenshot.native_width,
        ),
      ),
    );
    return result;
  });
  await observe("ui_png_native_frame_comparison", async () => {
    const schema = z.object({
        screenshot: z
          .object({
            format: z.literal("png"),
            width: z.number().positive(),
            height: z.number().positive(),
            native_width: z.number().positive(),
            native_height: z.number().positive(),
            frame_signature: z.string(),
            unchanged: z.boolean(),
            artifact: z.unknown().optional(),
          })
          .passthrough(),
      }),
      first = schema.parse(
        await runtime.call("ui_snapshot", {
          target,
          capture: { format: "png" },
        }),
      ),
      second = schema.parse(
        await runtime.call("ui_snapshot", {
          target,
          capture: {
            format: "png",
            if_changed_from: first.screenshot.frame_signature,
          },
        }),
      );
    assert.equal(first.screenshot.width, first.screenshot.native_width);
    assert.equal(first.screenshot.height, first.screenshot.native_height);
    assert.equal(
      second.screenshot.unchanged,
      second.screenshot.frame_signature === first.screenshot.frame_signature,
    );
    if (second.screenshot.unchanged)
      assert.equal(second.screenshot.artifact, undefined);
    return { first, second };
  });
  await observe("ui_window_find", () =>
    runtime.call("ui_find", { target, selector: { type: "WindowScene" } }),
  );
  await observe("ui_queries_one_snapshot", async () => {
    const result = await runtime.call("ui_observe", {
      target,
      selectors: [
        { id: "windows", selector: { type: "WindowScene", limit: 1 } },
        { id: "missing", selector: { key: `deveco-absent-${randomUUID()}` } },
      ],
    });
    const parsed = z
      .object({
        snapshot_id: z.string(),
        queries: z.array(z.object({ id: z.string(), match_count: z.number() })),
      })
      .parse(result);
    assert.ok(parsed.queries.find((x) => x.id === "windows")!.match_count > 0);
    assert.equal(
      parsed.queries.find((x) => x.id === "missing")!.match_count,
      0,
    );
    const cached = await runtime.call("ui_find", {
      target,
      snapshot_id: parsed.snapshot_id,
      selectors: [{ id: "windows", selector: { type: "WindowScene" } }],
    });
    assert.equal(
      z.object({ snapshot_id: z.string() }).parse(cached).snapshot_id,
      parsed.snapshot_id,
    );
    return { observed: result, cached };
  });
  await observe("ui_window_depth_inspection", async () => {
    const result = await runtime.call("ui_inspect", {
      target,
      max_depth: 1,
      limit: 20,
    });
    const parsed = z
      .object({
        window_count: z.number().positive(),
        nodes: z.array(
          z.object({
            index: z.number(),
            parent: z.number().nullable(),
            depth: z.number().max(1),
          }),
        ),
      })
      .parse(result);
    assert.ok(parsed.nodes.length > 0);
    return result;
  });
  await observe("visible_window_assertion", () =>
    runtime.call("verify_ui", {
      target,
      assert: { visible: { type: "WindowScene" }, timeoutMs: 5000 },
    }),
  );
  await observe("hilog_tail", () =>
    runtime.call("hdc_log", { action: "collect", target, lines: 20 }),
  );
  await observe("hilog_literal_no_match", async () => {
    const result = await runtime.call("hdc_log", {
      action: "collect",
      target,
      contains: `deveco-readonly-nonexistent-${randomUUID()}`,
      lines: 20,
    });
    z.object({ line_count: z.literal(0) }).parse(result);
    return result;
  });
  await observe("faultlog_inventory", () =>
    runtime.call("hdc_log", {
      action: "probe",
      target,
      max_age_minutes: 30,
      limit: 3,
    }),
  );
} finally {
  await observe("runtime_shutdown", async () => runtime.close());
  process.exitCode = failed ? 1 : 0;
}
