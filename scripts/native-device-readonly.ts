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
  await observe("device_properties", async () => {
    const result = await runtime.call("device_info", { target });
    z.object({ properties: z.record(z.string(), z.string()) }).parse(result);
    return result;
  });
  await observe("ui_snapshot", async () =>
    z
      .object({
        node_count: z.number().positive(),
        snapshot_id: z.string(),
        tree: z.unknown(),
      })
      .passthrough()
      .parse(await runtime.call("ui_snapshot", { target })),
  );
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
