import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  ScreenshotService,
  imageDimensions,
  screenshotSize,
} from "../src/services/screenshot.js";
import { StateStore } from "../src/core/store.js";
import type { ProcessResult } from "../src/core/process.js";
import { Runtime } from "../src/services/runtime.js";
import { tools } from "../src/core/contracts.js";
import { withTrace } from "../src/core/trace.js";

function image(format: string, width: number, height: number) {
  if (format === "png") {
    const bytes = Buffer.alloc(45);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write("IHDR", 12);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 33);
    return bytes;
  }
  const bytes = Buffer.from([
    255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217,
  ]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}
const receipt = (stdout: string): ProcessResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  truncated: false,
  elapsedMs: 1,
  pid: null,
});
function fixture(store: StateStore) {
  const calls: string[][] = [];
  let native = { width: 1440, height: 3000 },
    encoded = Buffer.alloc(0),
    size: number | undefined,
    broken = false,
    rejectTransfer = false;
  const io = {
    async shell(_target: string, args: string[]) {
      calls.push(args);
      if (args[0] === "stat") return receipt(String(size ?? encoded.length));
      if (args[0] === "rm") return receipt("");
      assert.equal(args[0], "snapshot_display");
      const argument = (name: string) =>
        args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
      const width = Number(argument("-w") ?? native.width),
        height = Number(argument("-h") ?? native.height);
      encoded = image(argument("-t")!, width, height);
      if (broken) encoded[encoded.length - 1] = 0;
      return receipt(
        `process: width: ${native.width}, height: ${native.height}\nsuccess: width: ${width}, height: ${height}\n`,
      );
    },
    async command(args: string[]) {
      calls.push(args);
      assert.deepEqual(args.slice(0, 4), ["-t", "device", "file", "recv"]);
      const allocation = z
        .object({ bytes: z.number() })
        .parse(
          store.db
            .prepare("SELECT bytes FROM artifact_streams WHERE file=?")
            .get(args[5]),
        );
      assert.ok(
        allocation.bytes >= encoded.length,
        "Disk budget precedes transfer",
      );
      fs.writeFileSync(args[5]!, encoded);
      if (rejectTransfer) throw new Error("transfer cancelled");
      return receipt("recv success");
    },
  };
  return {
    io,
    calls,
    rotate() {
      native = { width: native.height, height: native.width };
    },
    setSize(value: number) {
      size = value;
    },
    breakImage() {
      broken = true;
    },
    cancelTransfer() {
      rejectTransfer = true;
    },
  };
}
test("native image dimensions validate frame metadata and reject truncated PNG/JPEG without pixel decoding", () => {
  for (const format of ["png", "jpeg"] as const) {
    const bytes = image(format, 320, 640);
    assert.deepEqual(imageDimensions(bytes, bytes.subarray(-12), format), {
      width: 320,
      height: 640,
    });
    assert.throws(
      () =>
        imageDimensions(bytes.subarray(0, -3), bytes.subarray(0, -3), format),
      { code: "SCREENSHOT_INVALID" },
    );
  }
  assert.deepEqual(screenshotSize({ width: 1440, height: 3000 }, "jpeg"), {
    width: 1236,
    height: 2576,
  });
  assert.deepEqual(screenshotSize({ width: 1440, height: 3000 }, "png"), {
    width: 1440,
    height: 3000,
  });
  assert.deepEqual(screenshotSize({ width: 1440, height: 3000 }, "png", 720), {
    width: 720,
    height: 1500,
  });
});
test("screenshots reserve before receiving, reuse capture dimensions and discard unchanged artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-image-")),
    store = new StateStore(root),
    f = fixture(store),
    service = new ScreenshotService(store, f.io);
  try {
    const first = await service.capture("device");
    assert.equal(first.width, 1236);
    assert.equal(first.height, 2576);
    assert.equal(first.unchanged, false);
    assert.ok(first.artifact);
    assert.equal(
      f.calls.filter((args) => args[0] === "snapshot_display").length,
      2,
    );
    f.calls.length = 0;
    const second = await service.capture("device", {
      if_changed_from: first.frame_signature,
    });
    assert.equal(second.unchanged, true);
    assert.equal(second.artifact, undefined);
    assert.equal(
      f.calls.filter((args) => args[0] === "snapshot_display").length,
      1,
    );
    assert.equal(store.db.prepare("SELECT * FROM artifacts").all().length, 1);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM artifact_streams").all(),
      [],
    );
    assert.equal(fs.readdirSync(path.join(root, "artifacts")).length, 1);
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("queued screenshots keep separate workflow owners and survive retention until each run ends", async () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-image-ownership-"),
    ),
    store = new StateStore(root),
    f = fixture(store),
    service = new ScreenshotService(store, f.io);
  try {
    const runs = [
      store.create("verify", {}).run,
      store.create("verify", {}).run,
    ];
    const results = await Promise.all(
      runs.map((run) =>
        withTrace({ run_id: run.id }, () => service.capture("device")),
      ),
    );
    for (const [index, run] of runs.entries()) {
      assert.ok(results[index]!.artifact);
      store.update(run.id, "interrupted", results[index]);
    }
    store.db.prepare("UPDATE artifacts SET created=0").run();
    store.db.prepare("UPDATE runs SET updated=0").run();
    store.prune();
    for (const [index, run] of runs.entries()) {
      const artifact = results[index]!.artifact!;
      assert.ok(store.readArtifact(artifact.artifact_id).bytes > 0);
      assert.deepEqual(
        store.db
          .prepare("SELECT run_id FROM artifacts WHERE id=?")
          .get(artifact.artifact_id),
        { run_id: run.id },
      );
      store.claim(run.id);
      store.update(run.id, "cancelled");
      store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(run.id);
      store.prune();
      assert.throws(() => store.readArtifact(artifact.artifact_id), {
        code: "ARTIFACT_NOT_FOUND",
      });
    }
    assert.deepEqual(fs.readdirSync(path.join(root, "artifacts")), []);
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("display-specific captures preserve aspect ratio after rotation and return independent coordinate scales", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-image-")),
    store = new StateStore(root),
    f = fixture(store),
    service = new ScreenshotService(store, f.io);
  try {
    await service.capture("device", {
      format: "png",
      width: 720,
      display_id: 2,
    });
    f.rotate();
    f.calls.length = 0;
    const rotated = await service.capture("device", {
      format: "png",
      width: 720,
      display_id: 2,
    });
    assert.equal(rotated.width, 720);
    assert.equal(rotated.height, 346);
    assert.equal(rotated.coordinate_scale.x, 3000 / 720);
    assert.equal(rotated.coordinate_scale.y, 1440 / 346);
    const captures = f.calls.filter((args) => args[0] === "snapshot_display");
    assert.equal(captures.length, 2);
    assert.ok(captures.every((args) => args[args.indexOf("-i") + 1] === "2"));
    f.calls.length = 0;
    await service.capture("device", { format: "png" });
    assert.equal(
      f.calls[0]!.includes("-i"),
      false,
      "Unspecified display stays device-selected",
    );
    assert.equal(
      f.calls[0]!.includes("-w"),
      false,
      "Display size caches cannot leak into other displays",
    );
  } finally {
    service.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("oversized, incomplete and interrupted screenshots never publish or retain partial artifacts", async () => {
  for (const failure of ["size", "encoding", "transfer"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-image-")),
      store = new StateStore(root),
      f = fixture(store),
      service = new ScreenshotService(store, f.io);
    try {
      if (failure === "size") f.setSize(32 * 1024 * 1024 + 1);
      if (failure === "encoding") f.breakImage();
      if (failure === "transfer") f.cancelTransfer();
      await assert.rejects(service.capture("device", { format: "png" }));
      if (failure === "size")
        assert.equal(
          f.calls.some((args) => args.includes("recv")),
          false,
        );
      assert.deepEqual(
        store.db.prepare("SELECT * FROM artifact_streams").all(),
        [],
      );
      assert.deepEqual(store.db.prepare("SELECT * FROM artifacts").all(), []);
      assert.deepEqual(fs.readdirSync(path.join(root, "artifacts")), []);
      assert.equal(f.calls.at(-1)![0], "rm");
    } finally {
      service.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
test("image-only MCP capture skips layout acquisition and rejects ignored tree capture options", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-image-runtime-")),
    previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime(),
    f = fixture(runtime.store);
  try {
    t.mock.method(runtime.devices, "target", async () => "device");
    t.mock.method(runtime.devices, "snapshot", async () => {
      throw new Error("An image-only call must not dump the UI tree");
    });
    t.mock.method(runtime.devices, "shell", f.io.shell);
    t.mock.method(runtime.devices, "command", f.io.command);
    const result = z
      .object({
        screenshot: z.object({
          width: z.number().positive(),
          artifact: z.object({ artifact_id: z.string() }),
        }),
      })
      .parse(await runtime.call("ui_snapshot", { target: "device" }));
    assert.ok(result.screenshot.artifact.artifact_id);
    assert.equal(
      tools.ui_snapshot.schema.safeParse({ mode: "tree", capture: {} }).success,
      false,
    );
    assert.equal(
      tools.ui_snapshot.schema.safeParse({ capture: { display_id: -1 } })
        .success,
      false,
    );
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
