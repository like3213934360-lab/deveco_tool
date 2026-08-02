import fs from "node:fs";
import path from "node:path";

/**
 * Strip JSON5 comments and trailing commas so `JSON.parse` can read a
 * `build-profile.json5`. Deliberately dependency-free; anything this cannot
 * normalise falls back to the regex scan in `readModuleEntries`.
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

/**
 * Read the `modules` array out of a project's `build-profile.json5`.
 *
 * @param {string} projectRoot Absolute project root.
 * @returns {Array<{name?: string, srcPath?: string}>|null} Module entries, or null when the file is absent.
 */
export function readModuleEntries(projectRoot) {
  const profile = path.join(projectRoot, "build-profile.json5");
  if (!fs.existsSync(profile)) return null;
  let raw;
  try {
    raw = fs.readFileSync(profile, "utf8");
  } catch {
    return null;
  }
  for (const candidate of [raw, stripJson5(raw)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.modules)) return parsed.modules;
    } catch {
      // Fall through to the next candidate.
    }
  }
  const matches = [...raw.matchAll(/"srcPath"\s*:\s*"([^"]+)"/g)];
  return matches.length ? matches.map((match) => ({ srcPath: match[1] })) : null;
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
