/**
 * @file Layout-dump parsing, node selection and change signatures.
 * @author deveco-tool
 *
 * Split out of `src/device-ui.mjs` because `ui_find` and `ui_observe` must select nodes by exactly
 * the same rules. While the selection logic was a closure inside `ui_find`, the second caller could
 * only have copied it, and two copies of "which nodes count as on-screen" drift silently -- the
 * failure being a tap that lands somewhere plausible but wrong.
 */

import crypto from "node:crypto";
import fs from "node:fs";

function fail(message, code, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  throw error;
}

function attributesOf(node) {
  return node.$attrs ?? node.attributes ?? {};
}

function childrenOf(node) {
  const children = node.$children ?? node.children;
  return Array.isArray(children) ? children : [];
}

/**
 * The addressable label of a node.
 *
 * `description` is last and it is the one that matters in practice: `uitest dumpLayout` puts the
 * accessibility label there, not in `accessibilityText`, which does not exist in either dump shape.
 * An icon-only control -- a back arrow, a mute toggle -- carries no `text` at all, so without this
 * it could not be found by name. Real text still wins wherever a node has both.
 *
 * @param {object} attributes Raw node attributes.
 * @returns {string} Best available label, or an empty string.
 */
function firstText(attributes) {
  for (const key of ["content", "text", "label", "accessibilityText", "description"]) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** Flags arrive as real booleans in one dump shape and as "true"/"false" strings in the other. */
function readFlag(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/**
 * Parse a `$rect` string such as `[604.00, 2689.00],[675.00,2730.00]`.
 *
 * Spacing is inconsistent between fields and values are floats. Inverted corners are normalised
 * rather than rejected, since a swapped pair still describes a real box.
 *
 * @param {unknown} value Raw `$rect`.
 * @returns {{x1: number, y1: number, x2: number, y2: number}|null} Normalised box, or null.
 */
export function parseRect(value) {
  if (typeof value !== "string") return null;
  const numbers = value.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 4) return null;
  const parsed = numbers.slice(0, 4).map(Number);
  if (parsed.some((entry) => !Number.isFinite(entry))) return null;
  const [a, b, c, d] = parsed;
  return { x1: Math.min(a, c), y1: Math.min(b, d), x2: Math.max(a, c), y2: Math.max(b, d) };
}

function intersects(box, screen) {
  if (!screen) return true;
  return box.x2 > screen.x1 && box.x1 < screen.x2 && box.y2 > screen.y1 && box.y1 < screen.y2;
}

/**
 * Flatten a uitest layout dump into addressable nodes.
 *
 * There are two shapes in the wild and this has to read both. `uitest dumpLayout`, which is what
 * ui_find runs, emits the accessibility shape: `children` / `attributes`, with `bounds` written as
 * `[372,389][905,1452]` and the component type, key and clickable/visible flags all inside
 * `attributes`. CodeGenie's `get_app_ui_tree full` emits the ArkUI inspector shape instead:
 * `$children` / `$attrs` / `$rect`, with the type at `$type` and text under `content`. A dump saved
 * from either tool can therefore be handed to `dumpPath`, and an array root or the
 * `{ProcessID, ..., content}` wrapper is unwrapped on the way in.
 *
 * The projection kept here is also what makes the signatures below meaningful: `accessibilityId`
 * and `hashcode` never enter it. Measured across consecutive dumps of one unchanged screen, those
 * two churn on 90 of 214 nodes -- they identify a dump, not a screen -- so any signature computed
 * over the raw JSON is different every time and useless for change detection.
 *
 * @param {unknown} root Parsed dump.
 * @returns {{nodes: object[], screen: object|null}} Nodes in document order plus the screen box.
 */
export function flattenDump(root) {
  const nodes = [];
  let screen = null;

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const hasOwnShape = node.$children || node.children || node.$attrs || node.attributes || node.$rect;
    if (!hasOwnShape && node.content && typeof node.content === "object") {
      visit(node.content);
      return;
    }
    const attributes = attributesOf(node);
    const rect = parseRect(node.$rect ?? attributes.bounds ?? attributes.rect);
    // Pre-order, so the first node carrying a box is the outermost one: the screen.
    if (rect && !screen) screen = rect;
    nodes.push({
      id: node.$ID ?? node.id ?? attributes.id ?? null,
      // The inspector shape puts the type on the node; the accessibility shape puts it in attributes.
      type: node.$type ?? node.type ?? attributes.type ?? "",
      text: firstText(attributes),
      key: (typeof attributes.key === "string" && attributes.key)
        || (typeof attributes.id === "string" && attributes.id)
        || null,
      // Only the accessibility shape carries these, and where it does they beat any geometric
      // guess: a node can sit inside the screen box and still be untappable or hidden.
      clickable: readFlag(attributes.clickable),
      enabled: readFlag(attributes.enabled),
      visible: readFlag(attributes.visible),
      // Present on the accessibility shape. Surfaced so a caller on a foldable or an external screen
      // can tell which display a node belongs to; nodes from two displays share one dump.
      displayId: attributes.displayId === undefined ? null : String(attributes.displayId),
      rect,
    });
    for (const child of childrenOf(node)) visit(child);
  };

  visit(root);
  return { nodes, screen };
}

function hash(parts) {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

function rectKey(rect) {
  return rect ? `${rect.x1},${rect.y1},${rect.x2},${rect.y2}` : "";
}

/**
 * Two hashes over a flattened dump, for deciding whether re-observing is worth a round trip.
 *
 * `signature` includes text, so any content change moves it. That is correct but blunt: a screen
 * with a clock or a counter never repeats a signature. Measured on an unchanged launcher, exactly
 * 2 of 214 nodes flipped a digit between consecutive dumps, which is enough to make `signature`
 * differ while nothing navigable changed.
 *
 * `structureSignature` drops text, so it answers the different and usually more useful question:
 * did the layout change -- did navigation happen, did a dialog open.
 *
 * @param {object[]} nodes Flattened nodes.
 * @returns {{signature: string, structureSignature: string}} Both digests.
 */
export function dumpSignatures(nodes) {
  const withText = [];
  const structureOnly = [];
  for (const node of nodes) {
    const skeleton = `${node.type}|${rectKey(node.rect)}|${node.key ?? ""}`;
    structureOnly.push(skeleton);
    withText.push(`${skeleton}|${node.text}`);
  }
  return { signature: hash(withText), structureSignature: hash(structureOnly) };
}

/**
 * Parse dump text, preserving the diagnosis when it is not JSON at all.
 *
 * @param {string} raw File contents.
 * @param {string} source Path or description, for the error message.
 * @returns {unknown} Parsed dump.
 */
export function parseDump(raw, source) {
  if (!raw || !raw.trim()) fail(`Layout dump is empty: ${source}`, "UI_DUMP_EMPTY");
  try {
    return JSON.parse(raw);
  } catch (error) {
    // uitest writes plain-text failures into the -p target, so the head of the file is the
    // diagnosis. Without it the caller only learns that JSON.parse was unhappy.
    fail(
      `Layout dump is not valid JSON: ${source} (${error.message})`,
      "UI_DUMP_PARSE_FAILED",
      raw.slice(0, 200),
    );
  }
  return null;
}

export function readDump(dumpPath) {
  let raw;
  try {
    raw = fs.readFileSync(dumpPath, "utf8");
  } catch (error) {
    fail(`Layout dump could not be read: ${dumpPath} (${error.message})`, "UI_DUMP_FAILED");
  }
  return parseDump(raw, dumpPath);
}

/**
 * Normalise the selector arguments shared by ui_find, ui_observe and selector-driven ui_tap.
 *
 * @param {object} input Tool arguments.
 * @returns {object} Selector with defaults applied.
 */
export function readSelector(input = {}) {
  return {
    limit: Math.min(Math.max(Number(input.limit) || 20, 1), 200),
    onScreenOnly: input.onScreenOnly !== false,
    // The text you can see is often a label nested inside the node that actually handles the tap,
    // so being able to ask only for tappable nodes is the difference between a hit and a no-op.
    clickableOnly: input.clickableOnly === true,
    text: typeof input.text === "string" && input.text ? input.text.toLowerCase() : null,
    key: typeof input.key === "string" && input.key ? input.key : null,
    type: typeof input.type === "string" && input.type ? input.type.toLowerCase() : null,
    displayId: input.displayId === undefined || input.displayId === null
      ? null
      : String(input.displayId),
  };
}

/** True when the caller named something to look for, rather than taking the default. */
export function hasSelector(selector) {
  return Boolean(selector.text || selector.key || selector.type || selector.clickableOnly);
}

/**
 * Select nodes from a flattened dump.
 *
 * @param {{nodes: object[], screen: object|null}} flattened Output of flattenDump.
 * @param {object} selector Output of readSelector.
 * @returns {{matches: object[], matchCount: number}} Matches capped at the selector's limit.
 */
export function selectNodes({ nodes, screen }, selector) {
  const matches = [];
  let matchCount = 0;
  for (const node of nodes) {
    if (selector.text && !node.text.toLowerCase().includes(selector.text)) continue;
    if (selector.key && node.key !== selector.key) continue;
    if (selector.type && node.type.toLowerCase() !== selector.type) continue;
    if (selector.displayId && node.displayId !== null && node.displayId !== selector.displayId) continue;
    // With no selector at all, "everything that shows text" is the useful default; without this
    // the answer would be every layout container on screen. clickableOnly counts as a selector:
    // measured on a real device, a launcher screen carried 35 clickable nodes and not one of them
    // had text -- they are Stack / Flex / FormComponent containers wrapping a label -- so treating
    // it as a mere filter made "list what I can tap" answer 0 every time.
    if (!hasSelector(selector) && !node.text) continue;
    if (selector.clickableOnly && node.clickable !== true) continue;
    if (!node.rect) continue;
    const hasArea = node.rect.x2 > node.rect.x1 && node.rect.y2 > node.rect.y1;
    // Where the dump states visibility, trust it over the geometry.
    const onScreen = hasArea && intersects(node.rect, screen) && node.visible !== false;
    // Off-screen nodes are in the dump but tapping their centre does nothing, and the caller has
    // no way to tell that apart from a broken tap.
    if (selector.onScreenOnly && !onScreen) continue;
    matchCount += 1;
    if (matches.length >= selector.limit) continue;
    matches.push({
      id: node.id,
      type: node.type,
      text: node.text,
      key: node.key,
      rect: [node.rect.x1, node.rect.y1, node.rect.x2, node.rect.y2],
      center: {
        x: Math.round((node.rect.x1 + node.rect.x2) / 2),
        y: Math.round((node.rect.y1 + node.rect.y2) / 2),
      },
      onScreen,
      clickable: node.clickable ?? undefined,
      enabled: node.enabled ?? undefined,
      displayId: node.displayId ?? undefined,
    });
  }
  return { matches, matchCount };
}

/**
 * The full ui_find-shaped report for one dump.
 *
 * @param {{root: unknown, dumpPath: string|null, deviceId: string|null, selector: object}} input Source.
 * @returns {object} Report with matches, counts and both signatures.
 */
export function analyseDump({ root, dumpPath = null, deviceId = null, selector }) {
  const flattened = flattenDump(root);
  const { matches, matchCount } = selectNodes(flattened, selector);
  const { signature, structureSignature } = dumpSignatures(flattened.nodes);
  const screen = flattened.screen;
  const componentTypes = Object.create(null);
  for (const node of flattened.nodes) {
    if (!node.type || !node.rect || node.visible === false) continue;
    const hasArea = node.rect.x2 > node.rect.x1 && node.rect.y2 > node.rect.y1;
    if (!hasArea || !intersects(node.rect, screen)) continue;
    componentTypes[node.type] = (componentTypes[node.type] ?? 0) + 1;
  }
  const truncated = matchCount > matches.length;
  return {
    deviceId,
    nodeCount: flattened.nodes.length,
    matchCount,
    truncated,
    truncationHint: truncated
      ? `Only ${matches.length} of ${matchCount} matches are included. Re-query dumpPath with text, key, or type (for example type: Slider), or raise limit.`
      : undefined,
    componentTypes,
    dumpPath,
    screen: screen ? [screen.x1, screen.y1, screen.x2, screen.y2] : null,
    signature,
    structureSignature,
    matches,
  };
}
