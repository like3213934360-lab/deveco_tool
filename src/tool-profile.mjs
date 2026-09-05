export const TOOL_PROFILES = ["core", "sdd", "legacy"];

export function resolveToolProfile(value = process.env.DEVECO_TOOL_PROFILE ?? "core") {
  if (!TOOL_PROFILES.includes(value)) throw new Error(`DEVECO_TOOL_PROFILE must be ${TOOL_PROFILES.join(", ")}; received ${JSON.stringify(value)}`);
  return value;
}

export function toolEnabled(name, profile) {
  if (name === "init_project_path") return profile === "legacy";
  if (name === "document_validate") return profile === "sdd" || profile === "legacy";
  return true;
}
