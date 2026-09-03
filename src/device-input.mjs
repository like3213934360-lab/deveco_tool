/**
 * @file Building and validating a `uitest uiInput` command line, and picking what to aim it at.
 * @author deveco-tool
 *
 * Everything here is pure: it decides what to send, never sends it. That is worth a module of its
 * own because the rules encoded below are not obvious from the code they guard -- they are
 * measurements of how hdc hands arguments to the device shell, and of what a layout dump does when
 * you ask it for "the button that says 首页".
 */

function fail(message, code, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  throw error;
}

export const TAP_ACTIONS = new Set([
  "click", "doubleClick", "longClick", "swipe", "fling", "drag", "dircFling", "inputText", "keyEvent",
]);

/** Actions a selector can aim, because they take exactly one point. */
export const POINT_ACTIONS = new Set(["click", "doubleClick", "longClick"]);
export const RECT_GESTURE_ACTIONS = new Set(["swipe", "fling", "drag"]);

/**
 * `hdc shell a b c` joins its arguments into one command line and wraps any argument containing
 * whitespace in double quotes of its own, so what the device shell finally parses depends on
 * whether the text has a space in it. Both regimes were measured on a real device:
 *
 *   - No whitespace: the argument is passed through untouched, so a single-quoted form is unquoted
 *     by the device shell exactly once and everything inside arrives literally. Backtick, $, ~, ;,
 *     |, >, ", parentheses and globs were each confirmed inert this way.
 *   - Whitespace: hdc's own double quotes already make parentheses, globs, #, ~ and ; inert, but
 *     $, a backtick and a backslash stay live inside them, and a double quote closes the wrapper
 *     outright -- `a" ; id ; "b` ran id. Our own quoting cannot help in this regime: it lands
 *     inside hdc's quotes and reaches the input field as literal characters nobody typed.
 *
 * Hence: quote whatever has no whitespace and accept it whatever it contains, and screen the rest
 * for exactly the four characters that survive. This replaced an allowlist of permitted characters,
 * which had the two failures such a list tends to have -- it passed `(` and `)`, which are a hard
 * `/bin/sh: syntax error` in the first regime, and it rejected every CJK punctuation mark, since
 * `，` and `。` are in neither \p{L}, \p{M} nor \p{N}.
 *
 * `test/device-canary.test.mjs` pins both regimes against a real device, because this is a
 * measurement of someone else's binary and an SDK upgrade could quietly invalidate it.
 */
const ACTIVE_INSIDE_HDC_QUOTES = /["$`\\]/;

/** uiInput cannot type these, and a newline would end the command line hdc builds. */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]");

/**
 * Render text as one argv element that reaches `uitest uiInput` unchanged.
 *
 * @param {string} text Text the caller wants typed.
 * @returns {string} The argument to pass, quoted where quoting is what protects it.
 */
export function deviceTextArgument(text) {
  if (CONTROL_CHARACTERS.test(text)) {
    fail("text may not contain control characters", "UI_ARGS_INVALID");
  }
  if (!/\s/.test(text)) {
    // The standard sh idiom for a single quote inside a single-quoted string: close, escape, reopen.
    // It introduces no whitespace, so the result stays in the regime where quoting works at all.
    return `'${text.split("'").join("'\\''")}'`;
  }
  if (ACTIVE_INSIDE_HDC_QUOTES.test(text)) {
    fail(
      "text mixes whitespace with a character the device shell still expands inside hdc's quoting",
      "UI_ARGS_INVALID",
      'Remove the " $ ` or \\, remove the spaces, or use perform_ui_action for this text.',
    );
  }
  return text;
}

function requireCoordinate(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`${name} must be a non-negative integer`, "UI_ARGS_INVALID");
  }
  return parsed;
}

/**
 * Translate tool arguments into the argv `uitest uiInput` expects.
 *
 * @param {object} input Tool arguments.
 * @returns {string[]} Arguments after `uiInput`.
 */
export function buildInputArgs(input) {
  const action = input.action;
  if (POINT_ACTIONS.has(action)) {
    return [action, String(requireCoordinate(input.x, "x")), String(requireCoordinate(input.y, "y"))];
  }
  if (["swipe", "fling", "drag"].includes(action)) {
    const args = [
      action,
      String(requireCoordinate(input.x, "x")),
      String(requireCoordinate(input.y, "y")),
      String(requireCoordinate(input.x2, "x2")),
      String(requireCoordinate(input.y2, "y2")),
    ];
    if (input.velocity !== undefined && input.velocity !== null) {
      args.push(String(requireCoordinate(input.velocity, "velocity")));
    }
    return args;
  }
  if (action === "dircFling") {
    const direction = Number(input.direction);
    if (![0, 1, 2, 3].includes(direction)) {
      fail("direction must be 0 (left), 1 (right), 2 (toward the top), or 3 (toward the bottom)", "UI_ARGS_INVALID");
    }
    const args = ["dircFling", String(direction)];
    if (input.velocity !== undefined && input.velocity !== null) {
      args.push(String(requireCoordinate(input.velocity, "velocity")));
    }
    if (input.stepLength !== undefined && input.stepLength !== null) {
      args.push(String(requireCoordinate(input.stepLength, "stepLength")));
    }
    return args;
  }
  if (action === "inputText") {
    const text = typeof input.text === "string" ? input.text : "";
    if (!text) fail("text is required for inputText", "UI_ARGS_INVALID");
    return [
      "inputText",
      String(requireCoordinate(input.x, "x")),
      String(requireCoordinate(input.y, "y")),
      deviceTextArgument(text),
    ];
  }
  const keys = [input.key1, input.key2, input.key3]
    .filter((entry) => entry !== undefined && entry !== null && String(entry).trim())
    .map((entry) => String(entry).trim());
  if (!keys.length) fail("key1 is required for keyEvent", "UI_ARGS_INVALID");
  if (keys.some((entry) => !/^[A-Za-z0-9_]+$/.test(entry))) {
    fail("key names may only contain letters, digits, and underscores", "UI_ARGS_INVALID");
  }
  return ["keyEvent", ...keys];
}

function requirePercent(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    fail(`${name} must be a number between 0 and 100`, "UI_ARGS_INVALID");
  }
  return parsed;
}

/**
 * Build a gesture inside a selected node instead of relying on screenshot coordinates.
 * Horizontal percentages run left-to-right; vertical percentages run bottom-to-top, matching
 * the usual meaning of a slider value. A small edge inset lands on an endpoint thumb rather than
 * just outside the component's interactive track.
 *
 * @param {object} input Tool arguments.
 * @param {{rect: number[]}} target Selected node returned by analyseDump.
 * @returns {string[]} Arguments after `uiInput`.
 */
export function buildTargetGestureArgs(input, target) {
  if (!RECT_GESTURE_ACTIONS.has(input.action)) {
    fail(`${input.action} cannot use a percentage gesture`, "UI_ARGS_INVALID");
  }
  if (!Array.isArray(target?.rect) || target.rect.length !== 4) {
    fail("The selected node has no usable bounds", "UI_TARGET_BOUNDS_MISSING");
  }
  const fromPercent = requirePercent(input.from_percent, "from_percent");
  const toPercent = requirePercent(input.to_percent, "to_percent");
  const axis = input.axis ?? "horizontal";
  if (axis !== "horizontal" && axis !== "vertical") {
    fail("axis must be horizontal or vertical", "UI_ARGS_INVALID");
  }

  const [x1, y1, x2, y2] = target.rect.map(Number);
  const width = x2 - x1;
  const height = y2 - y1;
  if (!(width > 0) || !(height > 0)) {
    fail("The selected node has zero-area bounds", "UI_TARGET_BOUNDS_MISSING");
  }

  let pointAt;
  if (axis === "horizontal") {
    const inset = Math.min(height / 2, width * 0.05);
    const usable = Math.max(0, width - (2 * inset));
    pointAt = (percent) => ({
      x: Math.round(x1 + inset + ((usable * percent) / 100)),
      y: Math.round((y1 + y2) / 2),
    });
  } else {
    const inset = Math.min(width / 2, height * 0.05);
    const usable = Math.max(0, height - (2 * inset));
    pointAt = (percent) => ({
      x: Math.round((x1 + x2) / 2),
      y: Math.round(y2 - inset - ((usable * percent) / 100)),
    });
  }

  const from = pointAt(fromPercent);
  const to = pointAt(toPercent);
  return buildInputArgs({ ...input, x: from.x, y: from.y, x2: to.x, y2: to.y });
}

/**
 * Build a raw gesture from percentages of the current device screen.
 *
 * Unlike selector percentages, both axes use normal screen coordinates: x grows left-to-right
 * and y grows top-to-bottom. This is the stable fallback for controls omitted from dumpLayout --
 * it preserves the intended location across devices without pretending that a missing node can be
 * semantically selected or verified.
 *
 * @param {object} input Tool arguments.
 * @param {number[]} screen Root screen rectangle [x1, y1, x2, y2].
 * @returns {string[]} Arguments after `uiInput`.
 */
export function buildScreenGestureArgs(input, screen) {
  if (!RECT_GESTURE_ACTIONS.has(input.action)) {
    fail(`${input.action} cannot use a screen-percentage gesture`, "UI_ARGS_INVALID");
  }
  if (!Array.isArray(screen) || screen.length !== 4) {
    fail("The UI dump has no usable screen bounds", "UI_SCREEN_BOUNDS_MISSING");
  }
  const [x1, y1, x2, y2] = screen.map(Number);
  if (!(x2 > x1) || !(y2 > y1)) {
    fail("The UI dump has invalid screen bounds", "UI_SCREEN_BOUNDS_MISSING");
  }
  const fromX = requirePercent(input.from_x_percent, "from_x_percent");
  const fromY = requirePercent(input.from_y_percent, "from_y_percent");
  const toX = requirePercent(input.to_x_percent, "to_x_percent");
  const toY = requirePercent(input.to_y_percent, "to_y_percent");
  const point = (xPercent, yPercent) => ({
    x: Math.round(x1 + (((x2 - x1) * xPercent) / 100)),
    y: Math.round(y1 + (((y2 - y1) * yPercent) / 100)),
  });
  const from = point(fromX, fromY);
  const to = point(toX, toY);
  return buildInputArgs({ ...input, x: from.x, y: from.y, x2: to.x, y2: to.y });
}

function describeCandidate(match) {
  const label = match.text ? ` "${match.text}"` : "";
  const key = match.key ? ` key=${match.key}` : "";
  return `${match.type}${label}${key} @${match.center.x},${match.center.y}`;
}

/**
 * Resolve a selector to the one node to aim at.
 *
 * Nothing is guessed between real alternatives. An agent handed "the first of six matches" has no
 * way to know it hit the wrong one, whereas a refusal that lists the candidates is actionable.
 *
 * @param {object} analysis Result of analyseDump.
 * @param {object} selector Selector that produced it.
 * @returns {object} The single match.
 */
export function requireSingleTarget(analysis, selector) {
  if (analysis.matchCount === 0) {
    fail(
      `No on-screen node matched ${JSON.stringify(selector.key ?? selector.text ?? selector.type)}`,
      "UI_TARGET_NOT_FOUND",
      "Check the dump at the reported dumpPath, or relax the selector: text matches substrings,"
      + " key is exact, and off-screen nodes are excluded by default.",
    );
  }
  if (analysis.matchCount > 1) {
    // Before refusing, let the device break the tie. Visible text almost always matches twice --
    // the label and the container that actually handles the tap are both in the tree, e.g. a tab
    // measured as Column "互动卡片" clickable=true wrapping Text "互动卡片" clickable=false. Taking
    // the one node the device calls tappable is not a guess between candidates; the others cannot
    // be tapped at all. Two genuinely tappable matches still refuse.
    const tappable = analysis.matches.filter((match) => match.clickable === true);
    if (tappable.length === 1 && analysis.matches.length === analysis.matchCount) {
      return { ...tappable[0], disambiguatedBy: "clickable" };
    }
    fail(
      `${analysis.matchCount} nodes matched; refusing to guess which one to tap`,
      "UI_TARGET_AMBIGUOUS",
      `Candidates: ${analysis.matches.slice(0, 5).map(describeCandidate).join("; ")}`
      + ". Narrow it with key, type, or clickableOnly.",
    );
  }
  return analysis.matches[0];
}
