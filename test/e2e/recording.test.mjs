// Real recorder acceptance. A codec/export failure fails this test; receipts and diagnostics remain.
// Requires E2E_TARGET plus ffprobe/ffmpeg already installed; never installs tools or changes the image.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { checkRecording, requireRecordingTools } from "../../tools/recording-check.mjs";

test("system recording exports actual frames and decodes without errors", { skip: !process.env.E2E_TARGET }, async () => {
  const target = process.env.E2E_TARGET;
  const directory = path.resolve(`.scratch/recording-${Date.now()}`), calls = [];
  fs.mkdirSync(directory, { recursive: true });
  const client = connect({ DEVECO_STATE_DIR: path.join(directory, "state") });
  const call = async (name, args) => {
    const result = await client.call(name, args);
    calls.push({ at: new Date().toISOString(), name, args, result });
    fs.writeFileSync(path.join(directory, "calls.json"), JSON.stringify(calls, null, 2));
    assert.equal(result.isError, false, JSON.stringify(result.data));
    return result.data;
  };
  try {
    // Fail before device mutation when an independent decoder is unavailable.
    requireRecordingTools();
    await client.initialize();
    await call("doctor", { target });
    const started = await call("ui", { action: "record_start", target });
    assert.equal(started.recording, true);
    const status = await call("ui", { action: "record_status", target });
    assert.equal(status.status, "recording"); assert.equal(status.file, started.file);
    await delay(2500);
    const file = path.join(directory, "recording.mp4");
    const saved = await call("ui", { action: "record_stop", target, save_path: file });
    assert.equal(saved.bytes, fs.statSync(file).size); assert.ok(saved.bytes > 0); assert.ok(saved.artifact_id);
    const media = checkRecording(file, path.join(directory, "recording-check.json"));
    fs.writeFileSync(path.join(directory, "media.json"), JSON.stringify(media, null, 2));
    const videos = media.streams.filter((s) => s.codec_type === "video");
    assert.equal(videos.length, 1);
    const video = videos[0];
    assert.ok(video.width > 0 && video.height > 0 && Number(video.nb_read_frames) > 1 && Number(video.duration) >= 1);
    const ended = await call("ui", { action: "record_status", target });
    assert.equal(ended.status, "idle"); assert.equal(ended.file, undefined);
  } catch (error) {
    // Preserve both the original failure and diagnostics failure; never discard the pending recording.
    let diagnostic;
    try { diagnostic = await client.call("device", { action: "log", target, from: "2m", lines: 1000 }); }
    catch (failure) { diagnostic = { error: failure.message }; }
    fs.writeFileSync(path.join(directory, "failure.json"), JSON.stringify({ error: error.message, diagnostic }, null, 2));
    throw error;
  } finally { await client.close(); }
});
