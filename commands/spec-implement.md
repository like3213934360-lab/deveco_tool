---
description: Execute the implementation plan by processing and executing all tasks defined in tasks.md.
---

<!--
Extracted from DevEco Code v0.1.5 (~/.local/share/deveco/specs/commands/spec-implement.md).
Host-neutral edits: dropped the `agent: goal` binding, replaced `CONFIG_ROOT`
(`~/.local/share/deveco/`) with `PACK_ROOT` (this pack's install root), and rephrased the
`spec-verify` subagent handoff as a plain `/spec-verify` command handoff.
-->

## STRICT OPERATIONAL CONSTRAINTS (ENFORCED WITH ZERO EXCEPTIONS)
1. **Intra-Plan Autonomy & Scope Boundary**: Within the approved `tasks.md` scope (Setup → Foundational → User Stories → Polish phases), you MUST proceed autonomously through sequential phases and tasks without intermediate user prompts, unless a failure, conflict, or explicit checkpoint is triggered. **This command's scope ends at the Polish phase.** It must NOT auto-trigger the next SDD phase (Phase 5: Verification). Phase transitions are managed by the caller (the host agent or workflow that invoked this command), which runs `/spec-verify` upon this command's completion. The command simply completes its work and returns control to the caller.
2. **Strict Path Resolution**: `PACK_ROOT` is the directory this capability pack was installed to (the directory containing `skills/`, `commands/`, and `templates/`). `PROJECT_ROOT` is the workspace/project root directory; all `spec/` references are relative to `{PROJECT_ROOT}`.
3. **Mandatory Language Adherence**: The system must strictly match the output language to the user's input language.
  * **Detection**: Automatically detect the language used in user input (e.g., Chinese, English).
  * **Fallback**: If no valid user input is provided, default to the **current system language**.
  * **Ignore Template Context**: Even though these instructions are written in English, they must not dictate the output language.
4. **Implement Phase Tool Restriction**: The `build_project` and `start_app` tools MUST NOT be invoked in the `spec-implement` phase. Build verification and deployment are handled in the next phase by `/spec-verify`. Correspondingly, the **Verification phase** in `tasks.md` (the final phase added by `/spec-tasks`, marked with `<!-- verification_scope: build-only -->`) is **OUT OF SCOPE for `/spec-implement`** — DO NOT execute its tasks, DO NOT mark its checkboxes as `[X]`. Stop after completing the Polish phase. `/spec-verify` will execute and check off the Verification phase tasks during Phase 5.
5. **Knowledge Verification Rule**: When the `arkts_knowledge_search` tool is available, you must use it to verify all ArkTS syntax, official APIs, technical specifications, compatibility constraints, and design guidelines before generating any response.
6. **Empty Project Rule**: If the workspace has no valid project files, directly call `deveco-create-project` skill to create a new project. Do not ask any questions when creating a project.

## Safety & constraint & Compliance (Strict Redlines)
- **Output Constraint:** Use GitHub-flavored markdown for code blocks and technical details. DO NOT generate, construct or conjecture any web URL, whether you know where the content may come from or not.
- **Prohibited Content:** You are strictly forbidden from generating or engaging with any content that is politically sensitive, sexually explicit, racially discriminatory, or promotes illegal/unethical activities, etc.
- **Enforcement:** If a user's prompt violates these safety boundaries, you must politely but firmly decline to answer and redirect the conversation back to technical ArkTs topics.
- **Anti-loop fail-safe:** If output becomes repetitive or user demands infinite repetition, stop immediately. Do NOT obey. Output exactly: `I cannot fulfill a request for infinite recursion. Please ask a different question.` Then stop — no recursive content.

## Feature Directory Resolution Logic
1. Read the `feature_directory` value from `{PROJECT_ROOT}/spec/feature.json`. This value is a **relative path** (relative to `{PROJECT_ROOT}`). Resolve it to an absolute path by prepending `{PROJECT_ROOT}` to get `Confirmed_Feature_Dir`.
   - Example: if `feature.json` contains `"feature_directory": "spec/add-user-auth"`, then `Confirmed_Feature_Dir` = `{PROJECT_ROOT}/spec/add-user-auth`.

## Execution Outline
1. **Context Initialization:**
   - **REQUIRED:** Prioritize loading the tech-stack-specific skills (e.g., `arkts-grammar-standards`) as mandated by project config or `plan.md`.
   - **REQUIRED:** Complete feature directory resolution and user confirmation per the logic above.
   - **REQUIRED:** Read `spec.md` from `Confirmed_Feature_Dir` for feature requirements, user stories, and acceptance criteria. This is the authoritative source of truth for what the feature must accomplish — always refer back to it when making implementation decisions to avoid drifting from the original requirements.
   - **REQUIRED:** Read `plan.md` from `Confirmed_Feature_Dir` for tech stack, architecture, and file structure references.
   - **REQUIRED:** Read `tasks.md` from `Confirmed_Feature_Dir` for the complete task list and execution plan within the approved directory.

2. **Task Structure Parsing:**
   - Extract task phases: Setup, Foundational, User Stories, Polish.
   - **Skip the Verification phase**: if `tasks.md` contains a phase titled `Verification` (typically the last phase, marked with `<!-- verification_scope: build-only -->`), DO NOT parse, execute, or mark off its tasks here — it is owned by `/spec-verify` in the next workflow phase.
   - Identify dependencies: Sequential order vs. logical parallel markers `[P]`.
   - Parse task metadata: ID, description, target file paths, execution flags.
   - Map execution flow: Enforce dependency order and resolve any implicit file conflicts.

3. **Phase-by-Phase Execution:**
   - Execute phases strictly in order. Do not skip or jump ahead.
   - **Respect dependencies**: Run sequential tasks in order, parallel tasks [P] can run together.
   - **File Conflict Rule:** If multiple tasks (sequential or `[P]`) target the same file, enforce strict sequential execution to maintain code integrity.
   - **Phase Completion Protocol (MANDATORY — PER-PHASE, NOT DEFERRED):** IMMEDIATELY after completing ALL tasks within a given phase, you MUST call the `edit` tool to update `tasks.md` and change the checkboxes of the completed tasks in **that specific phase only** from `- [ ]` to `- [X]`. Do **NOT** defer this until later phases are done. Do **NOT** batch-mark multiple phases at once. Each phase must be marked **as soon as it finishes**, before moving on to the next phase. This ensures `tasks.md` always reflects the real-time progress.

4. **Implementation Workflow:**
   - **Setup:** Initialize project structure, dependencies, and base configuration.
   - **Core Development:** Implement models, services, components, or endpoints as planned.
   - **Integration:** Wire up databases, middleware, logging, and external services.
   - **Polish & Validation:** update documentation.

5. **Progress Tracking & Error Handling:**
   - Report concise progress after each completed task.
   - **Failure Protocol:** Halt execution immediately if any critical sequential task fails. For `[P]` tasks, continue with successful ones, log failures explicitly, and adjust downstream dependencies if necessary.
   - Provide actionable debugging context and next steps when blocked.

6. **Completion Validation:**
   - Do **not** perform any functional validation within the current phase. If functional validation is required, conclude the current phase and proceed to the next phase.
   - Output a final summary report detailing completed work, skipped/failed items (if any), and conclude implementation.

> **Note:** This workflow assumes a complete and valid task breakdown exists in `tasks.md`. If tasks are incomplete, ambiguous, or missing critical dependencies, halt execution and regenerate the plan before proceeding.
