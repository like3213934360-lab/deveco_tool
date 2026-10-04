import { invariant } from "../core/errors.js";
import { listSkills, readSkill } from "./skills.js";

/* MCP Resources: skills are readable directly; Prompts package common workflows. */

export async function listResources() {
  return listSkills().map((s) => ({
    uri: `deveco://skills/${s.name}`,
    name: s.name,
    description: s.description,
    mimeType: "text/markdown",
  }));
}

export async function readResource(uri: string) {
  const match = /^deveco:\/\/skills\/([a-z0-9-]+)(?:\/(.+))?$/.exec(uri);
  invariant(match, "NOT_FOUND", `Unknown resource ${uri}`);
  const skill = readSkill(match[1]!, match[2]);
  return { uri, mimeType: "text/markdown", text: skill.content };
}

const prompts: Record<string, { description: string; args: { name: string; description: string; required?: boolean }[]; text(a: Record<string, string>): string }> = {
  "fix-build": {
    description: "Build the project and fix compile errors iteratively",
    args: [{ name: "project", description: "Absolute project path", required: true }],
    text: (a) => `Build ${a.project} with the project tool (action=build). Each reported diagnostic carries the file, line and the code around it (source): fix it there, searching knowledge for the error code/message when the cause is unclear. Build again until it succeeds (the build itself re-checks the edited files first, so no separate code check is needed). Do not change unrelated code.`,
  },
  "debug-crash": {
    description: "Reproduce, diagnose and fix an app crash",
    args: [{ name: "project", description: "Absolute project path", required: true }, { name: "symptom", description: "What the user saw" }],
    text: (a) => `The app in ${a.project} crashes${a.symptom ? ` (${a.symptom})` : ""}. 1) run action=build_run (target=<device>). If it fails with LAUNCH_FAILED, crash.source already gives the project file, line and code, plus likely causes: fix that and build_run again. 2) Otherwise reproduce in one call with ui act steps=[...] (add assert for the expected screen); save the path with save_flow so later deploys can use run then_flow=<id>. 3) Read the crash with diagnose action=crash project=${a.project} bundle=<bundle> since_minutes=10 (project adds the source location); follow skill hmos-runtime-fix-skill for the root cause. 4) Fix it, build_run again (code-only changes are quick-fixed in seconds) and verify with ui assert.`,
  },
  "upgrade-sdk": {
    description: "Check API compatibility before raising the SDK level",
    args: [{ name: "project", description: "Absolute project path", required: true }],
    text: (a) => `For ${a.project}: run code action=api_scan, group findings by severity, fix breaking changes, then build and run tests.`,
  },
};

export function listPrompts() {
  return Object.entries(prompts).map(([name, p]) => ({ name, description: p.description, arguments: p.args }));
}
export function getPrompt(name: string, args: Record<string, unknown>) {
  const prompt = Object.hasOwn(prompts, name) ? prompts[name] : undefined;
  invariant(prompt, "NOT_FOUND", `Unknown prompt ${name}`);
  invariant(args && typeof args === "object" && !Array.isArray(args), "INVALID_INPUT", "Prompt arguments must be an object");
  const checked: Record<string, string> = {};
  for (const arg of prompt.args) {
    const value = args[arg.name];
    invariant(value === undefined ? !arg.required : typeof value === "string" && (!arg.required || !!value.trim()),
      "INVALID_INPUT", `Prompt argument ${arg.name} must be ${arg.required ? "a non-empty" : "a"} string`);
    if (typeof value === "string") checked[arg.name] = value;
  }
  invariant(Object.keys(args).every((key) => prompt.args.some((arg) => arg.name === key)), "INVALID_INPUT", "Unknown prompt argument");
  return { description: prompt.description, messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text(checked) } }] };
}
