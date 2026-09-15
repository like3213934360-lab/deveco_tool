import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { flowSchema } from "../src/core/contracts.js";
import { atomicWrite, digest, fileDigest } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";

const [root, preparedFile, osVersion] = z
  .tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Use a new evidence directory and retain failed attempts",
);
const prepared = z
  .object({
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
  })
  .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const ownerRoot = path.join(root, "emulator-owner");
fs.mkdirSync(ownerRoot, { mode: 0o700 });
atomicWrite(path.join(ownerRoot, "config.json"), "{}\n");
const mcp = new AcceptanceMcp(root, "native-recording-mouse-acceptance"),
  owner = new AcceptanceMcp(ownerRoot, "native-recording-emulator-owner", { tool_groups: ["core", "emulator-admin"] });
const tested = evidenceIdentity(),
  results: Record<string, unknown> = {};
const file = path.join(root, "evidence.json"),
  save = () =>
    atomicWrite(
      file,
      JSON.stringify(
        {
          results,
          scope:
            "Actual public MCP on an owned phone emulator: seven native mouse operations and directional fling, application event/scroll assertions, save, MCP restart and replay. This is not physical mouse hardware coverage.",
        },
        null,
        2,
      ),
    );
const record = (key: string, value: unknown) => {
  results[key] = value;
  save();
};
const owned = new OwnedEmulatorAcceptance(mcp, record, owner);
let completed = false,
  closed = false,
  recording: string | undefined;
const original = path.join(
    prepared.project_path,
    prepared.module,
    "src/main/ets/pages/Index.ets",
  ),
  originalHash = fileDigest(original);
const project = path.join(root, "application"),
  flowId = "mouse-event-replay";
const selector = (key: string, text?: string) => ({
  key,
  bundle_name: prepared.bundle_name,
  ...(text === undefined ? {} : { text, textMode: "exact" }),
});
const firstFlingText =
  "click=1 double=2 long=1 move=1 track=1 drag=1 wheel=1 fling=1";
const finalText =
  "click=1 double=2 long=1 move=1 track=1 drag=1 wheel=1 fling=2";
const finalAssertion = {
  visible: selector("event-status", finalText),
  timeoutMs: 10000,
};
try {
  await mcp.connect();
  await owner.connect();
  record(
    "arkts_rules",
    await mcp.call("harmony_knowledge", {
      action: "read",
      kind: "rules",
      id: "arkts-grammar-standards/recipes-core",
    }),
  );
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  const page = path.join(
    project,
    prepared.module,
    "src/main/ets/pages/Index.ets",
  );
  atomicWrite(
    page,
    `@Entry
@Component
struct Index {
  @State clickSeen: number = 0;
  @State doubleSeen: number = 0;
  @State longSeen: number = 0;
  @State moveSeen: number = 0;
  @State trackSeen: number = 0;
  @State dragSeen: number = 0;
  @State wheelSeen: number = 0;
  @State flingSeen: number = 0;
  private sawPositiveScroll: boolean = false;
  private sawNegativeScroll: boolean = false;
  @State scrollMode: boolean = false;
  private pressedAt: number = 0;
  private wheelScroller: Scroller = new Scroller();
  private flingScroller: Scroller = new Scroller();
  private rows: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  build() {
    Column({ space: 6 }) {
      Text('click=' + this.clickSeen + ' double=' + this.doubleSeen + ' long=' + this.longSeen + ' move=' + this.moveSeen + ' track=' + this.trackSeen + ' drag=' + this.dragSeen + ' wheel=' + this.wheelSeen + ' fling=' + this.flingSeen)
        .id('event-status').fontSize(18).height(70).width('96%').fontColor('#ffffff')
      if (!this.scrollMode) {
        Text('Click: ' + this.clickSeen).id('click-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => {
            if (event.action === MouseAction.Release && event.button === MouseButton.Right && event.getModifierKeyState?.(['Ctrl'])) this.clickSeen = 1;
          })
        Text('Double: ' + this.doubleSeen).id('double-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Release && event.button === MouseButton.Left) this.doubleSeen++; })
        Text('Long: ' + this.longSeen).id('long-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => {
            if (event.action === MouseAction.Press && event.button === MouseButton.Left) this.pressedAt = Date.now();
            if (event.action === MouseAction.Release && event.button === MouseButton.Left && this.pressedAt > 0 && Date.now() - this.pressedAt >= 500) this.longSeen = 1;
          })
        Text('Move: ' + this.moveSeen).id('move-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Move) this.moveSeen = 1; })
        Text('Track: ' + this.trackSeen).id('track-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Move) this.trackSeen = 1; })
        Text('Drag: ' + this.dragSeen).id('drag-panel').width('90%').height(48).backgroundColor('#c6e9ff')
          .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Move && event.pressedButtons?.includes(MouseButton.Left)) this.dragSeen = 1; })
        Text('Wheel: ' + this.wheelSeen).id('wheel-status').fontColor('#ffffff').fontSize(16)
        Scroll(this.wheelScroller) {
          Column() { ForEach(this.rows, (item: number) => { Text('Wheel row ' + item).width('100%').height(60) }) }
        }.id('wheel-panel').width('90%').height(70).backgroundColor('#b2ead1')
          .onScroll((xOffset: number, yOffset: number) => { if (Math.abs(yOffset) > 0) this.wheelSeen = 1; })
        Button('Open fling page').id('fling-page').height(42).onClick(() => { this.scrollMode = true; })
      } else {
        Scroll(this.flingScroller) {
          Column() { ForEach(this.rows, (item: number) => { Text('Fling row ' + item).width('100%').height(100).backgroundColor(item % 2 === 0 ? '#c6e9ff' : '#b2ead1') }) }
        }.id('fling-panel').width('96%').layoutWeight(1)
          .onScroll((xOffset: number, yOffset: number) => {
            if (yOffset > 0) this.sawPositiveScroll = true;
            if (yOffset < 0) this.sawNegativeScroll = true;
            this.flingSeen = (this.sawPositiveScroll ? 1 : 0) + (this.sawNegativeScroll ? 1 : 0);
          })
      }
    }.width('100%').height('100%').backgroundColor('#152a4b')
  }
}
`,
  );
  record("fixture", {
    project,
    original,
    original_sha256: originalHash,
    page_sha256: fileDigest(page),
  });
  const target = await owned.start(osVersion);
  await owned.workflow("sync", "project_sync", { project_path: project });
  const built = await owned.workflow("build", "project_build", {
    project_path: project,
    modules: [prepared.module],
  });
  const packages = z
    .object({ artifacts: z.array(z.object({ path: z.string() })) })
    .parse(await owned.output(built.result, "build_project"))
    .artifacts.filter((item) => item.path.endsWith(".hap"))
    .map((item) => ({ ...item, sha256: fileDigest(item.path) }));
  assert.equal(packages.length, 1);
  await owned.workflow("deploy", "app_deploy", {
    target,
    packages,
    app: {
      bundle_name: prepared.bundle_name,
      module: prepared.module,
      ability: prepared.ability,
    },
  });
  recording = await owned.submit("record_start", "ui_flow", {
    action: "record_start",
    project_path: project,
    target,
    id: flowId,
    name: "鼠标与方向手势事件验收",
    route: { module: prepared.module, ability: prepared.ability },
    mode: "restart",
  });
  await owned.settle("record_ready", recording, "needs_input");
  async function verify(key: string, text: string) {
    const result = z
      .object({ verified: z.literal(true) })
      .passthrough()
      .parse(
        await mcp.call("verify_ui", {
          target,
          assert: { visible: selector(key, text), timeoutMs: 10000 },
        }),
      );
    record(`observed_${key}`, result);
  }
  async function action(key: string, operation: Record<string, unknown>) {
    record(
      `action_${key}`,
      await mcp.call("ui_control", { target, operation }),
    );
  }
  await action("click", {
    action: "mouseClick",
    selector: selector("click-panel"),
    button: "right",
    keys: ["2072"],
  });
  await verify("click-panel", "Click: 1");
  await action("double", {
    action: "mouseDoubleClick",
    selector: selector("double-panel"),
    button: "left",
  });
  await verify("double-panel", "Double: 2");
  await action("long", {
    action: "mouseLongClick",
    selector: selector("long-panel"),
    button: "left",
  });
  await verify("long-panel", "Long: 1");
  await action("move", {
    action: "mouseMoveTo",
    selector: selector("move-panel"),
  });
  await verify("move-panel", "Move: 1");
  for (const [name, verb] of [
    ["track", "mouseMoveWithTrack"],
    ["drag", "mouseDrag"],
  ] as const) {
    const inspection = z
      .object({
        matching_nodes: z.literal(1),
        nodes: z
          .array(
            z.object({
              rect: z.object({
                x1: z.number(),
                y1: z.number(),
                x2: z.number(),
                y2: z.number(),
              }),
            }),
          )
          .length(1),
      })
      .parse(
        await mcp.call("ui_inspect", {
          target,
          selector: selector(`${name}-panel`),
        }),
      );
    record(`${name}_bounds`, inspection);
    const rect = inspection.nodes[0]!.rect,
      y = Math.round((rect.y1 + rect.y2) / 2);
    await action(name, {
      action: verb,
      window: { bundle_name: prepared.bundle_name },
      x: Math.round(rect.x1 + (rect.x2 - rect.x1) * 0.2),
      y,
      x2: Math.round(rect.x1 + (rect.x2 - rect.x1) * 0.8),
      y2: y,
      velocity: 800,
    });
    await verify(`${name}-panel`, `${name === "track" ? "Track" : "Drag"}: 1`);
  }
  await action("wheel", {
    action: "mouseScroll",
    selector: selector("wheel-panel"),
    scroll_down: true,
    ticks: 4,
    mouse_scroll_speed: 20,
  });
  await verify("wheel-status", "Wheel: 1");
  await action("fling_page", {
    action: "click",
    selector: selector("fling-page"),
  });
  record(
    "before_fling",
    await mcp.call("ui_inspect", {
      target,
      selector: { bundle_name: prepared.bundle_name },
      screenshot: true,
      limit: 100,
    }),
  );
  // Native CLI direction describes scrolling toward a document edge.
  // TO_DOWN starts below centre and swipes upward. Preserve native semantics.
  record("direction_source", {
    url: "https://github.com/openharmony/testfwk_arkxtest/blob/b04e30c40cf266c9abfbd52933e43a0456eb99a2/uitest/input/ui_input.cpp",
    functions: ["CreateFlingPoint", "FlingActionInput"],
    down: 3,
    up: 2,
  });
  await action("fling_down", {
    action: "dircFling",
    window: { bundle_name: prepared.bundle_name },
    direction: 3,
    velocity: 1000,
    step_length: 80,
  });
  record(
    "after_fling",
    await mcp.call("ui_inspect", {
      target,
      selector: { bundle_name: prepared.bundle_name },
      screenshot: true,
      limit: 100,
    }),
  );
  await verify("event-status", firstFlingText);
  await action("fling_up", {
    action: "dircFling",
    window: { bundle_name: prepared.bundle_name },
    direction: 2,
    velocity: 1000,
    step_length: 80,
  });
  await verify("event-status", finalText);
  record(
    "stop_recording",
    await mcp.call("ui_flow", {
      action: "record_stop",
      recording_id: recording,
      assert: finalAssertion,
    }),
  );
  await owned.settle("record_saved", recording);
  const saved = flowSchema.parse(
    await mcp.call("ui_flow", {
      action: "read",
      project_path: project,
      id: flowId,
    }),
  );
  assert.equal(saved.version, 2);
  assert.deepEqual(
    saved.steps.map((step) => step.action),
    [
      "mouseClick",
      "mouseDoubleClick",
      "mouseLongClick",
      "mouseMoveTo",
      "mouseMoveWithTrack",
      "mouseDrag",
      "mouseScroll",
      "tap",
      "dircFling",
      "dircFling",
    ],
  );
  assert.equal(saved.steps[0]!.button, "right");
  assert.deepEqual(saved.steps[0]!.keys, ["2072"]);
  for (const index of [4, 5]) {
    assert.equal(saved.steps[index]!.gesture?.velocity, 800);
    assert.ok(
      saved.steps[index]!.gesture!.toXPercent >
        saved.steps[index]!.gesture!.fromXPercent,
    );
  }
  assert.equal(saved.steps[6]!.scroll_down, true);
  assert.equal(saved.steps[6]!.ticks, 4);
  assert.equal(saved.steps[6]!.mouse_scroll_speed, 20);
  assert.equal(saved.steps[8]!.direction, 3);
  assert.equal(saved.steps[8]!.velocity, 1000);
  assert.equal(saved.steps[8]!.step_length, 80);
  assert.equal(saved.steps[9]!.direction, 2);
  assert.equal(saved.steps[9]!.velocity, 1000);
  assert.equal(saved.steps[9]!.step_length, 80);
  record("saved_flow", saved);
  await mcp.close();
  await mcp.connect();
  assert.equal(
    digest(
      await mcp.call("ui_flow", {
        action: "read",
        project_path: project,
        id: flowId,
      }),
    ),
    digest(saved),
  );
  const replay = await owned.operation("replay", "ui_flow", {
    action: "run",
    project_path: project,
    target,
    id: flowId,
  });
  record("replay_result", replay);
  await verify("event-status", finalText);
  record(
    "final_inspection",
    await mcp.call("ui_inspect", {
      target,
      selector: selector("event-status"),
      screenshot: true,
    }),
  );
  assert.equal(fileDigest(original), originalHash);
  completed = true;
} catch (error) {
  record("error", errorResult(error));
  console.error(JSON.stringify(errorResult(error)));
} finally {
  if (!completed && recording)
    try {
      record(
        "recording_cleanup",
        await mcp.call("ui_flow", {
          action: "record_cancel",
          recording_id: recording,
        }),
      );
    } catch (error) {
      record("recording_cleanup_error", errorResult(error));
    }
  try {
    await owned.close();
    closed = true;
  } catch (error) {
    record("close_error", errorResult(error));
    await mcp.close().catch(() => {});
    await owner.close().catch(() => {});
    await owned.processes.close();
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Real mouse recording MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
