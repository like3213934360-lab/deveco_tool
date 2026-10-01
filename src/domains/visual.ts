import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { invariant } from "../core/errors.js";
import { artifactDir, commitArtifact } from "../core/artifacts.js";
import { hdc, shell } from "./device.js";
import { pngGray } from "./ui.js";

/*
 * Screenshot baselines: a small grayscale PNG of the screen (360 px wide: enough to see layout changes,
 * a few KB) is stored per name and device model in <project>/.arkpilot/baselines; later shots are
 * compared block by block. The status bar (top 6 %) and navigation bar (bottom 4 %) are ignored:
 * clock, battery and signal change on every shot.
 */

export interface Gray { width: number; height: number; gray: Uint8Array }

/* ------------------------------- PNG writer ------------------------------- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
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
export function decodeGray(buf: Buffer): Gray | undefined {
  if (buf.length > 25 && buf[25] === 0) {
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
    let offset = 8; const idat: Buffer[] = [];
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset), type = buf.toString("latin1", offset + 4, offset + 8);
      if (type === "IDAT") idat.push(buf.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const gray = new Uint8Array(width * height);
    // encodePng writes filter 0 only.
    for (let y = 0; y < height; y++) gray.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
    return { width, height, gray };
  }
  return pngGray(buf);
}

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
  let changed = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    for (let y = top + r * block; y < Math.min(bottom, top + (r + 1) * block); y++)
      for (let x = c * block; x < Math.min(a.width, (c + 1) * block); x++) { const i = y * a.width + x; sum += Math.abs(a.gray[i]! - b.gray[i]!); n++; }
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
  return { changed_ratio: +(changed / (cols * rows)).toFixed(4), regions };
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

/**
 * Compare the screen with a stored baseline (or store it). mode: "compare" (default; stores the baseline
 * when none exists yet), "update" (overwrite the baseline with the current screen).
 */
export async function visualCheck(target: string, input: { project: string; name: string; update?: boolean; threshold?: number }, device: { model: string; size?: { w: number; h: number } }, signal?: AbortSignal) {
  const file = baselinePath(input.project, input.name, device.model);
  const current = await grayShot(target, device.size, signal);
  if (input.update || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePng(current.width, current.height, current.gray));
    return { baseline: input.update ? "updated" : "created", file, note: "Later calls with this name compare the screen against it" };
  }
  const base = decodeGray(fs.readFileSync(file));
  invariant(base, "VISUAL_BASELINE_INVALID", `Cannot read baseline ${file}`, undefined, "Recreate it with update=true");
  const result = compareGray(base, current, { threshold: input.threshold });
  const same = result.changed_ratio === 0;
  let artifact: string | undefined;
  if (!same) {
    const id = `a_${crypto.randomBytes(8).toString("hex")}`;
    const out = path.join(artifactDir(), `${id}.png`);
    fs.writeFileSync(out, annotate(current, result.regions));
    artifact = (await commitArtifact(id, out, "image/png")).artifact_id;
  }
  const scale = device.size ? device.size.w / current.width : 1;
  return {
    same, changed_ratio: result.changed_ratio,
    // Regions in device pixels (what ui tree bounds use), largest first.
    regions: result.regions.slice(0, 10).map((r) => ({ x: Math.round(r.x * scale), y: Math.round(r.y * scale), w: Math.round(r.w * scale), h: Math.round(r.h * scale) })),
    ...(artifact ? { diff_artifact: artifact, note: "diff_artifact: the current screen with changed areas boxed in red (job action=read)" } : {}),
    baseline: file,
  };
}
