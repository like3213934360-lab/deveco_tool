import { decode } from "jpeg-js";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { startupCheckSchema } from "../core/contracts.js";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import type { Rect } from "./ui-tree.js";

export type StartupPolicy = z.infer<typeof startupCheckSchema>;
export interface StartupFrame {
  artifact_id: string;
  sha256: string;
  uniform: boolean;
  sample_pixels: number;
  dominant_fraction: number;
}
interface StartupIo {
  pids(signal: AbortSignal): Promise<string[]>;
  frame(signal: AbortSignal): Promise<StartupFrame>;
  now?(): number;
  wait?(milliseconds: number, signal: AbortSignal): Promise<void>;
}
export interface ProcessSample {
  elapsed_ms: number;
  pids?: string[];
  code?: string;
}
export interface FrameSample {
  elapsed_ms: number;
  frame?: StartupFrame;
  code?: string;
}
export interface StartupReport {
  format: 1;
  status: "passed" | "failed" | "inconclusive" | "cancelled";
  reason: string;
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  policy: StartupPolicy;
  process: "stable" | "exited" | "restarted" | "unverified";
  screen: "nonuniform" | "uniform" | "unavailable" | "not_applicable";
  business_outcome_verified: false;
  process_samples: ProcessSample[];
  frames: FrameSample[];
}

/** Pixel structure is only a basic blank-screen indicator. Uniform white,
 * black and other solid pages need an explicit contract or client review. */
export function inspectStartupFrame(
  encoded: Buffer,
  native: { width: number; height: number },
  windows: readonly Rect[],
) {
  invariant(
    encoded.length <= 4 * 1024 * 1024 &&
      windows.length > 0 &&
      windows.length <= 32 &&
      [native.width, native.height].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    "STARTUP_FRAME_INVALID",
    "Startup image or application window scope exceeds its limits",
  );
  let image;
  try {
    image = decode(encoded, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
      maxResolutionInMP: 7,
      maxMemoryUsageInMB: 128,
    });
  } catch {
    throw new ToolError(
      "STARTUP_FRAME_INVALID",
      "Startup image could not be decoded within its budget",
    );
  }
  const bins = new Map<number, number>();
  let samples = 0;
  for (const rect of windows) {
    invariant(
      Object.values(rect).every(Number.isFinite),
      "STARTUP_FRAME_INVALID",
      "Invalid application window geometry",
    );
    const left = Math.max(0, Math.ceil((rect.x1 * image.width) / native.width));
    const right = Math.min(
      image.width,
      Math.floor((rect.x2 * image.width) / native.width),
    );
    const top = Math.max(
      0,
      Math.ceil((rect.y1 * image.height) / native.height),
    );
    const bottom = Math.min(
      image.height,
      Math.floor((rect.y2 * image.height) / native.height),
    );
    invariant(
      right > left && bottom > top,
      "STARTUP_FRAME_INVALID",
      "Application window has no captured pixels",
    );
    // At most 32 * 128 * 128 sampled pixels, independent of input resolution.
    const stepX = Math.max(1, Math.ceil((right - left) / 128));
    const stepY = Math.max(1, Math.ceil((bottom - top) / 128));
    for (let y = top; y < bottom; y += stepY)
      for (let x = left; x < right; x += stepX) {
        const at = (y * image.width + x) * 3;
        const bin =
          ((image.data[at]! >> 4) << 8) |
          ((image.data[at + 1]! >> 4) << 4) |
          (image.data[at + 2]! >> 4);
        bins.set(bin, (bins.get(bin) ?? 0) + 1);
        samples++;
      }
  }
  const dominant = Math.max(...bins.values()) / samples;
  return {
    uniform: dominant >= 0.995,
    sample_pixels: samples,
    dominant_fraction: dominant,
  };
}

/** Bounded repeated liveness observations plus app-scoped image checks.
 * Transport errors never mean a live process or a passed screen check. */
export async function checkStartup(
  io: StartupIo,
  policy: StartupPolicy,
  signal: AbortSignal,
  expectedPids?: readonly string[],
): Promise<StartupReport> {
  const now = io.now ?? (() => performance.now());
  const wait =
    io.wait ??
    (async (ms, signal) => {
      await delay(ms, undefined, { signal });
    });
  const began = now(),
    started_at = new Date().toISOString();
  const process_samples: ProcessSample[] = [],
    frames: FrameSample[] = [];
  let original = expectedPids ? [...expectedPids].sort() : undefined;
  let stableSince: number | undefined,
    everSeen = false,
    lastPidOk = false;
  let screen: StartupReport["screen"] =
    policy.mode === "process_only" ? "not_applicable" : "unavailable";
  let nextFrame = policy.stable_ms;
  const finish = (
    status: StartupReport["status"],
    process: StartupReport["process"],
    reason: string,
  ): StartupReport => ({
    format: 1,
    status,
    process,
    reason,
    started_at,
    finished_at: new Date().toISOString(),
    elapsed_ms: Math.max(0, now() - began),
    policy,
    screen,
    business_outcome_verified: false,
    process_samples,
    frames,
  });
  try {
    while (now() - began < policy.timeout_ms && process_samples.length < 128) {
      signal.throwIfAborted();
      let current: string[];
      try {
        current = [...new Set(await io.pids(signal))].sort();
        invariant(
          current.length <= 32 && current.every((pid) => /^\d+$/.test(pid)),
          "STARTUP_PID_UNAVAILABLE",
          "Invalid process identifiers",
        );
        process_samples.push({ elapsed_ms: now() - began, pids: current });
        lastPidOk = true;
      } catch (error) {
        signal.throwIfAborted();
        process_samples.push({
          elapsed_ms: now() - began,
          code: errorResult(error).code,
        });
        stableSince = undefined;
        lastPidOk = false;
        await wait(250, signal);
        continue;
      }
      if (!current.length) {
        if (everSeen || expectedPids?.length)
          return finish(
            "failed",
            "exited",
            "Application process disappeared during the startup observation window",
          );
        stableSince = undefined;
      } else {
        everSeen = true;
        if (original && !original.some((pid) => current.includes(pid)))
          return finish(
            "failed",
            "restarted",
            "Original application process was replaced during startup observation",
          );
        if (
          expectedPids &&
          JSON.stringify(current) !== JSON.stringify(original)
        )
          return finish(
            "failed",
            "restarted",
            "Quickfix requires the original application process set",
          );
        original ??= current;
        stableSince ??= now();
        if (now() - stableSince >= policy.stable_ms) {
          if (policy.mode === "process_only")
            return finish(
              "passed",
              "stable",
              "Process remained observable for the required window; UI is outside the declared headless contract",
            );
          if (frames.length < 3 && now() - began >= nextFrame) {
            try {
              const frame = await io.frame(signal);
              frames.push({ elapsed_ms: now() - began, frame });
              screen = frame.uniform ? "uniform" : "nonuniform";
            } catch (error) {
              signal.throwIfAborted();
              frames.push({
                elapsed_ms: now() - began,
                code: errorResult(error).code,
              });
              screen = "unavailable";
            }
            nextFrame =
              now() -
              began +
              Math.max(
                500,
                (policy.timeout_ms - (now() - began)) /
                  Math.max(1, 3 - frames.length),
              );
            // A frame capture takes time. Observe liveness again before passing.
            if (
              screen === "nonuniform" ||
              (screen === "uniform" && policy.allow_uniform)
            ) {
              await wait(250, signal);
              const after = [...new Set(await io.pids(signal))].sort();
              invariant(
                after.length <= 32 && after.every((pid) => /^\d+$/.test(pid)),
                "STARTUP_PID_UNAVAILABLE",
                "Invalid process identifiers after frame capture",
              );
              process_samples.push({ elapsed_ms: now() - began, pids: after });
              if (!after.length)
                return finish(
                  "failed",
                  "exited",
                  "Application process disappeared during frame capture",
                );
              if (
                !original.some((pid) => after.includes(pid)) ||
                (expectedPids &&
                  JSON.stringify(after) !== JSON.stringify(original))
              )
                return finish(
                  "failed",
                  "restarted",
                  "Application process changed during frame capture",
                );
              return finish(
                "passed",
                "stable",
                screen === "uniform"
                  ? "Stable process and solid screen accepted by the explicit startup contract"
                  : "Stable process and a nonuniform application frame; business UI still requires its own assertion",
              );
            }
          }
        }
      }
      await wait(250, signal);
    }
    return finish(
      "inconclusive",
      lastPidOk &&
        stableSince !== undefined &&
        now() - stableSince >= policy.stable_ms
        ? "stable"
        : "unverified",
      screen === "uniform"
        ? "Persistent solid application frame needs client review or an explicit valid-solid-screen contract"
        : "Startup could not be verified within the bounded observation window",
    );
  } catch (error) {
    return finish(
      signal.aborted ? "cancelled" : "inconclusive",
      "unverified",
      signal.aborted
        ? "Startup observation was interrupted; the accepted launch must not be replayed blindly"
        : `Startup query failed (${errorResult(error).code})`,
    );
  }
}
