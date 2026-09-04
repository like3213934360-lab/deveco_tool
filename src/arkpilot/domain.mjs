const FLOW_ACTIONS = new Set([
  "tap", "doubleTap", "longTap", "input", "key", "swipe", "fling", "drag",
  "waitVisible", "waitHidden", "assertVisible", "assertHidden",
]);

const SELECTOR_ACTIONS = new Set([
  "tap", "doubleTap", "longTap", "input", "waitVisible", "waitHidden",
  "assertVisible", "assertHidden",
]);

const GESTURE_ACTIONS = new Set(["swipe", "fling", "drag"]);
const VARIABLE_REFERENCE = /^\$\{([A-Za-z][A-Za-z0-9_]*)\}$/;
const FLOW_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export function flowError(message, code, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  return error;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw flowError(`${label} must be an object`, "FLOW_INVALID");
  }
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw flowError(`${label} must be a non-empty string`, "FLOW_INVALID");
  }
  return value.trim();
}

function timeout(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 600000) {
    throw flowError(`${label} must be an integer between 100 and 600000`, "FLOW_INVALID");
  }
  return parsed;
}

export function validateFlowId(value) {
  const id = nonEmpty(value, "flow.id");
  if (!FLOW_ID.test(id)) {
    throw flowError(
      "flow.id must be a 1-64 character lowercase slug containing only letters, digits, _ or -",
      "FLOW_ID_INVALID",
    );
  }
  return id;
}

export function normalizeSelector(value, { required = true } = {}) {
  if (value === undefined && !required) return null;
  const source = object(value, "selector");
  const selector = {};
  if (typeof source.key === "string" && source.key.trim()) selector.key = source.key.trim();
  if (typeof source.text === "string" && source.text.trim()) selector.text = source.text.trim();
  if (typeof source.type === "string" && source.type.trim()) selector.type = source.type.trim();
  if (source.clickableOnly === true) selector.clickableOnly = true;
  if (source.textMode !== undefined) {
    if (!selector.text || !["exact", "contains"].includes(source.textMode)) {
      throw flowError("selector.textMode requires text and must be exact or contains", "FLOW_SELECTOR_INVALID");
    }
    selector.textMode = source.textMode;
  }
  if (!selector.key && !selector.text && !selector.type) {
    throw flowError("selector requires key, text, or type", "FLOW_SELECTOR_INVALID");
  }
  return selector;
}

export function selectorStrength(step) {
  if (step?.selector?.key) return 3;
  if (step?.selector && (step.selector.text || step.selector.type)) return 2;
  if (step?.point) return 1;
  return 0;
}

function percent(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw flowError(`${label} must be between 0 and 100`, "FLOW_INVALID");
  }
  return parsed;
}

function normalizeStep(value, index, variables) {
  const source = object(value, `steps[${index}]`);
  const action = nonEmpty(source.action, `steps[${index}].action`);
  if (!FLOW_ACTIONS.has(action)) {
    throw flowError(`Unsupported flow action: ${action}`, "FLOW_ACTION_INVALID");
  }
  const step = {
    id: nonEmpty(source.id ?? `step-${index + 1}`, `steps[${index}].id`),
    action,
    timeoutMs: timeout(source.timeoutMs, 5000, `steps[${index}].timeoutMs`),
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(step.id)) {
    throw flowError(`Invalid step id: ${step.id}`, "FLOW_INVALID");
  }

  if (SELECTOR_ACTIONS.has(action)) {
    if (source.point) {
      const point = object(source.point, `steps[${index}].point`);
      step.point = {
        xPercent: percent(point.xPercent, "xPercent"),
        yPercent: percent(point.yPercent, "yPercent"),
      };
      step.fragile = true;
    } else {
      step.selector = normalizeSelector(source.selector);
      if (source.alternates !== undefined) {
        if (!Array.isArray(source.alternates) || source.alternates.length > 5) {
          throw flowError(`steps[${index}].alternates must contain at most five selectors`, "FLOW_SELECTOR_INVALID");
        }
        const seen = new Set([JSON.stringify(step.selector)]);
        step.alternates = source.alternates.map((candidate) => normalizeSelector(candidate))
          .filter((candidate) => {
            const signature = JSON.stringify(candidate);
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
          });
        if (step.alternates.length === 0) delete step.alternates;
      }
    }
  }
  if (action === "input") {
    const valueReference = nonEmpty(source.value, `steps[${index}].value`);
    const match = VARIABLE_REFERENCE.exec(valueReference);
    if (!match || !Object.hasOwn(variables, match[1])) {
      throw flowError(`Input step ${step.id} must reference a declared variable`, "FLOW_VARIABLE_INVALID");
    }
    step.value = valueReference;
  }
  if (action === "key") {
    step.key = nonEmpty(source.key, `steps[${index}].key`);
    if (!/^[A-Za-z0-9_]+$/.test(step.key)) {
      throw flowError(`Invalid key name in step ${step.id}`, "FLOW_INVALID");
    }
  }
  if (GESTURE_ACTIONS.has(action)) {
    const gesture = object(source.gesture, `steps[${index}].gesture`);
    step.gesture = {
      fromXPercent: percent(gesture.fromXPercent, "fromXPercent"),
      fromYPercent: percent(gesture.fromYPercent, "fromYPercent"),
      toXPercent: percent(gesture.toXPercent, "toXPercent"),
      toYPercent: percent(gesture.toYPercent, "toYPercent"),
    };
    if (gesture.velocity !== undefined) {
      const velocity = Number(gesture.velocity);
      if (!Number.isInteger(velocity) || velocity < 200 || velocity > 40000) {
        throw flowError("gesture.velocity must be an integer between 200 and 40000", "FLOW_INVALID");
      }
      step.gesture.velocity = velocity;
    }
    step.fragile = source.fragile !== false;
  }
  return step;
}

export function validateFlow(value, { allowUnverified = false } = {}) {
  const source = object(value, "flow");
  if (source.version !== 1) {
    throw flowError(`Unsupported flow version: ${String(source.version)}`, "FLOW_VERSION_UNSUPPORTED");
  }
  const id = validateFlowId(source.id);
  const app = object(source.app, "flow.app");
  const variables = {};
  for (const [name, definition] of Object.entries(source.variables ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw flowError(`Invalid variable name: ${name}`, "FLOW_VARIABLE_INVALID");
    }
    const details = object(definition, `variables.${name}`);
    variables[name] = { required: details.required !== false, secret: details.secret !== false };
  }
  if (!Array.isArray(source.steps)) throw flowError("flow.steps must be an array", "FLOW_INVALID");
  const steps = source.steps.map((step, index) => normalizeStep(step, index, variables));
  const ids = steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) throw flowError("Flow step ids must be unique", "FLOW_INVALID");

  let assertion = null;
  if (source.assert !== undefined) {
    const rawAssert = object(source.assert, "flow.assert");
    const kind = rawAssert.visible ? "visible" : rawAssert.hidden ? "hidden" : null;
    if (!kind || (rawAssert.visible && rawAssert.hidden)) {
      throw flowError("flow.assert requires exactly one of visible or hidden", "FLOW_ASSERT_INVALID");
    }
    assertion = {
      [kind]: normalizeSelector(rawAssert[kind]),
      timeoutMs: timeout(rawAssert.timeoutMs, 5000, "flow.assert.timeoutMs"),
    };
    if (rawAssert.alternates !== undefined) {
      if (!Array.isArray(rawAssert.alternates) || rawAssert.alternates.length > 5) {
        throw flowError("flow.assert.alternates must contain at most five selectors", "FLOW_SELECTOR_INVALID");
      }
      const seen = new Set([JSON.stringify(assertion[kind])]);
      assertion.alternates = rawAssert.alternates.map((candidate) => normalizeSelector(candidate))
        .filter((candidate) => {
          const signature = JSON.stringify(candidate);
          if (seen.has(signature)) return false;
          seen.add(signature);
          return true;
        });
      if (assertion.alternates.length === 0) delete assertion.alternates;
    }
  } else if (!allowUnverified) {
    throw flowError("A final assertion is required", "FLOW_ASSERT_REQUIRED");
  }

  const mode = source.start?.mode ?? "restart";
  if (mode !== "restart" && mode !== "attach") {
    throw flowError("flow.start.mode must be restart or attach", "FLOW_INVALID");
  }
  return {
    version: 1,
    id,
    name: nonEmpty(source.name, "flow.name"),
    app: {
      bundleName: nonEmpty(app.bundleName, "flow.app.bundleName"),
      module: nonEmpty(app.module, "flow.app.module"),
      ability: nonEmpty(app.ability, "flow.app.ability"),
    },
    start: { mode },
    variables,
    steps,
    ...(assertion ? { assert: assertion } : {}),
  };
}

export function variablesForRun(flow, supplied = {}) {
  object(supplied, "variables");
  const resolved = {};
  for (const [name, definition] of Object.entries(flow.variables)) {
    if (definition.required && (supplied[name] === undefined || supplied[name] === null)) {
      throw flowError(`Required flow variable is missing: ${name}`, "FLOW_VARIABLE_REQUIRED");
    }
    if (supplied[name] !== undefined) resolved[name] = String(supplied[name]);
  }
  const unknown = Object.keys(supplied).filter((name) => !Object.hasOwn(flow.variables, name));
  if (unknown.length) throw flowError(`Unknown flow variables: ${unknown.join(", ")}`, "FLOW_VARIABLE_UNKNOWN");
  return resolved;
}

export function variableName(reference) {
  return VARIABLE_REFERENCE.exec(reference)?.[1] ?? null;
}

export const flowInternals = { FLOW_ACTIONS, SELECTOR_ACTIONS, GESTURE_ACTIONS };
