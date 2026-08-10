/**
 * @file Fast device-UI tools that talk to hdc directly: capture, locate, observe, and input.
 * @author deveco-tool
 *
 * CodeGenie already proxies `perform_ui_action` and `get_app_ui_tree`, and both keep working
 * untouched. These exist beside them because the screenshot-driven loop (capture, find a control,
 * tap it) was paying for three avoidable things, all measured on a real device:
 *
 *   - `uitest screenCap` writes a full-resolution PNG: 1.05s end to end for 5.2MB. The same frame
 *     as JPEG through `snapshot_display` is 0.42s for ~260KB, with no visible loss for UI work.
 *   - Reading tap coordinates off that image is imprecise; a real estimate landed 40px off a tab
 *     centre. `uitest dumpLayout` carries an exact `$rect` per node.
 *   - Every action went through the CodeGenie child, whose handshake intermittently hangs forever
 *     (see src/codegenie-tools.mjs). Anything on that path inherits the stall.
 *
 * Everything here runs over hdc in this process, so the loop keeps working when the child is gone.
 *
 * Three later decisions came out of measuring the loop itself rather than the individual calls:
 *
 *   - `uitest` is a device singleton but `snapshot_display` is not, so only uitest work takes the
 *     lock. The two were confirmed to overlap on a real device (356ms of genuine concurrency).
 *   - `ui_observe` runs both in one shell round trip with the capture backgrounded. Fusing alone
 *     bought nothing -- 1736ms against 1731ms, because a `file recv` is only ~48ms and `dumpLayout`
 *     is the 1.25s long pole -- but fusing *and* overlapping them lands at 1238ms.
 *   - Captures are bounded by the longest edge a vision consumer will keep rather than by a chosen
 *     width, because that is the point past which extra pixels are resized away and charged for
 *     anyway. Cost follows pixel area alone -- not bytes, not encoding -- so resolution is the only
 *     lever there is, and it is the one that was set wrong: a fixed 480px default made small text
 *     unreadable on a dense display. See MAX_CAPTURE_LONG_EDGE.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyseDump, hasSelector, parseDump, readDump, readSelector,
} from "./device-dump.mjs";
import {
  TAP_ACTIONS, POINT_ACTIONS, buildInputArgs, requireSingleTarget,
} from "./device-input.mjs";
import { withUitestLock } from "./device-lock.mjs";
import { entryByBaseName, readTar } from "./device-tar.mjs";
import { hdcFailureMessage, requireHdc, resolveDevice, runHdc, targetArgs } from "./hdc-log.mjs";

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

/**
 * How long to wait for another process to release the device before giving up.
 *
 * Our own hold is about 1.3s, so this covers a deep queue, while still failing in a bounded time
 * rather than inheriting the caller's whole budget on top of the operation's own.
 */
const MAX_LOCK_WAIT_MS = 30000;

/**
 * The longest edge worth capturing, because it is the longest edge the consumer will keep.
 *
 * A vision model resizes any image whose long edge exceeds this before it ever looks at it, and
 * charges for the resized pixels -- so beyond this point extra resolution is discarded, and all
 * the larger capture buys is bytes on the wire. Below it, resolution is the only thing that helps:
 * cost follows pixel *area*, never file size or encoding, so no choice of format saves anything.
 *
 * This replaced a fixed 480px default, which was wrong twice over. It was picked from one reading
 * of one screen, and it was expressed as an absolute width when what decides legibility is the
 * scale factor -- 480px is 38% of a 1276px display and 30% of a 1600px one, so the same number
 * quietly degrades as displays get denser, and the failure surfaces as the model misreading the
 * screen rather than as a setting being wrong. Measured against a lossless capture of the same
 * screen, JPEG loss also got *worse* as resolution dropped (34.0dB at 480px against 37.7dB at
 * 1154px): scaling down and compression damage the same text edges, and compound.
 *
 * Capping the long edge instead is self-adjusting. A denser display is scaled further, a smaller
 * one is not scaled at all, and a consumer with a lower ceiling of its own simply resizes again
 * and is charged its own lower price. `width` still overrides it downward for a long loop where
 * the screen is simple and the tokens matter more than the detail.
 */
const MAX_CAPTURE_LONG_EDGE = 2576;

/** Below this, a transferred image is an error string or a truncated write, never a frame. */
const MIN_IMAGE_BYTES = 512;

/** A tar is at least a header block plus one end-of-archive block. */
const MIN_TAR_BYTES = 1024;

const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** snapshot_display prints the display's own size before scaling, then what it actually wrote. */
const NATIVE_SIZE_PATTERN = /process:[^\n]*?width:\s*(\d+)[^\n]*?height:\s*(\d+)/i;
const OUTPUT_SIZE_PATTERN = /success:[^\n]*?width:\s*(\d+)[^\n]*?height:\s*(\d+)/i;
const SCREENCAP_SUCCESS_PATTERN = /ScreenCap saved to/i;
const DUMP_SUCCESS_PATTERN = /DumpLayout saved to/i;
const OBSERVE_SUCCESS_PATTERN = /OBSERVE_OK/;

/**
 * What losing the device to another uitest client looks like. Measured with two independent
 * processes dumping at once: the loser sat for 30533ms and then printed this, having written a
 * 0-byte artifact. The lock below stops our own processes from racing each other, but DevEco Studio
 * drives uitest through its own client and will never take it, so this has to stay recognisable.
 */
const UITEST_CONFLICT_PATTERN = /Wait for subscribe uitest\.broadcast\.command\.reply timeout/i;

/**
 * A device that has no `snapshot_display` at all will never grow one, so that verdict is cached and
 * the probe is never paid again. Anything else is treated as a one-off.
 */
const SNAPSHOT_MISSING_PATTERN = /(not found|inaccessible|no such file|not executable|permission denied)/i;

/**
 * Work that drives `uitest` is chained per device inside this process before it ever reaches the
 * cross-process lock, so same-process callers queue cheaply and only distinct processes contend on
 * the filesystem. Different devices never wait on each other.
 */
const deviceQueues = new Map();

/** deviceId -> {width, height}. Refreshed from every capture, so rotating or folding self-heals. */
const nativeSizes = new Map();

/** deviceId -> reason, for devices proven to have no snapshot_display. */
const snapshotUnavailable = new Map();

/** Devices already swept this process; see sweepStaleArtifacts. */
const sweptDevices = new Set();

let snapshotCounter = 0;
let devicePathCounter = 0;

function fail(message, code, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  throw error;
}

function boundedTimeout(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(requested, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * Run hdc, translating a missing binary into the same code the rest of the pack uses.
 *
 * `requireHdc()` allows the bare string "hdc" when nothing is configured, so on a machine without
 * it spawn raises a bare ENOENT that carries no code the tool handler recognises.
 *
 * @param {string[]} command Full argv.
 * @param {number} timeoutMs Bound for the call.
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null, signal: string|null}>} Result.
 */
async function execHdc(command, timeoutMs) {
  try {
    return await runHdc(command, timeoutMs);
  } catch (error) {
    if (error.code === "ENOENT") {
      fail(`hdc could not be executed: ${command[0]}`, "HDC_NOT_FOUND");
    }
    throw error;
  }
}

function serializePerDevice(deviceId, task) {
  const previous = deviceQueues.get(deviceId) ?? Promise.resolve();
  // The predecessor's rejection is swallowed for the *chain* only: one failed capture must not
  // reject the next caller's unrelated call. `next` still settles with this task's own outcome.
  const next = previous.then(task, task);
  deviceQueues.set(deviceId, next.then(() => {}, () => {}));
  return next;
}

/**
 * Run work that drives `uitest`, holding the device against every other client that takes the lock.
 *
 * Only uitest work goes through here. A plain `snapshot_display` capture is a different binary and
 * was measured running concurrently with a dump on a real device, so queueing it behind one would
 * be pure latency.
 *
 * @param {string} deviceId Target device.
 * @param {string} op Label recorded in the lock file, so a blocked caller can say who holds it.
 * @param {number} timeoutMs The caller's budget.
 * @param {() => Promise<any>} task Work to run under the lock.
 * @returns {Promise<any>} Whatever `task` resolves to.
 */
function withUitest(deviceId, op, timeoutMs, task) {
  return serializePerDevice(deviceId, () => withUitestLock(
    { directory: defaultLocalDirectory(deviceId), op, timeoutMs: Math.min(timeoutMs, MAX_LOCK_WAIT_MS) },
    task,
  ));
}

/**
 * Turn a foreign uitest client's signature into an actionable failure instead of a puzzling one.
 *
 * @param {string} combined Command output.
 * @param {string} operation What was attempted.
 * @returns {void}
 */
function assertNoUitestConflict(combined, operation) {
  if (!UITEST_CONFLICT_PATTERN.test(combined)) return;
  fail(
    `${operation} lost the device to another uitest client`,
    "UI_DEVICE_BUSY",
    "DevEco Studio's device panel drives uitest through its own client and cannot see this pack's"
    + " lock. Close it (or stop whatever else is driving the device) and retry.",
  );
}

function sanitizeForPath(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Device-side scratch path.
 *
 * The pid separates two server processes. The per-call counter separates concurrent calls inside
 * one process: uitest work is serialised, but captures deliberately are not, so two overlapping
 * snapshots would otherwise write the same file and each pull whichever finished last.
 *
 * @param {string} kind Short label, part of the filename.
 * @param {string} extension File extension.
 * @param {boolean} unique Whether this path may be shared with a concurrent call.
 * @returns {string} Absolute device path.
 */
function devicePathFor(kind, extension, unique = false) {
  const suffix = unique ? `_${(devicePathCounter += 1)}` : "";
  return `/data/local/tmp/deveco_ui_${process.pid}_${kind}${suffix}.${extension}`;
}

/**
 * Drop device-side scratch files left behind by server processes that have since exited.
 *
 * The paths above are keyed by pid, which bounds them per process but not over time: a development
 * device had accumulated 14 files totalling 6.9MB, one of them a 5.2MB PNG from the screenCap
 * fallback. This runs once per device per process and is deliberately not awaited -- the capture
 * path is what was optimised here, and a failed sweep is not a failed capture.
 *
 * The age bound is what makes it safe. A second server process may be mid-capture against the same
 * device, and its file is seconds old; a blanket `rm deveco_ui_*` would delete that file between its
 * write and its `file recv`. An hour-old file belongs to nobody.
 *
 * Passed as a single argv element on purpose: hdc forwards a lone `shell` argument as the command
 * line, but quotes each of several arguments separately, which would send the -name pattern with
 * its quotes attached and match nothing.
 *
 * @param {string} hdc Resolved hdc binary.
 * @param {string} deviceId Target device.
 * @returns {void}
 */
function sweepStaleArtifacts(hdc, deviceId) {
  if (sweptDevices.has(deviceId)) return;
  sweptDevices.add(deviceId);
  execHdc(
    [hdc, ...targetArgs(deviceId), "shell",
      "find /data/local/tmp -maxdepth 1 -name 'deveco_ui_*' -mmin +60 -delete"],
    30000,
  ).catch(() => {});
}

function defaultLocalDirectory(deviceId) {
  // Never a relative path: the MCP server's cwd is the pack root, so a relative default would drop
  // screenshots into the repository.
  return path.join(os.tmpdir(), "deveco-ui", sanitizeForPath(deviceId));
}

/**
 * Where the display's pixel size is remembered between processes.
 *
 * Scaling a capture needs the native size, because `-w` alone does not preserve aspect ratio (a 640
 * request produced 640x2848). Without a persisted answer every fresh server process would have to
 * spend one unscaled capture learning it before it could scale anything.
 */
function displayCachePath(deviceId) {
  return path.join(defaultLocalDirectory(deviceId), "display.json");
}

function readDisplaySize(deviceId) {
  const remembered = nativeSizes.get(deviceId);
  if (remembered) return remembered;
  try {
    const parsed = JSON.parse(fs.readFileSync(displayCachePath(deviceId), "utf8"));
    if (Number.isInteger(parsed?.width) && Number.isInteger(parsed?.height)
      && parsed.width > 0 && parsed.height > 0) {
      const size = { width: parsed.width, height: parsed.height };
      nativeSizes.set(deviceId, size);
      return size;
    }
  } catch {
    // No cache yet, or an unreadable one. Either way the next capture reports the real size.
  }
  return null;
}

/**
 * Record the display size a capture just reported.
 *
 * The cache is never trusted over the device: every capture reports the native size, so a fold, an
 * unfold or a rotation is picked up on the next call. The frame taken with the stale size has the
 * wrong aspect ratio, which is why the change is reported rather than swallowed -- but it only
 * affects how the image looks, since coordinates come from the dump.
 *
 * @param {string} deviceId Target device.
 * @param {{width: number, height: number}|null} size Size reported by snapshot_display.
 * @returns {boolean} True when this differs from what was cached.
 */
function rememberDisplaySize(deviceId, size) {
  if (!size || !(size.width > 0) || !(size.height > 0)) return false;
  const previous = nativeSizes.get(deviceId) ?? readDisplaySize(deviceId);
  const changed = Boolean(previous) && (previous.width !== size.width || previous.height !== size.height);
  nativeSizes.set(deviceId, size);
  if (!previous || changed) {
    try {
      fs.mkdirSync(defaultLocalDirectory(deviceId), { recursive: true });
      fs.writeFileSync(displayCachePath(deviceId), JSON.stringify(size));
    } catch {
      // A cache that cannot be written just means the next process re-learns it.
    }
  }
  return changed;
}

/**
 * Work out the `-w` / `-h` pair for a capture.
 *
 * With no explicit width the answer is "native, unless the display's long edge is past the ceiling"
 * -- so most displays are captured untouched and only the tall ones are scaled, to exactly the size
 * a consumer would have resized them to anyway.
 *
 * @param {{width: number, height: number}|null} nativeSize Known display size, if any.
 * @param {number|null} targetWidth Explicit width, or null for the default ceiling.
 * @returns {{width: number, height: number}|null} Scale arguments, or null to capture natively.
 */
function scaleArguments(nativeSize, targetWidth) {
  if (!nativeSize || !(nativeSize.width > 0) || !(nativeSize.height > 0)) return null;
  const fromWidth = (width) => ({
    width,
    height: Math.max(1, Math.round((nativeSize.height * width) / nativeSize.width)),
  });

  if (targetWidth !== null) {
    // An explicit width only ever scales down; asking for more pixels than the display has would
    // upscale a blurry frame and charge for the extra area.
    return targetWidth >= nativeSize.width ? null : fromWidth(targetWidth);
  }

  const longEdge = Math.max(nativeSize.width, nativeSize.height);
  if (longEdge <= MAX_CAPTURE_LONG_EDGE) return null;
  return fromWidth(Math.max(1, Math.round((nativeSize.width * MAX_CAPTURE_LONG_EDGE) / longEdge)));
}

function withExtension(filePath, extension) {
  return filePath.replace(/\.[^.\\/]*$/, "") + `.${extension}`;
}

function readMagic(filePath, length) {
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Pull a device file to a local path, proving it arrived intact before it becomes visible.
 *
 * The staging file is the point: device paths are reused, so if `recv` quietly failed while an
 * earlier call's file still sat at the destination, a size check would pass and the caller would be
 * handed a stale screenshot -- worse than an error, because nothing looks wrong.
 *
 * @param {string} hdc Resolved hdc binary.
 * @param {string} deviceId Target device.
 * @param {string} devicePath Source path on the device.
 * @param {string} localPath Final destination.
 * @param {number} timeoutMs Bound for the transfer.
 * @param {{emptyCode: string, magic?: Buffer, minBytes?: number}} expectations Validation rules.
 * @returns {Promise<number>} Byte size of the delivered file.
 */
async function pullArtifact(hdc, deviceId, devicePath, localPath, timeoutMs, expectations) {
  const staging = `${localPath}.part`;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.rmSync(staging, { force: true });

  const received = await execHdc(
    [hdc, ...targetArgs(deviceId), "file", "recv", devicePath, staging],
    timeoutMs,
  );
  const transportFailure = hdcFailureMessage(received);
  if (transportFailure) {
    fs.rmSync(staging, { force: true });
    fail(`hdc file recv failed: ${transportFailure}`, "UI_RECV_FAILED");
  }

  const size = fs.existsSync(staging) ? fs.statSync(staging).size : 0;
  const minimum = expectations.minBytes ?? 1;
  if (size < minimum) {
    fs.rmSync(staging, { force: true });
    fail(
      `Transferred file is ${size} bytes, below the ${minimum} byte minimum: ${devicePath}`,
      expectations.emptyCode,
    );
  }
  if (expectations.magic) {
    const magic = readMagic(staging, expectations.magic.length);
    if (!magic.equals(expectations.magic)) {
      // uitest and snapshot_display write plain-text failures into the -p/-f target, and recv pulls
      // those faithfully. Without this check they would arrive as a "successful" screenshot.
      const preview = magic.toString("utf8").replace(/[^\x20-\x7e]/g, ".");
      fs.rmSync(staging, { force: true });
      fail(
        `Transferred file is not the expected image format (starts with "${preview}")`,
        expectations.emptyCode,
      );
    }
  }

  fs.renameSync(staging, localPath);
  return size;
}

function parseSize(pattern, text) {
  const match = pattern.exec(text);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Capture through snapshot_display.
 *
 * Success is a positive marker plus a validated artifact, never the absence of an error pattern:
 * `hdc shell X` exits 0 no matter what X did on the device, so there is no exit code to trust.
 *
 * @returns {Promise<{ok: true, native: object|null, output: object|null}|{ok: false, permanent: boolean, reason: string}>} Outcome.
 */
async function captureWithSnapshotDisplay(hdc, deviceId, devicePath, format, scale, displayId, timeoutMs) {
  const args = [hdc, ...targetArgs(deviceId), "shell", "snapshot_display", "-f", devicePath, "-t", format];
  // Only pass -i when the caller named a display. Defaulting it to 0 would break every device whose
  // active display is not 0: unfolded foldables, 2-in-1, anything on an external screen.
  if (displayId !== undefined) args.push("-i", String(displayId));
  if (scale) args.push("-w", String(scale.width), "-h", String(scale.height));

  const result = await execHdc(args, timeoutMs);
  return readCaptureOutcome(`${result.stdout}\n${result.stderr}`, deviceId);
}

/**
 * Interpret snapshot_display's output, wherever it was captured from.
 *
 * `ui_observe` redirects it to a file on the device and reads it back out of the archive, so this
 * cannot assume it came from the command's own stdout.
 *
 * @param {string} combined Everything the command printed.
 * @param {string} deviceId Target device, for the size cache.
 * @returns {object} Outcome, including whether the display size changed.
 */
function readCaptureOutcome(combined, deviceId) {
  const native = parseSize(NATIVE_SIZE_PATTERN, combined);
  const nativeSizeChanged = rememberDisplaySize(deviceId, native);

  if (!/success:/i.test(combined)) {
    return {
      ok: false,
      permanent: SNAPSHOT_MISSING_PATTERN.test(combined),
      reason: combined.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ")
        || "snapshot_display produced no success marker",
    };
  }
  return { ok: true, native, nativeSizeChanged, output: parseSize(OUTPUT_SIZE_PATTERN, combined) };
}

async function captureWithScreenCap(hdc, deviceId, devicePath, timeoutMs) {
  const result = await execHdc(
    [hdc, ...targetArgs(deviceId), "shell", "uitest", "screenCap", "-p", devicePath],
    timeoutMs,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertNoUitestConflict(combined, "uitest screenCap");
  if (!SCREENCAP_SUCCESS_PATTERN.test(combined)) {
    fail(`uitest screenCap failed: ${combined.trim() || "no output"}`, "UI_SNAPSHOT_FAILED");
  }
}

/**
 * Validate and normalise the capture-shaping arguments shared by ui_snapshot and ui_observe.
 *
 * @param {object} input Tool arguments.
 * @returns {{format: string, targetWidth: number|null, displayId: number|undefined}} Normalised.
 */
function readCaptureOptions(input) {
  const format = input.format === "png" ? "png" : "jpeg";
  // null means "use the default ceiling" -- except for png, the explicit ask for the untouched
  // original, which is left at the display's own size unless a width is named.
  let targetWidth = format === "png" ? Number.POSITIVE_INFINITY : null;
  if (input.width !== undefined && input.width !== null) {
    targetWidth = Number(input.width);
    if (!Number.isInteger(targetWidth) || targetWidth < 64 || targetWidth > 4096) {
      fail("width must be an integer between 64 and 4096", "UI_ARGS_INVALID");
    }
  }

  let displayId;
  if (input.displayId !== undefined && input.displayId !== null) {
    displayId = Number(input.displayId);
    if (!Number.isInteger(displayId) || displayId < 0) {
      fail("displayId must be a non-negative integer", "UI_ARGS_INVALID");
    }
  }
  return { format, targetWidth, displayId };
}

function captureReport({ deviceId, method, localPath, requestedPath, fallbackReason, isPng, bytes, outputSize, nativeSize, nativeSizeChanged, startedAt }) {
  const width = outputSize?.width ?? nativeSize?.width ?? null;
  const height = outputSize?.height ?? nativeSize?.height ?? null;
  return {
    deviceId,
    method,
    localPath,
    requestedPath: localPath === requestedPath ? undefined : requestedPath,
    fallbackReason: fallbackReason ?? undefined,
    mimeType: isPng ? "image/png" : "image/jpeg",
    bytes,
    width,
    height,
    nativeWidth: nativeSize?.width ?? null,
    nativeHeight: nativeSize?.height ?? null,
    nativeSizeChanged: nativeSizeChanged || undefined,
    // Multiply a pixel read off this image by this to get device coordinates. Prefer the matches
    // from ui_observe or ui_find, which are device coordinates already and cannot be misscaled.
    coordinateScale: width && nativeSize?.width ? Number((nativeSize.width / width).toFixed(4)) : 1,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Capture the device screen and pull it back.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} Capture report including the local path and coordinate scale.
 */
export async function uiSnapshot(input = {}) {
  const hdc = requireHdc();
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const deviceId = await resolveDevice(hdc, input.hvd);
  const { format, targetWidth, displayId } = readCaptureOptions(input);

  sweepStaleArtifacts(hdc, deviceId);

  const startedAt = Date.now();
  const requestedPath = input.localPath
    ? path.resolve(input.localPath)
    : path.join(
      defaultLocalDirectory(deviceId),
      // Snapshots get unique names because a visual loop refers back to earlier frames by path;
      // overwriting would silently rewrite history. Dumps are the opposite case.
      `snapshot-${startedAt}-${(snapshotCounter += 1)}.${format}`,
    );

  const cachedUnavailable = snapshotUnavailable.get(deviceId);
  // snapshot_display writes png as well as jpeg -- the earlier belief that it was jpeg-only sent
  // every lossless capture to uitest screenCap, which on one screen meant 5.2MB in 813ms against
  // 3.7MB in 655ms here, and needlessly took the uitest lock. screenCap is now purely the fallback
  // for a device that has no snapshot_display at all.
  const skipSnapshotDisplay = Boolean(cachedUnavailable);
  let method = skipSnapshotDisplay ? null : "snapshot_display";
  let fallbackReason = cachedUnavailable ?? null;
  let localPath = requestedPath;
  let devicePath = devicePathFor("snap", format, true);
  let outputSize = null;
  let nativeSize = readDisplaySize(deviceId);
  let nativeSizeChanged = false;

  if (!skipSnapshotDisplay) {
    // No probe capture when the size is unknown: the first call simply comes back native and
    // teaches the cache, and every later call -- in this process or the next -- can scale.
    const captured = await captureWithSnapshotDisplay(
      hdc, deviceId, devicePath, format, scaleArguments(nativeSize, targetWidth), displayId, timeoutMs,
    );
    if (captured.ok) {
      nativeSize = captured.native ?? nativeSize;
      nativeSizeChanged = captured.nativeSizeChanged;
      outputSize = captured.output;
    } else {
      // A timeout never reaches here: execHdc rethrows HDC_TIMEOUT, and falling back after one
      // would double the wait on a device that is already wedged.
      fallbackReason = captured.reason;
      if (captured.permanent) snapshotUnavailable.set(deviceId, captured.reason);
      method = null;
    }
  }

  if (method !== "snapshot_display") {
    method = "uitest-screenCap";
    devicePath = devicePathFor("snap", "png", true);
    // screenCap only writes PNG. Handing back PNG bytes at a .jpeg path would be a lie the caller
    // cannot detect, so the destination moves and both paths are reported.
    localPath = withExtension(requestedPath, "png");
    // This one is uitest, so unlike the path above it has to hold the device.
    await withUitest(deviceId, "screenCap", timeoutMs,
      () => captureWithScreenCap(hdc, deviceId, devicePath, timeoutMs));
  }

  const isPng = method === "uitest-screenCap" || format === "png";
  const bytes = await pullArtifact(hdc, deviceId, devicePath, localPath, timeoutMs, {
    emptyCode: "UI_SNAPSHOT_EMPTY",
    magic: isPng ? PNG_MAGIC : JPEG_MAGIC,
    minBytes: MIN_IMAGE_BYTES,
  });

  return captureReport({
    deviceId, method, localPath, requestedPath, fallbackReason, isPng, bytes,
    outputSize, nativeSize, nativeSizeChanged, startedAt,
  });
}

/**
 * Run `uitest dumpLayout` and bring the tree back.
 *
 * @returns {Promise<string>} Local path of the pulled dump.
 */
async function dumpLayout(hdc, deviceId, timeoutMs) {
  const devicePath = devicePathFor("dump", "json");
  const result = await execHdc(
    [hdc, ...targetArgs(deviceId), "shell", "uitest", "dumpLayout", "-p", devicePath],
    timeoutMs,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertNoUitestConflict(combined, "uitest dumpLayout");
  if (!DUMP_SUCCESS_PATTERN.test(combined)) {
    fail(`uitest dumpLayout failed: ${combined.trim() || "no output"}`, "UI_DUMP_FAILED");
  }
  // Stable name, overwritten every call: unlike a screenshot, a stale layout is actively harmful,
  // and dumpPath only has to stay valid until the next dump.
  const localPath = path.join(defaultLocalDirectory(deviceId), "layout.json");
  await pullArtifact(hdc, deviceId, devicePath, localPath, timeoutMs, { emptyCode: "UI_DUMP_EMPTY" });
  return localPath;
}

/**
 * Locate on-screen controls and return tap-ready device coordinates.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} Matches with centres, plus the dump path for further digging.
 */
export async function uiFind(input = {}) {
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const selector = readSelector(input);

  // Re-parsing a dump the caller already has costs nothing, where dumping again costs ~1.4s. It is
  // opt-in so nobody gets a stale tree by accident, and it makes this whole path device-free.
  if (typeof input.dumpPath === "string" && input.dumpPath) {
    const dumpPath = path.resolve(input.dumpPath);
    return analyseDump({ root: readDump(dumpPath), dumpPath, deviceId: null, selector });
  }

  const hdc = requireHdc();
  const deviceId = await resolveDevice(hdc, input.hvd);
  sweepStaleArtifacts(hdc, deviceId);
  return withUitest(deviceId, "dumpLayout", timeoutMs, async () => {
    const dumpPath = await dumpLayout(hdc, deviceId, timeoutMs);
    return analyseDump({ root: readDump(dumpPath), dumpPath, deviceId, selector });
  });
}

/**
 * The device-side command `ui_observe` runs.
 *
 * The capture is backgrounded so it overlaps the dump, which is the whole point: fusing the two
 * round trips without overlapping them measured 1736ms against 1731ms for doing them separately,
 * because `file recv` is only ~48ms while `dumpLayout` alone is 1.25s. Overlapping lands at 1238ms.
 *
 * Both commands' output is redirected into files that ride back inside the archive. Discarding it
 * would be faster to write and wrong: the success markers are the only proof either command did
 * anything, since `hdc shell` exits 0 regardless.
 *
 * Returned as one string because hdc forwards a lone `shell` argument as the command line but
 * quotes several arguments separately.
 *
 * @returns {string} Shell command line.
 */
function buildObserveCommand({ snap, dump, snapLog, dumpLog, archive, scale, displayId }) {
  const capture = ["snapshot_display", "-f", snap, "-t", "jpeg"];
  if (displayId !== undefined) capture.push("-i", String(displayId));
  if (scale) capture.push("-w", String(scale.width), "-h", String(scale.height));
  const base = (target) => path.posix.basename(target);
  return [
    `${capture.join(" ")} > ${snapLog} 2>&1 &`,
    `uitest dumpLayout -p ${dump} > ${dumpLog} 2>&1;`,
    "wait;",
    `cd /data/local/tmp && rm -f ${archive} &&`,
    `tar cf ${base(archive)} ${base(snap)} ${base(dump)} ${base(snapLog)} ${base(dumpLog)} &&`,
    "echo OBSERVE_OK",
  ].join(" ");
}

/**
 * Capture the screen and the layout tree in one device round trip.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} Capture report merged with the ui_find-shaped selection.
 */
export async function uiObserve(input = {}) {
  const hdc = requireHdc();
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const deviceId = await resolveDevice(hdc, input.hvd);
  const selector = readSelector(input);
  const { targetWidth, displayId } = readCaptureOptions({ ...input, format: "jpeg" });

  sweepStaleArtifacts(hdc, deviceId);
  return withUitest(deviceId, "observe", timeoutMs, async () => {
    const startedAt = Date.now();
    const directory = defaultLocalDirectory(deviceId);
    const localImage = input.localPath
      ? path.resolve(input.localPath)
      : path.join(directory, `snapshot-${startedAt}-${(snapshotCounter += 1)}.jpeg`);
    const localDump = path.join(directory, "layout.json");

    const targets = {
      snap: devicePathFor("obs_snap", "jpeg"),
      dump: devicePathFor("obs_dump", "json"),
      snapLog: devicePathFor("obs_snap", "log"),
      dumpLog: devicePathFor("obs_dump", "log"),
      archive: devicePathFor("obs", "tar"),
      scale: scaleArguments(readDisplaySize(deviceId), targetWidth),
      displayId,
    };

    const result = await execHdc(
      [hdc, ...targetArgs(deviceId), "shell", buildObserveCommand(targets)],
      timeoutMs,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    assertNoUitestConflict(combined, "ui_observe");
    if (!OBSERVE_SUCCESS_PATTERN.test(combined)) {
      // No tar on the device, or the archive step failed. The two-round-trip path still works, so
      // this degrades rather than fails.
      return observeSeparately({
        hdc, deviceId, timeoutMs, selector, targetWidth, displayId,
        localImage, startedAt, reason: combined.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
          || "the fused observe command produced no OBSERVE_OK marker",
      });
    }

    const archivePath = path.join(directory, "observe.tar");
    await pullArtifact(hdc, deviceId, targets.archive, archivePath, timeoutMs, {
      emptyCode: "UI_OBSERVE_EMPTY",
      minBytes: MIN_TAR_BYTES,
    });
    const files = readTar(fs.readFileSync(archivePath));
    const readEntry = (target) => entryByBaseName(files, path.posix.basename(target));

    const dumpLogText = readEntry(targets.dumpLog)?.toString("utf8") ?? "";
    assertNoUitestConflict(dumpLogText, "uitest dumpLayout");
    if (!DUMP_SUCCESS_PATTERN.test(dumpLogText)) {
      fail(`uitest dumpLayout failed: ${dumpLogText.trim() || "no output"}`, "UI_DUMP_FAILED");
    }
    const dumpBytes = readEntry(targets.dump);
    if (!dumpBytes || dumpBytes.length === 0) fail("Layout dump came back empty", "UI_DUMP_EMPTY");

    const captured = readCaptureOutcome(readEntry(targets.snapLog)?.toString("utf8") ?? "", deviceId);
    const imageBytes = readEntry(targets.snap);
    let fallbackReason;
    let bytes = 0;
    if (captured.ok && imageBytes && imageBytes.length >= MIN_IMAGE_BYTES
      && imageBytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
      fs.mkdirSync(path.dirname(localImage), { recursive: true });
      fs.writeFileSync(localImage, imageBytes);
      bytes = imageBytes.length;
    } else {
      // The dump is the half that decides where a tap lands, so a missing frame degrades the
      // observation rather than failing it.
      fallbackReason = captured.ok ? "the captured frame did not arrive intact" : captured.reason;
      if (captured.permanent) snapshotUnavailable.set(deviceId, captured.reason);
    }

    fs.writeFileSync(localDump, dumpBytes);
    const analysis = analyseDump({
      root: parseDump(dumpBytes.toString("utf8"), localDump), dumpPath: localDump, deviceId, selector,
    });
    const nativeSize = readDisplaySize(deviceId);
    return {
      ...analysis,
      ...captureReport({
        deviceId,
        method: bytes ? "fused-snapshot_display" : "fused-dump-only",
        localPath: bytes ? localImage : null,
        requestedPath: bytes ? localImage : null,
        fallbackReason,
        isPng: false,
        bytes,
        outputSize: captured.output,
        nativeSize,
        nativeSizeChanged: captured.nativeSizeChanged,
        startedAt,
      }),
      // captureReport rebuilds these from the frame; the analysis values are the authoritative ones.
      dumpPath: analysis.dumpPath,
      deviceId,
    };
  });
}

/**
 * The two-round-trip observation, used when the fused command cannot run.
 *
 * @returns {Promise<object>} Same shape as the fused path.
 */
async function observeSeparately({ hdc, deviceId, timeoutMs, selector, targetWidth, displayId, localImage, startedAt, reason }) {
  const dumpPath = await dumpLayout(hdc, deviceId, timeoutMs);
  const analysis = analyseDump({ root: readDump(dumpPath), dumpPath, deviceId, selector });

  const devicePath = devicePathFor("snap", "jpeg", true);
  const captured = await captureWithSnapshotDisplay(
    hdc, deviceId, devicePath, scaleArguments(readDisplaySize(deviceId), targetWidth), displayId, timeoutMs,
  );
  let bytes = 0;
  if (captured.ok) {
    bytes = await pullArtifact(hdc, deviceId, devicePath, localImage, timeoutMs, {
      emptyCode: "UI_SNAPSHOT_EMPTY", magic: JPEG_MAGIC, minBytes: MIN_IMAGE_BYTES,
    });
  }
  return {
    ...analysis,
    ...captureReport({
      deviceId,
      method: bytes ? "separate-snapshot_display" : "separate-dump-only",
      localPath: bytes ? localImage : null,
      requestedPath: bytes ? localImage : null,
      fallbackReason: reason,
      isPng: false,
      bytes,
      outputSize: captured.ok ? captured.output : null,
      nativeSize: readDisplaySize(deviceId),
      nativeSizeChanged: captured.ok ? captured.nativeSizeChanged : false,
      startedAt,
    }),
    dumpPath: analysis.dumpPath,
    deviceId,
  };
}

async function sendInput(hdc, deviceId, inputArgs, timeoutMs, action) {
  const result = await execHdc(
    [hdc, ...targetArgs(deviceId), "shell", "uitest", "uiInput", ...inputArgs],
    timeoutMs,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertNoUitestConflict(combined, `uitest uiInput ${action}`);
  // uitest reports a successful gesture as the literal string "No Error"; a real failure prints a
  // usage or error line instead. Exit codes say nothing here, as always through `hdc shell`.
  if (!/No Error/i.test(combined)) {
    fail(`uitest uiInput ${action} failed: ${combined.trim() || "no output"}`, "UI_TAP_FAILED");
  }
}

/**
 * Send a touch, gesture, or key event through `uitest uiInput`.
 *
 * A point action may name its target with key/text/type instead of coordinates. That is not just
 * convenience: coordinates go stale. Measured on a real device, (639,541) addressed a home-screen
 * widget before the notification shade was pulled down and `[Dropdown]NotificationListComponent`
 * after it -- same point, different element. Resolving and tapping inside one lock hold shrinks
 * that window from a whole agent turn to a single hdc round trip. It does not close it: the app's
 * own animations are not something any lock can hold still.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} What was sent, so a caller can confirm the coordinates it hit.
 */
export async function uiTap(input = {}) {
  if (!TAP_ACTIONS.has(input.action)) {
    fail(`action must be one of ${[...TAP_ACTIONS].join(", ")}`, "UI_ARGS_INVALID");
  }
  const hdc = requireHdc();
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const deviceId = await resolveDevice(hdc, input.hvd);

  const selector = readSelector(input);
  const aimed = hasSelector(selector) && input.x === undefined && input.y === undefined;
  if (aimed && !POINT_ACTIONS.has(input.action)) {
    fail(
      `${input.action} needs explicit coordinates; only ${[...POINT_ACTIONS].join(", ")} can be aimed by selector`,
      "UI_ARGS_INVALID",
    );
  }

  if (!aimed) {
    const inputArgs = buildInputArgs(input);
    return withUitest(deviceId, `uiInput ${input.action}`, timeoutMs, async () => {
      const startedAt = Date.now();
      await sendInput(hdc, deviceId, inputArgs, timeoutMs, input.action);
      return {
        deviceId,
        action: input.action,
        sent: `uitest uiInput ${inputArgs.join(" ")}`,
        elapsedMs: Date.now() - startedAt,
      };
    });
  }

  sweepStaleArtifacts(hdc, deviceId);
  return withUitest(deviceId, `uiInput ${input.action} by selector`, timeoutMs, async () => {
    const startedAt = Date.now();
    const dumpPath = await dumpLayout(hdc, deviceId, timeoutMs);
    const analysis = analyseDump({ root: readDump(dumpPath), dumpPath, deviceId, selector });
    const target = requireSingleTarget(analysis, selector);

    const inputArgs = [input.action, String(target.center.x), String(target.center.y)];
    await sendInput(hdc, deviceId, inputArgs, timeoutMs, input.action);

    let verified;
    if (input.verify === true) {
      // Opt-in because it doubles the cost: confirming the target is still there afterwards means
      // a second dump, which is the expensive half of the whole operation.
      const after = analyseDump({
        root: readDump(await dumpLayout(hdc, deviceId, timeoutMs)), dumpPath, deviceId, selector,
      });
      verified = { stillPresent: after.matchCount > 0, structureSignature: after.structureSignature };
    }

    return {
      deviceId,
      action: input.action,
      sent: `uitest uiInput ${inputArgs.join(" ")}`,
      target,
      dumpPath,
      structureSignature: analysis.structureSignature,
      verified,
      elapsedMs: Date.now() - startedAt,
    };
  });
}
