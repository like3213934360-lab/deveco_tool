import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkRecording } from "../../tools/recording-check.mjs";

const media = { streams: [
  { index: 0, codec_type: "audio", nb_read_frames: "24" },
  { index: 1, codec_type: "video", width: 64, height: 64, nb_read_frames: "12" },
] };
function fixture(t, change = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-recording-check-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "original video.mp4"), receipt = path.join(directory, "check.json"), calls = [];
  fs.writeFileSync(file, "original bytes");
  const spawn = (tool, args, options) => {
    calls.push({ tool, args, options });
    const result = { status: 0, signal: null, stdout: args[0] === "-version" ? "test version\n" : tool === "ffprobe" ? JSON.stringify(media) : "", stderr: "" };
    change(result, tool, args);
    return result;
  };
  return { file, receipt, calls, spawn, run: () => checkRecording(file, receipt, spawn), report: () => JSON.parse(fs.readFileSync(receipt, "utf8")) };
}

test("recording acceptance preserves input, checks all media streams and records exact commands", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.run(), media);
  assert.equal(fs.readFileSync(f.file, "utf8"), "original bytes");
  const report = f.report();
  assert.equal(report.passed, true); assert.deepEqual(report.media, media);
  assert.equal(report.commands.length, 4);
  const decode = report.commands.at(-1).args;
  for (const pair of [["-map", "0:v"], ["-map", "0:a?"], ["-enc_time_base:v", "demux"], ["-fps_mode", "passthrough"], ["-err_detect", "explode"], ["-f", "null"]])
    assert.ok(decode.some((arg, i) => arg === pair[0] && decode[i + 1] === pair[1]), pair.join(" "));
  assert.ok(decode.includes("-xerror")); assert.equal(decode.at(-1), "-");
  assert.ok(f.calls.every((c) => c.options.timeout === 120000 && c.options.stdio === "pipe" && !c.options.shell));
});

test("exit-zero diagnostics from either probe or decoder are failures, without filtering", (t) => {
  for (const tool of ["ffprobe", "ffmpeg"]) {
    const diagnostic = "Application provided invalid, non monotonically increasing dts to muxer\n";
    const f = fixture(t, (r, name, args) => { if (name === tool && args[0] !== "-version") r.stderr = diagnostic; });
    assert.throws(f.run, /emitted diagnostics/);
    const report = f.report();
    assert.equal(report.passed, false); assert.equal(report.commands.at(-1).stderr, diagnostic);
    assert.equal(report.commands.at(-1).status, 0); assert.ok(report.error.includes(diagnostic));
    assert.equal(f.calls.length, tool === "ffprobe" ? 3 : 4);
  }
});

test("nonzero exit, signal, missing executable, timeout and output overflow never retry", (t) => {
  for (const failure of [
    { status: 1, stderr: "corrupt frame\n" }, { status: null, signal: "SIGTERM" },
    ...["ENOENT", "ETIMEDOUT", "ENOBUFS"].map((code) => ({ status: null, error: Object.assign(new Error(code), { code }) })),
  ]) {
    const f = fixture(t, (r) => Object.assign(r, failure));
    assert.throws(f.run);
    const report = f.report();
    assert.equal(report.passed, false); assert.equal(report.commands.length, 1);
    assert.equal(report.commands[0].status, failure.status);
    assert.equal(report.commands[0].code, failure.error?.code);
  }
});

test("malformed probe data, missing video and empty or invalid streams cannot pass", (t) => {
  for (const output of ["invalid json", JSON.stringify({ streams: [media.streams[0]] }),
    ...[{ nb_read_frames: "0" }, { nb_read_frames: "N/A" }, { width: 0 }].map((change) => JSON.stringify({ streams: [{ ...media.streams[1], ...change }] })),
    JSON.stringify({ streams: [{ ...media.streams[0], nb_read_frames: "0" }, media.streams[1]] }),
  ]) {
    const f = fixture(t, (r, tool, args) => { if (tool === "ffprobe" && args[0] !== "-version") r.stdout = output; });
    assert.throws(f.run); assert.equal(f.report().passed, false); assert.equal(f.calls.length, 3);
    assert.equal(f.report().commands.at(-1).stdout, output);
  }
});

test("receipts never overwrite the video, an alias, or earlier evidence", (t) => {
  const f = fixture(t), alias = path.join(path.dirname(f.file), "alias.json");
  fs.linkSync(f.file, alias);
  for (const receipt of [f.file, alias]) assert.throws(() => checkRecording(f.file, receipt, f.spawn), { code: "EEXIST" });
  assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(f.file, "utf8"), "original bytes");
  f.run(); const before = fs.readFileSync(f.receipt);
  assert.throws(f.run, { code: "EEXIST" }); assert.deepEqual(fs.readFileSync(f.receipt), before);
});
