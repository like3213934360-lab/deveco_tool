import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

/**
 * Strip comments and trailing commas for callers that need normalized text.
 * Manifest parsing itself uses the full JSON5 parser below.
 *
 * @param {string} text Raw JSON5 document.
 * @returns {string} Text with comments and trailing commas removed.
 */
export function stripJson5(text) {
  let output = "";
  let quote = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const lookahead = text[index + 1];
    if (quote) {
      output += character;
      if (character === "\\") {
        output += lookahead ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = "";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === "/" && lookahead === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && lookahead === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
}

/** Parse a HarmonyOS JSON5 manifest with the complete JSON5 grammar. */
export function parseJson5(text) {
  return JSON5.parse(text);
}

/**
 * Read the `modules` array out of a project's `build-profile.json5`.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {Array<{name?: string, srcPath?: string}>|null} Module entries, or null when the file is absent.
 */
export function readModuleEntries(projectRoot) {
  const profile = path.join(projectRoot, "build-profile.json5");
  if (!fs.existsSync(profile)) return null;
  try {
    const parsed = parseJson5(fs.readFileSync(profile, "utf8"));
    if (Array.isArray(parsed?.modules)) return parsed.modules;
    const error = new Error(`${profile} does not contain a modules array`);
    error.code = "BUILD_PROFILE_INVALID";
    throw error;
  } catch (error) {
    if (error.code === "BUILD_PROFILE_INVALID") throw error;
    const invalid = new Error(`Invalid HarmonyOS build profile ${profile}: ${error.message}`);
    invalid.code = "BUILD_PROFILE_INVALID";
    invalid.cause = error;
    throw invalid;
  }
}

/**
 * List declared module names, in the order build-profile.json5 declares them.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {string[]} Module names; empty when none can be resolved.
 */
export function readModuleNames(projectRoot) {
  const entries = readModuleEntries(projectRoot) ?? [];
  const names = [];
  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
