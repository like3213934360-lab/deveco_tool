import { invariant } from "../core/errors.js";
import type { Element } from "./design-markup.js";

const containers = new Set(["body", "div", "main", "section", "article", "header", "footer", "aside", "nav"]);
const labels = new Set(["span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "label"]);
const headingSize: Record<string, number> = { h1: 32, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };
const namedColors: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000", transparent: "#00000000" };
const mainAxis = { "flex-start": "Start", center: "Center", "flex-end": "End", "space-between": "SpaceBetween", "space-around": "SpaceAround", "space-evenly": "SpaceEvenly" };
const crossAxis = {
  Column: { "flex-start": "HorizontalAlign.Start", center: "HorizontalAlign.Center", "flex-end": "HorizontalAlign.End" },
  Row: { "flex-start": "VerticalAlign.Top", center: "VerticalAlign.Center", "flex-end": "VerticalAlign.Bottom" },
};
const quoted = (value: string) => JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

function length(value: string, percent = false) {
  invariant(/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px)?)$/.test(value) || percent && /^\d+(?:\.\d+)?%$/.test(value),
    "CAPABILITY_UNAVAILABLE", "Use nonnegative px lengths or percentages where supported", { value });
  const number = Number.parseFloat(value);
  invariant(number <= 16384, "INVALID_INPUT", "Design length is outside the supported range", { value });
  return value.endsWith("%") ? quoted(value) : String(number);
}

function color(value: string) {
  const hex = Object.hasOwn(namedColors, value) ? namedColors[value]! : value;
  if (/^#[\da-f]{3}$/i.test(hex)) return quoted("#" + [...hex.slice(1)].map((c) => c + c).join(""));
  if (/^#[\da-f]{8}$/i.test(hex) && value !== "transparent") return quoted("#" + hex.slice(7) + hex.slice(1, 7));
  invariant(/^#[\da-f]{6}$/i.test(hex) || hex === "#00000000", "CAPABILITY_UNAVAILABLE", "Use a supported named color or hex", { color: value });
  return quoted(hex);
}

function css(style: string | undefined) {
  const entries = new Map<string, string>();
  for (const declaration of (style ?? "").split(";").map((entry) => entry.trim()).filter(Boolean)) {
    const pair = /^([a-z-]+)\s*:\s*(.+)$/.exec(declaration);
    invariant(pair, "INVALID_INPUT", "Invalid inline CSS declaration", { declaration });
    entries.set(pair[1]!, pair[2]!.trim());
  }
  return entries;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function arkuiPage(root: Element, page: string, media: (source: string) => string) {
  let nodes = 0;
  let needsMetrics = false;
  const render = (node: Element | string, depth: number): string => {
    invariant(++nodes <= 500 && depth <= 32, "INVALID_INPUT", "Design exceeds 500 components or 32 levels");
    const indent = "  ".repeat(depth + 2);
    if (typeof node === "string") return indent + "Text(" + quoted(compactText(node)) + ")";
    const { tag, attrs, children } = node, style = css(attrs.style);
    for (const name of Object.keys(attrs))
      invariant(["style", "id"].includes(name) || tag === "img" && ["src", "alt", "width", "height"].includes(name),
        "CAPABILITY_UNAVAILABLE", "Unsupported design attribute", { tag, attribute: name });
    if (tag === "img") for (const key of ["width", "height"])
      if (attrs[key] !== undefined && !style.has(key)) style.set(key, attrs[key]!);

    const cut = (key: string) => { const value = style.get(key); style.delete(key); return value; };
    const display = cut("display"), direction = cut("flex-direction"), gap = cut("gap"), mods: string[] = [];
    let content: string;
    if (containers.has(tag)) {
      invariant(display === undefined || ["block", "flex", "stack"].includes(display), "CAPABILITY_UNAVAILABLE", "Unsupported layout display", { display });
      invariant(direction === undefined || display === "flex" && ["row", "column"].includes(direction), "CAPABILITY_UNAVAILABLE", "Unsupported flex direction", { direction });
      const kind = display === "stack" ? "Stack" : display === "flex" && direction !== "column" ? "Row" : "Column";
      invariant(gap === undefined || kind !== "Stack", "CAPABILITY_UNAVAILABLE", "Stack does not support gap");
      let args = kind === "Stack" ? "{ alignContent: Alignment.TopStart }" : gap === undefined ? "" : "{ space: " + length(gap) + " }";
      const align = cut("align-items"), justify = cut("justify-content");
      invariant((!align && !justify) || display === "flex", "CAPABILITY_UNAVAILABLE", "Axis alignment requires flex display");
      const wrap = cut("flex-wrap");
      invariant(wrap === undefined || display === "flex" && ["nowrap", "wrap"].includes(wrap), "CAPABILITY_UNAVAILABLE", "Unsupported flex-wrap");
      if (wrap === "wrap") {
        const cross = { "flex-start": "Start", "flex-end": "End", center: "Center", stretch: "Stretch" };
        const alignKey = align ?? "stretch", main = justify ?? "flex-start", lines = cut("align-content");
        invariant(Object.hasOwn(cross, alignKey) && Object.hasOwn(mainAxis, main) && (lines === undefined || Object.hasOwn(mainAxis, lines)), "CAPABILITY_UNAVAILABLE", "Unsupported wrapped flex alignment");
        const options = ["wrap: FlexWrap.Wrap", "direction: FlexDirection." + (direction === "column" ? "Column" : "Row"),
          "alignItems: ItemAlign." + cross[alignKey as keyof typeof cross], "justifyContent: FlexAlign." + mainAxis[main as keyof typeof mainAxis]];
        if (lines) options.push("alignContent: FlexAlign." + mainAxis[lines as keyof typeof mainAxis]);
        if (gap !== undefined) {
          needsMetrics = true;
          const value = "LengthMetrics.vp(" + length(gap) + ")";
          options.push("space: { main: " + value + ", cross: " + value + " }");
        }
        args = "{ " + options.join(", ") + " }";
      } else if (kind !== "Stack") {
        const cross = align ?? "flex-start";
        invariant(Object.hasOwn(crossAxis[kind], cross), "CAPABILITY_UNAVAILABLE", "Unsupported cross-axis alignment", { align });
        mods.push(".alignItems(" + crossAxis[kind][cross as keyof typeof crossAxis.Row] + ")");
      }
      if (justify && wrap !== "wrap") {
        invariant(Object.hasOwn(mainAxis, justify), "CAPABILITY_UNAVAILABLE", "Unsupported main-axis alignment", { justify });
        mods.push(".justifyContent(FlexAlign." + mainAxis[justify as keyof typeof mainAxis] + ")");
      }
      const useful = children.filter((child) => typeof child !== "string" || compactText(child));
      const call = (wrap === "wrap" ? "Flex" : kind) + "(" + args + ")";
      content = useful.length ? call + " {\n" + useful.map((child) => render(child, depth + 1)).join("\n") + "\n" + indent + "}" : call;
      if (depth === 0 && !style.has("width")) style.set("width", "100%");
    } else if (labels.has(tag) || tag === "button") {
      invariant(display === undefined && direction === undefined && gap === undefined, "CAPABILITY_UNAVAILABLE", "Layout declarations require a container", { tag });
      invariant(children.every((child) => typeof child === "string"), "CAPABILITY_UNAVAILABLE", "Use plain text in labels and buttons", { tag });
      const whitespace = cut("white-space");
      invariant(whitespace === undefined || whitespace === "pre-wrap", "CAPABILITY_UNAVAILABLE", "Unsupported white-space setting", { whitespace });
      content = (tag === "button" ? "Button" : "Text") + "(" + quoted(whitespace ? children.join("") : compactText(children.join(""))) + ")";
      const size = headingSize[tag];
      if (size && !style.has("font-size")) style.set("font-size", String(size));
      if (size && !style.has("font-weight")) style.set("font-weight", "bold");
    } else if (tag === "img") {
      invariant(attrs.src && !children.length && display === undefined && direction === undefined && gap === undefined, "INVALID_INPUT", "Image needs src and no children");
      content = "Image($r('app.media." + media(attrs.src) + "'))";
      if (attrs.alt) mods.push(".accessibilityText(" + quoted(attrs.alt) + ")");
      const fit = cut("object-fit");
      if (fit !== undefined) {
        invariant(["contain", "cover", "fill"].includes(fit), "CAPABILITY_UNAVAILABLE", "Unsupported object-fit", { fit });
        mods.push(".objectFit(ImageFit." + (fit === "contain" ? "Contain" : fit === "cover" ? "Cover" : "Fill") + ")");
      }
    } else {
      invariant(false, "CAPABILITY_UNAVAILABLE", "Unsupported design tag", { tag });
    }
    const pixels: [string, string, boolean][] = [["width", "width", true], ["height", "height", true], ["padding", "padding", false], ["margin", "margin", false], ["border-radius", "borderRadius", false]];
    for (const [property, method, percent] of pixels) {
      const value = cut(property);
      if (value !== undefined) mods.push("." + method + "(" + length(value, percent) + ")");
    }
    const background = cut("background-color"), textColor = cut("color"), size = cut("font-size"), weight = cut("font-weight");
    if (background !== undefined) mods.push(".backgroundColor(" + color(background) + ")");
    if (textColor !== undefined || size !== undefined || weight !== undefined) {
      invariant(labels.has(tag) || tag === "button", "CAPABILITY_UNAVAILABLE", "Set text styles directly on a label or button", { tag });
      if (textColor !== undefined) mods.push(".fontColor(" + color(textColor) + ")");
      if (size !== undefined) mods.push(".fontSize(" + length(size) + ")");
      if (weight !== undefined) {
        invariant(weight === "normal" || weight === "bold" || /^[1-9]00$/.test(weight), "CAPABILITY_UNAVAILABLE", "Unsupported font-weight", { weight });
        mods.push(".fontWeight(" + (weight === "normal" ? "FontWeight.Normal" : weight === "bold" ? "FontWeight.Bold" : weight) + ")");
      }
    }
    const textAlign = cut("text-align"), opacity = cut("opacity"), overflow = cut("overflow");
    if (textAlign !== undefined) {
      invariant(labels.has(tag) && ["left", "center", "right", "justified"].includes(textAlign), "CAPABILITY_UNAVAILABLE", "Unsupported text alignment", { textAlign });
      const mode = textAlign === "justified" ? "JUSTIFY" : textAlign === "center" ? "Center" : textAlign.toUpperCase();
      mods.push(".textAlign(TextAlign." + mode + ")");
    }
    if (opacity !== undefined) {
      invariant(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(opacity), "INVALID_INPUT", "Opacity must be between zero and one");
      mods.push(".opacity(" + Number(opacity) + ")");
    }
    if (overflow !== undefined) {
      invariant(overflow === "hidden" && containers.has(tag), "CAPABILITY_UNAVAILABLE", "Only hidden container overflow can be converted");
      mods.push(".clip(true)");
    }
    const x = cut("left"), y = cut("top"), position = cut("position");
    if (position !== undefined || x !== undefined || y !== undefined) {
      invariant(position === "absolute" && x !== undefined && y !== undefined, "CAPABILITY_UNAVAILABLE", "Absolute placement requires left and top");
      const offset = (value: string) => value.startsWith("-") ? "-" + length(value.slice(1)) : length(value);
      mods.push(".position({ x: " + offset(x) + ", y: " + offset(y) + " })");
    }
    invariant(!style.size, "CAPABILITY_UNAVAILABLE", "Unsupported inline CSS properties", { tag, properties: [...style.keys()] });
    if (attrs.id) mods.push(".id(" + quoted(attrs.id) + ")");
    return indent + content + mods.join("");
  };
  invariant(root.children.length || root.tag === "img", "INVALID_INPUT", "The source has no visible markup");
  const body = render(root, 0);
  return (needsMetrics ? "import { LengthMetrics } from '@kit.ArkUI';\n\n" : "") + "@Entry\n@Component\nstruct " + page + " {\n  build() {\n" + body + "\n  }\n}\n";
}
