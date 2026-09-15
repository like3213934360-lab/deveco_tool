/** One vocabulary for native input, persisted routes, recordings and UI tests.
 * Version 1 routes remain readable; new actions require version 2 explicitly.
 * A schema entry declares an implemented adapter, never device acceptance. */
export const UI_ACTION_SCHEMA_VERSION = 2 as const;
export const UI_CONTROL_ACTIONS = [
  "click", "doubleClick", "longClick", "swipe", "fling", "drag", "dircFling",
  "keyEvent", "inputText", "text", "mouseClick", "mouseDoubleClick",
  "mouseLongClick", "mouseMoveTo", "mouseScroll", "mouseMoveWithTrack", "mouseDrag",
] as const;
export const UI_FLOW_ACTIONS = [
  "tap", "doubleTap", "longTap", "input", "key", "swipe", "fling", "drag",
  "waitVisible", "waitHidden", "assertVisible", "assertHidden", "focusInput",
  "dircFling", "mouseClick", "mouseDoubleClick", "mouseLongClick", "mouseMoveTo",
  "mouseScroll", "mouseMoveWithTrack", "mouseDrag",
] as const;
export type UiControlAction = typeof UI_CONTROL_ACTIONS[number];
export type UiFlowAction = typeof UI_FLOW_ACTIONS[number];
export const UI_ASSERTION_ACTIONS: readonly UiFlowAction[] = [
  "waitVisible", "waitHidden", "assertVisible", "assertHidden",
];
export const UI_FLOW_TO_CONTROL = {
  tap: "click", doubleTap: "doubleClick", longTap: "longClick", input: "inputText",
  key: "keyEvent", focusInput: "text", swipe: "swipe", fling: "fling", drag: "drag",
  dircFling: "dircFling", mouseClick: "mouseClick", mouseDoubleClick: "mouseDoubleClick",
  mouseLongClick: "mouseLongClick", mouseMoveTo: "mouseMoveTo", mouseScroll: "mouseScroll",
  mouseMoveWithTrack: "mouseMoveWithTrack", mouseDrag: "mouseDrag",
} as const satisfies Partial<Record<UiFlowAction, UiControlAction>>;
export const UI_CONTROL_TO_FLOW = {
  click: "tap", doubleClick: "doubleTap", longClick: "longTap", inputText: "input",
  keyEvent: "key", text: "focusInput", swipe: "swipe", fling: "fling", drag: "drag",
  dircFling: "dircFling", mouseClick: "mouseClick", mouseDoubleClick: "mouseDoubleClick",
  mouseLongClick: "mouseLongClick", mouseMoveTo: "mouseMoveTo", mouseScroll: "mouseScroll",
  mouseMoveWithTrack: "mouseMoveWithTrack", mouseDrag: "mouseDrag",
} as const satisfies Record<UiControlAction, UiFlowAction>;
export const UI_V2_ACTIONS: readonly UiControlAction[] = [
  "text", "dircFling", "mouseClick", "mouseDoubleClick", "mouseLongClick",
  "mouseMoveTo", "mouseScroll", "mouseMoveWithTrack", "mouseDrag",
];

/** Validate action-specific fields before recording or dispatch. Scope/focus
 * still needs the live tree; resolved private checkpoints intentionally no
 * longer carry selectors or windows and use this same structural contract. */
export function uiControlIssues(input: { action: UiControlAction; [key: string]: unknown }) {
  const issues: { path: string[]; message: string }[] = [];
  const allowed = new Set(["action", "display_id", "window"]);
  const moving = ["swipe", "fling", "drag", "mouseMoveWithTrack", "mouseDrag"].includes(input.action);
  const pointAction = !["keyEvent", "dircFling", "text"].includes(input.action);
  if (pointAction) for (const field of ["x", "y", "selector", "point"]) allowed.add(field);
  if (moving) for (const field of ["x2", "y2", "gesture", "velocity"]) allowed.add(field);
  if (["inputText", "text"].includes(input.action)) allowed.add("text");
  if (["fling", "dircFling"].includes(input.action)) allowed.add("step_length");
  if (input.action === "dircFling") { allowed.add("direction"); allowed.add("velocity"); }
  if (["keyEvent", "mouseClick", "mouseDoubleClick", "mouseLongClick", "mouseScroll"].includes(input.action)) allowed.add("keys");
  if (["mouseClick", "mouseDoubleClick", "mouseLongClick"].includes(input.action)) allowed.add("button");
  if (input.action === "mouseScroll") for (const field of ["scroll_down", "ticks", "mouse_scroll_speed"]) allowed.add(field);
  for (const [field, value] of Object.entries(input))
    if (value !== undefined && !allowed.has(field)) issues.push({ path: [field], message: `${field} does not apply to ${input.action}` });
  const require = (field: string) => {
    if (input[field] === undefined) issues.push({ path: [field], message: `${input.action} requires ${field}` });
  };
  if (["inputText", "text"].includes(input.action)) require("text");
  if (input.action === "keyEvent") require("keys");
  if (input.action === "dircFling") require("direction");
  if (input.action === "mouseScroll") { require("scroll_down"); require("ticks"); }
  const gesture = input.gesture as { stepLength?: number; velocity?: number } | undefined;
  if (gesture?.stepLength !== undefined && input.action !== "fling")
    issues.push({ path: ["gesture", "stepLength"], message: "Gesture stepLength only applies to fling" });
  if (input.point && input.gesture) issues.push({ path: ["point"], message: "Provide point or gesture, not both" });
  if ((input.point || input.gesture || input.selector) && [input.x, input.y, input.x2, input.y2].some(value => value !== undefined))
    issues.push({ path: ["x"], message: "Absolute coordinates cannot be combined with relative geometry or a selector" });
  if (gesture?.velocity !== undefined && input.velocity !== undefined)
    issues.push({ path: ["velocity"], message: "Specify gesture velocity once" });
  if (gesture?.stepLength !== undefined && input.step_length !== undefined)
    issues.push({ path: ["step_length"], message: "Specify gesture step length once" });
  return issues;
}

/** Stable, compact discovery; live SDK/device support remains an observation. */
export function uiActionCapabilities() {
  return {
    schema_version: UI_ACTION_SCHEMA_VERSION,
    supported_flow_versions: [1, 2],
    operations: UI_CONTROL_ACTIONS.map(action => ({
      action,
      flow_action: UI_CONTROL_TO_FLOW[action],
      minimum_flow_version: UI_V2_ACTIONS.includes(action) ? 2 : 1,
      implementation: "native" as const,
      recording: "requires_unique_application_window" as const,
      ...(action === "keyEvent" ? { recording_constraint: "Version 1 supports a single key; key chords require version 2" } : {}),
      ...(action === "inputText" || action === "text" ? {
        input_storage: "runtime_values_encrypted; saved_flow_contains_variable_reference_only",
      } : {}),
      environment_support: "requires_device_observation" as const,
      outcome_verified: false,
    })),
    assertions: UI_ASSERTION_ACTIONS,
  };
}
