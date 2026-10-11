// Acceptance only: decode without writing media, preserving the demuxer's video time base.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function requireRecordingTools() {
  for (const tool of ["ffprobe", "ffmpeg"]) execFileSync(tool, ["-version"], { stdio: "pipe", timeout: 120000 });
}

/** @typedef {{index: number, codec_type: string, codec_name: string, nb_read_frames: string, width: number, height: number, duration: string}} Stream */
/** @param {string} file @param {string} receipt */
export function checkRecording(file, receipt, spawn = spawnSync) {
  // Exclusive creation protects the input and previous evidence, including symlink/hardlink aliases.
  const fd = fs.openSync(receipt, "wx", 0o600);
  /** @type {{file: string, passed: boolean, commands: object[], media?: {streams: Stream[]}, error?: string}} */
  const report = { file: path.resolve(file), passed: false, commands: [] };
  /** @param {string} tool @param {string[]} args */
  const run = (tool, args) => {
    const { status, signal, stdout, stderr, error } = spawn(tool, args, { encoding: "utf8", stdio: "pipe", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    report.commands.push({ tool, args, status, signal, stdout, stderr, ...(error && { error: error.message, code: /** @type {NodeJS.ErrnoException} */ (error).code }) });
    assert.ifError(error);
    assert.equal(signal, null, `${tool} terminated: ${signal}\n${stderr}`);
    assert.equal(status, 0, `${tool} exited ${status}\n${stderr}`);
    // Some muxer errors leave exit status 0. Never filter or discard their diagnostics.
    assert.equal(stderr, "", `${tool} emitted diagnostics:\n${stderr}`);
    return stdout;
  };
  try {
    for (const tool of ["ffprobe", "ffmpeg"]) run(tool, ["-version"]);
    const media = report.media = /** @type {{streams: Stream[]}} */ (JSON.parse(run("ffprobe", ["-v", "error", "-err_detect", "explode", "-count_frames", "-show_streams", "-show_format", "-of", "json", report.file])));
    assert.ok(media.streams?.some((s) => s.codec_type === "video"), "Recording has no video stream");
    for (const stream of media.streams.filter((s) => ["video", "audio"].includes(s.codec_type))) {
      assert.ok(Number(stream.nb_read_frames) > 0, `Stream ${stream.index} has no decoded frames`);
      if (stream.codec_type === "video") assert.ok(stream.width > 0 && stream.height > 0, `Stream ${stream.index} has invalid dimensions`);
    }
    // Audio is optional in screen recordings; every present audio/video stream must decode.
    run("ffmpeg", ["-v", "error", "-nostdin", "-xerror", "-err_detect", "explode", "-i", report.file,
      "-map", "0:v", "-map", "0:a?", "-enc_time_base:v", "demux", "-fps_mode", "passthrough", "-abort_on", "empty_output_stream", "-f", "null", "-"]);
    report.passed = true;
    return media;
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    try { fs.writeFileSync(fd, JSON.stringify(report, null, 2) + "\n"); }
    finally { fs.closeSync(fd); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, receipt, ...extra] = process.argv.slice(2);
  assert.ok(file && receipt && !extra.length, "Usage: node test/support/recording.mjs <recording.mp4> <new-receipt.json>");
  const media = checkRecording(file, receipt);
  console.log(JSON.stringify({ passed: true, receipt: path.resolve(receipt), streams: media.streams.map(({ index, codec_type, codec_name, nb_read_frames }) => ({ index, codec_type, codec_name, nb_read_frames })) }));
}
