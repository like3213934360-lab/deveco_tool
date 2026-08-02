---
name: harmony-plan-doc
description: ArkTS-aware planning checklist and plan document structure for HarmonyOS features - which platform dimensions to reason about (strictness, lifecycle, state, navigation, permissions, resources, performance) and which sections a HarmonyOS implementation plan must contain. Load this skill when writing an implementation plan, technical design, or 方案 for a HarmonyOS/ArkTS change. Triggers - 方案, 设计, 计划, plan, implementation plan, technical design, 怎么改, 改造方案.
---

# HarmonyOS Plan Document

Extracted from the DevEco Code v0.1.5 `plan` agent system prompt. Two things only: what ArkTS
dimensions to think about while designing, and what the resulting plan document must contain.

The agent-mode plumbing around it (`plan_write` / `plan_exit` / approval turn protocol) is
DevEco Code's own harness and is deliberately not reproduced — use whatever planning and approval
mechanism your host provides.

**Scope note**: if the project you are working in already has its own plan format or planning
workflow, that one wins. Use this skill for the ArkTS-specific content checklist, not to override
an existing house style.

## ArkTS planning awareness

When designing the plan, actively consider these ArkTS-specific dimensions:

- **ArkTS strictness**: No `any`, no `unknown`, no `as` assertions, no structural typing, no dynamic property access. If the plan involves type restructuring, call it out.
- **Lifecycle**: `aboutToAppear`, `aboutToDisappear`, `onPageShow`, `onPageHide` — note which lifecycle points the implementation must hook into.
- **State management**: `@State`, `@Prop`, `@Link`, `@Provide`/`@Consume`, `AppStorage` — specify which mechanism the design uses and why. (V2 projects: `@Local`, `@Param`, `@Event`, `@Provider`, `@Consumer`, `@Monitor`, `@Computed`.)
- **Navigation**: `Navigation`, `NavDestination`, router — note the routing approach.
- **Permissions**: If the feature needs `ohos.permission.*`, list them and note that `module.json5` must be updated.
- **Resources**: If new string/media/color resources are needed, note the `resources/` entries.
- **Performance**: For lists, note whether `LazyForEach` + `IDataSource` is needed. For heavy computation, note `TaskPool`.

You do not need to cover all dimensions — only those relevant to the current task.

## Plan output contract

Required sections (adjust depth to task complexity):

| Section | Purpose |
|---|---|
| **Goal** | What the implementation achieves |
| **Scope / Non-goals** | What is and is not included |
| **Current State And Constraints** | Existing code state, ArkTS / platform constraints relevant to this task |
| **Design** | Recommended approach with rationale; call out ArkTS-specific decisions (lifecycle hooks, state mechanism, permissions, resources) |
| **Key Files** | Concrete file paths with markdown links |
| **Execution Sequence** | Ordered steps for the implementer to follow |
| **Verification** | A matrix — at minimum a compilation check (`arkts_check` on edited files, then `build_project`), plus any applicable integration or manual verification |
| **Risks And Compatibility** | SDK version, permission, backward compat, or migration risks |
| **Rollback** | How to revert code and configuration if the change fails |

For simple tasks (single file, low risk), the plan can be brief — but `Verification` and `Rollback`
must always be present even if short.

## Plan writing guidelines

- Keep the plan concise, specific, and directly executable by whoever implements it.
- Include concrete file paths when they matter. Use markdown links: `[path/to/file.ets](path/to/file.ets)`.
- Prefer a single recommended approach, not a long list of alternatives.
- Keep plans proportional to the request complexity — do not over-engineer simple tasks.
- If you do not have enough information to create an accurate plan, ask the user before designing.
- If the user's request is too broad, ask questions that narrow the scope — only 1-2 critical questions at a time.
- If there are multiple valid implementations that change the plan significantly, ask which direction they prefer.

## Related skills

- `harmony-build-loop` — the execution-side loop the `Verification` section should reference.
- `arkts-grammar-standards` — the rule dictionary behind the "ArkTS strictness" dimension.
