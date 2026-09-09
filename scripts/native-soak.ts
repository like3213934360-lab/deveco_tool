import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { WorkflowEngine } from "../src/core/workflows.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity();
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
const durationSeconds = z.coerce
  .number()
  .int()
  .min(1)
  .max(7200)
  .parse(process.argv[3] ?? 3600);
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const store = new StateStore(path.join(root, "state"));
const processes = new ProcessService(new PersistentProcessObserver(store));
let spawned = 0;
const engine = new WorkflowEngine(
  store,
  [
    {
      id: "soak",
      description: "Infrastructure acceptance fixture",
      capabilities: [],
      completion: "owned process closed and artifact persisted",
      resources: (context) => [
        `fixture:${Number(context.parameters.index) % 4}`,
      ],
      steps: [
        {
          id: "read",
          kind: "read",
          async execute() {
            return { ready: true };
          },
        },
        {
          id: "native_process",
          kind: "effect",
          async execute({ signal }) {
            spawned++;
            const result = await processes.run(
              {
                executable: process.execPath,
                args: [
                  fileURLToPath(
                    new URL(
                      "../test/fixtures/native-soak-child.js",
                      import.meta.url,
                    ),
                  ),
                ],
              },
              { signal },
            );
            return { log: result.log, exitCode: result.exitCode };
          },
        },
      ],
    },
  ],
  async () => {},
);
const samples: unknown[] = [];
const started = performance.now(),
  cpu = process.cpuUsage();
let cycles = 0,
  warmHeap = 0,
  failure: unknown;
function count(sql: string): number {
  return (store.db.prepare(sql).get() as { count: number }).count;
}
function save(status: string) {
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        status,
        scope:
          "Persistent workflow/process/log infrastructure with synthetic native child; does not validate SDK, device, LSP or hot reload session behavior.",
        platform: process.platform,
        node: process.version,
        duration_seconds: durationSeconds,
        elapsed_ms: performance.now() - started,
        cycles,
        spawned,
        cpu: process.cpuUsage(cpu),
        samples,
        error: failure === undefined ? null : errorResult(failure),
      },
      null,
      2,
    ),
  );
}
try {
  do {
    const runs = Array.from({ length: 8 }, (_, index) =>
      engine.start("soak", { parameters: { index } }),
    );
    for (const run of runs) {
      let result;
      do {
        result = await engine.status(run.run_id, 1000);
      } while (["queued", "running"].includes(result.status));
      assert.equal(result.status, "succeeded", JSON.stringify(result.error));
    }
    await delay(20);
    store.prune();
    global.gc?.();
    cycles++;
    const memory = process.memoryUsage();
    if (cycles === 5) warmHeap = memory.heapUsed;
    const state = {
      elapsed_ms: performance.now() - started,
      memory,
      active_executions: engine.activeCount,
      owned_processes: processes.size,
      leases: count("SELECT COUNT(*) AS count FROM leases"),
      streams: count("SELECT COUNT(*) AS count FROM artifact_streams"),
      runs: store.runCount(),
      process_history: count("SELECT COUNT(*) AS count FROM managed_processes"),
      artifacts: count("SELECT COUNT(*) AS count FROM artifacts"),
      event_rows: count("SELECT COUNT(*) AS count FROM events"),
      active_resources: process.getActiveResourcesInfo(),
    };
    assert.equal(state.active_executions, 0);
    assert.equal(state.owned_processes, 0);
    assert.equal(state.leases, 0);
    assert.equal(state.streams, 0);
    assert.ok(state.runs <= 100);
    assert.ok(state.process_history <= 1100);
    assert.ok(state.artifacts <= 100);
    assert.ok(state.event_rows <= 1200);
    if (warmHeap)
      assert.ok(
        memory.heapUsed <= warmHeap + 64 * 1024 * 1024,
        "Retained heap grew more than 64 MiB after warmup",
      );
    store.capacity();
    samples.push(state);
    save("running");
    if (cycles % 6 === 0)
      process.stdout.write(
        `soak: ${cycles} cycles, ${Math.round((performance.now() - started) / 1000)} seconds, ${state.runs} retained runs\n`,
      );
    const remaining = durationSeconds * 1000 - (performance.now() - started);
    if (remaining > 0) await delay(Math.min(10000, remaining));
  } while (performance.now() - started < durationSeconds * 1000);
} catch (error) {
  failure = error;
  process.exitCode = 1;
} finally {
  await engine.close();
  await processes.close();
  save(failure === undefined ? "passed" : "failed");
  store.close();
}
