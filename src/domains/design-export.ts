import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DOMParser } from "@xmldom/xmldom";
import { invariant, ToolError } from "../core/errors.js";
import { fileSnapshot, inside, sha256 } from "../core/files.js";
import { arkuiPage } from "./design-arkui.js";
import { figmaFrame } from "./design-figma.js";
import { lanhuFrame } from "./design-lanhu.js";
import { mastergoFrame } from "./design-mastergo.js";
import { readHtml, readJsx, type Element } from "./design-markup.js";
import { pixsoFrame } from "./design-pixso.js";
import type { Project } from "./project.js";

const bytesPerImage = 4_194_304;
const totalImageBytes = 24 * 1024 * 1024;
const local = z.string().min(1).max(4096);
const options = z.object({
  module: z.string().min(1),
  page: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
  replace_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  source: z.discriminatedUnion("format", [
    z.object({ format: z.enum(["html", "jsx", "arkts"]), file: local }).strict(),
    z.object({ format: z.literal("figma"), file: local, node: z.string().regex(/^\d+:\d+$/).optional() }).strict(),
    z.object({ format: z.literal("pixso"), file: local, node: z.string().min(1).max(120).optional() }).strict(),
    z.object({ format: z.literal("mastergo"), file: local, node: z.string().min(1).max(120).optional() }).strict(),
    z.object({ format: z.literal("lanhu"), file: local, context: local }).strict(),
  ]),
  assets: z.record(z.string().min(1), local).optional(),
  reference: local.optional(),
  reference_scale: z.union([z.literal(1), z.literal(2)]).optional(),
  component_reference: local.optional(),
  section: z.enum(["all", "input", "assets", "layout", "risks", "fallbacks"]).optional(),
}).strict();

function relative(root: string, file: string) {
  invariant(!path.isAbsolute(file) && !/^[A-Za-z][A-Za-z0-9+.-]*:|[?#\\]/.test(file),
    "INVALID_INPUT", "Use a local relative path within the staging directory", { file });
  return inside(root, file);
}

function read(file: string, max: number) {
  const snapshot = fileSnapshot(file, max);
  invariant(snapshot?.bytes.length, "NOT_FOUND", "Design input is missing or empty", { file });
  return snapshot.bytes;
}

function text(bytes: Buffer, file: string) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ToolError("INVALID_INPUT", "Design text must be UTF-8", { file }); }
}

function json(source: string, file: string): unknown {
  try { return JSON.parse(source); }
  catch { throw new ToolError("INVALID_INPUT", "Invalid design JSON", { file }); }
}

function validateSvg(buffer: Buffer, file: string) {
  const source = text(buffer, file);
  invariant(!/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source), "INVALID_INPUT", "SVG external declarations are unsupported", { file });
  const xml = new DOMParser({ onError: () => { throw new Error("Invalid SVG XML"); } });
  let root;
  try { root = xml.parseFromString(source, "image/svg+xml").documentElement; }
  catch { throw new ToolError("INVALID_INPUT", "Asset is not complete SVG XML", { file }); }
  const namespace = "http://www.w3.org/2000/svg";
  invariant(root?.localName === "svg" && root.namespaceURI === namespace, "INVALID_INPUT", "Expected an SVG root element", { file });
  for (const element of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    invariant(element.namespaceURI === namespace && !/^(?:script|style|foreignObject|animate.*|set)$/i.test(element.localName ?? ""),
      "CAPABILITY_UNAVAILABLE", "SVG requires static native elements", { file, element: element.localName });
    for (const attr of Array.from(element.attributes)) {
      const name = (attr.localName ?? attr.name).toLowerCase(), value = attr.value.trim();
      invariant(!name.startsWith("on") && name !== "style" && name !== "base" && name !== "src" &&
        (name !== "href" || /^#[\w:.-]+$/.test(value)) &&
        (!/url\s*\(/i.test(value) || /^url\(\s*["']?#[\w:.-]+["']?\s*\)$/i.test(value)),
        "CAPABILITY_UNAVAILABLE", "SVG cannot reference external content", { file, attribute: attr.name });
    }
  }
}

export async function exportDesign(project: Project, plan: string, output: string | undefined, signal: AbortSignal) {
  const root = fs.realpathSync(project.root), planFile = path.resolve(root, plan), base = path.dirname(planFile);
  const spec = options.parse(json(text(read(planFile, 65536), planFile), planFile));
  invariant(project.modules.some((candidate) => candidate.name === spec.module && ["entry", "feature"].includes(candidate.type)),
    "INVALID_INPUT", "Select an entry or feature module in this product", { module: spec.module });
  invariant(!spec.reference_scale || spec.reference, "INVALID_INPUT", "reference_scale needs a reference PNG");
  invariant(!spec.section || output === undefined, "INVALID_INPUT", "section is for read-only design inspection");
  const localAssets = new Map(Object.entries(spec.assets ?? {}));
  invariant(localAssets.size <= 32, "INVALID_INPUT", "Use at most 32 local assets");
  const { pngGray } = await import("./ui.js");
  let bytes = 0;
  const media = new Map<string, { bytes: Buffer; sha256: string; ext: string }>();
  const imageIds = new Map<string, string>();
  const png = (buffer: Buffer, id: string) => {
    invariant(pngGray(buffer), "INVALID_INPUT", "Asset must be a complete supported PNG", { asset: id });
    return buffer;
  };
  function addMedia(buffer: Buffer, id: string, ext = ".png", name?: string) {
    invariant(buffer.length <= bytesPerImage, "INVALID_INPUT", "Design image exceeds 4 MiB", { asset: id });
    invariant(ext === ".png" || ext === ".svg", "CAPABILITY_UNAVAILABLE", "Export media accepts PNG or SVG", { asset: id });
    if (ext === ".svg") validateSvg(buffer, id);
    else png(buffer, id);
    const sha = sha256(buffer), key = name ?? "asset_" + sha.slice(0, 20);
    imageIds.set(id, key + ext);
    const old = media.get(key);
    invariant(!old || old.sha256 === sha, "CONFLICT", "Exported media name conflicts", { name: key });
    if (!old) {
      bytes += buffer.length;
      invariant(bytes <= totalImageBytes && media.size < 32, "INVALID_INPUT", "Export exceeds 32 media files or 24 MiB of media");
      media.set(key, { bytes: buffer, sha256: sha, ext });
    }
    return key;
  }
  const input = spec.source;
  const snapshot = ["figma", "pixso", "mastergo", "lanhu"].includes(input.format);
  const filename = relative(base, input.file), source = read(filename, snapshot ? 4_194_304 : 256_000), data = text(source, input.file);
  const context = input.format === "lanhu" ? read(relative(base, input.context), 256_000) : undefined;
  let layout: Record<string, number> | undefined;
  let page: string;
  if (input.format === "arkts") {
    const escaped = new RegExp("\\bstruct\\s+" + spec.page + "\\b");
    invariant(/@Entry\b/.test(data) && /@Component\b/.test(data) && escaped.test(data),
      "INVALID_INPUT", "The staged ArkTS page must declare @Entry, @Component and the requested struct");
    for (const [name, file] of localAssets) {
      invariant(/^[a-z][a-z0-9_]{0,79}$/.test(name), "INVALID_INPUT", "ArkTS assets must use resource identifiers", { name });
      addMedia(read(relative(base, file), bytesPerImage), name, path.extname(file).toLowerCase(), name);
    }
    page = data;
  } else {
    const readers = { figma: figmaFrame, pixso: pixsoFrame, mastergo: mastergoFrame };
    const view = input.format === "html" ? readHtml(data) : input.format === "jsx" ? readJsx(data) :
      input.format === "lanhu" ? lanhuFrame(json(data, input.file), json(text(context!, input.context), input.context), new Set(localAssets.keys())) :
      readers[input.format](json(data, input.file), "node" in input ? input.node : undefined);
    const used = new Map<string, string>();
    page = arkuiPage(view, spec.page, (id) => {
      const previous = used.get(id);
      if (previous) return previous;
      const mapped = localAssets.get(id);
      invariant(mapped || !snapshot, "EVIDENCE_MISSING", "Supply the exported image for this design layer", { id });
      const file = mapped ? relative(base, mapped) : relative(path.dirname(filename), id);
      const key = addMedia(read(file, bytesPerImage), id, path.extname(file).toLowerCase());
      used.set(id, key);
      return key;
    });
    invariant([...localAssets.keys()].every((id) => used.has(id)), "INVALID_INPUT", "Asset map includes an unused entry");
    const tags = new Map<string, number>();
    const visit = (element: Element) => {
      tags.set(element.tag, (tags.get(element.tag) ?? 0) + 1);
      for (const child of element.children) if (typeof child !== "string") visit(child);
    };
    visit(view);
    layout = Object.fromEntries(tags);
  }
  const pageBytes = Buffer.byteLength(page);
  invariant(pageBytes <= 256_000 && pageBytes + bytes <= totalImageBytes,
    "INVALID_INPUT", "The page and media exceed the import size limit");
  const reference = spec.reference ? png(read(relative(base, spec.reference), bytesPerImage), spec.reference) : undefined;
  const componentReference = spec.component_reference ? png(read(relative(base, spec.component_reference), bytesPerImage), spec.component_reference) : undefined;
  signal.throwIfAborted();
  const pageFile = spec.page + ".ets";
  const files = [...media].map(([key, value]) => ({ name: key + value.ext, source: "media/" + key + value.ext, sha256: value.sha256 }));
  const bundle = { module: spec.module,
    page: { name: spec.page, source: pageFile, replace_sha256: spec.replace_sha256 }, media: files.map(({ name, source }) => ({ name, source })) };
  const inspection = { format: input.format, producer: input.format === "arkts" ? "provided" : "native",
    source_sha256: sha256(source), ...(context && { context_sha256: sha256(context) }), sha256: sha256(page), media: files,
    image_ids: Object.fromEntries(imageIds), layout: layout ?? null, risks: reference ? [] : ["NO_REFERENCE_SCREENSHOT"],
    semantic_reviewed: false, ...(reference && { reference_sha256: sha256(reference), reference_scale: spec.reference_scale ?? 1 }),
    ...(componentReference && { component_reference_sha256: sha256(componentReference) }) };
  if (output === undefined) {
    if (!spec.section || spec.section === "all") return { inspected: true, ...inspection };
    const sections = {
      input: { format: input.format, source_sha256: inspection.source_sha256, context_sha256: inspection.context_sha256 },
      assets: { media: files, image_ids: inspection.image_ids, reference_sha256: inspection.reference_sha256, component_reference_sha256: inspection.component_reference_sha256 },
      layout: inspection.layout, risks: inspection.risks, fallbacks: { semantic_reviewed: false },
    };
    return { inspected: true, section: spec.section, report: sections[spec.section] };
  }
  const destination = path.normalize(output), parent = path.dirname(destination);
  invariant(path.isAbsolute(output) && !fs.lstatSync(destination, { throwIfNoEntry: false }) &&
    fs.lstatSync(parent, { throwIfNoEntry: false })?.isDirectory() && fs.realpathSync(parent) === parent,
    "INVALID_INPUT", "Use a new absolute export directory under an existing regular directory", { output: destination });
  fs.mkdirSync(destination, { mode: 0o700 });
  const owned = fs.statSync(destination), written: { file: string; dev: number; ino: number }[] = [];
  const mediaDir = path.join(destination, "media");
  let ownedMedia: fs.Stats | undefined;
  const write = (relativePath: string, data: string | Buffer) => {
    const file = path.join(destination, relativePath), fd = fs.openSync(file, "wx", 0o600);
    try {
      const { dev, ino } = fs.fstatSync(fd);
      written.push({ file, dev, ino });
      fs.writeFileSync(fd, data);
    } finally { fs.closeSync(fd); }
  };
  try {
    if (files.length) {
      fs.mkdirSync(mediaDir, { mode: 0o700 });
      ownedMedia = fs.lstatSync(mediaDir);
    }
    for (const [key, image] of media) {
      signal.throwIfAborted();
      write("media/" + key + image.ext, image.bytes);
    }
    write(pageFile, page);
    if (reference) write("reference.png", reference);
    if (componentReference) write("component-reference.png", componentReference);
    signal.throwIfAborted();
    write("import.json", JSON.stringify(bundle, null, 2) + "\n");
  } catch (error) {
    const current = fs.lstatSync(destination, { throwIfNoEntry: false });
    invariant(current?.isDirectory() && current.dev === owned.dev && current.ino === owned.ino,
      "EFFECT_UNCERTAIN", "The export directory changed before cleanup", { output: destination });
    try {
      if (ownedMedia) {
        const directory = fs.lstatSync(mediaDir);
        invariant(directory.isDirectory() && directory.dev === ownedMedia.dev && directory.ino === ownedMedia.ino,
          "EFFECT_UNCERTAIN", "The media directory changed before cleanup");
      }
      for (const { file, dev, ino } of written.reverse()) {
        const currentFile = fs.lstatSync(file);
        invariant(currentFile.isFile() && currentFile.dev === dev && currentFile.ino === ino,
          "EFFECT_UNCERTAIN", "An export file changed before cleanup", { file });
        fs.unlinkSync(file);
      }
      if (ownedMedia) fs.rmdirSync(mediaDir);
      fs.rmdirSync(destination);
    } catch (cleanup) {
      throw new ToolError("EFFECT_UNCERTAIN", "Design export stopped and could not be fully cleaned up", { output: destination, cause: String(error), cleanup: String(cleanup) });
    }
    throw error;
  }
  return { ...inspection, page: path.join(destination, pageFile), plan: path.join(destination, "import.json"),
    ...(reference && { reference_image: path.join(destination, "reference.png") }),
    ...(componentReference && { component_reference_image: path.join(destination, "component-reference.png") }) };
}
