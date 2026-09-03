import { uiFind, uiSnapshot, withUiAutomationSession } from "../device-ui.mjs";
import { hdcFailureMessage, requireHdc, resolveDevice, runHdc, targetArgs } from "../hdc-log.mjs";
import { flowError } from "./domain.mjs";

function remoteFailure(result, operation) {
  const transport = hdcFailureMessage(result);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (transport) throw flowError(`${operation} failed: ${transport}`, "HDC_COMMAND_FAILED");
  if (/(?:error|failed|not found|does not exist|unknown bundle)/i.test(combined)
    && !/(?:success|successfully|no error)/i.test(combined)) {
    throw flowError(`${operation} failed: ${combined || "no output"}`, "FLOW_APP_START_FAILED");
  }
  return combined;
}

export class HdcUiAutomationAdapter {
  constructor() {
    this.name = "hdc-shell";
  }

  async resolveDevice(hvd, options = {}) {
    return resolveDevice(requireHdc(), hvd, options);
  }

  async launch(target, { deviceId, mode = "restart", timeoutMs = 10000, signal } = {}) {
    if (mode === "attach") return { mode, attached: true, deviceId };
    const hdc = requireHdc();
    const base = [hdc, ...targetArgs(deviceId), "shell"];
    const inspect = await runHdc([...base, "bm", "dump", "-n", target.bundleName], timeoutMs, { signal });
    const inspectText = `${inspect.stdout ?? ""}\n${inspect.stderr ?? ""}`;
    if (hdcFailureMessage(inspect) || /(?:not exist|not found|failed|error)/i.test(inspectText)) {
      throw flowError(
        `Application is not installed: ${target.bundleName}`,
        "FLOW_APP_NOT_INSTALLED",
        "Build and deploy it once with start_app; ArkPilot never installs implicitly.",
      );
    }
    remoteFailure(
      await runHdc([...base, "aa", "force-stop", target.bundleName], timeoutMs, { signal }),
      "aa force-stop",
    );
    const output = remoteFailure(await runHdc([
      ...base, "aa", "start", "-b", target.bundleName, "-m", target.module, "-a", target.ability,
    ], timeoutMs, { signal }), "aa start");
    return { mode, deviceId, target, output };
  }

  async withSession(options, task) {
    return withUiAutomationSession(options, task);
  }

  async isAppRunning(deviceId, bundleName, timeoutMs = 2000) {
    const result = await runHdc([
      requireHdc(), ...targetArgs(deviceId), "shell", "pidof", bundleName,
    ], timeoutMs);
    const transport = hdcFailureMessage(result);
    if (transport) throw flowError(`Application state check failed: ${transport}`, "HDC_COMMAND_FAILED");
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    if (/(?:pidof:.*not found|unknown command|inaccessible)/i.test(output)) return null;
    return output.length > 0;
  }

  async screen(deviceId, timeoutMs = 5000) {
    const report = await uiFind({ hvd: deviceId, timeoutMs, limit: 1, onScreenOnly: false });
    return report.screen;
  }

  async diagnostics(deviceId, timeoutMs = 5000) {
    const [tree, frame] = await Promise.allSettled([
      uiFind({ hvd: deviceId, timeoutMs, limit: 20 }),
      uiSnapshot({ hvd: deviceId, timeoutMs, inline: false, includeDevicePath: true }),
    ]);
    if (frame.status === "fulfilled" && frame.value.devicePath) {
      await runHdc([
        requireHdc(), ...targetArgs(deviceId), "shell", "rm", "-f", frame.value.devicePath,
      ], Math.min(timeoutMs, 2000)).catch(() => {});
    }
    return {
      tree: tree.status === "fulfilled" ? {
        dumpPath: tree.value.dumpPath,
        structureSignature: tree.value.structureSignature,
        matches: tree.value.matches,
        componentTypes: tree.value.componentTypes,
      } : { error: { code: tree.reason?.code, message: tree.reason?.message } },
      screenshot: frame.status === "fulfilled" ? {
        localPath: frame.value.localPath,
        bytes: frame.value.bytes,
      } : { error: { code: frame.reason?.code, message: frame.reason?.message } },
    };
  }

  async cleanup(deviceId, timeoutMs = 2000) {
    const dumpPath = `/data/local/tmp/deveco_ui_${process.pid}_dump.json`;
    await runHdc([
      requireHdc(), ...targetArgs(deviceId), "shell", "rm", "-f", dumpPath,
    ], timeoutMs).catch(() => {});
  }

  async close() {}
}

export class HypiumUiAutomationAdapter {
  constructor() {
    this.name = "hypium";
  }

  async availability() {
    try {
      await import("hypium-driver");
      return {
        available: false,
        code: "HYPERFORMANCE_GATE_REQUIRED",
        message: "hypium-driver is installed but ArkPilot has not passed the required device performance gate.",
      };
    } catch {
      return {
        available: false,
        code: "HYPIUM_NOT_INSTALLED",
        message: "hypium-driver is optional and is not installed; hdc-shell remains the supported backend.",
      };
    }
  }

  async withSession() {
    const status = await this.availability();
    throw flowError(status.message, status.code);
  }

  async close() {}
}
