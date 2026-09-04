import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uiFind, uiSnapshot, withUiAutomationSession } from "../device-ui.mjs";
import { withUitestLock } from "../device-lock.mjs";
import { hdcFailureMessage, requireHdc, resolveDevice, runHdc, targetArgs } from "../hdc-log.mjs";
import { flowError } from "./domain.mjs";

function remoteFailure(result, operation, { requireOutput = false, successPattern, code = "FLOW_APP_START_FAILED" } = {}) {
  const transport = hdcFailureMessage(result);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (transport) throw flowError(`${operation} failed: ${transport}`, "HDC_COMMAND_FAILED");
  const withoutBenignNoError = combined.replace(/\bno\s+error\b/gi, "");
  if (/(?:\berror\b|fail(?:ed|ure)?|not found|does not exist|unknown bundle)/i.test(withoutBenignNoError)) {
    throw flowError(`${operation} failed: ${combined || "no output"}`, code);
  }
  if (requireOutput && !combined) throw flowError(`${operation} produced no success acknowledgement`, code);
  if (successPattern && !successPattern.test(combined)) {
    throw flowError(`${operation} did not report success: ${combined || "no output"}`, code);
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
    await this.assertInstalled(target.bundleName, { deviceId, timeoutMs, signal });
    if (mode === "attach") {
      const running = await this.isAppRunning(deviceId, target.bundleName, Math.min(timeoutMs, 3000));
      if (running === false) {
        throw flowError(`Application is not running: ${target.bundleName}`, "FLOW_APP_NOT_RUNNING");
      }
      if (running === null) {
        throw flowError(
          `Application running state could not be verified: ${target.bundleName}`,
          "FLOW_APP_STATE_UNVERIFIED",
        );
      }
      return { mode, attached: true, processVerified: true, deviceId, target };
    }
    const hdc = requireHdc();
    const base = [hdc, ...targetArgs(deviceId), "shell"];
    remoteFailure(
      await runHdc([...base, "aa", "force-stop", target.bundleName], timeoutMs, { signal }),
      "aa force-stop",
    );
    const output = remoteFailure(await runHdc([
      ...base, "aa", "start", "-b", target.bundleName, "-m", target.module, "-a", target.ability,
    ], timeoutMs, { signal }), "aa start", {
      requireOutput: true,
      successPattern: /(?:success|succeed|no error)/i,
    });
    return { mode, deviceId, target, output, launchAcknowledged: true };
  }

  async assertInstalled(bundleName, { deviceId, timeoutMs = 10000, signal } = {}) {
    const hdc = requireHdc();
    const base = [hdc, ...targetArgs(deviceId), "shell"];
    const inspect = await runHdc([...base, "bm", "dump", "-n", bundleName], timeoutMs, { signal });
    const inspectText = `${inspect.stdout ?? ""}\n${inspect.stderr ?? ""}`.trim();
    if (hdcFailureMessage(inspect)
      || /(?:not exist|not found|failed|error)/i.test(inspectText)
      || !inspectText
      || !inspectText.includes(bundleName)) {
      throw flowError(
        `Application is not installed: ${bundleName}`,
        "FLOW_APP_NOT_INSTALLED",
        "Build and deploy it once with start_app; ArkPilot never installs implicitly.",
      );
    }
    return { installed: true, bundleName, output: inspectText };
  }

  async launchRoute(route, {
    deviceId, mode = "restart", uri, parameters = {}, timeoutMs = 10000, signal,
  } = {}) {
    const hdc = requireHdc();
    const base = [hdc, ...targetArgs(deviceId), "shell"];
    await this.assertInstalled(route.app.bundleName, { deviceId, timeoutMs, signal });
    if (mode === "restart") {
      remoteFailure(
        await runHdc([...base, "aa", "force-stop", route.app.bundleName], timeoutMs, { signal }),
        "aa force-stop",
      );
    }
    const args = [
      ...base, "aa", "start", "-b", route.app.bundleName,
      "-m", route.app.module, "-a", route.app.ability,
    ];
    if (route.action) args.push("-A", route.action);
    const selectedUri = uri ?? route.uri;
    if (selectedUri) args.push("-U", selectedUri);
    for (const entity of route.entities ?? []) args.push("-e", entity);
    for (const [key, value] of Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))) {
      if (typeof value === "boolean") args.push("--pb", key, String(value));
      else if (Number.isInteger(value)) args.push("--pi", key, String(value));
      else if (typeof value === "string") args.push("--ps", key, value);
      else throw flowError(`Want parameter ${key} must be a string, integer, or boolean`, "FLOW_ROUTE_PARAMETER_INVALID");
    }
    const output = remoteFailure(await runHdc(args, timeoutMs, { signal }), "aa start route", {
      requireOutput: true,
      successPattern: /(?:success|succeed|no error)/i,
    });
    return {
      mode, deviceId, routeId: route.id, target: route.app, uri: selectedUri, output,
      launchAcknowledged: true,
    };
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
    if (!output) return false;
    if (/^\d+(?:\s+\d+)*$/.test(output)) return true;
    return null;
  }

  async screen(deviceId, timeoutMs = 5000) {
    const report = await uiFind({ hvd: deviceId, timeoutMs, limit: 1, onScreenOnly: false });
    return report.screen;
  }

  async diagnostics(deviceId, timeoutMs = 5000) {
    const [tree, frame] = await Promise.allSettled([
      uiFind({ hvd: deviceId, timeoutMs, limit: 20 }),
      uiSnapshot({ hvd: deviceId, timeoutMs, inline: false }),
    ]);
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
  constructor({ moduleLoader, telemetryFile } = {}) {
    this.name = "hypium";
    this.drivers = new Map();
    this.moduleLoader = moduleLoader ?? (() => import("hypium-driver"));
    this.telemetryFile = telemetryFile
      ?? path.join(os.homedir(), ".hypium", ".hypium_driver_config");
  }

  async availability({ performanceGate = false } = {}) {
    let telemetryDisabled = false;
    try {
      telemetryDisabled = JSON.parse(fs.readFileSync(this.telemetryFile, "utf8")).telemetry === false;
    } catch {}
    try {
      await this.module();
      if (!telemetryDisabled) {
        return {
          available: false,
          code: "HYPIUM_TELEMETRY_ENABLED",
          message: "hypium-driver telemetry must be explicitly disabled before ArkPilot may load the persistent backend (run: npx hypium-driver telemetry disable).",
        };
      }
      if (!performanceGate) {
        return {
          available: false,
          code: "HYPIUM_PERFORMANCE_GATE_REQUIRED",
          message: "hypium-driver is installed and telemetry is disabled, but this project has not recorded a passing ArkPilot performance gate.",
        };
      }
      return {
        available: true,
        code: "HYPIUM_AVAILABLE",
        message: "The persistent Hypium backend is installed, telemetry-disabled, and enabled by the project performance gate.",
      };
    } catch {
      return {
        available: false,
        code: "HYPIUM_NOT_INSTALLED",
        message: "hypium-driver is optional and is not installed; hdc-shell remains the supported backend.",
      };
    }
  }

  async module() {
    const loaded = await this.moduleLoader();
    return loaded.UiDriver ? loaded : loaded.default;
  }

  async discard(deviceId) {
    const state = this.drivers.get(deviceId);
    this.drivers.delete(deviceId);
    if (!state) return;
    await state.driver.disconnect().catch(() => {});
  }

  async bounded(deviceId, label, options, task) {
    const timeoutMs = Math.min(Math.max(Number(options?.timeoutMs) || 10000, 100), 10000);
    const signal = options?.signal;
    let timer;
    let onAbort;
    const pending = Promise.resolve().then(task);
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(flowError(
        `${label} exceeded its ${timeoutMs}ms RPC deadline`, "HYPIUM_RPC_TIMEOUT",
      )), timeoutMs);
      if (signal) {
        onAbort = () => reject(flowError("UI flow was cancelled", "FLOW_CANCELLED"));
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      // Disconnecting is the only cancellation primitive exposed by hypium-driver. Bound that
      // cleanup as well so an RPC failure cannot keep the MCP request or the device lease alive.
      pending.catch(() => {});
      pending.then(() => this.discard(deviceId), () => {});
      await Promise.race([
        this.discard(deviceId),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async driver(deviceId, timeoutMs) {
    const existing = this.drivers.get(deviceId);
    if (existing) return existing;
    // hypium-driver invokes a bare `hdc` command internally. Put the already resolved official
    // binary on PATH once, using Node's platform delimiter rather than shell syntax.
    const hdcDirectory = path.dirname(requireHdc());
    const currentPath = process.env.PATH ?? "";
    if (!currentPath.split(path.delimiter).includes(hdcDirectory)) {
      process.env.PATH = `${hdcDirectory}${path.delimiter}${currentPath}`;
    }
    const api = await this.module();
    const driver = await api.UiDriver.connect({
      deviceSn: deviceId, hdcExecTimeout: Math.min(timeoutMs, 10000),
      rpcTimeout: Math.min(timeoutMs, 10000), implicitWaitTime: 100, samplingTime: 15,
    });
    const state = { api, driver, deviceId, lastUsedAt: Date.now() };
    this.drivers.set(deviceId, state);
    return state;
  }

  by(api, selector) {
    let by = api.BY;
    if (selector.key) by = by.key(selector.key, api.MatchPattern.EQUALS);
    if (selector.text) {
      by = by.text(selector.text, selector.textMode === "contains"
        ? api.MatchPattern.CONTAINS : api.MatchPattern.EQUALS);
    }
    if (selector.type) by = by.type(selector.type, api.MatchPattern.EQUALS);
    if (selector.clickableOnly) by = by.clickable(true);
    return by;
  }

  async analysis(state, selector, options = {}) {
    const components = await this.bounded(state.deviceId, "Hypium findComponents", options,
      () => state.driver.findComponents(this.by(state.api, selector)));
    const analysis = {
      deviceId: state.deviceId,
      matchCount: components.length,
      matches: components.slice(0, 10).map(() => ({
        key: selector.key ?? null,
        text: selector.text ?? "",
        type: selector.type ?? "",
        clickable: selector.clickableOnly || undefined,
        onScreen: true,
      })),
    };
    if (components.length === 1) {
      Object.defineProperty(analysis, "hypiumComponent", { value: components[0], enumerable: false });
    }
    return analysis;
  }

  async withSession(options, task) {
    const deviceId = String(options.resolvedDeviceId ?? options.hvd ?? "");
    if (!deviceId) throw flowError("A resolved device id is required for Hypium", "HDC_DEVICE_REQUIRED");
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 60000, 1000), 600000);
    const lockDirectory = path.join(os.tmpdir(), "deveco-ui", "locks", deviceId.replace(/[^A-Za-z0-9_.-]/g, "_"));
    return withUitestLock({ directory: lockDirectory, op: "ArkPilot Hypium flow", timeoutMs: options.lockWaitMs ?? 100 }, async () => {
      if (options.signal?.aborted) throw flowError("UI flow was cancelled", "FLOW_CANCELLED");
      const state = await this.bounded(deviceId, "Hypium connection", {
        timeoutMs: Math.min(timeoutMs, 10000), signal: options.signal,
      }, () => this.driver(deviceId, timeoutMs));
      const find = (selector, operation = {}) => this.analysis(state, selector, {
        timeoutMs: operation.timeoutMs ?? timeoutMs,
        signal: operation.signal ?? options.signal,
      });
      const findAny = async (selectors, operation = {}) => {
        const results = [];
        for (let index = 0; index < selectors.length; index += 1) {
          results.push({ index, selector: selectors[index], analysis: await find(selectors[index], operation) });
        }
        return results;
      };
      const action = async (step, prepared = null, operation = {}) => {
        if (options.signal?.aborted) throw flowError("UI flow was cancelled", "FLOW_CANCELLED");
        let component = prepared?.hypiumComponent;
        if (step.selector && !component) {
          const found = await find(step.selector, operation);
          if (found.matchCount !== 1) {
            const error = flowError(`Selector matched ${found.matchCount} controls`,
              found.matchCount ? "UI_TARGET_AMBIGUOUS" : "UI_TARGET_NOT_FOUND");
            error.analysis = found;
            throw error;
          }
          component = found.hypiumComponent;
        }
        await this.bounded(deviceId, `Hypium ${step.action}`, {
          timeoutMs: operation.timeoutMs ?? timeoutMs,
          signal: operation.signal ?? options.signal,
        }, async () => {
        if (step.point) {
          const size = await state.driver.getDisplaySize();
          const x = Math.round((size.x * step.point.xPercent) / 100);
          const y = Math.round((size.y * step.point.yPercent) / 100);
          if (step.action === "tap") await state.driver.click(x, y);
          else if (step.action === "doubleTap") await state.driver.doubleClick(x, y);
          else if (step.action === "longTap") await state.driver.longClick(x, y);
          else throw flowError(`Hypium point action is unsupported: ${step.action}`, "FLOW_ACTION_INVALID");
        } else if (step.action === "tap") await component.click();
        else if (step.action === "doubleTap") await component.doubleClick();
        else if (step.action === "longTap") await component.longClick();
        else if (step.action === "input") await component.inputText(step.value);
        else if (step.action === "key") {
          const key = state.api.KeyCode[String(step.key).toUpperCase()];
          if (key === undefined) throw flowError(`Hypium does not expose key ${step.key}`, "FLOW_KEY_UNSUPPORTED");
          await state.driver.triggerKey(key);
        } else if (["swipe", "fling", "drag"].includes(step.action)) {
          const size = await state.driver.getDisplaySize();
          const x1 = Math.round((size.x * step.gesture.fromXPercent) / 100);
          const y1 = Math.round((size.y * step.gesture.fromYPercent) / 100);
          const x2 = Math.round((size.x * step.gesture.toXPercent) / 100);
          const y2 = Math.round((size.y * step.gesture.toYPercent) / 100);
          if (step.action === "swipe") await state.driver.swipe(x1, y1, x2, y2, step.gesture.velocity);
          else if (step.action === "drag") await state.driver.drag(x1, y1, x2, y2, step.gesture.velocity);
          else await state.driver.fling(x1, y1, x2, y2, 5, step.gesture.velocity);
        }
        });
        state.lastUsedAt = Date.now();
        return { action: step.action, commandAccepted: true };
      };
      return task({ deviceId, find, findAny, action });
    });
  }

  async close() {
    const active = [...this.drivers.values()];
    this.drivers.clear();
    await Promise.allSettled(active.map(({ driver }) => driver.disconnect()));
  }
}
