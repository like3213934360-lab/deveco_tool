import fs from "node:fs";
import {
  executeOfficialLsp,
  lspUriToPath,
  officialLspStatus,
  resetOfficialLsp,
  setOfficialLspServerForTests,
} from "./lsp/service.mjs";

function fromPosition(position) {
  return {
    line: Number(position?.line ?? 0) + 1,
    column: Number(position?.character ?? 0) + 1,
  };
}

function locationParts(location) {
  const uri = location?.targetUri ?? location?.uri;
  const range = location?.targetSelectionRange ?? location?.targetRange ?? location?.range;
  if (!uri || !range) return null;
  const file = lspUriToPath(uri);
  const at = fromPosition(range.start);
  return { file, ...at };
}

function addLineText(locations) {
  const requested = new Map();
  for (const location of locations) {
    let lines = requested.get(location.file);
    if (!lines) {
      lines = new Set();
      requested.set(location.file, lines);
    }
    lines.add(location.line);
  }

  const textByLocation = new Map();
  for (const [file, lineNumbers] of requested) {
    try {
      const lines = fs.readFileSync(file, "utf8").split(/\n/);
      for (const line of lineNumbers) {
        textByLocation.set(`${file}\0${line}`, lines[line - 1]?.trimEnd() ?? "");
      }
    } catch {
      // A location remains useful even when its source was removed after the LSP response.
    }
  }
  return locations.map((location) => ({
    ...location,
    text: textByLocation.get(`${location.file}\0${location.line}`) ?? "",
  }));
}

function decodeHoverEntities(value) {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    "#39": "'",
  };
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (match, name) => entities[name] ?? match);
}

function formatOfficialHoverValue(value) {
  if (typeof value !== "string" || value[0] !== "{") return null;
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(payload?.info)) return null;
  const blocks = [];
  for (const info of payload.info) {
    const lines = [];
    if (typeof info?.code?.value === "string" && info.code.value) {
      lines.push(decodeHoverEntities(info.code.value));
    }
    for (const data of info?.data ?? []) {
      if (typeof data?.document === "string" && data.document) lines.push(data.document);
      for (const tag of data?.tags ?? []) {
        if (typeof tag === "string" && tag) lines.push(tag);
      }
    }
    if (lines.length) blocks.push(lines.join("\n"));
  }
  return blocks.length ? blocks.join("\n\n") : null;
}

function formatHover(contents) {
  if (typeof contents === "string") return formatOfficialHoverValue(contents) ?? contents;
  if (Array.isArray(contents)) return contents.map(formatHover).filter(Boolean).join("\n\n");
  if (contents?.value) return formatOfficialHoverValue(contents.value) ?? contents.value;
  return contents ? JSON.stringify(contents, null, 2) : "";
}

function dedicatedArgs(args, operation) {
  return {
    operation,
    filePath: args.file,
    line: args.line,
    character: args.column,
    timeoutMs: args.timeoutMs,
    includeDeclaration: args.includeDeclaration,
  };
}

export async function findReferences(args) {
  const result = await executeOfficialLsp(dedicatedArgs(args, "findReferences"));
  const locations = addLineText((result ?? []).map(locationParts).filter(Boolean));
  if (!locations.length) return `No references found for symbol at ${args.file}:${args.line}:${args.column}`;
  return `Found ${locations.length} references:\n${locations
    .map((item) => `${item.file}:${item.line}:${item.column}  ${item.text}`)
    .join("\n")}`;
}

export async function goToDefinition(args) {
  const result = await executeOfficialLsp(dedicatedArgs(args, "goToDefinition"));
  const locations = addLineText(
    (Array.isArray(result) ? result : [result]).map(locationParts).filter(Boolean),
  );
  if (!locations.length) return `No definition found for symbol at ${args.file}:${args.line}:${args.column}`;
  return `Definition(s):\n${locations
    .map((item) => `${item.file}:${item.line}:${item.column}  ${item.text}`)
    .join("\n")}`;
}

export async function getHover(args) {
  const result = await executeOfficialLsp(dedicatedArgs(args, "hover"));
  if (!result) return `No hover info for symbol at ${args.file}:${args.line}:${args.column}`;
  return formatHover(result.contents);
}

export function lspOperation(args) {
  return executeOfficialLsp(args);
}

export function lspStatus() {
  return officialLspStatus();
}

export function resetLsp() {
  return resetOfficialLsp();
}

export function shutdownLsp() {
  return resetOfficialLsp();
}

export { setOfficialLspServerForTests };
