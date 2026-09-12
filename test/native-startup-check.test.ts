import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "jpeg-js";
import { startupCheckSchema } from "../src/core/contracts.js";
import {
  checkStartup,
  inspectStartupFrame,
  type StartupFrame,
} from "../src/services/startup-check.js";

const frame = (uniform = false): StartupFrame => ({
  artifact_id: "fixture",
  sha256: "a".repeat(64),
  uniform,
  sample_pixels: 100,
  dominant_fraction: uniform ? 1 : 0.5,
});
const policy = () =>
  startupCheckSchema.parse({ stable_ms: 500, timeout_ms: 2000 });
async function scenario(options: {
  pids?: (time: number) => string[];
  frame?: (time: number) => StartupFrame;
  policy?: ReturnType<typeof policy>;
  expected?: string[];
  controller?: AbortController;
}) {
  let time = 0;
  return checkStartup(
    {
      now: () => time,
      wait: async (ms, signal) => {
        signal.throwIfAborted();
        time += ms;
      },
      pids: async () => options.pids?.(time) ?? ["10"],
      frame: async () => options.frame?.(time) ?? frame(),
    },
    options.policy ?? policy(),
    (options.controller ?? new AbortController()).signal,
    options.expected,
  );
}
test("startup requires delayed liveness and a subsequent process check after the app frame", async () => {
  const result = await scenario({});
  assert.equal(result.status, "passed");
  assert.equal(result.process, "stable");
  assert.equal(result.business_outcome_verified, false);
  assert.equal(result.screen, "nonuniform");
  assert.ok(result.elapsed_ms >= 750);
  assert.ok(
    result.process_samples.at(-1)!.elapsed_ms > result.frames[0]!.elapsed_ms,
  );
});
test("early disappearance, a replaced process, and death during screenshot cannot pass", async () => {
  for (const missingAt of [250, 750]) {
    const result = await scenario({
      pids: (time) => (time < missingAt ? ["10"] : []),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.process, "exited");
  }
  const replaced = await scenario({
    pids: (time) => (time < 250 ? ["10"] : ["20"]),
  });
  assert.equal(replaced.status, "failed");
  assert.equal(replaced.process, "restarted");
  const quickfix = await scenario({
    expected: ["10"],
    pids: () => ["10", "20"],
  });
  assert.equal(quickfix.status, "failed");
  assert.equal(quickfix.process, "restarted");
});
test("slow initial process and temporary solid loading page can become ready within the budget", async () => {
  const result = await scenario({
    pids: (time) => (time < 250 ? [] : ["10"]),
    frame: (time) => frame(time < 1000),
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.frames.map((value) => value.frame!.uniform),
    [true, false],
  );
});
test("persistent solid screen requires review and only an explicit contract accepts legitimate solid pages", async () => {
  const result = await scenario({ frame: () => frame(true) });
  assert.equal(result.status, "inconclusive");
  assert.equal(result.process, "stable");
  assert.equal(result.screen, "uniform");
  assert.ok(result.frames.length <= 3);
  const allowed = await scenario({
    frame: () => frame(true),
    policy: { ...policy(), allow_uniform: true },
  });
  assert.equal(allowed.status, "passed");
  assert.equal(allowed.business_outcome_verified, false);
});
test("transport failures are unverified, keep output private, and reset the stability window", async () => {
  const unavailable = await scenario({
    pids: () => {
      throw new Error("private Want password");
    },
  });
  assert.equal(unavailable.status, "inconclusive");
  assert.equal(unavailable.process, "unverified");
  assert.equal(JSON.stringify(unavailable).includes("password"), false);
  const recovered = await scenario({
    pids: (time) => {
      if (time === 250) throw new Error("offline");
      return ["10"];
    },
  });
  assert.equal(recovered.status, "passed");
  assert.ok(recovered.frames[0]!.elapsed_ms >= 1000);
  const imageFailure = await scenario({
    frame: () => {
      throw new Error("cannot capture");
    },
  });
  assert.equal(imageFailure.status, "inconclusive");
  assert.equal(imageFailure.screen, "unavailable");
  const invalidPostFrame = await scenario({
    pids: time => time < 750 ? ["10"] : ["10", "bad process"],
  });
  assert.equal(invalidPostFrame.status, "inconclusive");
  assert.equal(invalidPostFrame.process, "unverified");
  assert.equal(JSON.stringify(invalidPostFrame).includes("bad process"), false);
});
test("headless startup checks liveness without depending on UI tools; cancellation returns its observation boundary", async () => {
  const headless = await scenario({
    policy: { ...policy(), mode: "process_only" },
    frame: () => {
      throw new Error("must not query");
    },
  });
  assert.equal(headless.status, "passed");
  assert.equal(headless.screen, "not_applicable");
  assert.deepEqual(headless.frames, []);
  const controller = new AbortController();
  const cancelled = await scenario({
    controller,
    pids: (time) => {
      if (time >= 250) controller.abort();
      return ["10"];
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.business_outcome_verified, false);
  assert.equal(
    startupCheckSchema.safeParse({ stable_ms: 2000, timeout_ms: 2000 }).success,
    false,
  );
});
test("blank analysis checks only captured application pixels and treats white, dark and colored uniform screens equally", () => {
  const width = 240,
    height = 200;
  const make = (rgb: number[], textured = false) => {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const color = y < 50 || (textured && x > 120) ? [80, 200, 0] : rgb;
        for (let channel = 0; channel < 3; channel++)
          data[at + channel] = color[channel]!;
        data[at + 3] = 255;
      }
    return encode({ data, width, height }, 90).data;
  };
  for (const color of [
    [255, 255, 255],
    [0, 0, 0],
    [64, 80, 192],
  ]) {
    assert.equal(
      inspectStartupFrame(make(color), { width, height }, [
        { x1: 0, y1: 60, x2: width, y2: height },
      ]).uniform,
      true,
    );
  }
  assert.equal(
    inspectStartupFrame(make([255, 255, 255], true), { width, height }, [
      { x1: 0, y1: 60, x2: width, y2: height },
    ]).uniform,
    false,
  );
  assert.throws(
    () =>
      inspectStartupFrame(Buffer.from("bad"), { width, height }, [
        { x1: 0, y1: 0, x2: width, y2: height },
      ]),
    { code: "STARTUP_FRAME_INVALID" },
  );
});
