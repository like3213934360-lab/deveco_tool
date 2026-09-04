import fs from "node:fs";
import path from "node:path";
import { parseJson5, readModuleEntries } from "../build-profile.mjs";
import { flowError } from "./domain.mjs";

function readJson5(file, code) {
  if (!fs.existsSync(file)) throw flowError(`Required HarmonyOS manifest is missing: ${file}`, code);
  try {
    return parseJson5(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw flowError(`HarmonyOS manifest is invalid: ${file} (${error.message})`, code);
  }
}

function pickUnique(items, explicit, label, code) {
  if (explicit) {
    const match = items.find((entry) => entry.name === explicit || entry.buildName === explicit);
    if (!match) throw flowError(`${label} was not found: ${explicit}`, code);
    return match;
  }
  if (items.length !== 1) {
    throw flowError(
      `${items.length ? `Multiple ${label}s are available (${items.map((entry) => entry.name).join(", ")})` : `No ${label} is available`}; pass ${label} explicitly`,
      code,
    );
  }
  return items[0];
}

export function readHarmonyAppModel(projectPath) {
  const project = path.resolve(projectPath);
  const app = readJson5(path.join(project, "AppScope", "app.json5"), "FLOW_APP_MANIFEST_INVALID");
  const bundleName = app?.app?.bundleName;
  if (typeof bundleName !== "string" || !bundleName.trim()) {
    throw flowError("AppScope/app.json5 does not declare app.bundleName", "FLOW_APP_TARGET_INVALID");
  }

  const buildProfile = path.join(project, "build-profile.json5");
  if (!fs.existsSync(buildProfile)) {
    throw flowError(`Required HarmonyOS manifest is missing: ${buildProfile}`, "FLOW_BUILD_PROFILE_INVALID");
  }
  let rawEntries;
  try {
    rawEntries = readModuleEntries(project);
  } catch (error) {
    throw flowError(`HarmonyOS manifest is invalid: ${buildProfile} (${error.message})`, "FLOW_BUILD_PROFILE_INVALID");
  }
  if (!Array.isArray(rawEntries)) {
    throw flowError(`HarmonyOS manifest is invalid: ${buildProfile}`, "FLOW_BUILD_PROFILE_INVALID");
  }
  const entries = rawEntries.map((entry) => ({
    name: typeof entry?.name === "string" ? entry.name.trim() : "",
    srcPath: typeof entry?.srcPath === "string" ? entry.srcPath : entry?.name,
  })).filter((entry) => entry.name && entry.srcPath);

  const candidates = [];
  for (const entry of entries) {
    const moduleFile = path.join(project, entry.srcPath, "src", "main", "module.json5");
    if (!fs.existsSync(moduleFile)) {
      throw flowError(`Required HarmonyOS manifest is missing: ${moduleFile}`, "FLOW_MODULE_MANIFEST_INVALID");
    }
    const manifest = readJson5(moduleFile, "FLOW_MODULE_MANIFEST_INVALID");
    if (manifest?.module?.type !== "entry") continue;
    candidates.push({
      ...entry,
      buildName: entry.name,
      name: manifest?.module?.name || entry.name,
      manifest,
      moduleFile,
    });
  }
  return {
    projectPath: project,
    bundleName: bundleName.trim(),
    modules: candidates.map((candidate) => ({
      buildName: candidate.buildName,
      name: candidate.name,
      srcPath: candidate.srcPath,
      moduleFile: candidate.moduleFile,
      mainElement: candidate.manifest?.module?.mainElement ?? null,
      abilities: Array.isArray(candidate.manifest?.module?.abilities)
        ? candidate.manifest.module.abilities.filter((item) => typeof item?.name === "string" && item.name)
        : [],
    })),
  };
}

export function resolveAppTarget(projectPath, overrides = {}) {
  const model = readHarmonyAppModel(projectPath);
  if (overrides.bundleName && overrides.bundleName !== model.bundleName) {
    throw flowError(`bundleName does not match AppScope/app.json5: ${overrides.bundleName}`, "FLOW_APP_TARGET_INVALID");
  }
  const selectedModule = pickUnique(model.modules, overrides.module, "module", "FLOW_MODULE_REQUIRED");
  const preferredAbility = overrides.ability
    ?? (overrides.preferMain === true ? selectedModule.mainElement : undefined);
  const selectedAbility = pickUnique(selectedModule.abilities, preferredAbility, "ability", "FLOW_ABILITY_REQUIRED");
  return {
    bundleName: model.bundleName,
    module: selectedModule.name,
    ability: selectedAbility.name,
  };
}
