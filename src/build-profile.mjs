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

/** Resolve the selected product's declared SDK instead of guessing an API level. */
export function readProjectSdkConfig(projectRoot, productName) {
  const profile = path.join(projectRoot, "build-profile.json5");
  const invalid = (message) => {
    const error = new Error(`${profile}: ${message}`);
    error.code = "ARKTS_SDK_CONFIG_INVALID";
    throw error;
  };
  let app;
  try {
    app = parseJson5(fs.readFileSync(profile, "utf8"))?.app;
  } catch (error) {
    invalid(`Cannot read project SDK configuration: ${error.message}`);
  }
  if (!app || typeof app !== "object") invalid("Missing app SDK configuration");
  const products = app.products ?? [];
  if (!Array.isArray(products) || products.some((product) => !product || typeof product.name !== "string")) {
    invalid("app.products must contain named products");
  }
  let product;
  if (productName !== undefined) {
    const matches = products.filter((entry) => entry.name === productName);
    if (matches.length !== 1) invalid(`Product ${JSON.stringify(productName)} does not identify exactly one product`);
    [product] = matches;
  } else if (products.length) {
    const defaults = products.filter((entry) => entry.name === "default");
    if (defaults.length === 1) [product] = defaults;
    else if (products.length === 1) [product] = products;
    else invalid("Multiple products are declared without a unique default; pass product explicitly");
  }
  const apiLevel = (value, field) => {
    const text = typeof value === "string" ? value.trim() : "";
    const match = /^\d+\.\d+\.\d+\((\d+)\)$/.exec(text);
    const msf = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(text);
    const api = typeof value === "number" ? value : /^\d+$/.test(text) ? Number(text) : match ? Number(match[1])
      : msf && Number(msf[1]) >= 26 ? Number(msf[1]) * 10000 + Number(msf[2]) * 100 + Number(msf[3]) : NaN;
    if (!Number.isSafeInteger(api) || api <= 0) invalid(`${field} must be an API integer or a version such as 6.1.0(23)`);
    return api;
  };
  // Older profiles put the SDK fields on app; product fields override those values.
  const compatible = product?.compatibleSdkVersion ?? app.compatibleSdkVersion;
  const target = product?.targetSdkVersion ?? app.targetSdkVersion;
  const runtimeOS = product?.runtimeOS ?? app.runtimeOS ?? "OpenHarmony";
  if (!["HarmonyOS", "OpenHarmony"].includes(runtimeOS)) invalid(`Unsupported runtimeOS: ${JSON.stringify(runtimeOS)}`);
  // HarmonyOS's SDK comparison hook requires the distribution version, not a bare OpenHarmony
  // API integer. Losing this text makes it warn even when 13 <= 23.
  if (runtimeOS === "HarmonyOS" && !String(compatible).includes(".")) {
    invalid("HarmonyOS compatibleSdkVersion requires the distribution version, such as 6.1.0(23) or 26.0.0");
  }
  return {
    product: product?.name ?? null,
    runtimeOS,
    compatibleSdkVersion: apiLevel(compatible, "compatibleSdkVersion"),
    originCompatibleSdkVersion: String(compatible).trim(),
    ...(target !== undefined ? { targetSdkVersion: apiLevel(target, "targetSdkVersion") } : {}),
  };
}
