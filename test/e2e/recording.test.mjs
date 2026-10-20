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
  let startedFile, owned, stopped = false, failure;
  const oldArchives = new Set();
  const checkOwned = (entry) => {
    assert.equal(entry.target, target); assert.equal(entry.receipt.name, startedFile);
    const { name, started, recorder, identity } = entry.receipt;
    assert.ok(identity?.id && ["device", "emulator"].includes(identity.kind), "Fresh recordings must bind a target identity");
    assert.ok(Number.isFinite(started) && typeof recorder === "string" && recorder, "Recorder instance must be identified");
    const current = { name, started, recorder, identity };
    if (owned) assert.deepEqual(current, owned, "Recording ownership changed; do not stop it");
    else owned = current;
  };
  try {
    const before = await call("ui", { action: "record_status", target });
    assert.equal(before.status, "idle"); assert.equal(before.file, undefined, "Resolve the existing recording explicitly before a fresh trial");
    const receipts = await call("ui", { action: "record_receipts", target });
    assert.equal(receipts.pending.length, 0, "Pre-existing receipts must be resolved explicitly");
    for (const entry of receipts.archived) oldArchives.add(entry.receipt_id);
    const started = await call("ui", { action: "record_start", target });
    assert.equal(started.recording, true); assert.match(started.file, /^devecomcp-\d+-[a-f0-9]+\.mp4$/);
    startedFile = started.file; // Never clean up an unconfirmed start or another run's recording.
    const listed = await call("ui", { action: "record_receipts", target });
    assert.equal(listed.pending.length, 1);
    const pending = listed.pending[0];
    checkOwned(pending);
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
    const current = await call("ui", { action: "record_receipts", target });
    assert.equal(current.pending.length, 1); checkOwned(current.pending[0]);
    const saved = await call("ui", { action: "record_stop", target, save_path: file });
    stopped = true;
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
    failure = error;
    try { receipt("failure.json", { error: String(error), diagnostic: await raw("device", { action: "log", target, from: "2m", lines: 1000 }) }); }
    catch (diagnostic) { failure = new AggregateError([error, diagnostic], "Recording and diagnostic collection failed", { cause: error }); }
    throw failure;
  } finally {
    if (startedFile && !stopped) {
      try {
        let listed = await call("ui", { action: "record_receipts", target });
        if (!listed.pending.length) {
          const archived = listed.archived.filter((entry) => entry.receipt.name === startedFile && !oldArchives.has(entry.receipt_id));
          assert.equal(archived.length, 1, "Owned receipt is unavailable; preserve all other receipts and recordings");
          checkOwned(archived[0]);
          const restored = await call("ui", { action: "record_restore", receipt_id: archived[0].receipt_id });
          assert.equal(restored.restored, true); checkOwned(restored);
          listed = await call("ui", { action: "record_receipts", target });
        }
        assert.equal(listed.pending.length, 1); checkOwned(listed.pending[0]);
        const status = await call("ui", { action: "record_status", target });
        assert.equal(status.file, startedFile);
        assert.ok(["recording", "idle"].includes(status.status), "Identity mismatch or foreign recorder; do not stop it");
        // Release only this run's receipt. discard leaves every gallery video intact; never external=true.
        const cleaned = await call("ui", { action: "record_stop", target, discard: true });
        assert.equal(cleaned.stopped, true); assert.equal(cleaned.discarded, startedFile);
        stopped = true;
        const after = await call("ui", { action: "record_status", target });
        receipt("recording-cleanup.json", { owned, cleaned, after, gallery_deletion_requested: false });
        assert.equal(after.status, "idle"); assert.equal(after.file, undefined);
      } catch (cleanup) {
        if (failure) throw new AggregateError([failure, cleanup], "Recording and owned-recording cleanup failed", { cause: failure });
        throw cleanup;
      }
    }
  }
});
