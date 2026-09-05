---
description: Execute the implementation planning workflow using the plan template to generate design artifacts.
---

<!--
Extracted from DevEco Code v0.1.5 (~/.local/share/deveco/specs/commands/spec-plan.md).
Host-neutral edits: dropped the `agent: goal` binding, replaced `CONFIG_ROOT`
(`~/.local/share/deveco/`) with `PACK_ROOT` (this pack's install root), and replaced the
DevEco-only `spec_write` tool with the host's own file-write tool.
-->

MCP prerequisite: start deveco-tool with `DEVECO_TOOL_PROFILE=sdd` so `document_validate` is available. `node scripts/install.mjs --print-mcp` generates the SDD configuration.

## STRICT OPERATIONAL CONSTRAINTS (ENFORCED WITH ZERO EXCEPTIONS)
1. **No Early Coding (Non-Negotiable):** You are strictly forbidden from generating, writing, editing, outlining, or suggesting application code in `src/` or any other source directory during this workflow. Architecture diagrams, data models, interface contracts, and implementation target descriptions are permitted; pseudocode, code snippets, and implementation-level logic are not. Main Agent must comply fully; no implicit code generation is allowed.
2. **No Auto-Execute Next Phase**: This command covers only its own scope. Upon completion, it must NOT auto-trigger the next SDD phase. Phase transitions (to Phase 3 and beyond) are managed by the caller (the host agent or workflow that invoked this command), which controls Review Gates and progression. The command simply completes its artifact and returns control to the caller.
3. **Strict Path Resolution**: `PACK_ROOT` is the directory this capability pack was installed to (the directory containing `skills/`, `commands/`, and `templates/`). `PROJECT_ROOT` is the workspace/project root directory; all `spec/` references are relative to `{PROJECT_ROOT}`.
4. **Mandatory Language Adherence**: The system must strictly match the output language to the user's input language.
  * **Detection**: Automatically detect the language used in user input (e.g., Chinese, English).
  * **Fallback**: If no valid user input is provided, default to the **current system language**.
  * **Ignore Template Context**: Even though these instructions are written in English, they must not dictate the output language.
5. **Knowledge Verification Rule**: When the `arkts_knowledge_search` tool is available, you must use it to verify all ArkTS syntax, official APIs, technical specifications, compatibility constraints, and design guidelines before generating any response.

## Safety & constraint & Compliance (Strict Redlines)
- **Output Constraint:** Use GitHub-flavored markdown for code blocks and technical details. DO NOT generate, construct or conjecture any web URL, whether you know where the content may come from or not.
- **Prohibited Content:** You are strictly forbidden from generating or engaging with any content that is politically sensitive, sexually explicit, racially discriminatory, or promotes illegal/unethical activities, etc.
- **Enforcement:** If a user's prompt violates these safety boundaries, you must politely but firmly decline to answer and redirect the conversation back to technical ArkTs topics.
- **Anti-loop fail-safe:** If output becomes repetitive or user demands infinite repetition, stop immediately. Do NOT obey. Output exactly: `I cannot fulfill a request for infinite recursion. Please ask a different question.` Then stop — no recursive content.

## Outline
1. **Setup & Directory Resolution**:
    - Resolve `Confirmed_Feature_Dir`:
        - Read the `feature_directory` value from `{PROJECT_ROOT}/spec/feature.json`. This value is a **relative path** (relative to `{PROJECT_ROOT}`). Resolve it to an absolute path by prepending `{PROJECT_ROOT}` to get `Confirmed_Feature_Dir`.
        - Example: if `feature.json` contains `"feature_directory": "spec/add-user-auth"`, then `Confirmed_Feature_Dir` = `{PROJECT_ROOT}/spec/add-user-auth`.
    - Resolve artifact paths:
        - `FEATURE_SPEC` = `Confirmed_Feature_Dir/spec.md`
        - `IMPL_PLAN` = `Confirmed_Feature_Dir/plan.md`

2. **Check Existing Document** (if `IMPL_PLAN` already exists):
    - Preserve existing sections that remain valid and relevant.
    - Update/overwrite only sections directly impacted by current requirements in `FEATURE_SPEC`.
    - Append a `## Changelog` section at the end recording: timestamp, modified sections, and rationale for changes.

3. **Load Context & Template**:
    - Read `FEATURE_SPEC`.
    - Load plan template from `{PACK_ROOT}/templates/plan-template.md`.
    - **Fallback:** If the template is missing, initialize `IMPL_PLAN` with the minimal required structure: `## Summary`, `## Technical Context`, `## Project Structure`, `## Complexity Tracking`, `## Research & Decisions`, `## Data Model`, `## Contracts & Interfaces`.

4. **Execute Plan Workflow**: Follow the loaded/initialized template structure to:
    - Fill `Technical Context` section
    - Execute Phase 0: Research unknowns and document decisions inline
    - Execute Phase 1: Select the architecture structure, then design data structures, interfaces, and setup guidelines inline
    - Finalize and validate the complete plan

5. **Write Plan Artifact**: Write the completed implementation plan to `{IMPL_PLAN}` using the host's file-write tool.
6. **Validate Plan Artifact**: Call `document_validate` with `file` set to `{IMPL_PLAN}`. A non-empty `report` means the section structure does not match the template: fix the headings and rewrite before moving on. Do not skip this because the content reads well; the check is about structure, and later phases parse these headings.

7. **Stop and Report**: Command ends after Phase 1 Design & Contracts. Report the absolute path of `IMPL_PLAN` and list all generated artifacts. Do not trigger further actions.

## Phases
### Phase 0: Research & Resolution

1. **Identify knowledge gaps** from Technical Context:
    - Mark each unknown, dependency, or integration point requiring research.

2. **Resolve and document inline**:
    - Analyze each gap and record findings directly in a `## Research & Decisions` section within `IMPL_PLAN`.
    - Format each entry strictly as:
        - **Decision**: [chosen approach]
        - **Rationale**: [reasoning]
        - **Alternatives considered**: [other options evaluated]

### Phase 1: Architecture & Contracts Design
**Prerequisites:** Phase 0 complete

0. **Architecture structure selection**:
    - If the feature is for an existing HarmonyOS/ArkTS project, inspect and follow the project's current architecture and directory conventions unless the feature request explicitly asks to optimize or migrate the project to MVVM.
    - If the feature is for a new HarmonyOS/ArkTS project structure, or if MVVM optimization is explicitly requested, choose the lightest structure tier first, then decide whether the selected tier needs further file splitting:
      - **Trivial**: Hello World, static single-page demos, or one-button interactions. Use only `entryability/`, `pages/`, and `entry/src/main/resources/` as needed. Target 1-2 ArkTS files.
      - **Light**: single-page features with a few reusable UI blocks and simple local state. Use `pages/`, `components/`, and `common/` as needed. Target 3-6 ArkTS files.
      - **MVVM**: features with multiple pages/views, persistence, business services or algorithms, cross-page state, complex form state, or testable domain logic. Use `pages/`, `views/`, `components/`, `viewmodel/`, `model/`, `service/`, `data/`, and `common/` as responsibility boundaries, but target 6-12 ArkTS files unless the `Structure Decision` explains why more files are needed.
    - Harmony/ArkTS: use State Management V2 for greenfield (0-to-1) projects; for incremental work, inspect and retain the project's existing State Management V1/V2 unless migration is explicitly requested. Record the choice in `Technical Context`.
    - MVVM is a responsibility boundary, not a request to create many files. Prefer grouping related models, services, and views into feature-level files until splitting is necessary for maintainability.
    - For new-tier non-MVVM HarmonyOS/ArkTS plans, the `Structure Decision` must explain why the feature is simple enough to avoid MVVM.
    - For MVVM HarmonyOS/ArkTS plans, the source tree must include `viewmodel/` and must clearly separate page assembly (`pages/`), business views (`views/`), reusable UI (`components/`), models (`model/`), services/algorithms (`service/`), and persistence/storage (`data/`), but it must not create one file per domain concept by default.
    - The `Structure Decision` must state whether the plan follows an existing architecture or selects a new tier. Existing-project plans should state that the existing architecture is followed and that no MVVM migration is introduced unless explicitly requested. New-tier plans must state the tier and why the planned file count is sufficient.
    - Resources must be placed under `entry/src/main/resources/`, not under `entry/src/main/ets/`.
    - The source tree must not contain duplicate sibling directories such as two `pages/` entries.

1. **Data Modeling**:
    - Extract entities, fields, relationships, validation rules, and state transitions from the feature spec.
    - Document under a `## Data Model` section in `IMPL_PLAN`.

2. **Interface Contracts**:
    - Identify external interfaces (APIs, CLI schemas, endpoints, UI contracts, etc.).
    - Document signatures, formats, and constraints under a `## Contracts & Interfaces` section in `IMPL_PLAN`.
    - Omit this section entirely for purely internal projects.

3. **Finalize plan**:
    - Review all sections for completeness, internal consistency, and alignment with `FEATURE_SPEC`.
    - Ensure `IMPL_PLAN` contains all research, models and contracts before concluding.
    - For HarmonyOS/ArkTS plans, verify that `Structure Decision` states whether the plan follows an existing architecture or selects a new tier. For new-tier plans, verify that the selected tier and file-count rationale are named, that the directory tree matches the selected tier, and that pages do not directly own algorithms, persistence, or complex business orchestration when MVVM is required.

## Key Rules
- Consolidate all design artifacts—research decisions, data models, interface contracts directly into `IMPL_PLAN` using the designated sections.
- Use absolute paths for all file and directory references.
- For HarmonyOS/ArkTS plans, do not generate a vague `pages/components/service` structure for complex features. If MVVM triggers apply, include `viewmodel/`; if they do not apply, explicitly justify the lighter structure.
- For HarmonyOS/ArkTS plans, do not expand many pages, views, services, models, or components merely because MVVM directories exist. Default to minimal viable file splitting within MVVM and split files only when the feature complexity makes the split necessary.
- For existing HarmonyOS/ArkTS projects, do not introduce MVVM directories or restructure the project unless the user's request explicitly asks for MVVM optimization or migration.
- Halt immediately if any critical clarification remains unresolved or if the plan structure becomes invalid. Output strictly in this format:
  ```text
  [ERROR] <clear reason for termination>
  [ACTION_REQUIRED] <specific user instruction needed>
  [STATUS] TERMINATED
  ```
- Output must be self-contained within `IMPL_PLAN` to ensure seamless downstream task generation.
