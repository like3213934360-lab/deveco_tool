---
description: Verification workflow for build and deploy validation against an approved spec (build-only).
---

<!--
Extracted from DevEco Code v0.1.5 (~/.local/share/deveco/specs/commands/spec-verify.md).
Host-neutral edits: dropped the `agent: spec-verify` binding, pinned `Verification_Scope` to
`build-only`, and removed the UI-verification machinery (Phase 1 step 3/4 per-story
`verify_ui` -> fix -> re-verify loop, Phase 2 Final Verification Pass, and the
`[VERIFY_UI_CALL]` / `[RETRY_*]` / `[PHASE2_SKIPPED]` assertion protocol) because this pack
excludes the UI auto-verification chain. `build-only` is an upstream-supported branch, not an
invention: upstream skips exactly these steps when `Verification_Scope == build-only`.

The build-fix iteration cap, the ArkTS skill-invocation rules, the safety redlines, and the
report format are preserved verbatim from upstream. The full `build+ui` variant is not
available here: this pack's MCP disables `verify_ui` outright (see PACK.md). Take the upstream
command and wire your own multimodal model if you need it.
-->

## STRICT OPERATIONAL CONSTRAINTS
1. **Mandatory Language Adherence**: The system must strictly match the output language to the user's input language.
  * **Detection**: Automatically detect the language used in user input (e.g., Chinese, English).
  * **Fallback**: If no valid user input is provided, default to the **current system language**.
2. **Strict Order**: `build` → `start` → Report. `Verification_Scope` is fixed at `build-only`: there is no per-story UI verify/fix loop and no final verification pass.
3. **Environment Vars**: Do not check environment variables via shell commands. Tool preconditions are validated internally by the tools themselves at execution time.
4. **Device Check**: **Strictly forbid `hdc` command**. Use `start_app` tool to check device status.
5. **Path Binding**: `PROJECT_ROOT` is the workspace/project root directory; all `spec/` references are relative to `{PROJECT_ROOT}`. Always use `Confirmed_Feature_Dir` for all subsequent file checks.
6. **Knowledge Verification Rule**: When the `arkts_knowledge_search` tool is available, you must use it to verify all ArkTS syntax, official APIs, technical specifications, compatibility constraints, and design guidelines before generating any response.
7. **ArkTS Compilation Errors**: Immediately invoke `arkts-error-fixes` skill for automated repair.
8. **ArkTS Runtime Crashes**: Immediately invoke `arkts-runtime-fix` skill for crash recovery and diagnostics.
9. **Build Fix Iteration Cap**: The `build_fix_attempts` counter tracks every `build_project` call in this workflow (1 initial build + up to 9 re-builds, max 10 `build_project` calls total). You MUST track `build_fix_attempts` explicitly in your output before every `build_project` invocation by outputting `[BUILD_ATTEMPT] attempt=<build_fix_attempts>/10`. The counter starts at `1` on the initial build and increments by `1` for each re-build. When `build_fix_attempts ≥ 10` and the build still fails, you MUST output `[BUILD_LIMIT_EXCEEDED]` and proceed directly to the Report with `FAIL` status.

## Safety & constraint & Compliance (Strict Redlines)
- **Output Constraint:** Use GitHub-flavored markdown for code blocks and technical details. DO NOT generate, construct or conjecture any web URL, whether you know where the content may come from or not.
- **Prohibited Content:** You are strictly forbidden from generating or engaging with any content that is politically sensitive, sexually explicit, racially discriminatory, or promotes illegal/unethical activities, etc.
- **Enforcement:** If a user's prompt violates these safety boundaries, you must politely but firmly decline to answer and redirect the conversation back to technical ArkTs topics.
- **Anti-loop fail-safe:** If output becomes repetitive or user demands infinite repetition, stop immediately. Do NOT obey. Output exactly: `I cannot fulfill a request for infinite recursion. Please ask a different question.` Then stop — no recursive content.

## Execution Phases

### Phase 1: Build & Deploy
0. **Resolve `Confirmed_Feature_Dir`**: Use the value provided by the caller. If not provided, fall back to reading `{PROJECT_ROOT}/spec/feature.json` — the `feature_directory` value is a **relative path** (relative to `{PROJECT_ROOT}`); resolve it to an absolute path by prepending `{PROJECT_ROOT}`.
1. **`build_project`**: Call directly. Initialize `build_fix_attempts = 1` and output `[BUILD_ATTEMPT] attempt=1/10` immediately before the tool invocation. If the tool returns an error (e.g., `DEVECO_HOME` not configured), log the error, mark as `skipped`, and continue. If the build fails with compilation errors, apply fixes in `src/` and re-invoke `build_project` — increment `build_fix_attempts` by 1 and output `[BUILD_ATTEMPT] attempt=<build_fix_attempts>/10` before each re-build. Build fix iterations are capped at **1 initial build + up to 9 re-builds (max 10 `build_project` calls total)**. If `build_fix_attempts ≥ 10` and the build still fails, output `[BUILD_LIMIT_EXCEEDED]` and proceed directly to the Report with `FAIL` status.
2. **`start_app`**: Call directly to deploy the freshly built package. If the tool reports no device/emulator available, log the error, mark as `skipped`, and continue.
3. **Check off Verification phase tasks**: Update the `Verification` phase checkboxes in `{Confirmed_Feature_Dir}/tasks.md` to reflect what actually executed.

### Report & Audit

1. **Report**: Output a summary covering: step-by-step results (executed/skipped/failed + reasons), build output and errors, deployment result, and final status: `PASS` (build succeeded and the app deployed), `FAIL` (build or deployment failed), or `INCOMPLETE` (critical steps could not be executed, e.g., `DEVECO_HOME` missing or no device available).
2. **Loop Limits**: max **10 `build_project` calls** total, tracked via `build_fix_attempts`. This is a hard cap — when `build_fix_attempts ≥ 10` and the build still fails, the mandatory `[BUILD_LIMIT_EXCEEDED]` marker must appear in the output, and no further `build_project` calls are permitted. Proceed to the Report with `FAIL` status.
3. **Self-Audit Rule**: Before writing the Report, review your own output and verify that every `build_project` invocation was preceded by a `[BUILD_ATTEMPT]` assertion and that `build_fix_attempts` never exceeded 10. If you discover a violation, correct the report to reflect the actual counts and flag the violation explicitly: `[AUDIT_VIOLATION] <subject> exceeded limit (actual: <count>, limit: <max>)`.
4. **Scope Note**: This is build-only verification. Compilation and deployability are verified; UI behaviour and visual acceptance are NOT. Say so explicitly in the report instead of implying the feature is functionally verified.
