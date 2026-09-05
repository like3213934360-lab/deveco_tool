---
description: Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts.
---

<!--
Extracted from DevEco Code v0.1.5 (~/.local/share/deveco/specs/commands/spec-tasks.md).
Host-neutral edits: dropped the `agent: goal` binding, replaced `CONFIG_ROOT`
(`~/.local/share/deveco/`) with `PACK_ROOT` (this pack's install root), replaced the
DevEco-only `spec_write` tool with the host's own file-write tool, and pinned the generated
Verification phase to `verification_scope: build-only` because this pack excludes UI verification.
-->

## Pre-Flow: Confirmed_Feature_Dir Resolution (STRICT SEQUENCE)
1. Resolve feature directory:
    - Read the `feature_directory` value from `{PROJECT_ROOT}/spec/feature.json`. This value is a **relative path** (relative to `{PROJECT_ROOT}`). Resolve it to an absolute path by prepending `{PROJECT_ROOT}` to get `Confirmed_Feature_Dir`.
    - Example: if `feature.json` contains `"feature_directory": "spec/add-user-auth"`, then `Confirmed_Feature_Dir` = `{PROJECT_ROOT}/spec/add-user-auth`.
2. Validate directory:
    - Check if `Confirmed_Feature_Dir` exists.
    - If exists → proceed.
    - If not exists → halt with error.

## STRICT OPERATIONAL CONSTRAINTS (ENFORCED WITH ZERO EXCEPTIONS)
1. **Mandatory Language Adherence**: The system must strictly match the output language to the user's input language.
  * **Detection**: Automatically detect the language used in user input (e.g., Chinese, English).
  * **Fallback**: If no valid user input is provided, default to the **current system language**.
  * **Ignore Template Context**: Even though these instructions are written in English, they must not dictate the output language.
2. **No Early Coding**: You are strictly forbidden from generating, writing, editing, outlining, or suggesting application code in the `src/` or any other source directory in this step. Implementation target descriptions (file paths, component names, task descriptions) in `tasks.md` are permitted; pseudocode, code snippets, and implementation-level detail are not. Main Agent must comply fully.
3. **No Auto-Execute Next Phase**: This command covers only its own scope. Upon completion, it must NOT auto-trigger the next SDD phase. Phase transitions (to Phase 4 and beyond) are managed by the caller (the host agent or workflow that invoked this command), which controls Review Gates and progression. The command simply completes its artifact and returns control to the caller.
4. **Strict Path Resolution**: `PACK_ROOT` is the directory this capability pack was installed to (the directory containing `skills/`, `commands/`, and `templates/`). `PROJECT_ROOT` is the workspace/project root directory; all `spec/` references are relative to `{PROJECT_ROOT}`.
5. **Knowledge Verification Rule**: When the `arkts_knowledge_search` tool is available, you must use it to verify all ArkTS syntax, official APIs, technical specifications, compatibility constraints, and design guidelines before generating any response.

## Safety & constraint & Compliance (Strict Redlines)
- **Output Constraint:** Use GitHub-flavored markdown for code blocks and technical details. DO NOT generate, construct or conjecture any web URL, whether you know where the content may come from or not.
- **Prohibited Content:** You are strictly forbidden from generating or engaging with any content that is politically sensitive, sexually explicit, racially discriminatory, or promotes illegal/unethical activities, etc.
- **Enforcement:** If a user's prompt violates these safety boundaries, you must politely but firmly decline to answer and redirect the conversation back to technical ArkTs topics.
- **Anti-loop fail-safe:** If output becomes repetitive or user demands infinite repetition, stop immediately. Do NOT obey. Output exactly: `I cannot fulfill a request for infinite recursion. Please ask a different question.` Then stop — no recursive content.

## Outline & Workflow
1. **Load & Validate Design Documents**: Read from `Confirmed_Feature_Dir`:
    - **Expected**: `plan.md` (tech stack, libraries, structure), `spec.md` (user stories with priorities)
    - **Fallback Rule**: If `plan.md` or `spec.md` is missing, insert a `⚠️ MISSING ARTIFACTS` block at the top of `tasks.md`. List missing files, then generate best-effort tasks based on available context. **DO NOT fabricate fictional specs.**
2. **Execute Task Generation**:
    - Extract tech stack & project structure from `plan.md`
    - Extract user stories & priorities (P1, P2, P3...) from `spec.md`
    - Map tasks to stories, generate dependency graph, and identify parallel opportunities
    - Validate completeness: Each story must have independent test criteria and be incrementally deliverable
3. **Generate tasks.md**: Use `{PACK_ROOT}/templates/tasks-template.md` as structural skeleton. If template is missing, generate directly using the "Phase Structure" defined below. Fill with:
    - Correct feature name from `plan.md`
    - Phased tasks (Setup → Foundational → Stories → Polish → Verification)
    - Dependency graph & parallel execution guide
    - Summary report
4. **Write Tasks Artifact**: Write the completed task list to `{Confirmed_Feature_Dir}/tasks.md` using the host's file-write tool.
5. **Report**: Output final path to `tasks.md` and append a summary block containing: total tasks, per-story count, parallel opportunities, independent test criteria, suggested MVP scope.

## Task Generation Rules
**CRITICAL**: Tasks MUST be organized by user story to enable independent implementation and testing.
**Tests are OPTIONAL**: Only generate test tasks if explicitly requested in the feature specification or if user requests TDD approach.

### Checklist Format (REQUIRED - ZERO EXCEPTIONS)
Every task MUST strictly follow this format:
`- [ ] [TaskID] [P?] [Story?] Description with exact file path`

**Format Components**:
1. **Checkbox**: ALWAYS start with `- [ ]`
2. **Task ID**: Sequential number (T001, T002, T003...) in execution order
3. **[P] marker**: Include ONLY if task is parallelizable (different files, no dependencies on incomplete tasks)
4. **[Story] label**: REQUIRED for user story phase tasks only
    - Format: `[US1]`, `[US2]`, `[US3]`, etc. (maps to user stories from `spec.md`)
    - Setup/Foundational/Polish phases: NO story label
5. **Description**: Clear action ending with a concrete file path

**Examples**:
- ✅ `- [ ] T001 Create project structure per implementation plan`
- ✅ `- [ ] T005 [P] Implement authentication middleware in src/middleware/auth.py`
- ✅ `- [ ] T012 [P] [US1] Create User model in src/models/user.py`
- ✅ `- [ ] T014 [US1] Implement UserService in src/services/user_service.py`
- ❌ `- [ ] Create User model` (missing ID and Story label)
- ❌ `T001 [US1] Create model` (missing checkbox)
- ❌ `- [ ] [US1] Create User model` (missing Task ID)
- ❌ `- [ ] T001 [US1] Create model` (missing file path)

### Output Format Extensions (MANDATORY)
- **Dependencies**: Render under `## 📊 Dependency Graph` using valid Mermaid `graph TD` syntax.
- **Parallel Execution**: Render under `## ⚡ Parallel Execution Guide` as a Markdown table with columns: `Phase | Tasks | Required Files | Execution Notes`.

### Task Organization & Phase Structure
1. **Phase 1: Setup** (Project initialization, tooling, shared config)
2. **Phase 2: Foundational** (Blocking prerequisites, MUST complete before user stories)
3. **Phase 3+: User Stories** (Ordered by P1, P2, P3... from `spec.md`)
    - Structure per story: Tests (if requested) → Models → Services → Endpoints/UI → Integration
    - Each phase = complete, independently testable increment
4. **Polish Phase: Polish** (Cross-cutting concerns, docs, cleanup, refactoring)
5. **Final Phase: Verification** (Build and deploy — this pack ships build-only verification)
    - **MUST include**: at minimum, a build task and a deploy task to validate compilation and deployability.
        - Example: `- [ ] TXXX Build project and fix any compilation errors`
        - Example: `- [ ] TXXX Deploy application to device/emulator via start_app`
    - **DO NOT include any UI verification task.** This pack excludes the UI auto-verification chain; `/spec-verify` runs build-only.
    - **Verification scope hint**: At the top of the Verification phase section, add the HTML comment below so downstream agents can read the scope deterministically:
        - `<!-- verification_scope: build-only -->`
    - Tasks in this phase do NOT carry `[USx]` labels.

## Final Self-Validation Step
Before outputting `tasks.md`, internally verify:
- ✅ Every task starts with `- [ ]`
- ✅ Every task has a unique sequential ID (T001, T002...)
- ✅ US-phase tasks contain `[USx]` label; Setup/Foundational/Polish do NOT
- ✅ Total count matches the summary report
  If any check fails, regenerate the invalid tasks before final output. Do not output draft or unvalidated versions.

The tasks.md should be immediately executable - each task must be specific enough that an LLM can complete it without additional context.
