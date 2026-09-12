import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

const [root, preparedFile, target] = z
  .tuple([z.string(), z.string(), z.string()])
  .parse(process.argv.slice(2));
const prepared = z
  .object({
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
    product: z.string().optional(),
  })
  .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
assert.equal(fs.existsSync(root), false, "Use new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const project = path.join(root, "application"),
  tested = evidenceIdentity(),
  results: Record<string, unknown> = {},
  client = new AcceptanceMcp(root, "continuous-log-acceptance");
let testId: string | undefined,
  completed = false,
  closed = false;
const file = path.join(root, "evidence.json");
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        results,
        scope:
          "Owned copied and signed canary; public MCP continuous sequence logs, pagination, restart/resume, finish and export. No business apps, global log clearing or flow-control changes.",
      },
      null,
      2,
    ),
  );
async function call(name: string, raw: unknown) {
  return client.call(name, raw);
}
async function workflow(name: string, input: unknown) {
  const run = z
    .object({ run_id: z.string() })
    .parse(
      await call("workflow_run", { action: "start", workflow: name, input }),
    );
  results[name] = run;
  save();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const status = z
      .object({
        status: z.string(),
        result: z.unknown(),
        error: z.unknown().optional(),
      })
      .parse(
        await call("workflow_run", {
          action: "status",
          run_id: run.run_id,
          wait_ms: 1000,
        }),
      );
    results[name] = { ...run, ...status };
    save();
    if (["queued", "running", "cancelling"].includes(status.status)) continue;
    assert.equal(status.status, "succeeded", JSON.stringify(status.error));
    return;
  }
  throw new ToolError(
    "ACCEPTANCE_TIMEOUT",
    "Inspect recorded run before any repeat",
  );
}
const selector = (key: string, text?: string) => ({
  key,
  bundle_name: prepared.bundle_name,
  ...(text ? { text, textMode: "exact" } : {}),
});
const chunkSchema = z.object({
  id: z.number(),
  source: z.string().optional(),
  sha256: z.string().optional(),
  artifact_id: z.string(),
});
async function inspectLogs(stage: string) {
  const chunks: z.infer<typeof chunkSchema>[] = [];
  let chunkOffset = 0;
  for (;;) {
    const page = z
      .object({
        chunks: z.array(chunkSchema),
        next_chunk_offset: z.number().nullable(),
        continuous: z.unknown(),
      })
      .parse(
        await call("ui_test", {
          action: "logs",
          test_id: testId,
          chunk_offset: chunkOffset,
          chunk_limit: 7,
        }),
      );
    chunks.push(...page.chunks);
    results[`${stage}_continuous`] = page.continuous;
    if (page.next_chunk_offset === null) break;
    chunkOffset = page.next_chunk_offset;
  }
  const sequences: number[] = [];
  for (const chunk of chunks.filter((item) => item.source === "continuous")) {
    let offset = 0;
    for (;;) {
      const page = z
        .object({ content: z.string(), next_offset: z.number().nullable() })
        .parse(
          await call("ui_test", {
            action: "logs",
            test_id: testId,
            chunk_id: chunk.id,
            search_keywords: ["MCPSEQ:1:"],
            offset,
            limit: 4096,
          }),
        );
      for (const match of page.content.matchAll(/MCPSEQ:1:(\d+):中文🙂/g))
        sequences.push(Number(match[1]));
      if (page.next_offset === null) break;
      offset = page.next_offset;
    }
  }
  results[`${stage}_sequence`] = {
    total: sequences.length,
    unique: new Set(sequences).size,
    minimum: Math.min(...sequences),
    maximum: Math.max(...sequences),
    missing: Array.from({ length: 6000 }, (_, i) => i + 1).filter(
      (id) => !sequences.includes(id),
    ),
    duplicates: sequences.filter(
      (id, index) => sequences.indexOf(id) !== index,
    ),
    chunks,
  };
  save();
  return sequences;
}
try {
  // Copy only this previously owned acceptance app; signing stays in its
  // existing private store and is never copied to evidence output JSON.
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  atomicWrite(
    path.join(project, prepared.module, "src/main/ets/pages/Index.ets"),
    `import { hilog } from '@kit.PerformanceAnalysisKit';
@Entry
@Component
struct Index {
  @State count: number = 0;
  @State running: boolean = false;
  private timer: number = -1;
  private pulse: number = -1;
  private batch: number = 0;
  aboutToAppear(): void {
    this.pulse = setInterval(() => { hilog.info(0x1234, 'MCPLogAcceptance', 'MCPREADY:%{public}d', this.count); }, 500);
  }
  aboutToDisappear(): void { clearInterval(this.timer); clearInterval(this.pulse); }
  private startLogs(): void {
    if (this.running) { return; }
    this.running = true; this.count = 0; this.batch++;
    this.timer = setInterval(() => {
      for (let i: number = 0; i < 20; i++) {
        this.count++;
        hilog.info(0x1234, 'MCPLogAcceptance', 'MCPSEQ:%{public}d:%{public}d:中文🙂', this.batch, this.count);
      }
      if (this.count >= 6000) { clearInterval(this.timer); this.running = false; }
    }, 100);
  }
  build() {
    Column({ space: 20 }) {
      Text('连续日志验收').fontSize(28)
      Text(this.running ? '采集中 ' + this.count : '完成 ' + this.count).id('mcp-log-status').fontSize(24)
      Button('输出 6000 行中文日志').id('mcp-log-start').onClick(() => { this.startLogs(); })
    }.width('100%').padding(24)
  }
}
`,
  );
  results.fixture = {
    project_path: project,
    source_sha256: fileDigest(
      path.join(project, prepared.module, "src/main/ets/pages/Index.ets"),
    ),
  };
  await client.connect();
  await workflow("build_deploy_verify", {
    project_path: project,
    product: prepared.product,
    modules: [prepared.module],
    target,
    app: {
      bundle_name: prepared.bundle_name,
      ability: prepared.ability,
      module: prepared.module,
    },
    assert: { visible: selector("mcp-log-start"), timeoutMs: 10000 },
  });
  const start = z
    .object({ test_id: z.string() })
    .parse(
      await call("ui_test", {
        action: "start",
        target,
        app: {
          bundle_name: prepared.bundle_name,
          ability: prepared.ability,
          module: prepared.module,
        },
        test_plan:
          "Capture 6000 uniquely numbered Chinese and emoji log lines, survive MCP restart, and verify the app completed.",
        steps: [
          {
            id: "logs",
            goal: "App emitted its complete 6000-line sequence",
            assert: {
              visible: selector("mcp-log-status", "完成 6000"),
              timeoutMs: 60000,
            },
          },
        ],
      }),
    );
  testId = start.test_id;
  results.test_id = testId;
  save();
  await call("ui_test", { action: "resume", test_id: testId });
  // Readiness requires a real attributed app pulse, not just HDC spawn.
  const readyDeadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const status = z
      .object({
        continuous_logs: z.object({ ready_at: z.number().optional() }),
      })
      .parse(await call("ui_test", { action: "status", test_id: testId }));
    if (status.continuous_logs.ready_at) {
      ready = true;
      break;
    }
    await delay(500);
  }
  assert.ok(
    ready,
    "Continuous collector never retained a real application pulse",
  );
  results.action = await call("ui_test", {
    action: "act",
    test_id: testId,
    step_id: "logs",
    attempt_id: randomUUID(),
    operation: { action: "click", selector: selector("mcp-log-start") },
  });
  save();
  results.check = await call("ui_test", { action: "check", test_id: testId });
  save();
  await delay(1500);
  const sequence = await inspectLogs("before_restart");
  assert.deepEqual(
    [...sequence].sort((a, b) => a - b),
    Array.from({ length: 6000 }, (_, i) => i + 1),
  );
  await client.close();
  await client.connect();
  const retained = await inspectLogs("after_restart");
  assert.deepEqual(retained, sequence);
  results.resumed = await call("ui_test", {
    action: "resume",
    test_id: testId,
  });
  await delay(2000);
  results.finish = await call("ui_test", { action: "finish", test_id: testId });
  results.export = await call("ui_test", {
    action: "export",
    test_id: testId,
    directory: path.join(root, "export"),
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "export/manifest.json"), "utf8"),
  );
  const hashes = z
    .array(z.object({ file: z.string(), sha256: z.string() }))
    .parse(manifest.artifacts);
  for (const artifact of hashes)
    assert.equal(
      fileDigest(path.join(root, "export", artifact.file)),
      artifact.sha256,
    );
  results.export_hashes_verified = hashes.length;
  results.final_logs = await call("ui_test", {
    action: "logs",
    test_id: testId,
  });
  completed = true;
} catch (error) {
  results.error = errorResult(error);
  console.error(errorResult(error));
} finally {
  if (!completed && testId) {
    try {
      results.cancel = await call("ui_test", {
        action: "cancel",
        test_id: testId,
      });
    } catch (error) {
      results.cancel_error = errorResult(error);
    }
  }
  try {
    await client.close();
    closed = true;
  } catch (error) {
    results.close_error = errorResult(error);
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Continuous logs MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
