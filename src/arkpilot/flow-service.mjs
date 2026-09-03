import crypto from "node:crypto";
import path from "node:path";
import { getProjectPath } from "../project-context.mjs";
import { withHdcCommandObserver } from "../hdc-log.mjs";
import {
  flowError, validateFlow, validateFlowId, variableName, variablesForRun,
} from "./domain.mjs";
import { HdcUiAutomationAdapter, HypiumUiAutomationAdapter } from "./hdc-adapter.mjs";
import { JsonFlowRepository } from "./repository.mjs";
import { FlowJobRepository, RecordingSessionRepository } from "./session-repositories.mjs";
import { resolveAppTarget } from "./target-resolver.mjs";

const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 32;
const MAX_MCP_WAIT_MS = 20000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60000;
const recordings = new RecordingSessionRepository();
const jobs = new FlowJobRepository();
const activeFlowDevices = new Map();
const hdcAdapter = new HdcUiAutomationAdapter();
const hypiumAdapter = new HypiumUiAutomationAdapter();

function projectFrom(input) {
  const selected = input.project_path ?? getProjectPath();
  if (!selected) throw flowError("project_path is required until switch_cwd selects a project", "PROJECT_PATH_REQUIRED");
  return path.resolve(selected);
}

function repository(input) {
  return new JsonFlowRepository(projectFrom(input));
}

function redactError(error) {
  const result = { code: error.code ?? "FLOW_FAILED", message: error.message, hint: error.hint };
  if (error.analysis) {
    result.candidates = {
      matchCount: error.analysis.matchCount ?? 0,
      matches: Array.isArray(error.analysis.matches) ? error.analysis.matches.slice(0, 10) : [],
    };
  }
  return result;
}

function redactSecrets(value, secrets) {
  if (!secrets.length || value === null || value === undefined) return value;
  if (typeof value === "string") {
    return secrets.reduce(
      (text, secret) => text.split(secret).join("[REDACTED]"),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  }
  return value;
}

function normalizeExecutionError(error) {
  const message = String(error?.message ?? "");
  if (/(?:not connected|device not found|target not found|not match target)/i.test(message)) {
    return flowError(message, "DEVICE_DISCONNECTED", "Reconnect the selected device and run the flow again.");
  }
  return error;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size < MAX_JOBS) return;
  const finished = jobs.finishedOldestFirst();
  while (jobs.size >= MAX_JOBS && finished.length) jobs.delete(finished.shift().id);
  if (jobs.size >= MAX_JOBS) throw flowError("Too many UI flow jobs are active", "FLOW_JOB_LIMIT");
}

function recordingResult(session) {
  return {
    recordingId: session.id,
    status: session.status,
    flowId: session.flowId,
    name: session.name,
    projectPath: session.projectPath,
    deviceId: session.deviceId,
    app: session.app,
    steps: session.steps,
    variables: session.variables,
    elapsedMs: Date.now() - session.startedAt,
  };
}

function selectorFrom(input, result) {
  if (result?.target?.key) return { key: result.target.key };
  if (input.key) return { key: input.key };
  const text = result?.target?.text || (input.action !== "inputText" ? input.text : undefined);
  const type = result?.target?.type || input.type;
  if (text || type) return { ...(text ? { text } : {}), ...(type ? { type } : {}), clickableOnly: true };
  return null;
}

function percentOf(value, start, end) {
  return Math.max(0, Math.min(100, ((Number(value) - start) * 100) / (end - start)));
}

async function recordedStep(session, input, result) {
  const mapping = { click: "tap", doubleClick: "doubleTap", longClick: "longTap", inputText: "input" };
  const id = `step-${session.steps.length + 1}`;
  if (mapping[input.action]) {
    let selector = selectorFrom(input, result);
    let fragile;
    if (!selector && input.x !== undefined && input.y !== undefined) {
      const screen = result.screen ?? await hdcAdapter.screen(session.deviceId, 5000);
      if (!Array.isArray(screen) || screen.length !== 4) {
        throw flowError("The screen bounds could not be resolved for coordinate recording", "FLOW_RECORDING_UNSUPPORTED_ACTION");
      }
      fragile = true;
      const [x1, y1, x2, y2] = screen;
      const pointStep = {
        id, action: mapping[input.action], fragile,
        point: { xPercent: percentOf(input.x, x1, x2), yPercent: percentOf(input.y, y1, y2) },
        timeoutMs: 5000,
      };
      if (input.action === "inputText") {
        const variable = `input${Object.keys(session.variables).length + 1}`;
        session.variables[variable] = { required: true, secret: true };
        pointStep.value = `\${${variable}}`;
      }
      return pointStep;
    }
    const step = { id, action: mapping[input.action], selector, timeoutMs: 5000 };
    if (input.action === "inputText") {
      const variable = `input${Object.keys(session.variables).length + 1}`;
      session.variables[variable] = { required: true, secret: true };
      step.value = `\${${variable}}`;
    }
    return step;
  }
  if (["swipe", "fling", "drag"].includes(input.action)) {
    if ([input.from_x_percent, input.from_y_percent, input.to_x_percent, input.to_y_percent]
      .some((value) => value === undefined)) {
      const screen = result.screen ?? await hdcAdapter.screen(session.deviceId, 5000);
      if (!Array.isArray(screen)) throw flowError("Screen bounds are unavailable", "FLOW_RECORDING_UNSUPPORTED_ACTION");
      const [x1, y1, x2, y2] = screen;
      return {
        id, action: input.action, fragile: true, timeoutMs: 5000,
        gesture: {
          fromXPercent: percentOf(input.x, x1, x2), fromYPercent: percentOf(input.y, y1, y2),
          toXPercent: percentOf(input.x2, x1, x2), toYPercent: percentOf(input.y2, y1, y2),
          ...(input.velocity ? { velocity: input.velocity } : {}),
        },
      };
    }
    return {
      id, action: input.action, fragile: true, timeoutMs: 5000,
      gesture: {
        fromXPercent: input.from_x_percent, fromYPercent: input.from_y_percent,
        toXPercent: input.to_x_percent, toYPercent: input.to_y_percent,
        ...(input.velocity ? { velocity: input.velocity } : {}),
      },
    };
  }
  if (input.action === "keyEvent") {
    return { id, action: "key", key: input.key1, timeoutMs: 5000 };
  }
  throw flowError(`Action cannot be recorded: ${input.action}`, "FLOW_RECORDING_UNSUPPORTED_ACTION");
}

export async function recordSuccessfulUiAction(input, result) {
  const session = recordings.activeForDevice(result.deviceId);
  if (!session || session.replaying) return null;
  const step = await recordedStep(session, input, result);
  session.steps.push(step);
  return { recordingId: session.id, stepId: step.id };
}

async function recordStart(input) {
  const projectPath = projectFrom(input);
  const deviceId = await hdcAdapter.resolveDevice(input.hvd, { timeoutMs: input.timeoutMs });
  const duplicate = recordings.activeForDevice(deviceId);
  if (duplicate) throw flowError(`A recording is already active on ${deviceId}`, "RECORDING_ALREADY_ACTIVE");
  const app = resolveAppTarget(projectPath, {
    bundleName: input.bundle_name, module: input.module, ability: input.ability,
  });
  await hdcAdapter.launch(app, { deviceId, mode: input.start_policy ?? "restart", timeoutMs: input.timeoutMs });
  const session = {
    id: crypto.randomUUID(), status: "recording", startedAt: Date.now(), projectPath, deviceId, app,
    flowId: validateFlowId(input.id), name: input.name, steps: [], variables: {},
    start: { mode: input.start_policy ?? "restart" },
  };
  recordings.set(session.id, session);
  return recordingResult(session);
}

function requireRecording(id) {
  const session = recordings.get(String(id ?? ""));
  if (!session) throw flowError(`Recording not found: ${id ?? ""}`, "RECORDING_NOT_FOUND");
  return session;
}

async function recordStop(input) {
  const session = requireRecording(input.recording_id);
  const assertion = input.success_selector ? {
    [input.success_state === "hidden" ? "hidden" : "visible"]: input.success_selector,
    timeoutMs: input.success_timeout_ms ?? 5000,
  } : undefined;
  const candidate = validateFlow({
    version: 1, id: session.flowId, name: session.name, app: session.app, start: session.start,
    variables: session.variables, steps: session.steps, ...(assertion ? { assert: assertion } : {}),
  }, { allowUnverified: input.allow_unverified === true });
  if (candidate.assert) {
    const controller = new AbortController();
    try {
      await hdcAdapter.withSession({
        hvd: session.deviceId,
        timeoutMs: candidate.assert.timeoutMs,
        lockWaitMs: 100,
        signal: controller.signal,
      }, async (deviceSession) => {
        const hidden = Boolean(candidate.assert.hidden);
        await waitFor(
          deviceSession,
          candidate.assert.visible ?? candidate.assert.hidden,
          !hidden,
          candidate.assert.timeoutMs,
          controller.signal,
        );
      });
    } finally {
      await hdcAdapter.cleanup(session.deviceId);
    }
  }
  const saved = new JsonFlowRepository(session.projectPath).save(candidate, {
    allowUnverified: input.allow_unverified === true,
  });
  session.status = "saved";
  recordings.delete(session.id);
  return { ...recordingResult(session), path: saved.path, flow: saved.flow };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(flowError("UI flow was cancelled", "FLOW_CANCELLED"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(flowError("UI flow was cancelled", "FLOW_CANCELLED"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitFor(session, selector, wantedVisible, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    if (signal.aborted) throw flowError("UI flow was cancelled", "FLOW_CANCELLED");
    last = await session.find(selector);
    const visible = last.matchCount > 0;
    if (visible === wantedVisible) return last;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())), signal);
  } while (Date.now() <= deadline);
  const state = wantedVisible ? "visible" : "hidden";
  const error = flowError(`Selector did not become ${state} before ${timeoutMs}ms`, "FLOW_STEP_TIMEOUT");
  error.analysis = last;
  throw error;
}

function resolvedStep(step, values) {
  if (step.action !== "input") return step;
  return { ...step, value: values[variableName(step.value)] };
}

async function executeJob(job, flow, input) {
  const startedAt = Date.now();
  const totalTimeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS, 1000), 600000);
  const timer = setTimeout(() => {
    job.cancelReason = "timeout";
    job.controller.abort();
  }, totalTimeoutMs);
  let deviceId = null;
  let secretValues = [];
  try {
    job.status = "STARTING_APP";
    deviceId = await hdcAdapter.resolveDevice(input.hvd, {
      timeoutMs: totalTimeoutMs,
      signal: job.controller.signal,
    });
    job.deviceId = deviceId;
    const holder = activeFlowDevices.get(deviceId);
    if (holder && holder !== job.id) {
      throw flowError(`Another ArkPilot flow is already using ${deviceId}`, "UI_DEVICE_BUSY");
    }
    activeFlowDevices.set(deviceId, job.id);
    const backendName = input.backend ?? "hdc-shell";
    if (backendName !== "hdc-shell" && backendName !== "hypium") {
      throw flowError(`Unknown UI backend: ${backendName}`, "FLOW_BACKEND_INVALID");
    }
    const adapter = backendName === "hypium" ? hypiumAdapter : hdcAdapter;
    job.backend = adapter.name;
    if (adapter === hypiumAdapter) {
      const status = await adapter.availability();
      if (!status.available) throw flowError(status.message, status.code);
    }
    const values = variablesForRun(flow, input.variables ?? {});
    secretValues = Object.entries(flow.variables)
      .filter(([name, definition]) => definition.secret && values[name])
      .map(([name]) => values[name]);
    await adapter.withSession({
      resolvedDeviceId: deviceId, timeoutMs: totalTimeoutMs, lockWaitMs: 100,
      signal: job.controller.signal,
    }, async (session) => {
      // The process-wide reservation above rejects local contenders. This cross-process lease is
      // deliberately acquired before restarting the application, so two MCP processes cannot
      // both mutate the same device and only discover the collision at the first UI dump.
      await hdcAdapter.launch(flow.app, {
        deviceId, mode: input.start_policy ?? flow.start.mode,
        timeoutMs: Math.min(totalTimeoutMs, 10000), signal: job.controller.signal,
      });
      const measuredSession = {
        ...session,
        async find(selector) {
          job.metrics.uiDumps += 1;
          return session.find(selector);
        },
        async action(step, analysis) {
          job.metrics.actions += 1;
          return session.action(step, analysis);
        },
      };
      for (let index = 0; index < flow.steps.length; index += 1) {
        const step = resolvedStep(flow.steps[index], values);
        const stepStartedAt = Date.now();
        job.currentStep = {
          index, id: step.id, action: step.action,
          ...(step.selector ? { selector: step.selector } : {}),
          ...(step.point ? { point: step.point } : {}),
        };
        job.status = step.action.startsWith("wait") || step.action.startsWith("assert") ? "WAITING" : "ACTING";
        let analysis = null;
        if (step.selector) {
          const hidden = step.action === "waitHidden" || step.action === "assertHidden";
          analysis = await waitFor(measuredSession, step.selector, !hidden, step.timeoutMs, job.controller.signal);
        }
        if (!["waitVisible", "waitHidden", "assertVisible", "assertHidden"].includes(step.action)) {
          await measuredSession.action(step, analysis);
        }
        job.steps.push({ id: step.id, action: step.action, elapsedMs: Date.now() - stepStartedAt });
      }
      if (flow.assert) {
        job.status = "VERIFYING";
        const hidden = Boolean(flow.assert.hidden);
        job.currentStep = {
          index: flow.steps.length,
          id: "final-assertion",
          action: hidden ? "assertHidden" : "assertVisible",
          selector: flow.assert.visible ?? flow.assert.hidden,
        };
        await waitFor(
          measuredSession,
          flow.assert.visible ?? flow.assert.hidden,
          !hidden,
          flow.assert.timeoutMs,
          job.controller.signal,
        );
      }
    });
    job.status = "SUCCEEDED";
    job.result = { assertionPassed: Boolean(flow.assert), stepCount: flow.steps.length };
  } catch (error) {
    let executionError = normalizeExecutionError(error);
    if (!job.controller.signal.aborted && executionError.code === "FLOW_STEP_TIMEOUT" && deviceId) {
      const running = await hdcAdapter.isAppRunning(deviceId, flow.app.bundleName, 2000).catch(() => null);
      if (running === false) {
        executionError = flowError(
          `Application exited while running the flow: ${flow.app.bundleName}`,
          "APP_EXITED",
          "Inspect the application fault log before replaying this flow.",
        );
      }
    }
    if (job.controller.signal.aborted && job.cancelReason === "timeout") {
      job.status = "FAILED";
      job.error = redactSecrets(redactError(flowError(
        `UI flow exceeded its ${totalTimeoutMs}ms total timeout`,
        "FLOW_TOTAL_TIMEOUT",
      )), secretValues);
    } else if (job.controller.signal.aborted) {
      job.status = "CANCELLED";
      job.error = redactSecrets(
        redactError(flowError("UI flow was cancelled", "FLOW_CANCELLED")),
        secretValues,
      );
    } else {
      job.status = "FAILED";
      job.error = redactSecrets(redactError(executionError), secretValues);
    }
    // Diagnostics are useful only after a concrete flow step started. Preflight failures such as
    // UI_DEVICE_BUSY and FLOW_APP_NOT_INSTALLED must remain fast and side-effect free.
    if (deviceId && job.status === "FAILED" && job.currentStep) {
      job.diagnostics = await hdcAdapter.diagnostics(deviceId, 5000).catch((diagnosticError) => ({
        error: redactError(diagnosticError),
      }));
      job.diagnostics = redactSecrets(job.diagnostics, secretValues);
      if (job.diagnostics?.screenshot?.localPath) job.metrics.screenshots += 1;
    }
  } finally {
    clearTimeout(timer);
    if (deviceId && activeFlowDevices.get(deviceId) === job.id) {
      await hdcAdapter.cleanup(deviceId);
      activeFlowDevices.delete(deviceId);
    }
    job.finishedAt = Date.now();
    job.elapsedMs = job.finishedAt - startedAt;
  }
}

function jobResult(job) {
  const result = {
    jobId: job.id, flowId: job.flowId, status: job.status, backend: job.backend,
    deviceId: job.deviceId, currentStep: job.currentStep, steps: job.steps,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    metrics: job.metrics,
  };
  if (job.result) result.result = job.result;
  if (job.error) result.error = job.error;
  if (job.diagnostics) result.diagnostics = job.diagnostics;
  if (job.status === "FAILED") {
    result.suggestion = job.error?.code === "UI_TARGET_AMBIGUOUS"
      ? "Strengthen the selector or re-record the step; ArkPilot will not guess between candidates."
      : "Inspect the failure screenshot and candidates, then re-record the failed step if the page changed.";
  }
  if (!job.finishedAt) result.nextAction = { tool: "ui_flow", arguments: { action: "status", job_id: job.id, wait_ms: 20000 } };
  return result;
}

async function waitJob(job, waitMs) {
  const bounded = Math.min(Math.max(Number(waitMs) || 0, 0), MAX_MCP_WAIT_MS);
  if (bounded && !job.finishedAt) {
    const waitController = new AbortController();
    try {
      await Promise.race([job.completion, sleep(bounded, waitController.signal)]);
    } finally {
      waitController.abort();
    }
  }
  return jobResult(job);
}

async function run(input) {
  pruneJobs();
  const repo = repository(input);
  const flow = repo.get(input.id, { allowUnverified: input.allow_unverified === true });
  const backend = input.backend ?? repo.config.driver;
  const job = {
    id: crypto.randomUUID(), flowId: flow.id, status: "QUEUED", backend,
    deviceId: null, startedAt: Date.now(), finishedAt: null, currentStep: null, steps: [],
    controller: new AbortController(), completion: null,
    cancelReason: null,
    metrics: { hdcCommands: 0, uiDumps: 0, actions: 0, screenshots: 0 },
  };
  jobs.set(job.id, job);
  job.completion = withHdcCommandObserver(
    () => { job.metrics.hdcCommands += 1; },
    () => executeJob(job, flow, { ...input, backend }),
  );
  return waitJob(job, input.wait_ms === undefined ? MAX_MCP_WAIT_MS : input.wait_ms);
}

function requireJob(id) {
  const job = jobs.get(String(id ?? ""));
  if (!job) throw flowError(`UI flow job not found: ${id ?? ""}`, "FLOW_JOB_NOT_FOUND");
  return job;
}

export async function uiFlow(input = {}) {
  const action = input.action;
  if (action === "record_start") return recordStart(input);
  if (action === "record_status") return recordingResult(requireRecording(input.recording_id));
  if (action === "record_stop") return recordStop(input);
  if (action === "record_cancel") {
    const session = requireRecording(input.recording_id);
    session.status = "cancelled";
    recordings.delete(session.id);
    return recordingResult(session);
  }
  if (action === "list") {
    const repo = repository(input);
    const flows = repo.list();
    return { projectPath: repo.projectPath, count: flows.length, flows };
  }
  if (action === "get") return repository(input).get(input.id, { allowUnverified: true });
  if (action === "validate") {
    const flow = input.flow ? validateFlow(input.flow, { allowUnverified: input.allow_unverified === true })
      : repository(input).get(input.id, { allowUnverified: input.allow_unverified === true });
    return { valid: true, flow };
  }
  if (action === "delete") return repository(input).delete(input.id);
  if (action === "run") return run(input);
  if (action === "status") return waitJob(requireJob(input.job_id), input.wait_ms);
  if (action === "cancel") {
    const job = requireJob(input.job_id);
    if (!job.finishedAt) {
      job.cancelReason = "cancel";
      job.controller.abort();
    }
    const waitController = new AbortController();
    try {
      await Promise.race([job.completion, sleep(3000, waitController.signal)]);
    } finally {
      waitController.abort();
    }
    return jobResult(job);
  }
  throw flowError(`Unknown ui_flow action: ${String(action)}`, "FLOW_ACTION_INVALID");
}

export async function closeUiFlows() {
  for (const job of jobs.values()) {
    if (!job.finishedAt) {
      job.cancelReason = "shutdown";
      job.controller.abort();
    }
  }
  await Promise.allSettled([...jobs.values()].map((job) => job.completion).filter(Boolean));
  await Promise.allSettled([hdcAdapter.close(), hypiumAdapter.close()]);
}

export const flowServiceInternals = {
  recordings, jobs, activeFlowDevices, recordedStep, waitFor, redactSecrets,
};
