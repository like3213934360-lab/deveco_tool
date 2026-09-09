import fs from "node:fs";
import path from "node:path";
import { resourceRoot } from "../core/config.js";
import { withinDeadline } from "../core/deadline.js";
import { errorResult, invariant } from "../core/errors.js";
import type { ProcessResult } from "../core/process.js";
import type { DeviceService } from "./device.js";
import { textComponent } from "./text-component.js";

function scalar(result: ProcessResult, pattern: RegExp) {
  invariant(
    !result.truncated &&
      result.exitCode === 0 &&
      pattern.test(result.stdout.trim()),
    "UI_DRIVER_PROBE_INVALID",
    "Driver probe needs a complete successful scalar response",
  );
  return result.stdout.trim();
}

export async function inspectUiDriver(
  device: DeviceService,
  target?: string,
  signal?: AbortSignal,
) {
  const base = {
    backend: "hdc-uitest",
    target: target ?? null,
    architecture: null as string | null,
    uitest_version: null as string | null,
    operation_verified: false,
    text_input: {
      status: "not_probed",
      component: null as string | null,
      endpoint: null as string | null,
      error: null as ReturnType<typeof errorResult> | null,
    },
  };
  if (!target) return { ...base, status: "not_probed", error: null };
  try {
    return await withinDeadline(
      10000,
      signal,
      "UI_DRIVER_PROBE_TIMEOUT",
      async (probeSignal) => {
        const selected = await device.target(target, probeSignal);
        return device.store.lease(
          `device:${selected}`,
          async () => {
            base.architecture = scalar(
              await device.shell(selected, ["uname", "-m"], probeSignal),
              /^[A-Za-z0-9_-]{1,64}$/,
            );
            base.uitest_version = scalar(
              await device.shell(
                selected,
                ["uitest", "--version"],
                probeSignal,
              ),
              /^\d{1,8}\.\d{1,8}\.\d{1,8}\.\d{1,8}$/,
            );
            try {
              const component = textComponent(
                base.architecture,
                base.uitest_version,
              );
              invariant(
                fs
                  .statSync(
                    path.join(resourceRoot, "native/hypium", component.asset),
                    { throwIfNoEntry: false },
                  )
                  ?.isFile(),
                "UI_TEXT_COMPONENT_MISSING",
                "Packaged native text component is missing",
              );
              base.text_input = {
                status: "component_detected",
                component: component.asset,
                endpoint: component.endpoint,
                error: null,
              };
            } catch (error) {
              base.text_input = {
                ...base.text_input,
                status: "unavailable",
                error: errorResult(error),
              };
            }
            return { ...base, status: "detected", error: null };
          },
          probeSignal,
        );
      },
    );
  } catch (error) {
    signal?.throwIfAborted();
    return { ...base, status: "unavailable", error: errorResult(error) };
  }
}
