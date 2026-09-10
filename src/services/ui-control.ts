import type { z } from "zod";
import { controlSchema, selectorSchema } from "../core/contracts.js";
import { invariant } from "../core/errors.js";
import type { Snapshot } from "./device.js";
import type { Rect, UiNode } from "./ui-tree.js";
import { isWindowSurface } from "./ui-tree.js";

type Control = z.infer<typeof controlSchema>;
export const needsControlSnapshot = (input: Control) =>
  !!(input.selector || input.window || input.point || input.gesture);

/** Coordinates are relative to one identified rectangle and clamp to its last usable pixel. */
export function percentagePoint(
  rect: Rect,
  point: { xPercent: number; yPercent: number },
) {
  const coordinate = (low: number, high: number, percent: number) => {
    const min = Math.max(1, Math.ceil(low)),
      max = Math.ceil(high) - 1;
    invariant(
      Number.isFinite(percent) && percent >= 0 && percent <= 100 && min <= max,
      "UI_COORDINATES_INVALID",
      "Window has no usable UiTest coordinates or percentage is outside 0–100",
    );
    return Math.max(
      min,
      Math.min(max, Math.round(low + ((high - low) * percent) / 100)),
    );
  };
  return {
    x: coordinate(rect.x1, rect.x2, point.xPercent),
    y: coordinate(rect.y1, rect.y2, point.yPercent),
  };
}
export function controlDisplay(node: UiNode): number | undefined {
  if (node.displayId === null) return undefined;
  invariant(
    /^\d+$/.test(node.displayId) && Number(node.displayId) <= 2147483647,
    "UI_DISPLAY_INVALID",
    "UI node has an invalid display identity",
  );
  return Number(node.displayId);
}

/** Resolve once under the device lease; callers can reuse this result for recording and execution. */
export function resolveControl(input: Control, snapshot?: Snapshot): Control {
  const output = { ...input };
  if (input.action.startsWith("mouse") || input.action === "text") {
    invariant(input.window || (input.action !== "text" && input.selector?.bundle_name), "UI_SCOPE_REQUIRED", "Focused text and mouse actions require an explicit application/window scope; never infer the destination from screen coordinates");
  }
  if (input.action === "text") invariant(!input.selector && !input.point && !input.gesture && [input.x,input.y,input.x2,input.y2].every(value => value === undefined), "UI_INPUT_CONFLICT", "Focused text uses the current field in the specified window; do not provide coordinates or a selector");
  const relative = !!(input.point || input.gesture),
    endpoints = [input.x, input.y, input.x2, input.y2].some(
      (value) => value !== undefined,
    );
  invariant(
    !(input.point && input.gesture) &&
      !(relative && endpoints) &&
      !(input.selector && endpoints),
    "UI_INPUT_CONFLICT",
    "Choose absolute coordinates or percentages within one selector or window",
  );
  invariant(
    !relative || input.window || input.selector,
    "UI_WINDOW_REQUIRED",
    "Percentages require a unique selector or an explicit window id or bundle_name",
  );
  const moving = ["swipe", "fling", "drag", "mouseMoveWithTrack", "mouseDrag"].includes(input.action);
  invariant(
    !input.gesture || moving,
    "UI_INPUT_CONFLICT",
    "Gesture percentages require swipe, fling or drag",
  );
  invariant(
    !input.point || !moving,
    "UI_INPUT_CONFLICT",
    "Moving gestures require two endpoints",
  );
  invariant(
    !input.gesture?.velocity || input.velocity === undefined,
    "UI_INPUT_CONFLICT",
    "Specify gesture velocity once",
  );
  invariant(
    input.gesture?.stepLength === undefined || input.step_length === undefined,
    "UI_INPUT_CONFLICT",
    "Specify gesture step length once",
  );
  let window: UiNode | undefined;
  let coordinateRect: Rect | undefined;
  if (needsControlSnapshot(input)) {
    invariant(
      snapshot,
      "UI_SNAPSHOT_REQUIRED",
      "UI coordinates need a current snapshot",
    );
    if (input.window) {
      const windows = snapshot.nodes.filter(
        (node) =>
          isWindowSurface(node) &&
          node.rect &&
          node.visible !== false &&
          (!input.window!.id || node.windowId === input.window!.id) &&
          (!input.window!.bundle_name ||
            node.bundleName === input.window!.bundle_name) &&
          (input.display_id === undefined ||
            node.displayId === String(input.display_id)),
      );
      invariant(
        windows.length === 1 && windows[0]?.rect,
        "UI_WINDOW_AMBIGUOUS",
        `Expected one identified window, found ${windows.length}`,
      );
      window = windows[0];
      coordinateRect = window.rect!;
      output.display_id = controlDisplay(window) ?? input.display_id;
    }
    if (input.action === "text") {
      const fields = snapshot.nodes.filter(node => node.focused === true && node.enabled !== false && node.visible !== false && /TextInput|TextArea|Search/.test(node.type ?? "") && node.windowId === window?.windowId && node.displayId === window?.displayId && (!input.window?.bundle_name || node.bundleName === input.window.bundle_name));
      invariant(fields.length === 1, "UI_FOCUS_AMBIGUOUS", `Expected exactly one focused editable field in the selected window, found ${fields.length}. Inspect the window and explicitly focus a field first.`);
      output.display_id = controlDisplay(fields[0]!) ?? input.display_id;
    }
    if (input.selector) {
      const selector = input.selector;
      invariant(
        input.display_id === undefined ||
          selector.displayId === undefined ||
          String(input.display_id) === String(selector.displayId),
        "UI_INPUT_CONFLICT",
        "Selector and operation name different displays",
      );
      const matches = snapshot.query
        .select(
          selectorSchema.parse({
            ...selector,
            ...(input.display_id === undefined
              ? {}
              : { displayId: input.display_id }),
          }),
        )
        .filter(
          (node) =>
            !window ||
            (node.windowId === window.windowId &&
              node.displayId === window.displayId),
        );
      invariant(
        matches.length === 1 && matches[0]?.rect,
        "UI_TARGET_AMBIGUOUS",
        `Expected one target, found ${matches.length}`,
      );
      const node = matches[0];
      invariant(node.enabled !== false, "UI_DISABLED", "Target is disabled");
      coordinateRect = node.rect!;
      Object.assign(
        output,
        percentagePoint(node.rect!, { xPercent: 50, yPercent: 50 }),
      );
      output.display_id = controlDisplay(node) ?? input.display_id;
    }
  }
  if (coordinateRect) {
    if (input.point)
      Object.assign(output, percentagePoint(coordinateRect, input.point));
    if (input.gesture) {
      const from = percentagePoint(coordinateRect, {
          xPercent: input.gesture.fromXPercent,
          yPercent: input.gesture.fromYPercent,
        }),
        to = percentagePoint(coordinateRect, {
          xPercent: input.gesture.toXPercent,
          yPercent: input.gesture.toYPercent,
        });
      Object.assign(output, from, {
        x2: to.x,
        y2: to.y,
        velocity: input.gesture.velocity ?? input.velocity,
        step_length: input.gesture.stepLength ?? input.step_length,
      });
    }
  }
  if (window?.rect) {
    for (const [x, y] of [
      [output.x, output.y],
      [output.x2, output.y2],
    ])
      if (x !== undefined || y !== undefined)
        invariant(
          x !== undefined &&
            y !== undefined &&
            x >= window.rect.x1 &&
            x < window.rect.x2 &&
            y >= window.rect.y1 &&
            y < window.rect.y2,
          "UI_COORDINATES_INVALID",
          "Coordinates are outside the selected window",
        );
  }
  delete output.selector;
  delete output.window;
  delete output.point;
  delete output.gesture;
  return output;
}

/** Modern uiInput positional protocol. Fill optional slots before appending a display ID. */
export function uiInputArguments(input: Control): string[] {
  const {
    action,
    display_id: targetDisplay,
    velocity,
    step_length: step,
  } = input;
  invariant(
    !needsControlSnapshot(input),
    "UI_CONTROL_UNRESOLVED",
    "Resolve UI coordinates before constructing a command",
  );
  const moving = ["swipe", "fling", "drag", "dircFling", "mouseMoveWithTrack", "mouseDrag"].includes(action);
  const mouse = action.startsWith("mouse");
  invariant(mouse || [input.button, input.scroll_down, input.ticks, input.mouse_scroll_speed].every(value => value === undefined), "UI_INPUT_CONFLICT", "Mouse fields only apply to mouse actions");
  if (mouse) { mouseRequest(input); return []; }
  invariant(
    velocity === undefined || moving,
    "UI_INPUT_CONFLICT",
    "Velocity only applies to a gesture",
  );
  invariant(
    step === undefined || ["fling", "dircFling"].includes(action),
    "UI_INPUT_CONFLICT",
    "Step length only applies to fling",
  );
  invariant(
    input.text === undefined || ["inputText", "text"].includes(action),
    "UI_INPUT_CONFLICT",
    "Text only applies to inputText",
  );
  invariant(
    input.keys === undefined || action === "keyEvent",
    "UI_INPUT_CONFLICT",
    "Keys only apply to keyEvent",
  );
  invariant(
    input.direction === undefined || action === "dircFling",
    "UI_INPUT_CONFLICT",
    "Direction only applies to dircFling",
  );
  const args: string[] = [action];
  if (action === "keyEvent") {
    invariant(input.keys?.length, "UI_KEYS_REQUIRED", "Keys required");
    const aliases: Record<string, string> = { back: "Back", home: "Home", power: "Power" };
    const keys = input.keys.map(key => aliases[key.toLowerCase()] ?? key),
      named = ["Home", "Back", "Power"].includes(keys[0]!);
    invariant(
      named
        ? keys.length === 1
        : keys.every(
            (key) => /^[1-9]\d*$/.test(key) && Number(key) <= 2147483647,
          ),
      "UI_KEYS_INVALID",
      "Use a single Home/Back/Power or one to three numeric key codes",
    );
    // Numeric keys reserve three slots; 0 is the native KEYCODE_NONE value.
    if (!named && targetDisplay !== undefined)
      while (keys.length < 3) keys.push("0");
    args.push(...keys);
  } else if (action === "text") {
    invariant(input.text && input.text.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text) && Buffer.byteLength(input.text) <= 60000, "UI_TEXT_INVALID", "Focused text requires valid Unicode of at most 60000 bytes without unsafe controls");
    args.push(input.text);
  } else if (action === "dircFling") {
    invariant(
      input.direction !== undefined,
      "UI_DIRECTION_REQUIRED",
      "Direction required",
    );
    args.push(String(input.direction));
    if (
      velocity !== undefined ||
      step !== undefined ||
      targetDisplay !== undefined
    )
      args.push(String(velocity ?? 600));
    // This native slot is the sample count despite its CLI name stepLength.
    if (step !== undefined || targetDisplay !== undefined)
      args.push(String(step ?? 50));
  } else {
    invariant(
      input.x !== undefined &&
        input.y !== undefined &&
        [input.x, input.y].every(
          (n) => Number.isInteger(n) && n > 0 && n <= 2147483647,
        ),
      "UI_COORDINATES_REQUIRED",
      "Use a unique selector or positive x/y coordinates. For the currently focused field use action=text with an explicit window scope.",
    );
    args.push(String(input.x), String(input.y));
    if (moving) {
      invariant(
        input.x2 !== undefined &&
          input.y2 !== undefined &&
          [input.x2, input.y2].every(
            (n) => Number.isInteger(n) && n > 0 && n <= 2147483647,
          ),
        "UI_COORDINATES_REQUIRED",
        "UiTest requires positive int32 endpoints",
      );
      const distance = Math.floor(
        Math.hypot(input.x2 - input.x, input.y2 - input.y),
      );
      invariant(
        distance > 0 && distance <= 32767,
        "UI_GESTURE_INVALID",
        "Gesture distance must be 1–32767 pixels for native integer arithmetic",
      );
      invariant(
        step === undefined || step <= distance,
        "UI_GESTURE_INVALID",
        "Fling step length exceeds its distance",
      );
      args.push(String(input.x2), String(input.y2));
      if (
        velocity !== undefined ||
        step !== undefined ||
        targetDisplay !== undefined
      )
        args.push(String(velocity ?? 600));
      if (
        action === "fling" &&
        (step !== undefined || targetDisplay !== undefined)
      )
        args.push(String(step ?? Math.max(1, Math.floor(distance / 50))));
    } else
      invariant(
        input.x2 === undefined && input.y2 === undefined,
        "UI_INPUT_CONFLICT",
        "Endpoint coordinates require a gesture",
      );
    if (action === "inputText") {
      invariant(
        input.text !== undefined,
        "UI_INPUT_REQUIRED",
        "Input text required",
      );
      args.push(input.text);
    }
  }
  if (["keyEvent", "dircFling", "text"].includes(action))
    invariant(
      [input.x, input.y, input.x2, input.y2].every(
        (value) => value === undefined,
      ),
      "UI_INPUT_CONFLICT",
      "Key and directional operations do not accept coordinates",
    );
  if (targetDisplay !== undefined) args.push(String(targetDisplay));
  return args;
}


export function mouseRequest(input: Control) {
  const actions = ["mouseClick", "mouseDoubleClick", "mouseLongClick", "mouseMoveTo", "mouseScroll", "mouseMoveWithTrack", "mouseDrag"] as const;
  invariant(actions.some(action => action === input.action), "UI_MOUSE_ACTION_INVALID", "Unknown native mouse action");
  invariant(!needsControlSnapshot(input), "UI_CONTROL_UNRESOLVED", "Resolve mouse coordinates in its application window first");
  const point = (x?: number, y?: number) => {
    invariant(x !== undefined && y !== undefined && [x,y].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647), "UI_COORDINATES_REQUIRED", "Mouse actions require positive int32 coordinates");
    return { x, y, ...(input.display_id === undefined ? {} : { displayId: input.display_id }) };
  };
  invariant(input.text === undefined && input.direction === undefined && input.step_length === undefined, "UI_INPUT_CONFLICT", "Text, directional fling and step length do not apply to mouse actions");
  const args: unknown[] = [point(input.x, input.y)], moving = ["mouseMoveWithTrack", "mouseDrag"].includes(input.action), click = ["mouseClick", "mouseDoubleClick", "mouseLongClick"].includes(input.action);
  invariant(moving || input.velocity === undefined, "UI_INPUT_CONFLICT", "Mouse velocity applies only to movement and drag");
  invariant(click || input.button === undefined, "UI_INPUT_CONFLICT", "Mouse button applies only to click actions");
  invariant(input.action === "mouseScroll" || [input.scroll_down,input.ticks,input.mouse_scroll_speed].every(value => value === undefined), "UI_INPUT_CONFLICT", "Scroll fields apply only to mouseScroll");
  invariant(moving || (input.x2 === undefined && input.y2 === undefined), "UI_INPUT_CONFLICT", "Mouse endpoints apply only to movement and drag");
  invariant(!input.keys || ((click || input.action === "mouseScroll") && input.keys.length <= 2 && input.keys.every(key => /^[1-9]\d*$/.test(key) && Number(key) <= 2147483647)), "UI_KEYS_INVALID", "Mouse modifiers allow up to two positive numeric key codes");
  if (click) args.push({ left: 0, right: 1, middle: 2 }[input.button ?? "left"], ...(input.keys ?? []).map(Number));
  else if (input.action === "mouseScroll") {
    invariant(input.scroll_down !== undefined && input.ticks !== undefined, "UI_SCROLL_REQUIRED", "mouseScroll requires scroll_down and ticks");
    args.push(input.scroll_down, input.ticks, Number(input.keys?.[0] ?? 0), Number(input.keys?.[1] ?? 0), input.mouse_scroll_speed ?? 20);
  } else if (moving) {
    args.push(point(input.x2, input.y2));
    if (input.velocity !== undefined) args.push(input.velocity);
  }
  return { api: `Driver.${input.action}` as `Driver.${typeof actions[number]}`, args };
}
