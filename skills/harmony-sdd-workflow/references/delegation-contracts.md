# Phase 4 and Phase 5 delegation contracts

Companion to `../SKILL.md`. From the DevEco Code `goal` agent prompt, with the subagent registry
generalised and the permission-based enforcement restated as explicit instructions.

## Why these are contracts and not just "run the command"

Upstream ran Phases 4 and 5 as two dedicated subagents whose boundaries were enforced *mechanically*
by a permission table: the implementation subagent was denied the build and launch tools outright,
and both subagents were denied their own task list and the ability to spawn further subagents. That
table is host-specific and cannot be reproduced by a capability pack, so the same boundaries are
written here as instructions. They are load-bearing — the phase split only means something if
implementation genuinely cannot build and verification genuinely runs once.

## Two ways to run a phase

**If the host can delegate to a subagent** — spawn one, and give it the prompt contract below.
**If it cannot** — execute `{PACK_ROOT}/commands/spec-implement.md` (Phase 4) or
`{PACK_ROOT}/commands/spec-verify.md` (Phase 5) directly, honouring the same constraints. The
contract is what matters; the delegation mechanism is not.

Either way, the constraints listed under each phase apply.

## Phase 4 — Implementation

**Zero implementation rule.** As the orchestrator you perform no implementation work: no creating
project directories, no scaffolding, no writing code, no creating files in `src/`, no build
commands. Hand the whole task list over.

The prompt must include all five:

1. `Confirmed_Feature_Dir` — the absolute feature directory, `{PROJECT_ROOT}/spec/{feature_name}/`.
2. **Tasks summary** — the complete list from `tasks.md`: task IDs, descriptions, target file paths,
   dependencies, execution flags.
3. **Plan summary** — tech stack, architecture decisions, module breakdown from `plan.md`.
4. **Feature summary** — what the feature does, core user stories, key functional points from
   Phases 1-3.
5. **Execution constraints** — proceed autonomously with no intermediate prompts; execute only
   implementation tasks and **exclude the Verification phase**; return an implementation report.

Constraints on whoever executes it:

- **Must not build or deploy.** Building and launching belong to Phase 5. Upstream enforced this by
  denying `build_project` and `start_app`; here it is a rule. `{PACK_ROOT}/commands/spec-implement.md`
  carries the equivalent clause.
- **Must not spawn further subagents, and must not start its own task list.** One level of
  delegation, one owner of phase state.
- **Mark tasks `[X]` in `tasks.md` as each phase completes**, with an edit, immediately — not
  batched at the end. A crash mid-run should leave an accurate file behind.
- Re-read `spec.md` / `plan.md` / `tasks.md` from disk even though summaries were passed in.

Expected report: phase-by-phase results, files created and modified, deviations, blocked items, and
a final status of `COMPLETED` / `PARTIAL` / `FAILED`.

**No failure branch.** Phase 4 has no error gate — Phase 5 runs regardless, and verification is what
establishes the real state.

## Phase 5 — Verification

**Resolve scope first.** Read the Verification section of `tasks.md` in `Confirmed_Feature_Dir`:

- Marker `<!-- verification_scope: build+ui -->`, **or** any task referencing UI verification →
  scope is `build+ui`.
- Otherwise — including `<!-- verification_scope: build-only -->` or no UI task at all → scope is
  `build-only`.

This pack ships build-only. `build+ui` requires a UI verification capability that is not provided
here; if the marker somehow says `build+ui`, report that the scope cannot be honoured and run
build-only rather than silently downgrading.

Do not ask the user about scope. It was decided at the Phase 3 gate.

The prompt must include:

1. `Confirmed_Feature_Dir` — absolute path.
2. **Feature summary** — enough context to make good decisions during fix cycles.
3. **Implementation summary** — files created and modified in Phase 4, key changes.
4. **Verification scope** — resolved above.
5. **UI test cases** — only when scope is `build+ui`. One per user story, formatted
   `User Story <number>: <action> expected: <UI result>`, covering core page rendering and key
   interaction flows.

Retry budgets:

- **`build_project`: at most 10 calls** during the initial build-fix loop (1 build + up to 9
  rebuilds). Per-story fix builds are exempt from this cap.
- **Per user story: at most 3 verification attempts** (1 initial + 2 fix-then-reverify cycles),
  when scope is `build+ui`.
- After the per-story loop, a final no-fix pass re-verifies every story once. **Skip that pass
  entirely if no code was modified during the loop** — then the first-pass results stand.

**Invoked exactly once.** The returned report is final and authoritative.

- Status `PASS` → mark the workflow completed.
- Status `FAIL` or `INCOMPLETE` → report the failures to the user and mark the workflow completed
  **with noted failures**.

**Do not re-run verification after a failure.** A failing report is the outcome, not a retry
trigger. Re-running is how an agent talks itself into a pass.

Either way, mark the Verification tasks in `tasks.md` as `[X]` with an edit once the report is in.
