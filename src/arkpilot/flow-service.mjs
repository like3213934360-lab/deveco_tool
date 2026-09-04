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
import { discoverAppRoutes, selectAppRoute } from "./route-resolver.mjs";
import { resolveAppTarget } from "./target-resolver.mjs";

const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 32;
const MAX_MCP_WAIT_MS = 20000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60000;
const MAX_UI_READ_ATTEMPT_MS = 3500;
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

function selectorBundle(input, result) {
  const key = result?.target?.key || input.key;
  const text = result?.target?.text || (input.action !== "inputText" ? input.text : undefined);
  const type = result?.target?.type || input.type;
  const semantic = text || type ? {
    ...(text ? { text, textMode: "exact" } : {}),
    ...(type ? { type } : {}),
    ...(result?.target?.clickable === false ? {} : { clickableOnly: true }),
  } : null;
  if (key) return { selector: { key }, alternates: semantic ? [semantic] : [] };
  if (semantic) return { selector: semantic, alternates: [] };
  return { selector: null, alternates: [] };
}

function percentOf(value, start, end) {
  return Math.max(0, Math.min(100, ((Number(value) - start) * 100) / (end - start)));
}

async function recordedStep(session, input, result) {
  const mapping = { click: "tap", doubleClick: "doubleTap", longClick: "longTap", inputText: "input" };
  const id = `step-${session.steps.length + 1}`;
  if (mapping[input.action]) {
    const bundle = selectorBundle(input, result);
    let selector = bundle.selector;
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
    const step = {
      id, action: mapping[input.action], selector,
      ...(bundle.alternates.length ? { alternates: bundle.alternates } : {}),
      timeoutMs: 5000,
    };
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
    preferMain: input.prefer_main === true,
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

function sameTarget(left, right) {
  if (!left || !right) return false;
  if (left.key && right.key) return left.key === right.key;
  return left.type === right.type && left.text === right.text
    && left.center?.x === right.center?.x && left.center?.y === right.center?.y;
}

async function findCandidates(session, selectors, options) {
  if (selectors.length > 1 && typeof session.findAny === "function") return session.findAny(selectors, options);
  const analysis = await session.find(selectors[0], options);
  return [{ index: 0, selector: selectors[0], analysis }];
}

const RETRYABLE_UI_READ_ERRORS = new Set([
  "UI_DUMP_FAILED", "UI_DUMP_EMPTY", "UI_DUMP_PARSE_FAILED", "UI_RECV_FAILED", "HDC_TIMEOUT",
]);

async function waitFor(session, selector, wantedVisible, timeoutMs, signal, alternates = []) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastReadError;
  do {
    if (signal.aborted) throw flowError("UI flow was cancelled", "FLOW_CANCELLED");
    let candidates;
    try {
      candidates = await findCandidates(session, [selector, ...alternates], {
        timeoutMs: Math.min(MAX_UI_READ_ATTEMPT_MS, Math.max(100, deadline - Date.now())), signal,
      });
      lastReadError = null;
    } catch (error) {
      // A freshly started Ability can make uitest return an empty/partial read while its window is
      // being attached. Reading the tree is side-effect free, so it is safe to retry within this
      // step's existing deadline. Transport timeouts, device loss, ambiguity and every action error
      // still fail immediately; actions themselves are never retried.
      if (!RETRYABLE_UI_READ_ERRORS.has(error.code) || Date.now() >= deadline) throw error;
      lastReadError = error;
      // When the host-side hdc process reaches its deadline, the device-side uitest command may
      // still need a fraction of a second to relinquish the singleton service. Starting the retry
      // immediately can collide with that cleanup and turn one slow read into a chain of failures.
      const backoffMs = error.code === "HDC_TIMEOUT" ? 500 : 100;
      await sleep(Math.min(backoffMs, Math.max(1, deadline - Date.now())), signal);
      continue;
    }
    const primary = candidates[0].analysis;
    last = primary;
    const anyVisible = candidates.some((candidate) => candidate.analysis.matchCount > 0);
    if (wantedVisible && primary.matchCount === 0) {
      const matchingFallbacks = candidates.slice(1)
        .filter((candidate) => candidate.analysis.matchCount > 0);
      if (matchingFallbacks.some((candidate) => candidate.analysis.matchCount !== 1)) {
        const error = flowError(
          "A semantic fallback selector matches several controls; ArkPilot refused to guess",
          "FLOW_SELECTOR_HEAL_AMBIGUOUS",
        );
        error.analysis = {
          matchCount: matchingFallbacks.reduce((total, candidate) => total + candidate.analysis.matchCount, 0),
          matches: matchingFallbacks.flatMap((candidate) => candidate.analysis.matches).slice(0, 10),
        };
        throw error;
      }
      const safe = matchingFallbacks;
      if (safe.length) {
        const firstTarget = safe[0].analysis.matches[0];
        if (safe.every((candidate) => sameTarget(firstTarget, candidate.analysis.matches[0]))) {
          return {
            ...safe[0].analysis,
            healed: true,
            healedFrom: selector,
            resolvedSelector: safe[0].selector,
          };
        }
        const error = flowError(
          "Semantic fallback selectors resolve to different controls; ArkPilot refused to guess",
          "FLOW_SELECTOR_HEAL_AMBIGUOUS",
        );
        error.analysis = { matchCount: safe.length, matches: safe.map((candidate) => candidate.analysis.matches[0]) };
        throw error;
      }
    }
    // A visible assertion/action may use a fallback only through the unique-healing branch above.
    // Treating an ambiguous fallback as "visible" would let waitVisible/assertVisible pass and,
    // for an action, defer the real error until after this wait. A hidden check is different: any
    // recorded identity that is still visible means the control has not disappeared yet.
    const visible = wantedVisible ? primary.matchCount > 0 : anyVisible;
    if (visible === wantedVisible) return last;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())), signal);
  } while (Date.now() <= deadline);
  const state = wantedVisible ? "visible" : "hidden";
  const error = flowError(
    `Selector did not become ${state} before ${timeoutMs}ms`,
    "FLOW_STEP_TIMEOUT",
    lastReadError ? `The last read-only UI-tree attempt failed: ${lastReadError.message}` : undefined,
  );
  error.analysis = last;
  throw error;
}

function applySuccessfulHealings(flow, healings) {
  if (!healings.length) return flow;
  const byStep = new Map(healings.map((healing) => [healing.stepId, healing]));
  const promote = (owner, healing) => {
    const alternates = [owner.selector, ...(owner.alternates ?? [])]
      .filter((candidate) => JSON.stringify(candidate) !== JSON.stringify(healing.selector));
    return { ...owner, selector: healing.selector, ...(alternates.length ? { alternates } : {}) };
  };
  const steps = flow.steps.map((step) => {
    const healing = byStep.get(step.id);
    return healing ? promote(step, healing) : step;
  });
  let assertion = flow.assert;
  const finalHealing = byStep.get("final-assertion");
  if (assertion && finalHealing) {
    const kind = assertion.visible ? "visible" : "hidden";
    const owner = promote({ selector: assertion[kind], alternates: assertion.alternates }, finalHealing);
    assertion = {
      ...assertion,
      [kind]: owner.selector,
      ...(owner.alternates ? { alternates: owner.alternates } : {}),
    };
  }
  return validateFlow({ ...flow, steps, ...(assertion ? { assert: assertion } : {}) }, {
    allowUnverified: !assertion,
  });
}

function resolvedStep(step, values) {
  if (step.action !== "input") return step;
  return { ...step, value: values[variableName(step.value)] };
}

async function executeJob(job, flow, input, repo) {
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
      const status = await adapter.availability({ performanceGate: input.hypiumPerformanceGate === true });
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
      if (input.route) {
        await hdcAdapter.launchRoute(input.route, {
          deviceId, mode: input.start_policy ?? flow.start.mode,
          uri: input.uri, parameters: input.want_parameters,
          timeoutMs: Math.min(totalTimeoutMs, 10000), signal: job.controller.signal,
        });
      } else {
        await hdcAdapter.launch(flow.app, {
          deviceId, mode: input.start_policy ?? flow.start.mode,
          timeoutMs: Math.min(totalTimeoutMs, 10000), signal: job.controller.signal,
        });
      }
      const measuredSession = {
        ...session,
        async find(selector, options) {
          job.metrics.uiDumps += 1;
          return session.find(selector, options);
        },
        async findAny(selectors, options) {
          job.metrics.uiDumps += 1;
          return session.findAny(selectors, options);
        },
        async action(step, analysis, options) {
          job.metrics.actions += 1;
          return session.action(step, analysis, options);
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
          analysis = await waitFor(
            measuredSession, step.selector, !hidden, step.timeoutMs, job.controller.signal,
            input.selectorHealing ? (step.alternates ?? []) : [],
          );
          if (analysis.healed) {
            job.healings.push({
              stepId: step.id, from: step.selector, selector: analysis.resolvedSelector,
            });
          }
        } else if (step.point || ["swipe", "fling", "drag"].includes(step.action)) {
          // Point and screen-percentage gestures still need current screen bounds. Resolve that
          // tree here, through the measured wrapper, rather than letting session.action perform an
          // invisible dump that would make benchmark reports under-count device work.
          analysis = await measuredSession.find({}, {
            timeoutMs: step.timeoutMs, signal: job.controller.signal,
          });
        }
        if (!["waitVisible", "waitHidden", "assertVisible", "assertHidden"].includes(step.action)) {
          await measuredSession.action(step, analysis, {
            timeoutMs: step.timeoutMs, signal: job.controller.signal,
          });
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
        const finalAnalysis = await waitFor(
          measuredSession,
          flow.assert.visible ?? flow.assert.hidden,
          !hidden,
          flow.assert.timeoutMs,
          job.controller.signal,
          input.selectorHealing ? (flow.assert.alternates ?? []) : [],
        );
        if (finalAnalysis.healed) {
          job.healings.push({
            stepId: "final-assertion",
            from: flow.assert.visible ?? flow.assert.hidden,
            selector: finalAnalysis.resolvedSelector,
          });
        }
      }
    });
    if (input.selectorHealing && input.persistHealing !== false && job.healings.length) {
      const healed = applySuccessfulHealings(flow, job.healings);
      const saved = repo.save(healed, { allowUnverified: !healed.assert });
      job.healedFlowPath = saved.path;
    }
    job.status = "SUCCEEDED";
    job.result = {
      assertionPassed: Boolean(flow.assert), stepCount: flow.steps.length,
      selectorHealings: job.healings.length,
      ...(job.healedFlowPath ? { healedFlowPath: job.healedFlowPath } : {}),
    };
  } catch (error) {
    let executionError = normalizeExecutionError(error);
    if (job.currentStep && ["HDC_TIMEOUT", "HYPIUM_RPC_TIMEOUT"].includes(executionError.code)) {
      executionError = flowError(
        `Step ${job.currentStep.id} exceeded its external-call deadline`,
        "FLOW_STEP_TIMEOUT",
        `The ${job.backend} operation was terminated; the action was not retried.`,
      );
    }
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
    metrics: job.metrics, healings: job.healings,
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

async function run(input, selectedFlow = null, execution = {}) {
  pruneJobs();
  const repo = repository(input);
  const flow = selectedFlow ?? repo.get(input.id, { allowUnverified: input.allow_unverified === true });
  const backend = input.backend ?? repo.config.driver;
  const job = {
    id: crypto.randomUUID(), flowId: flow.id, status: "QUEUED", backend,
    deviceId: null, startedAt: Date.now(), finishedAt: null, currentStep: null, steps: [],
    controller: new AbortController(), completion: null,
    cancelReason: null,
    healings: [],
    metrics: { hdcCommands: 0, uiDumps: 0, actions: 0, screenshots: 0 },
  };
  jobs.set(job.id, job);
  job.completion = withHdcCommandObserver(
    () => { job.metrics.hdcCommands += 1; },
    () => executeJob(job, flow, {
      ...input, ...execution, backend,
      selectorHealing: input.selector_healing ?? repo.config.selectorHealing,
      hypiumPerformanceGate: repo.config.hypiumPerformanceGate,
    }, repo),
  );
  return waitJob(job, input.wait_ms === undefined ? MAX_MCP_WAIT_MS : input.wait_ms);
}

function navigationFlowId(input) {
  if (input.id) return validateFlowId(input.id);
  const goal = String(input.goal ?? input.name ?? "").trim();
  const readable = goal.toLocaleLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const digest = crypto.createHash("sha256").update(goal || "navigation").digest("hex").slice(0, 10);
  return validateFlowId(`${readable || "navigation"}-${digest}`);
}

function routeForGoal(catalog, goal) {
  const wanted = String(goal ?? "").trim().toLocaleLowerCase();
  if (!wanted) return null;
  const exact = catalog.routes.filter((route) => [
    route.id, route.name, route.app.ability, route.action, route.uri,
  ].some((value) => typeof value === "string" && value.toLocaleLowerCase() === wanted));
  if (exact.length === 1) return exact[0];
  return null;
}

async function navigate(input) {
  if (input.recording_id) {
    if (!input.success_selector && input.allow_unverified !== true) {
      throw flowError("Finishing automatic exploration requires success_selector", "FLOW_ASSERT_REQUIRED");
    }
    return {
      mode: "recorded",
      ...await recordStop({ ...input, recording_id: input.recording_id }),
    };
  }

  const projectPath = projectFrom(input);
  const repo = new JsonFlowRepository(projectPath);
  const catalog = discoverAppRoutes(projectPath);
  const declaredRoute = selectAppRoute(catalog, input) ?? routeForGoal(catalog, input.goal);
  if (!declaredRoute && (input.route_id || input.ability || input.route_action || input.uri)) {
    throw flowError(
      "No standard HarmonyOS manifest route matches the explicit Ability, Action, or URI",
      "FLOW_ROUTE_NOT_FOUND",
      "Call ui_flow action=routes to inspect declared routes, or omit route fields to use a saved/explored UI flow.",
    );
  }
  if (declaredRoute) {
    if (!declaredRoute.launchable && !input.uri) {
      throw flowError(
        `Route ${declaredRoute.id} has a dynamic URI; pass a concrete uri that matches its manifest pattern`,
        "FLOW_ROUTE_URI_REQUIRED",
      );
    }
    const routeFlow = validateFlow({
      version: 1,
      id: navigationFlowId({ id: `route-${crypto.createHash("sha256").update(declaredRoute.id).digest("hex").slice(0, 12)}` }),
      name: input.name ?? input.goal ?? declaredRoute.name,
      app: declaredRoute.app,
      start: { mode: input.start_policy ?? "restart" },
      variables: {}, steps: [],
      ...(input.success_selector ? {
        assert: {
          [input.success_state === "hidden" ? "hidden" : "visible"]: input.success_selector,
          timeoutMs: input.success_timeout_ms ?? 5000,
        },
      } : {}),
    }, { allowUnverified: !input.success_selector });
    const result = await run({ ...input, project_path: projectPath }, routeFlow, {
      route: declaredRoute,
      uri: input.uri,
      want_parameters: input.want_parameters ?? {},
      persistHealing: false,
    });
    return { mode: "direct-route", route: declaredRoute, execution: result };
  }

  let flow = null;
  let matchReport = null;
  if (input.id) {
    try { flow = repo.get(input.id); } catch (error) {
      if (error.code !== "FLOW_NOT_FOUND") throw error;
    }
  } else {
    matchReport = repo.findForNavigation(input.goal ?? input.name, { bundleName: catalog.bundleName });
    if (matchReport.ambiguous) {
      throw flowError(
        `Several saved flows match this navigation: ${matchReport.candidates.map((item) => item.id).join(", ")}`,
        "FLOW_NAVIGATION_AMBIGUOUS",
        "Pass the intended flow id; ArkPilot will not replay a plausible wrong navigation.",
      );
    }
    flow = matchReport.match;
  }
  if (flow) {
    return {
      mode: "replay",
      matchedFlow: { id: flow.id, name: flow.name },
      execution: await run({ ...input, id: flow.id, project_path: projectPath }, flow),
    };
  }
  if (!repo.config.autoRecord) {
    throw flowError("No saved flow matches and automatic recording is disabled", "FLOW_NOT_FOUND");
  }
  const id = navigationFlowId(input);
  const started = await recordStart({
    ...input,
    project_path: projectPath,
    id,
    name: input.name ?? input.goal ?? id,
    prefer_main: true,
  });
  return {
    mode: "explore",
    status: "EXPLORING",
    recording: started,
    consideredFlows: matchReport?.candidates ?? [],
    nextAction: {
      instruction: "Explore with ui_observe and semantic ui_tap. Successful ui_tap actions are recorded automatically. When the goal is visible, call ui_flow navigate again with recording_id and success_selector to verify and save.",
      tool: "ui_flow",
      arguments: { action: "navigate", recording_id: started.recordingId, success_selector: "<final semantic selector>" },
    },
  };
}

function requireJob(id) {
  const job = jobs.get(String(id ?? ""));
  if (!job) throw flowError(`UI flow job not found: ${id ?? ""}`, "FLOW_JOB_NOT_FOUND");
  return job;
}

export async function uiFlow(input = {}) {
  const action = input.action;
  if (action === "navigate") return navigate(input);
  if (action === "routes") return discoverAppRoutes(projectFrom(input));
  if (action === "driver_status") {
    const repo = repository(input);
    return {
      configured: repo.config.driver,
      hdcShell: { available: true, default: repo.config.driver === "hdc-shell" },
      hypium: await hypiumAdapter.availability({ performanceGate: repo.config.hypiumPerformanceGate }),
    };
  }
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
