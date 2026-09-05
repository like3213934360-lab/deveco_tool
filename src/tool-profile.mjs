export const TOOL_PROFILES = ["core", "sdd"];

export function resolveToolProfile(value = process.env.DEVECO_TOOL_PROFILE ?? "core") {
  if (!TOOL_PROFILES.includes(value)) throw new Error(`DEVECO_TOOL_PROFILE must be ${TOOL_PROFILES.join(", ")}; received ${JSON.stringify(value)}`);
  return value;
}

export function toolEnabled(name, profile) {
  if (name === "document_validate") return profile === "sdd";
  return true;
}
