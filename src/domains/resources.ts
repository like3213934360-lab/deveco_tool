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
    text: (a) => `Build ${a.project} with the project tool (action=build). For each reported diagnostic: read the file, search knowledge for the error code/message, fix it, then use code action=check on changed files. Repeat build until it succeeds. Do not change unrelated code.`,
  },
  "debug-crash": {
    description: "Reproduce, diagnose and fix an app crash",
    args: [{ name: "project", description: "Absolute project path", required: true }, { name: "symptom", description: "What the user saw" }],
    text: (a) => `The app in ${a.project} crashes${a.symptom ? ` (${a.symptom})` : ""}. 1) run action=build_run to deploy. 2) Reproduce with ui tools. 3) diagnose action=crash to read the fault log and matched patterns; follow skill hmos-runtime-fix-skill. 4) Open the top app frame, fix the root cause. 5) Redeploy and verify with ui assert.`,
  },
  "implement-feature": {
    description: "Spec-driven feature implementation for HarmonyOS (specify → plan → tasks → implement → verify)",
    args: [{ name: "project", description: "Absolute project path", required: true }, { name: "feature", description: "Feature request", required: true }],
    text: (a) => `Implement in ${a.project}: ${a.feature}\nPhases: (1) Specify: restate requirements and acceptance criteria. (2) Plan: pages, components, state (@ComponentV2/@Local...), APIs — verify APIs with knowledge search and code lsp hover. (3) Tasks: ordered checklist. (4) Implement: follow skill hmos-arkui-develop-skill (quick-apis + quick-rules); run code action=check after edits. (5) Verify: run action=build_run, then ui assert each acceptance criterion.`,
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
export function getPrompt(name: string, args: Record<string, string>) {
  const prompt = prompts[name];
  invariant(prompt, "NOT_FOUND", `Unknown prompt ${name}`);
  return { description: prompt.description, messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text(args) } }] };
}
