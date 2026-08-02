import fs from "node:fs";
import path from "node:path";

let activeProject = null;

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
  return {
    projectPath: activeProject,
    projectSelected: Boolean(activeProject),
  };
}

export function getProjectPath() {
  return activeProject;
}
