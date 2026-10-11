// Real FFmpeg regression tests. Explicit invocation requires installed tools; no install or skip.
// Generated fixtures are separate from device recordings and are never used as device evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { checkRecording, requireRecordingTools } from "../../tools/recording-check.mjs";

requireRecordingTools();
const exec = (tool, args) => execFileSync(tool, args, { encoding: "utf8", stdio: "pipe", timeout: 120000 });
function fixture(t, audio, variable) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-media-")), file = path.join(directory, "source.mp4");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  exec("ffmpeg", ["-v", "error", "-nostdin", "-xerror", "-f", "lavfi", "-i", `testsrc2=size=64x64:rate=${variable ? 100 : 12}:duration=${variable ? 0.12 : 1.5}`,
    ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=1000:duration=1.5", "-map", "0:v", "-map", "1:a", "-c:a", "aac"] : []),
    ...(variable ? ["-vf", "setpts=if(lt(N\\,6)\\,N\\,N+100)", "-fps_mode", "passthrough"] : []),
    "-c:v", "mpeg4", "-video_track_timescale", "90000", file]);
  return { file, directory, receipt: path.join(directory, "check.json") };
}

test("real decoder accepts constant-rate video without audio and leaves every byte intact", (t) => {
  const f = fixture(t, false, false), before = fs.readFileSync(f.file);
  const media = checkRecording(f.file, f.receipt);
  assert.equal(media.streams.length, 1); assert.equal(Number(media.streams[0].nb_read_frames), 18);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test("real decoder preserves closely spaced VFR frames and decodes the existing audio", (t) => {
  const f = fixture(t, true, true), before = fs.readFileSync(f.file);
  const media = checkRecording(f.file, f.receipt), video = media.streams.find((s) => s.codec_type === "video");
  assert.equal(Number(video.nb_read_frames), 12);
  assert.ok(Number(media.streams.find((s) => s.codec_type === "audio").nb_read_frames) > 0);
  const { frames } = JSON.parse(exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", f.file]));
  const times = frames.map((f) => Number(f.best_effort_timestamp_time));
  assert.ok(times.every((time, i) => !i || time > times[i - 1]));
  const [num, den] = video.avg_frame_rate.split("/").map(Number);
  assert.ok(times[1] - times[0] < den / num / 2, "Fixture must expose default output time-base rounding");
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.ok(JSON.parse(fs.readFileSync(f.receipt, "utf8")).commands.every((c) => c.status === 0 && c.stderr === ""));
});

test("real decoder rejects damaged video and audio payloads while retaining diagnostics", (t) => {
  const f = fixture(t, true, false), original = fs.readFileSync(f.file);
  for (const type of ["v:0", "a:0"]) {
    const { packets } = JSON.parse(exec("ffprobe", ["-v", "error", "-select_streams", type, "-show_packets", "-show_entries", "packet=pos,size", "-of", "json", f.file]));
    const packet = packets.at(-1), bytes = Buffer.from(original);
    bytes.fill(0xff, Number(packet.pos), Number(packet.pos) + Number(packet.size));
    const damaged = path.join(f.directory, `damaged-${type[0]}.mp4`), receipt = damaged + ".json";
    fs.writeFileSync(damaged, bytes);
    assert.throws(() => checkRecording(damaged, receipt));
    const report = JSON.parse(fs.readFileSync(receipt, "utf8"));
    assert.equal(report.passed, false); assert.ok(report.commands.at(-1).stderr.length > 0);
    assert.deepEqual(fs.readFileSync(damaged), bytes);
  }
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test("real probe rejects a truncated container instead of accepting its file size", (t) => {
  const f = fixture(t, false, false), truncated = path.join(f.directory, "truncated.mp4");
  fs.writeFileSync(truncated, fs.readFileSync(f.file).subarray(0, 256));
  assert.throws(() => checkRecording(truncated, f.receipt));
  const report = JSON.parse(fs.readFileSync(f.receipt, "utf8"));
  assert.equal(report.passed, false); assert.ok(report.commands.at(-1).stderr.length > 0);
});
