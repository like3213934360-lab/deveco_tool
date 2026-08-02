#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENGINE_PATH =
  process.env.PIXSO_ARKTS_ENGINE ||
  path.join(SCRIPT_DIR, "pixso-arkts.js");

const USAGE = `
Usage:
  node call-pixso-arkts.mjs --input pixso.json --out EntryPage.ets [options]
  node call-pixso-arkts.mjs --full page.full.json --occurrence page.occurrence.json --out EntryPage.ets [options]

Options:
  --engine <file>       pixso-arkts.js path. Defaults to PIXSO_ARKTS_ENGINE or pixso-arkts.js in this script directory.
  --input <file>        Single Pixso JSON input file: dual snapshot, old snapshot, RawNewRoot, or refs root.
  --full <file>         Pixso get_node_dsl(..., simplify=false) JSON.
  --occurrence <file>   Pixso get_node_dsl(...) JSON with default simplify=true.
  --out <file>          ArkTS output file. Required unless --stdout-code is used.
  --struct-name <name>  ArkTS page struct name. Must end with Page. Default: PixsoPage.
  --images <file>       Write imageIds/media export manifest JSON.
  --raw-out <file>      Also write canonical RawNewRoot JSON.
  --result <file>       Write full JSON result: { code, imageIds }.
  --stdout-code         Print only generated ArkTS code to stdout.
  --pretty             Pretty-print JSON outputs. Default: compact for result/images, pretty for raw-out.
  --help               Show this help.

Examples:
  node outputs/call-pixso-arkts.mjs --input design.json --out EntryPage.ets --struct-name EntryPage --images imageIds.json
  node outputs/call-pixso-arkts.mjs --full page.full.json --occurrence page.occurrence.json --out VideoHomePage.ets --struct-name VideoHomePage --images imageIds.json
  node outputs/call-pixso-arkts.mjs --engine "D:\\tools\\pixso-arkts.js" --input design.json --stdout-code
`.trim();

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function argValue(args, ...keys) {
  for (const key of keys) {
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

function absPath(filePath) {
  return path.resolve(process.cwd(), String(filePath));
}

async function ensureParent(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath) {
  const text = await fsp.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON input: ${filePath}\n${error.message}`);
  }
}

function shouldFallbackToMjs(error) {
  const message = String(error?.message || error);
  return (
    message.includes("Unexpected token 'export'") ||
    message.includes("Cannot use import statement outside a module") ||
    message.includes("To load an ES module")
  );
}

async function importEngine(enginePath) {
  const engineUrl = pathToFileURL(enginePath).href;

  try {
    return await import(`${engineUrl}?mtime=${Date.now()}`);
  } catch (error) {
    if (!shouldFallbackToMjs(error)) throw error;
  }

  const stat = await fsp.stat(enginePath);
  const source = await fsp.readFile(enginePath, "utf8");
  const hash = crypto
    .createHash("sha256")
    .update(enginePath)
    .update(String(stat.size))
    .update(String(stat.mtimeMs))
    .digest("hex")
    .slice(0, 16);
  const tempDir = path.join(os.tmpdir(), "pixso-arkts-agent-loader");
  const tempModule = path.join(tempDir, `pixso-arkts-${hash}.mjs`);

  await fsp.mkdir(tempDir, { recursive: true });
  await fsp.writeFile(tempModule, source, "utf8");
  return import(`${pathToFileURL(tempModule).href}?mtime=${stat.mtimeMs}`);
}

function stringifyJson(value, pretty) {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

async function writeText(filePath, text) {
  await ensureParent(filePath);
  await fsp.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }

  const inputArg = argValue(args, "input", "i");
  const fullArg = argValue(args, "full");
  const occurrenceArg = argValue(args, "occurrence");
  const outArg = argValue(args, "out", "o");
  const stdoutCode = args["stdout-code"] === true;
  const hasSingleInput = inputArg !== undefined;
  const hasDualInput = fullArg !== undefined || occurrenceArg !== undefined;
  if (
    (!hasSingleInput && !hasDualInput) ||
    (hasSingleInput && hasDualInput) ||
    (hasDualInput && (!fullArg || !occurrenceArg)) ||
    (!outArg && !stdoutCode)
  ) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const enginePath = absPath(argValue(args, "engine", "e") || DEFAULT_ENGINE_PATH);
  const inputPath = inputArg ? absPath(inputArg) : undefined;
  const fullPath = fullArg ? absPath(fullArg) : undefined;
  const occurrencePath = occurrenceArg ? absPath(occurrenceArg) : undefined;
  const outPath = outArg ? absPath(outArg) : undefined;
  const imagesPath = argValue(args, "images") ? absPath(argValue(args, "images")) : undefined;
  const rawOutPath = argValue(args, "raw-out") ? absPath(argValue(args, "raw-out")) : undefined;
  const resultPath = argValue(args, "result") ? absPath(argValue(args, "result")) : undefined;
  const structName = argValue(args, "struct-name", "structName");
  const pretty = args.pretty === true;

  if (!fs.existsSync(enginePath)) {
    throw new Error(`Engine file not found: ${enginePath}`);
  }

  const engine = await importEngine(enginePath);
  if (typeof engine.pixsoToArkTs !== "function") {
    throw new Error(`Engine does not export pixsoToArkTs: ${enginePath}`);
  }

  const pixsoData = inputPath
    ? await readJson(inputPath)
    : {
        full: await readJson(fullPath),
        occurrence: await readJson(occurrencePath)
      };
  const options = {};
  if (structName !== undefined) options.structName = structName;

  if (rawOutPath) {
    if (typeof engine.pixsoToRawNewRoot !== "function") {
      throw new Error(`Engine does not export pixsoToRawNewRoot: ${enginePath}`);
    }
    const rawRoot = engine.pixsoToRawNewRoot(pixsoData);
    await writeText(rawOutPath, `${stringifyJson(rawRoot, true)}\n`);
  }

  const result = engine.pixsoToArkTs(pixsoData, options);
  if (!result || typeof result.code !== "string") {
    throw new Error("pixsoToArkTs returned an invalid result; expected { code, imageIds }.");
  }

  if (outPath) await writeText(outPath, result.code);
  if (imagesPath) await writeText(imagesPath, `${stringifyJson(result.imageIds || [], pretty)}\n`);
  if (resultPath) await writeText(resultPath, `${stringifyJson(result, pretty)}\n`);

  if (stdoutCode) {
    process.stdout.write(result.code);
    return;
  }

  console.log(
    stringifyJson(
      {
        ok: true,
        engine: enginePath,
        input: inputPath,
        full: fullPath,
        occurrence: occurrencePath,
        out: outPath,
        images: imagesPath,
        rawOut: rawOutPath,
        result: resultPath,
        imageIds: result.imageIds || []
      },
      true
    )
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
