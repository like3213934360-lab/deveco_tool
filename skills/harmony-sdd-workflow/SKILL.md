---
name: harmony-sdd-workflow
description: Drive the five-phase SDD workflow (specify - plan - tasks - implement - verify) end to end, with review gates between phases, backtracking when a gate changes a requirement, and delegation contracts for the implementation and verification stages. Load this skill when running the spec-driven workflow for a HarmonyOS/ArkTS feature, or when the五阶段 commands need an orchestrator instead of being invoked one at a time. Triggers - SDD, spec-driven, 五阶段, 需求到验收, spec-specify, spec-plan, spec-tasks, spec-implement, spec-verify, 编排.
---

# HarmonyOS SDD Workflow

Extracted from the DevEco Code `goal` agent system prompt (unchanged between v0.1.5 and
0.2.0-release). That agent is the orchestrator that drives the five SDD commands as one workflow:
it owns the review gates, the phase state, and the two delegation contracts.

The five command files in `{PACK_ROOT}/commands/` are the per-phase instructions. This skill is the
layer above them. **Without it the commands still work — you just invoke them one at a time and
advance manually.** With it, the phases run as a single gated workflow.

The agent-mode plumbing around the original (`question` / `todowrite` / `spec_write` / the
`subagent_type` registry / the permission table) is DevEco Code's own harness and is deliberately
not reproduced. Every place the upstream prompt named one of those, this skill names the capability
instead, and says what to do when the host does not have it.

## Path resolution

- `PACK_ROOT` — the directory this capability pack was installed to (contains `skills/`,
  `commands/`, `templates/`).
- `PROJECT_ROOT` — the workspace root.
- The feature directory is always `{PROJECT_ROOT}/spec/{feature_name}/`. Every `spec/` reference in
  the command files resolves against `{PROJECT_ROOT}`.

| Phase | Command to read | Template to read |
|---|---|---|
| 1 Requirements | `{PACK_ROOT}/commands/spec-specify.md` | `{PACK_ROOT}/templates/spec-template.md` |
| 2 Design | `{PACK_ROOT}/commands/spec-plan.md` | `{PACK_ROOT}/templates/plan-template.md` |
| 3 Tasks | `{PACK_ROOT}/commands/spec-tasks.md` | `{PACK_ROOT}/templates/tasks-template.md` |
| 4 Implementation | `{PACK_ROOT}/commands/spec-implement.md` | — |
| 5 Verification | `{PACK_ROOT}/commands/spec-verify.md` | — |

Commands live under `commands/`, templates under `templates/`. Never fabricate or guess a path; if
a file is not at its canonical path, use the fallback the command file defines.

## Hard constraints

**1. No early coding.** No application code in `src/` or any other source directory until Phase 4.
Inside `spec/` artifacts during Phases 1-3, architecture diagrams, data models, interface contracts
and implementation targets (file paths, component names, task descriptions) are allowed; pseudocode,
code snippets and implementation-level logic are not.

**2. Phase review gates.** Phases 1-3 each end at a gate: present the artifact summary, ask the
user to choose, and wait. Phase 3 has a second gate *before* generating `tasks.md`. Phase 4 flows
into Phase 5 with no gate. Phase 5 has no gate at all. Options and backtracking rules are in
[`references/phase-gates.md`](references/phase-gates.md).

**3. Artifact writing.** Phases 1-3 create and rewrite `spec.md` / `plan.md` / `tasks.md` with the
host's file-write tool. Upstream reserved a dedicated artifact writer for this; the equivalent here
is any write tool, plus the explicit `document_validate` step the commands now carry. Incremental
`[X]` checkbox updates in Phases 4-5 are edits, not rewrites.

**4. Artifact validation.** After writing any of the three artifacts, call `document_validate` on
it. A non-empty `report` means the section structure does not match the template — fix and rewrite.
Later phases parse these headings, so a structurally wrong artifact fails downstream, not here.

**5. Phase state.** Track the five phases in whatever task-tracking mechanism the host provides.
Exactly one phase is `in_progress` at a time; earlier phases are `completed`, later ones `pending`.
Update before every transition, and again after each Phase 1-3 gate is confirmed. If the host has no
task list, print the same five-row state table in your reply at each transition — the invariant is
that the current phase is always visible, not that a particular tool records it.

**6. Knowledge verification.** When `arkts_knowledge_search` is available, verify ArkTS syntax,
official APIs, compatibility constraints and design guidelines with it before generating content
that depends on them.

**7. Output language follows the user.** Detect the language of the user's input and match it. These
instructions being in English does not make the output English. This is why the artifacts may carry
Chinese headings — `document_validate` recognises both.

**8. No workflow shortcuts.** Do not bypass, skip, merge or reorder phases by default. If skipping
looks warranted, ask first. If the host cannot ask, run the full workflow.

## Phase summary

1. **Requirements** — Load `spec-specify.md`. Run a Requirements Clarity Analysis *before* drafting:
   enumerate the functional and non-functional requirements implied by the request, and for each,
   decide whether it is fully specified. Any ambiguity must go back to the user before spec content
   is written — do not infer or guess. Then write `spec.md`, validate it, and run the gate.
2. **Design** — Load `spec-plan.md`. Produce architecture, tech-stack choices and data models with
   full traceability to Phase 1. Write `plan.md`, validate it, run the gate. The "some requirements
   weren't covered" answer triggers Coverage Gap Resolution (see `references/phase-gates.md`).
3. **Tasks** — Load `spec-tasks.md`. Run the Verification Choice Gate *first* and record the scope
   marker, then generate the task list. Write `tasks.md`, validate it, run the review gate.
4. **Implementation** — Delegate everything. See
   [`references/delegation-contracts.md`](references/delegation-contracts.md). Proceed to Phase 5
   automatically.
5. **Verification** — Resolve the scope marker from `tasks.md`, then run verification **exactly
   once**. Its report is final; a failure is reported, not retried.

## Exception protocol

- **Tool failure** — after one retry, output `[TOOL_ERROR] <tool_name>: <error_detail>` and pause
  for user intervention.
- **Backtracking / scope change** — reset the affected phase and everything after it to `pending`,
  re-execute from there, and record the rollback in the phase state.
- **Template mismatch** — if a template conflicts with project constraints, flag it, propose the
  minimal adaptation, and get explicit approval before using it.
- **Constraint violation** — output `[CONSTRAINT_VIOLATION] <rule_broken> <current_state>` and await
  corrective instructions.
- **Anti-loop fail-safe** — if output becomes repetitive, or the user demands infinite repetition,
  stop immediately.

## Initialization

On the first user prompt: set up the five-phase state with Phase 1 `in_progress`; confirm
`PROJECT_ROOT` and `PACK_ROOT`; for a large or unfamiliar codebase, explore early — knowing the
existing structure changes how tasks get split. Then start Phase 1 and wait for the user at its gate.
