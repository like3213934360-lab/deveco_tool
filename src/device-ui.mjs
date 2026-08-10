/**
 * @file Fast device-UI tools that talk to hdc directly: capture, locate, and input.
 * @author deveco-tool
 *
 * CodeGenie already proxies `perform_ui_action` and `get_app_ui_tree`, and both keep working
 * untouched. These three exist beside them because the screenshot-driven loop (capture, find a
 * control, tap it) was paying for three avoidable things, all measured on a real device:
 *
 *   - `uitest screenCap` writes a full-resolution PNG: 1.05s end to end for 5.2MB. The same frame
 *     as JPEG through `snapshot_display` is 0.42s for ~260KB, with no visible loss for UI work.
 *   - Reading tap coordinates off that image costs ~2400 image tokens and is imprecise; a real
 *     estimate landed 40px off a tab centre. `uitest dumpLayout` carries an exact `$rect` per node.
 *   - Every action went through the CodeGenie child, whose handshake intermittently hangs forever
 *     (see src/codegenie-tools.mjs). Anything on that path inherits the stall.
 *
 * Everything here runs over hdc in this process, so the loop keeps working when the child is gone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hdcFailureMessage, requireHdc, resolveDevice, runHdc, targetArgs } from "./hdc-log.mjs";

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

/** Below this, a transferred image is an error string or a truncated write, never a frame. */
const MIN_IMAGE_BYTES = 512;

const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** snapshot_display prints the display's own size before scaling, then what it actually wrote. */
const NATIVE_SIZE_PATTERN = /process:[^\n]*?width:\s*(\d+)[^\n]*?height:\s*(\d+)/i;
const OUTPUT_SIZE_PATTERN = /success:[^\n]*?width:\s*(\d+)[^\n]*?height:\s*(\d+)/i;
const SCREENCAP_SUCCESS_PATTERN = /ScreenCap saved to/i;

/**
 * A device that has no `snapshot_display` at all will never grow one, so that verdict is cached and
 * the probe is never paid again. Anything else is treated as a one-off.
 */
const SNAPSHOT_MISSING_PATTERN = /(not found|inaccessible|no such file|not executable|permission denied)/i;

/**
 * `uitest` is a singleton daemon on the device: two concurrent dumps against one device genuinely
 * fail. Work is chained per device, which also makes the fixed per-process device paths below safe.
 * Different devices never wait on each other.
 */
const deviceQueues = new Map();

/** deviceId -> {width, height}. Refreshed from every capture, so rotating or folding self-heals. */
const nativeSizes = new Map();

/** deviceId -> reason, for devices proven to have no snapshot_display. */
const snapshotUnavailable = new Map();

/** Devices already swept this process; see sweepStaleArtifacts. */
const sweptDevices = new Set();

let snapshotCounter = 0;

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

function sanitizeForPath(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Device-side scratch path. Fixed per process and per kind rather than timestamped: the per-device
 * queue already prevents collisions inside this process, the pid separates two servers, and a fixed
 * name means no `rm` round trip on the hot path. The bounded cost is one JPEG plus one JSON per
 * server process per device, in a directory whose contents are already ephemeral.
 */
function devicePathFor(kind, extension) {
  return `/data/local/tmp/deveco_ui_${process.pid}_${kind}.${extension}`;
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
async function captureWithSnapshotDisplay(hdc, deviceId, devicePath, width, height, displayId, timeoutMs) {
  const args = [hdc, ...targetArgs(deviceId), "shell", "snapshot_display", "-f", devicePath, "-t", "jpeg"];
  // Only pass -i when the caller named a display. Defaulting it to 0 would break every device whose
  // active display is not 0: unfolded foldables, 2-in-1, anything on an external screen.
  if (displayId !== undefined) args.push("-i", String(displayId));
  if (width && height) args.push("-w", String(width), "-h", String(height));

  const result = await execHdc(args, timeoutMs);
  const combined = `${result.stdout}\n${result.stderr}`;
  const native = parseSize(NATIVE_SIZE_PATTERN, combined);
  if (native) nativeSizes.set(deviceId, native);

  if (!/success:/i.test(combined)) {
    return {
      ok: false,
      permanent: SNAPSHOT_MISSING_PATTERN.test(combined),
      reason: combined.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || "snapshot_display produced no success marker",
    };
  }
  return { ok: true, native, output: parseSize(OUTPUT_SIZE_PATTERN, combined) };
}

async function captureWithScreenCap(hdc, deviceId, devicePath, timeoutMs) {
  const result = await execHdc(
    [hdc, ...targetArgs(deviceId), "shell", "uitest", "screenCap", "-p", devicePath],
    timeoutMs,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  if (!SCREENCAP_SUCCESS_PATTERN.test(combined)) {
    fail(`uitest screenCap failed: ${combined.trim() || "no output"}`, "UI_SNAPSHOT_FAILED");
  }
}

/**
 * Capture the device screen and pull it back.
 *
 * Defaults to the display's native size. That is not a compromise: a native JPEG measured 0.42s
 * end to end against 0.44s for a half-width one (the device-side rescale costs about what the
 * smaller transfer saves), and it keeps `coordinateScale` at 1, so no caller can misread a scaled
 * image's pixels as device coordinates. `width` is offered only to cut image tokens.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} Capture report including the local path and coordinate scale.
 */
export async function uiSnapshot(input = {}) {
  const hdc = requireHdc();
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const deviceId = await resolveDevice(hdc, input.hvd);

  const format = input.format === "png" ? "png" : "jpeg";
  const requestedWidth = input.width === undefined || input.width === null ? null : Number(input.width);
  if (requestedWidth !== null && (!Number.isInteger(requestedWidth) || requestedWidth < 64 || requestedWidth > 4096)) {
    fail("width must be an integer between 64 and 4096", "UI_ARGS_INVALID");
  }
  let displayId;
  if (input.displayId !== undefined && input.displayId !== null) {
    displayId = Number(input.displayId);
    if (!Number.isInteger(displayId) || displayId < 0) {
      fail("displayId must be a non-negative integer", "UI_ARGS_INVALID");
    }
  }

  sweepStaleArtifacts(hdc, deviceId);
  return serializePerDevice(deviceId, async () => {
    const startedAt = Date.now();
    const requestedPath = input.localPath
      ? path.resolve(input.localPath)
      : path.join(
        defaultLocalDirectory(deviceId),
        // Snapshots get unique names because a visual loop refers back to earlier frames by path;
        // overwriting would silently rewrite history. Dumps below are the opposite case.
        `snapshot-${startedAt}-${(snapshotCounter += 1)}.${format}`,
      );

    const cachedUnavailable = snapshotUnavailable.get(deviceId);
    // snapshot_display only writes jpeg, so an explicit png request goes straight to screenCap, as
    // does a device already proven not to have the binary.
    const skipSnapshotDisplay = format === "png" || Boolean(cachedUnavailable);
    // null means "not captured yet", which is what routes the screenCap block below. Starting this
    // at "snapshot_display" would make both skip paths fall through that block and then try to pull
    // a jpeg that was never written.
    let method = skipSnapshotDisplay ? null : "snapshot_display";
    let fallbackReason = cachedUnavailable ?? null;
    let localPath = requestedPath;
    let devicePath = devicePathFor("snap", "jpeg");
    let outputSize = null;
    let nativeSize = nativeSizes.get(deviceId) ?? null;

    if (!skipSnapshotDisplay) {
      let width = null;
      let height = null;
      if (requestedWidth !== null) {
        // -w alone does not preserve aspect ratio (a 640 request produced 640x2848), so the height
        // has to be computed, which needs the native size. snapshot_display prints it on every run,
        // so one unscaled capture teaches it; after that this branch is free.
        if (!nativeSize) {
          const probe = await captureWithSnapshotDisplay(
            hdc, deviceId, devicePath, null, null, displayId, timeoutMs,
          );
          if (probe.ok || probe.native) nativeSize = nativeSizes.get(deviceId) ?? null;
        }
        if (nativeSize && nativeSize.width > 0 && requestedWidth < nativeSize.width) {
          width = requestedWidth;
          height = Math.max(1, Math.round((nativeSize.height * requestedWidth) / nativeSize.width));
        }
      }

      const captured = await captureWithSnapshotDisplay(
        hdc, deviceId, devicePath, width, height, displayId, timeoutMs,
      );
      if (captured.ok) {
        nativeSize = captured.native ?? nativeSize;
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
      devicePath = devicePathFor("snap", "png");
      // screenCap writes PNG. Handing back PNG bytes at a .jpeg path would be a lie the caller
      // cannot detect, so the destination moves and both paths are reported.
      localPath = withExtension(requestedPath, "png");
      await captureWithScreenCap(hdc, deviceId, devicePath, timeoutMs);
    }

    const isPng = method === "uitest-screenCap";
    const bytes = await pullArtifact(hdc, deviceId, devicePath, localPath, timeoutMs, {
      emptyCode: "UI_SNAPSHOT_EMPTY",
      magic: isPng ? PNG_MAGIC : JPEG_MAGIC,
      minBytes: MIN_IMAGE_BYTES,
    });

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
      // Multiply a pixel read off this image by this to get device coordinates. Prefer ui_find,
      // which returns device coordinates directly and cannot be off by a scale factor.
      coordinateScale: width && nativeSize?.width ? Number((nativeSize.width / width).toFixed(4)) : 1,
      elapsedMs: Date.now() - startedAt,
    };
  });
}

function attributesOf(node) {
  return node.$attrs ?? node.attributes ?? {};
}

function childrenOf(node) {
  const children = node.$children ?? node.children;
  return Array.isArray(children) ? children : [];
}

/**
 * The addressable label of a node.
 *
 * `description` is last and it is the one that matters in practice: `uitest dumpLayout` puts the
 * accessibility label there, not in `accessibilityText`, which does not exist in either dump shape.
 * An icon-only control -- a back arrow, a mute toggle -- carries no `text` at all, so without this
 * it could not be found by name. Real text still wins wherever a node has both.
 */
function firstText(attributes) {
  for (const key of ["content", "text", "label", "accessibilityText", "description"]) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** Flags arrive as real booleans in one dump shape and as "true"/"false" strings in the other. */
function readFlag(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/**
 * Parse a `$rect` string such as `[604.00, 2689.00],[675.00,2730.00]`.
 *
 * Spacing is inconsistent between fields and values are floats. Inverted corners are normalised
 * rather than rejected, since a swapped pair still describes a real box.
 *
 * @param {unknown} value Raw `$rect`.
 * @returns {{x1: number, y1: number, x2: number, y2: number}|null} Normalised box, or null.
 */
function parseRect(value) {
  if (typeof value !== "string") return null;
  const numbers = value.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 4) return null;
  const parsed = numbers.slice(0, 4).map(Number);
  if (parsed.some((entry) => !Number.isFinite(entry))) return null;
  const [a, b, c, d] = parsed;
  return { x1: Math.min(a, c), y1: Math.min(b, d), x2: Math.max(a, c), y2: Math.max(b, d) };
}

function intersects(box, screen) {
  if (!screen) return true;
  return box.x2 > screen.x1 && box.x1 < screen.x2 && box.y2 > screen.y1 && box.y1 < screen.y2;
}

/**
 * Flatten a uitest layout dump into addressable nodes.
 *
 * There are two shapes in the wild and this has to read both. `uitest dumpLayout`, which is what
 * ui_find runs, emits the accessibility shape: `children` / `attributes`, with `bounds` written as
 * `[372,389][905,1452]` and the component type, key and clickable/visible flags all inside
 * `attributes`. CodeGenie's `get_app_ui_tree full` emits the ArkUI inspector shape instead:
 * `$children` / `$attrs` / `$rect`, with the type at `$type` and text under `content`. A dump saved
 * from either tool can therefore be handed to `dumpPath`, and an array root or the
 * `{ProcessID, ..., content}` wrapper is unwrapped on the way in.
 *
 * @param {unknown} root Parsed dump.
 * @returns {{nodes: object[], screen: object|null}} Nodes in document order plus the screen box.
 */
function flattenDump(root) {
  const nodes = [];
  let screen = null;

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const hasOwnShape = node.$children || node.children || node.$attrs || node.attributes || node.$rect;
    if (!hasOwnShape && node.content && typeof node.content === "object") {
      visit(node.content);
      return;
    }
    const attributes = attributesOf(node);
    const rect = parseRect(node.$rect ?? attributes.bounds ?? attributes.rect);
    // Pre-order, so the first node carrying a box is the outermost one: the screen.
    if (rect && !screen) screen = rect;
    nodes.push({
      id: node.$ID ?? node.id ?? attributes.id ?? null,
      // The inspector shape puts the type on the node; the accessibility shape puts it in attributes.
      type: node.$type ?? node.type ?? attributes.type ?? "",
      text: firstText(attributes),
      key: (typeof attributes.key === "string" && attributes.key)
        || (typeof attributes.id === "string" && attributes.id)
        || null,
      // Only the accessibility shape carries these, and where it does they beat any geometric
      // guess: a node can sit inside the screen box and still be untappable or hidden.
      clickable: readFlag(attributes.clickable),
      enabled: readFlag(attributes.enabled),
      visible: readFlag(attributes.visible),
      rect,
    });
    for (const child of childrenOf(node)) visit(child);
  };

  visit(root);
  return { nodes, screen };
}

function readDump(dumpPath) {
  let raw;
  try {
    raw = fs.readFileSync(dumpPath, "utf8");
  } catch (error) {
    fail(`Layout dump could not be read: ${dumpPath} (${error.message})`, "UI_DUMP_FAILED");
  }
  if (!raw.trim()) fail(`Layout dump is empty: ${dumpPath}`, "UI_DUMP_EMPTY");
  try {
    return JSON.parse(raw);
  } catch (error) {
    // uitest writes plain-text failures into the -p target, so the head of the file is the
    // diagnosis. Without it the caller only learns that JSON.parse was unhappy.
    fail(
      `Layout dump is not valid JSON: ${dumpPath} (${error.message})`,
      "UI_DUMP_PARSE_FAILED",
      raw.slice(0, 200),
    );
  }
  return null;
}

/**
 * Locate on-screen controls and return tap-ready device coordinates.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<object>} Matches with centres, plus the dump path for further digging.
 */
export async function uiFind(input = {}) {
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 200);
  const onScreenOnly = input.onScreenOnly !== false;
  // The text you can see is often a label nested inside the node that actually handles the tap, so
  // being able to ask only for tappable nodes is the difference between a hit and a no-op.
  const clickableOnly = input.clickableOnly === true;
  const wantedText = typeof input.text === "string" && input.text ? input.text.toLowerCase() : null;
  const wantedKey = typeof input.key === "string" && input.key ? input.key : null;
  const wantedType = typeof input.type === "string" && input.type ? input.type.toLowerCase() : null;

  const analyse = (dumpPath, deviceId) => {
    const { nodes, screen } = flattenDump(readDump(dumpPath));
    const matches = [];
    let matchCount = 0;
    for (const node of nodes) {
      if (wantedText && !node.text.toLowerCase().includes(wantedText)) continue;
      if (wantedKey && node.key !== wantedKey) continue;
      if (wantedType && node.type.toLowerCase() !== wantedType) continue;
      // With no selector at all, "everything that shows text" is the useful default; without this
      // the answer would be every layout container on screen. clickableOnly counts as a selector:
      // measured on a real device, a launcher screen carried 35 clickable nodes and not one of them
      // had text -- they are Stack / Flex / FormComponent containers wrapping a label -- so treating
      // it as a mere filter made "list what I can tap" answer 0 every time.
      if (!wantedText && !wantedKey && !wantedType && !clickableOnly && !node.text) continue;
      if (clickableOnly && node.clickable !== true) continue;
      if (!node.rect) continue;
      const hasArea = node.rect.x2 > node.rect.x1 && node.rect.y2 > node.rect.y1;
      // Where the dump states visibility, trust it over the geometry.
      const onScreen = hasArea && intersects(node.rect, screen) && node.visible !== false;
      // Off-screen nodes are in the dump but tapping their centre does nothing, and the caller has
      // no way to tell that apart from a broken tap.
      if (onScreenOnly && !onScreen) continue;
      matchCount += 1;
      if (matches.length >= limit) continue;
      matches.push({
        id: node.id,
        type: node.type,
        text: node.text,
        key: node.key,
        rect: [node.rect.x1, node.rect.y1, node.rect.x2, node.rect.y2],
        center: {
          x: Math.round((node.rect.x1 + node.rect.x2) / 2),
          y: Math.round((node.rect.y1 + node.rect.y2) / 2),
        },
        onScreen,
        clickable: node.clickable ?? undefined,
        enabled: node.enabled ?? undefined,
      });
    }
    return {
      deviceId,
      nodeCount: nodes.length,
      matchCount,
      truncated: matchCount > matches.length,
      dumpPath,
      screen: screen ? [screen.x1, screen.y1, screen.x2, screen.y2] : null,
      matches,
    };
  };

  // Re-parsing a dump the caller already has costs nothing, where dumping again costs ~1.4s. It is
  // opt-in so nobody gets a stale tree by accident, and it makes this whole path device-free.
  if (typeof input.dumpPath === "string" && input.dumpPath) {
    return analyse(path.resolve(input.dumpPath), null);
  }

  const hdc = requireHdc();
  const deviceId = await resolveDevice(hdc, input.hvd);
  sweepStaleArtifacts(hdc, deviceId);
  return serializePerDevice(deviceId, async () => {
    const devicePath = devicePathFor("dump", "json");
    const result = await execHdc(
      [hdc, ...targetArgs(deviceId), "shell", "uitest", "dumpLayout", "-p", devicePath],
      timeoutMs,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    if (!/DumpLayout saved to/i.test(combined)) {
      fail(`uitest dumpLayout failed: ${combined.trim() || "no output"}`, "UI_DUMP_FAILED");
    }
    // Stable name, overwritten every call: unlike a screenshot, a stale layout is actively harmful,
    // and dumpPath only has to stay valid until the next dump.
    const localPath = path.join(defaultLocalDirectory(deviceId), "layout.json");
    await pullArtifact(hdc, deviceId, devicePath, localPath, timeoutMs, { emptyCode: "UI_DUMP_EMPTY" });
    return analyse(localPath, deviceId);
  });
}

const TAP_ACTIONS = new Set([
  "click", "doubleClick", "longClick", "swipe", "dircFling", "inputText", "keyEvent",
]);

/**
 * `hdc shell a b c` joins its arguments into one command line and wraps any argument containing
 * whitespace in double quotes of its own, so what the device shell finally parses depends on
 * whether the text has a space in it. Both regimes were measured on a real device:
 *
 *   - No whitespace: the argument is passed through untouched, so a single-quoted form is unquoted
 *     by the device shell exactly once and everything inside arrives literally. Backtick, $, ~, ;,
 *     |, >, ", parentheses and globs were each confirmed inert this way.
 *   - Whitespace: hdc's own double quotes already make parentheses, globs, #, ~ and ; inert, but
 *     $, a backtick and a backslash stay live inside them, and a double quote closes the wrapper
 *     outright -- `a" ; id ; "b` ran id. Our own quoting cannot help in this regime: it lands
 *     inside hdc's quotes and reaches the input field as literal characters nobody typed.
 *
 * Hence: quote whatever has no whitespace and accept it whatever it contains, and screen the rest
 * for exactly the four characters that survive. This replaced an allowlist of permitted characters,
 * which had the two failures such a list tends to have -- it passed `(` and `)`, which are a hard
 * `/bin/sh: syntax error` in the first regime, and it rejected every CJK punctuation mark, since
 * `，` and `。` are in neither \p{L}, \p{M} nor \p{N}.
 */
const ACTIVE_INSIDE_HDC_QUOTES = /["$`\\]/;

/** uiInput cannot type these, and a newline would end the command line hdc builds. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Render text as one argv element that reaches `uitest uiInput` unchanged.
 *
 * @param {string} text Text the caller wants typed.
 * @returns {string} The argument to pass, quoted where quoting is what protects it.
 */
function deviceTextArgument(text) {
  if (CONTROL_CHARACTERS.test(text)) {
    fail("text may not contain control characters", "UI_ARGS_INVALID");
  }
  if (!/\s/.test(text)) {
    // The standard sh idiom for a single quote inside a single-quoted string: close, escape, reopen.
    // It introduces no whitespace, so the result stays in the regime where quoting works at all.
    return `'${text.split("'").join("'\\''")}'`;
  }
  if (ACTIVE_INSIDE_HDC_QUOTES.test(text)) {
    fail(
      "text mixes whitespace with a character the device shell still expands inside hdc's quoting",
      "UI_ARGS_INVALID",
      'Remove the " $ ` or \\, remove the spaces, or use perform_ui_action for this text.',
    );
  }
  return text;
}

function requireCoordinate(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`${name} must be a non-negative integer`, "UI_ARGS_INVALID");
  }
  return parsed;
}

function buildInputArgs(input) {
  const action = input.action;
  if (action === "click" || action === "doubleClick" || action === "longClick") {
    return [action, String(requireCoordinate(input.x, "x")), String(requireCoordinate(input.y, "y"))];
  }
  if (action === "swipe") {
    const args = [
      "swipe",
      String(requireCoordinate(input.x, "x")),
      String(requireCoordinate(input.y, "y")),
      String(requireCoordinate(input.x2, "x2")),
      String(requireCoordinate(input.y2, "y2")),
    ];
    if (input.velocity !== undefined && input.velocity !== null) {
      args.push(String(requireCoordinate(input.velocity, "velocity")));
    }
    return args;
  }
  if (action === "dircFling") {
    const direction = Number(input.direction);
    if (![0, 1, 2, 3].includes(direction)) {
      fail("direction must be 0 (left), 1 (right), 2 (toward the top), or 3 (toward the bottom)", "UI_ARGS_INVALID");
    }
    const args = ["dircFling", String(direction)];
    if (input.velocity !== undefined && input.velocity !== null) {
      args.push(String(requireCoordinate(input.velocity, "velocity")));
    }
    if (input.stepLength !== undefined && input.stepLength !== null) {
      args.push(String(requireCoordinate(input.stepLength, "stepLength")));
    }
    return args;
  }
  if (action === "inputText") {
    const text = typeof input.text === "string" ? input.text : "";
    if (!text) fail("text is required for inputText", "UI_ARGS_INVALID");
    return [
      "inputText",
      String(requireCoordinate(input.x, "x")),
      String(requireCoordinate(input.y, "y")),
      deviceTextArgument(text),
    ];
  }
  const keys = [input.key1, input.key2, input.key3]
    .filter((entry) => entry !== undefined && entry !== null && String(entry).trim())
    .map((entry) => String(entry).trim());
  if (!keys.length) fail("key1 is required for keyEvent", "UI_ARGS_INVALID");
  if (keys.some((entry) => !/^[A-Za-z0-9_]+$/.test(entry))) {
    fail("key names may only contain letters, digits, and underscores", "UI_ARGS_INVALID");
  }
  return ["keyEvent", ...keys];
}

/**
 * Send a touch, gesture, or key event through `uitest uiInput`.
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
  const inputArgs = buildInputArgs(input);

  return serializePerDevice(deviceId, async () => {
    const startedAt = Date.now();
    const result = await execHdc(
      [hdc, ...targetArgs(deviceId), "shell", "uitest", "uiInput", ...inputArgs],
      timeoutMs,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    // uitest reports a successful gesture as the literal string "No Error"; a real failure prints a
    // usage or error line instead. Exit codes say nothing here, as always through `hdc shell`.
    if (!/No Error/i.test(combined)) {
      fail(`uitest uiInput ${input.action} failed: ${combined.trim() || "no output"}`, "UI_TAP_FAILED");
    }
    return {
      deviceId,
      action: input.action,
      sent: `uitest uiInput ${inputArgs.join(" ")}`,
      elapsedMs: Date.now() - startedAt,
    };
  });
}
