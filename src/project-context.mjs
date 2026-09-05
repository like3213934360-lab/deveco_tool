import fs from "node:fs";
import path from "node:path";

// GUI MCP hosts commonly configure the initial project through the environment.
// Keep it even if unavailable so doctor can diagnose it and file operations fail
// at the configured location, instead of silently using the gateway repository.
let activeProject = process.env.PROJECT_PATH?.trim() ? path.resolve(process.env.PROJECT_PATH) : null;

const PROJECT_MARKERS = [
  "build-profile.json5",
  "oh-package.json5",
  "hvigorfile.ts",
  "hvigorfile.js",
  "entry/src/main/module.json5",
];

function hasProjectMarker(projectPath) {
  return PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(projectPath, marker)));
}

export function setProjectPath(projectPath) {
  if (typeof projectPath !== "string" || projectPath.trim() === "") {
    const error = new Error("project_path is required");
    error.code = "PROJECT_PATH_REQUIRED";
    throw error;
  }

  const absolute = path.resolve(projectPath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    const error = new Error(`Project directory does not exist: ${absolute}`);
    error.code = "PROJECT_PATH_NOT_FOUND";
    throw error;
  }

  if (!hasProjectMarker(absolute)) {
    const error = new Error(
      `The directory is not recognized as a HarmonyOS project: ${absolute}`,
    );
    error.code = "NOT_HARMONY_PROJECT";
    error.hint = "Expected build-profile.json5, oh-package.json5, hvigorfile.ts, or module.json5.";
    throw error;
  }

  activeProject = absolute;
  return getProjectContext();
}

export function getProjectContext() {
  let issue;
  if (activeProject) {
    try {
      if (!fs.statSync(activeProject).isDirectory() || !hasProjectMarker(activeProject)) {
        issue = "The configured path is not recognized as a HarmonyOS project";
      }
    } catch (error) {
      issue = error.message;
    }
  }
  return {
    projectPath: activeProject,
    projectSelected: Boolean(activeProject),
    ...(issue ? { issue } : {}),
  };
}

export function getProjectPath() {
  return activeProject;
}
