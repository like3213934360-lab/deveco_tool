import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { invariant } from "../core/errors.js";
import { artifactDir, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { atomicWrite, fileSnapshot, sha256 } from "../core/files.js";
import { assertConnected, hdc, shell } from "./device.js";
import { run } from "../core/proc.js";
import { pngGray } from "./ui.js";

/*
 * Screenshot baselines: a small grayscale PNG of the screen (360 px wide: enough to see layout changes,
 * a few KB) is stored per name and device model in <project>/.arkpilot/baselines; later shots are
 * compared block by block. The status bar (top 6 %) and navigation bar (bottom 4 %) are ignored:
 * clock, battery and signal change on every shot.
 */

export interface Gray { width: number; height: number; gray: Uint8Array }

/* ------------------------------- PNG writer ------------------------------- */

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** Encode 8-bit grayscale (channels=1) or RGB (channels=3) pixels as PNG. Pure. */
export function encodePng(width: number, height: number, pixels: Uint8Array, channels: 1 | 3 = 1) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 1 ? 0 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Decode a grayscale PNG written by encodePng (color type 0) or an RGB/RGBA one (pngGray). */
export const decodeGray = pngGray;

/* ------------------------------- comparison ------------------------------- */

export interface Region { x: number; y: number; w: number; h: number }

/**
 * Block comparison (block x block pixels): a block differs when its mean absolute difference exceeds
 * `threshold` gray levels (anti-aliasing and JPEG-like noise stay well below 8). Adjacent differing
 * blocks are merged into rectangles. Pure.
 */
export function compareGray(a: Gray, b: Gray, options: { block?: number; threshold?: number; top?: number; bottom?: number } = {}) {
  invariant(a.width === b.width && a.height === b.height, "VISUAL_SIZE_MISMATCH", `Screens differ in size (${a.width}x${a.height} vs ${b.width}x${b.height})`,
    undefined, "Compare shots of the same device and orientation, or save a new baseline");
  const block = options.block ?? 12, threshold = options.threshold ?? 8;
  const top = Math.floor(a.height * (options.top ?? 0.06)), bottom = Math.floor(a.height * (1 - (options.bottom ?? 0.04)));
  const cols = Math.ceil(a.width / block), rows = Math.ceil((bottom - top) / block);
  const diff = new Uint8Array(cols * rows);
  // Per-block mean difference (signed) first: a uniform shift of most blocks is a brightness/dimming
  // or overlay change of the whole screen, not a layout change.
  const signed = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    for (let y = top + r * block; y < Math.min(bottom, top + (r + 1) * block); y++)
      for (let x = c * block; x < Math.min(a.width, (c + 1) * block); x++) { const i = y * a.width + x; sum += b.gray[i]! - a.gray[i]!; n++; }
    signed[r * cols + c] = n ? sum / n : 0;
  }
  const sorted = Array.from(signed).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  // 75 %: a real change (a moved card, a new banner) may occupy the rest while the screen is dimmed.
  const near = sorted.filter((v) => Math.abs(v - median) <= threshold).length / Math.max(1, sorted.length);
  const globalShift = Math.abs(median) > threshold && near >= 0.75 ? Math.round(median) : 0;
  let changed = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    for (let y = top + r * block; y < Math.min(bottom, top + (r + 1) * block); y++)
      for (let x = c * block; x < Math.min(a.width, (c + 1) * block); x++) { const i = y * a.width + x; sum += Math.abs(b.gray[i]! - a.gray[i]! - globalShift); n++; }
    if (n && sum / n > threshold) { diff[r * cols + c] = 1; changed++; }
  }
  // Merge 8-connected differing blocks into bounding boxes (flood fill).
  const seen = new Uint8Array(cols * rows);
  const regions: Region[] = [];
  for (let i = 0; i < diff.length; i++) {
    if (!diff[i] || seen[i]) continue;
    let minC = cols, maxC = 0, minR = rows, maxR = 0;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!; const r = Math.floor(k / cols), c = k % cols;
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc, kk = rr * cols + cc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && diff[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    regions.push({ x: minC * block, y: top + minR * block, w: Math.min(a.width, (maxC + 1) * block) - minC * block, h: Math.min(bottom, top + (maxR + 1) * block) - (top + minR * block) });
  }
  regions.sort((p, q) => q.w * q.h - p.w * p.h);
  return { changed_ratio: +(changed / (cols * rows)).toFixed(4), regions, ...(globalShift ? { global_shift: true, brightness_delta: globalShift } : {}) };
}

/** The new shot in gray with the changed regions outlined in red (RGB PNG). Pure. */
export function annotate(img: Gray, regions: Region[]) {
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.gray.length; i++) { const g = Math.round(img.gray[i]! * 0.7); rgb[i * 3] = g; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = g; }
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 3; rgb[i] = 255; rgb[i + 1] = 0; rgb[i + 2] = 0;
  };
  for (const r of regions) for (let t = 0; t < 2; t++) {
    for (let x = r.x; x < r.x + r.w; x++) { set(x, r.y + t); set(x, r.y + r.h - 1 - t); }
    for (let y = r.y; y < r.y + r.h; y++) { set(r.x + t, y); set(r.x + r.w - 1 - t, y); }
  }
  return encodePng(img.width, img.height, rgb, 3);
}

/* ------------------------------- device side ------------------------------- */

const WIDTH = 360;

/** A small PNG shot decoded to gray (snapshot_display scales on the device). */
export async function grayShot(target: string, size: { w: number; h: number } | undefined, signal?: AbortSignal): Promise<Gray> {
  const remote = `/data/local/tmp/deveco-vis-${crypto.randomBytes(4).toString("hex")}.png`;
  const local = path.join(artifactDir(), `vis-${crypto.randomBytes(4).toString("hex")}.png`);
  try {
    const h = size ? Math.round((size.h * WIDTH) / size.w) : 800;
    const shot = await shell(target, ["snapshot_display", "-f", remote, "-t", "png", "-w", String(WIDTH), "-h", String(h)], signal, 20000);
    if (!/success/i.test(shot.stdout)) await assertConnected(target, signal);
    invariant(/success/i.test(shot.stdout), "SCREENSHOT_FAILED", `snapshot_display failed: ${shot.stdout.trim().slice(0, 200)}`, undefined, "Wake and unlock the device");
    await hdc(["-t", target, "file", "recv", remote, local], signal, 20000, true);
    const img = fs.existsSync(local) ? pngGray(fs.readFileSync(local)) : undefined;
    invariant(img, "SCREENSHOT_FAILED", "Could not decode the screenshot");
    return img;
  } finally {
    fs.rmSync(local, { force: true });
    await shell(target, ["rm", "-f", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
}

export function baselinePath(project: string, name: string, model: string) {
  invariant(/^[\w.-]{1,64}$/.test(name), "INVALID_INPUT", "baseline name: letters, digits, . _ - (max 64)");
  return path.join(path.resolve(project), ".arkpilot", "baselines", `${name}@${model.replace(/[^\w.-]+/g, "_")}.png`);
}

function visualInput(file: string, field: "reference_image" | "candidate_image") {
  const stat = path.isAbsolute(file) && fs.statSync(file, { throwIfNoEntry: false });
  invariant(stat && stat.isFile() && stat.size <= 16 * 1024 * 1024, "INVALID_INPUT", `${field} must be an existing absolute PNG path (max 16 MiB)`);
  const snapshot = fileSnapshot(fs.realpathSync(file), 16 * 1024 * 1024);
  invariant(snapshot, "INVALID_INPUT", `${field} disappeared before comparison`);
  const { bytes } = snapshot, image = decodeGray(bytes);
  invariant(image, "INVALID_INPUT", `${field} must be a decodable 8-bit PNG within four million pixels`);
  return { bytes, image };
}

type VisualOptions = { threshold?: number; context?: string };
async function compareReference({ bytes, image: reference }: ReturnType<typeof visualInput>, current: Gray, options: VisualOptions, candidate?: Buffer) {
  invariant(Math.abs(reference.height * current.width / reference.width - current.height) <= 1,
    "VISUAL_SIZE_MISMATCH", "Reference and candidate must have the same aspect ratio", { reference: [reference.width, reference.height], captured: [current.width, current.height] });
  const { width, height } = current, gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.floor((x + 0.5) * reference.width / width);
    const sourceY = Math.floor((y + 0.5) * reference.height / height);
    gray[y * width + x] = reference.gray[sourceY * reference.width + sourceX]!;
  }
  const diff = compareGray({ width, height, gray }, current, { threshold: options.threshold });
  return {
    ...diff, regions: diff.regions.slice(0, 10), same: diff.changed_ratio === 0 && !diff.global_shift, method: "gray-block-v1", context: options.context,
    reference_sha256: sha256(bytes),
    reference_artifact: (await saveArtifact(bytes, "image/png")).artifact_id,
    ...(candidate ? { candidate_sha256: sha256(candidate) } : {}),
    captured_artifact: (await saveArtifact(candidate ?? encodePng(width, height, current.gray), "image/png")).artifact_id,
    ...((diff.changed_ratio || diff.global_shift) ? { diff_artifact: (await saveArtifact(annotate(current, diff.regions), "image/png")).artifact_id } : {}),
  };
}

export async function visualFiles(reference: string, candidate: string, options: VisualOptions & { score_script?: string }, signal: AbortSignal) {
  signal.throwIfAborted();
  const current = visualInput(candidate, "candidate_image"), expected = visualInput(reference, "reference_image");
  if (options.score_script === undefined) return compareReference(expected, current.image, options, current.bytes);
  invariant(!options.context && options.threshold === undefined && path.isAbsolute(options.score_script), "INVALID_INPUT", "Scoring needs an absolute upstream ui_score.py path and no gray-diff options");
  const script = fileSnapshot(options.score_script, 128 * 1024);
  const digest = "70862380c9b6e94404144046d78064cb98d12d86f51c9bb7978102c66f6143d4";
  invariant(script && sha256(script.bytes) === digest, "CAPABILITY_UNAVAILABLE", "Supply the pinned DevEco UI scorer", { sha256: digest });
  const normalizedHeight = Math.round(current.bytes.readUInt32BE(20) * expected.bytes.readUInt32BE(16) / current.bytes.readUInt32BE(16));
  invariant(normalizedHeight * expected.bytes.readUInt32BE(16) <= 4000000, "INVALID_INPUT", "Resized candidate exceeds four million pixels");
  const dir = fs.mkdtempSync(path.join(artifactDir(), "visual-score-"));
  try {
    const scripts = path.join(dir, "engine/references/capabilities/score/scripts");
    fs.mkdirSync(scripts, { recursive: true });
    const scorer = path.join(scripts, "ui_score.py"), ref = path.join(dir, "reference.png"), actual = path.join(dir, "candidate.png"), out = path.join(dir, "out");
    fs.writeFileSync(scorer, script.bytes); fs.writeFileSync(ref, expected.bytes); fs.writeFileSync(actual, current.bytes);
    await run({ file: process.platform === "win32" ? "python" : "python3", args: ["-I", scorer, ref, actual, "--out", out], cwd: dir }, { signal, timeoutMs: 45000 });
    const result = fileSnapshot(path.join(out, "score.json"), 1024 * 1024);
    invariant(result, "EVIDENCE_MISSING", "Scorer did not create score.json");
    const data = JSON.parse(result.bytes.toString("utf8")), score = data.aggregate?.final_baseline_score;
    invariant(data.pair_count === 1 && Number.isFinite(score) && score >= 0 && score <= 100, "EVIDENCE_MISSING", "Scorer did not return one image-pair score");
    return { method: "deveco-ui-score", scorer_sha256: digest, reference_sha256: sha256(expected.bytes), candidate_sha256: sha256(current.bytes),
      score, metrics: data.aggregate, ignored_top_px: data.ignored_top_status_px, ignored_bottom_px: data.ignored_bottom_system_px };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Compare an explicitly selected design PNG against a fresh device screenshot. */
export async function visualReference(target: string, file: string, size: { w: number; h: number } | undefined, options: VisualOptions, signal: AbortSignal) {
  const reference = visualInput(file, "reference_image");
  return compareReference(reference, await grayShot(target, size, signal), options);
}

/**
 * Compare the screen with a stored baseline (or store it). mode: "compare" (default; stores the baseline
 * when none exists yet), "update" (overwrite the baseline with the current screen).
 */
export async function visualCheck(target: string, input: { project: string; name: string; update?: boolean; require_baseline?: boolean; threshold?: number; context?: string }, device: { model: string; size?: { w: number; h: number }; os?: string; api?: number }, signal?: AbortSignal) {
  const file = baselinePath(input.project, input.name, device.model);
  invariant(!input.require_baseline || fs.existsSync(file), "BASELINE_MISSING", `Missing visual baseline ${file}`);
  const { inspectProject } = await import("./project.js");
  const p = inspectProject(input.project);
  const context = { model: device.model, size: device.size, os: device.os, api: device.api, compile_sdk: p.compileSdk, product: p.product, scenario: input.context, method: "gray-block-v1", threshold: input.threshold ?? 8 };
  const metadata = `${file}.json`, identity = sha256(JSON.stringify(context));
  if (input.require_baseline) {
    invariant(fs.existsSync(metadata), "BASELINE_INCOMPATIBLE", "Visual baseline lacks environment metadata; record and review a new baseline");
    invariant(JSON.parse(fs.readFileSync(metadata, "utf8")).identity === identity && JSON.parse(fs.readFileSync(metadata, "utf8")).image_sha256 === sha256(fs.readFileSync(file)), "BASELINE_INCOMPATIBLE", "Visual baseline device/SDK/method/scenario differs", { file });
  }
  const current = await grayShot(target, device.size, signal);
  if (input.update || !fs.existsSync(file)) {
    atomicWrite(file, encodePng(current.width, current.height, current.gray));
    atomicWrite(metadata, JSON.stringify({ schema: 1, identity, context, image_sha256: sha256(fs.readFileSync(file)) }, null, 2));
    return { baseline: input.update ? "updated" : "created", file, baseline_artifact: (await saveArtifact(fs.readFileSync(file), "image/png")).artifact_id, context, note: "Later calls with this name compare the screen against it" };
  }
  const base = decodeGray(fs.readFileSync(file));
  invariant(base, "VISUAL_BASELINE_INVALID", `Cannot read baseline ${file}`, undefined, "Recreate it with update=true");
  const result = compareGray(base, current, { threshold: input.threshold });
  const same = result.changed_ratio === 0;
  let artifact: string | undefined, currentArtifact: string | undefined;
  if (!same) {
    const id = `a_${crypto.randomBytes(8).toString("hex")}`;
    const out = path.join(artifactDir(), `${id}.png`);
    fs.writeFileSync(out, annotate(current, result.regions));
    artifact = (await commitArtifact(id, out, "image/png")).artifact_id;
  }
  const captured = (await saveArtifact(encodePng(current.width, current.height, current.gray), "image/png")).artifact_id;
  if (result.changed_ratio > 0.5 || result.global_shift) currentArtifact = captured;
  const scale = device.size ? device.size.w / current.width : 1;
  return {
    same, changed_ratio: result.changed_ratio,
    baseline_artifact: (await saveArtifact(fs.readFileSync(file), "image/png")).artifact_id,
    captured_artifact: captured,
    context,
    ...(result.global_shift ? { global_shift: true, brightness_delta: result.brightness_delta, note_global: "The whole screen got uniformly brighter/darker (dimming, night mode, a translucent overlay): compared after removing that shift" } : {}),
    ...(currentArtifact ? { current_artifact: currentArtifact } : {}),
    // Regions in device pixels (what ui tree bounds use), largest first.
    regions: result.regions.slice(0, 10).map((r) => ({ x: Math.round(r.x * scale), y: Math.round(r.y * scale), w: Math.round(r.w * scale), h: Math.round(r.h * scale) })),
    ...(artifact ? { diff_artifact: artifact, note: "diff_artifact: the current screen with changed areas boxed in red (job action=read)" } : {}),
    baseline: file,
  };
}
