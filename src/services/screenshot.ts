import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { invariant } from "../core/errors.js";
import { screenshotOptionsSchema } from "../core/contracts.js";
import { StateStore } from "../core/store.js";
import type { ProcessResult } from "../core/process.js";

interface Size {
  width: number;
  height: number;
}
interface CaptureIo {
  shell(
    target: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ProcessResult>;
  command(args: string[], signal?: AbortSignal): Promise<ProcessResult>;
}
const maximumBytes = 32 * 1024 * 1024;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Bounded header/terminator checks; this does not decode image pixels. */
export function imageDimensions(
  prefix: Buffer,
  suffix: Buffer,
  format: "png" | "jpeg",
): Size {
  if (format === "png") {
    invariant(
      prefix.length >= 33 &&
        prefix.subarray(0, 8).equals(png) &&
        prefix.readUInt32BE(8) === 13 &&
        prefix.toString("ascii", 12, 16) === "IHDR" &&
        suffix
          .subarray(-12)
          .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])),
      "SCREENSHOT_INVALID",
      "Screenshot has an invalid PNG header or completion marker",
    );
    return validSize(prefix.readUInt32BE(16), prefix.readUInt32BE(20));
  }
  invariant(
    prefix[0] === 255 &&
      prefix[1] === 216 &&
      suffix.at(-2) === 255 &&
      suffix.at(-1) === 217,
    "SCREENSHOT_INVALID",
    "Screenshot has an invalid JPEG header or completion marker",
  );
  let offset = 2;
  while (offset + 4 <= prefix.length) {
    invariant(
      prefix[offset++] === 255,
      "SCREENSHOT_INVALID",
      "Invalid JPEG segment marker",
    );
    while (prefix[offset] === 255) offset++;
    const marker = prefix[offset++]!;
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    invariant(
      offset + 2 <= prefix.length,
      "SCREENSHOT_INVALID",
      "Truncated JPEG segment length",
    );
    const length = prefix.readUInt16BE(offset);
    invariant(
      length >= 2 && offset + length <= prefix.length,
      "SCREENSHOT_INVALID",
      "Truncated or oversized JPEG metadata",
    );
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      invariant(
        length >= 8,
        "SCREENSHOT_INVALID",
        "Truncated JPEG frame header",
      );
      return validSize(
        prefix.readUInt16BE(offset + 5),
        prefix.readUInt16BE(offset + 3),
      );
    }
    offset += length;
  }
  invariant(
    false,
    "SCREENSHOT_INVALID",
    "No JPEG dimensions in the bounded 64 KiB header",
  );
}
function validSize(width: number, height: number): Size {
  invariant(
    width > 0 &&
      height > 0 &&
      width <= 32768 &&
      height <= 32768 &&
      width * height <= 100_000_000,
    "SCREENSHOT_INVALID",
    "Screenshot dimensions exceed supported limits",
  );
  return { width, height };
}
export function screenshotSize(
  native: Size,
  format: "png" | "jpeg",
  width?: number,
): Size {
  if (width !== undefined)
    return validSize(
      width,
      Math.max(1, Math.round((native.height * width) / native.width)),
    );
  const scale =
    format === "jpeg"
      ? Math.min(1, 2576 / Math.max(native.width, native.height))
      : 1;
  return validSize(
    Math.max(1, Math.round(native.width * scale)),
    Math.max(1, Math.round(native.height * scale)),
  );
}
function reportedSize(output: string, kind: "process" | "success"): Size {
  const match = new RegExp(
    `${kind}:[^\\r\\n]*?width:\\s*(\\d+)[^\\r\\n]*?height:\\s*(\\d+)`,
    "i",
  ).exec(output);
  invariant(
    match,
    "SCREENSHOT_RECEIPT_INVALID",
    `Screenshot component did not report ${kind} dimensions`,
  );
  return validSize(Number(match[1]), Number(match[2]));
}
export class ScreenshotService {
  private readonly sizes = new Map<string, { size: Size; time: number }>();
  constructor(
    readonly store: StateStore,
    readonly io: CaptureIo,
  ) {}
  close() {
    this.sizes.clear();
  }
  async capture(target: string, raw: unknown = {}, signal?: AbortSignal) {
    const input = screenshotOptionsSchema.parse(raw);
    return this.store.lease(
      `device:${target}`,
      async () => {
        const key = JSON.stringify([target, input.display_id ?? null]),
          cached = this.sizes.get(key),
          remote = `/data/local/tmp/deveco-${randomUUID()}.${input.format}`;
        let desired =
          cached && Date.now() - cached.time < 30000
            ? screenshotSize(cached.size, input.format, input.width)
            : undefined;
        let stream: ReturnType<StateStore["streamArtifact"]> | undefined;
        try {
          let native: Size | undefined, output: Size | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            const args = ["snapshot_display", "-f", remote, "-t", input.format];
            if (input.display_id !== undefined)
              args.push("-i", String(input.display_id));
            if (desired)
              args.push(
                "-w",
                String(desired.width),
                "-h",
                String(desired.height),
              );
            const result = await this.io.shell(target, args, signal);
            native = reportedSize(result.stdout, "process");
            output = reportedSize(result.stdout, "success");
            desired = screenshotSize(native, input.format, input.width);
            if (
              desired.width === output.width &&
              desired.height === output.height
            )
              break;
            invariant(
              attempt < 2,
              "SCREENSHOT_SIZE_UNSTABLE",
              "Display changed repeatedly or the component ignored capture dimensions",
            );
          }
          invariant(
            native && output,
            "SCREENSHOT_RECEIPT_INVALID",
            "Missing capture dimensions",
          );
          this.sizes.delete(key);
          if (this.sizes.size >= 16)
            this.sizes.delete(this.sizes.keys().next().value!);
          this.sizes.set(key, { size: native, time: Date.now() });
          const sizeReceipt = await this.io.shell(
              target,
              ["stat", "-c", "%s", remote],
              signal,
            ),
            bytes = Number(sizeReceipt.stdout.trim());
          invariant(
            /^\d+$/.test(sizeReceipt.stdout.trim()) &&
              Number.isSafeInteger(bytes) &&
              bytes > 0 &&
              bytes <= maximumBytes,
            "SCREENSHOT_SIZE_INVALID",
            "Missing, empty or oversized screenshot (maximum 32 MiB)",
          );
          const mime = `image/${input.format}`;
          stream = this.store.streamArtifact("ui", mime);
          stream.reserve(bytes);
          await this.io.command(
            ["-t", target, "file", "recv", remote, stream.file],
            signal,
          );
          const file = await fs.open(
            stream.file,
            // Windows FlushFileBuffers requires a handle opened for writing.
            // Verification and durability use the same existing-file handle.
            constants.O_RDWR | constants.O_NONBLOCK,
          );
          let sha256: string;
          try {
            const before = await file.stat();
            invariant(
              before.isFile() && before.size === bytes,
              "SCREENSHOT_SIZE_INVALID",
              "Transferred screenshot differs from its size receipt",
            );
            const buffer = Buffer.allocUnsafe(65536),
              hash = createHash("sha256");
            let offset = 0,
              prefix = Buffer.alloc(0),
              suffix = Buffer.alloc(0);
            while (offset < bytes) {
              signal?.throwIfAborted();
              const part = await file.read(
                buffer,
                0,
                Math.min(buffer.length, bytes - offset),
                offset,
              );
              invariant(
                part.bytesRead > 0,
                "SCREENSHOT_INVALID",
                "Screenshot was truncated during verification",
              );
              const chunk = buffer.subarray(0, part.bytesRead);
              hash.update(chunk);
              if (prefix.length < 65536)
                prefix = Buffer.concat([
                  prefix,
                  chunk.subarray(0, 65536 - prefix.length),
                ]);
              suffix = Buffer.from(
                Buffer.concat([suffix, chunk]).subarray(-12),
              );
              offset += part.bytesRead;
            }
            const after = await file.stat(),
              dimensions = imageDimensions(prefix, suffix, input.format);
            invariant(
              after.size === before.size &&
                after.mtimeMs === before.mtimeMs &&
                after.ctimeMs === before.ctimeMs &&
                dimensions.width === output.width &&
                dimensions.height === output.height,
              "SCREENSHOT_INVALID",
              "Screenshot changed or its encoded dimensions differ from the component receipt",
            );
            sha256 = hash.digest("hex");
            await file.chmod(0o600);
            await file.sync();
          } finally {
            await file.close();
          }
          signal?.throwIfAborted();
          const frame_signature = createHash("sha256")
              .update(
                JSON.stringify({
                  target,
                  display: input.display_id ?? null,
                  native,
                  output,
                  sha256,
                }),
              )
              .digest("hex"),
            unchanged = frame_signature === input.if_changed_from;
          const artifact = unchanged ? undefined : stream.finish();
          if (unchanged) stream.discard();
          return {
            target,
            display_id: input.display_id ?? null,
            format: input.format,
            mime,
            bytes,
            ...output,
            native_width: native.width,
            native_height: native.height,
            coordinate_scale: {
              x: native.width / output.width,
              y: native.height / output.height,
            },
            sha256,
            frame_signature,
            unchanged,
            ...(artifact ? { artifact } : {}),
          };
        } catch (error) {
          stream?.discard();
          throw error;
        } finally {
          await this.io
            .shell(target, ["rm", "-f", remote], undefined, 5000)
            .catch(() => {});
        }
      },
      signal,
    );
  }
}
