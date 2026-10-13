// Fresh recording on the explicitly selected device; original bytes and strict decoder receipt remain.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { session, required, sha } from "../support/acceptance.mjs";
import { checkRecording, requireRecordingTools } from "../support/recording.mjs";

test("system recording exports actual frames and decodes without errors", async (t) => {
  const target = required("E2E_TARGET");
  requireRecordingTools();
  const { call, raw, directory, receipt } = await session(t);
  await call("device", { action: "info", target });
  try {
    const before = await call("ui", { action: "record_status", target });
    assert.equal(before.status, "idle"); assert.equal(before.file, undefined, "Resolve the existing recording explicitly before a fresh trial");
    const started = await call("ui", { action: "record_start", target });
    assert.equal(started.recording, true);
    const listed = await call("ui", { action: "record_receipts", target });
    assert.equal(listed.pending.length, 1);
    const pending = listed.pending[0];
    assert.equal(pending.receipt.name, started.file);
    assert.ok(pending.receipt.identity?.id, "Fresh recordings must bind a target identity");
    const archived = await call("ui", { action: "record_archive", target, name: started.file, reason: "Explicit recording receipt round trip" });
    assert.equal(archived.raw, pending.raw);
    assert.equal((await call("ui", { action: "record_status", target })).status, "busy", "Archiving a receipt must not stop the recorder");
    const restored = await call("ui", { action: "record_restore", receipt_id: archived.receipt_id });
    assert.equal(restored.restored, true);
    assert.equal((await call("ui", { action: "record_receipts", target })).pending[0].raw, pending.raw);
    receipt("recording-receipt.json", { identity: pending.receipt.identity, original_raw: pending.raw, restored });
    const status = await call("ui", { action: "record_status", target });
    assert.equal(status.status, "recording"); assert.equal(status.file, started.file);
    await delay(2500);
    const file = path.join(directory, "recording.mp4");
    const saved = await call("ui", { action: "record_stop", target, save_path: file });
    assert.equal(saved.bytes, fs.statSync(file).size); assert.ok(saved.bytes > 10000); assert.ok(saved.artifact_id);
    const hash = sha(fs.readFileSync(file)), media = checkRecording(file, path.join(directory, "recording-check.json"));
    assert.equal(sha(fs.readFileSync(file)), hash, "Strict decoding must not change the original video");
    receipt("media.json", { ...media, sha256: hash });
    const videos = media.streams.filter((s) => s.codec_type === "video");
    assert.equal(videos.length, 1);
    assert.ok(videos[0].width > 0 && videos[0].height > 0 && Number(videos[0].nb_read_frames) > 10 && Number(videos[0].duration) >= 1);
    const ended = await call("ui", { action: "record_status", target });
    assert.equal(ended.status, "idle"); assert.equal(ended.file, undefined);
  } catch (error) {
    try { receipt("failure.json", { error: String(error), diagnostic: await raw("device", { action: "log", target, from: "2m", lines: 1000 }) }); }
    catch (diagnostic) { throw new AggregateError([error, diagnostic], "Recording and diagnostic collection failed"); }
    throw error;
  }
});
