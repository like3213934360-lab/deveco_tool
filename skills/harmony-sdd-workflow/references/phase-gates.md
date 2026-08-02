# Review gates, backtracking, and the verification-scope handshake

Companion to `../SKILL.md`. Everything here is from the DevEco Code `goal` agent prompt, with the
host-specific asking mechanism generalised.

## How a gate works

Upstream every gate is a dedicated ask-the-user tool that renders canonical options plus a free-form
"Other". Here, a gate is: **present the summary, offer the listed options verbatim, and wait.** Use
whatever the host provides — an interactive question tool, a numbered list in your reply, whatever
gets a real answer from a real person.

Every gate carries the same fallback: **if the host cannot ask the user, take the documented default
and continue.** A gate that cannot be presented must not become a deadlock. State in your reply
which default you took, so the user can correct it on the next turn.

## Phase 1 gate — after `spec.md`

Present a structured requirements summary: core goals, user stories, key constraints, scope
boundaries. Then offer:

- "Looks good, proceed to Phase 2"
- "I want to adjust some requirements"
- "Add more detail to specific areas"

Default if unaskable: proceed to Phase 2.

## Phase 2 gate — after `plan.md`

Present a structured design overview: architecture decisions, tech choices, key interfaces, data
model summary, trade-offs considered. Then offer:

- "Approved, proceed to Phase 3"
- "I'd like to discuss the architecture"
- "Some requirements weren't covered"

Actions:

| Answer | Action |
|---|---|
| Approved | Update state, proceed to Phase 3 |
| Discuss the architecture | Revise `plan.md` inside Phase 2, re-present, re-run this gate |
| Some requirements weren't covered | Run Coverage Gap Resolution below |
| Free-form "Other" | Backtracking rule |

Default if unaskable: proceed to Phase 3.

### Coverage Gap Resolution

Only for "some requirements weren't covered".

1. **Self-compare** `spec.md` against `plan.md`. Map every functional requirement and user story to
   where `plan.md` covers it (data models, interface contracts, technical context). Collect the
   items with no or insufficient coverage into a coverage-gap list.
2. **Present the gaps** as a multi-select. List **only requirements that already exist in
   `spec.md`**. Do not offer options that add a new requirement or change what an existing one
   means — such a request is backtracking, not gap resolution.
3. **Apply** — revise `plan.md` to cover the selected requirements, re-present, re-run the gate.

## Phase 3 gate 1 — Verification Choice, BEFORE generating tasks

This gate runs *before* `tasks.md` is generated, because it determines what the Verification phase
of that file contains.

- "Run verification (build-only)"

This pack ships a build-only `spec-verify`: `tasks-template.md` only emits the build-only
Verification phase, and the UI auto-verification tools are disabled at the MCP layer. So there is one
option, and it is also the default.

Upstream's second option — "Run verification + UI verification" — requires a multimodal UI
verification capability this pack does not provide. If your host has one, that branch exists upstream
and can be re-enabled; see the UI verification section of `PACK.md` for what would have to come back.

Whichever scope is chosen, **write the marker into the Verification section of `tasks.md`**:

```
<!-- verification_scope: build-only -->
```

The marker is the handshake between Phase 3 and Phase 5. Keep writing it even though there is
currently one possible value — Phase 5 reads it rather than assuming.

## Phase 3 gate 2 — after `tasks.md`

Present the full task list with priority labels and the total count, and highlight execution order
and dependencies. Then offer:

- "Start implementation"
- "Reorder or reprioritize tasks"
- "Add or remove tasks"

Actions:

| Answer | Action |
|---|---|
| Start implementation | Update state, proceed to Phase 4 |
| Reorder / reprioritize, Add / remove | Revise `tasks.md` inside Phase 3, re-present, re-run this gate |
| Free-form "Other" | Backtracking rule |

The two revision options **must stay inside the approved `spec.md` / `plan.md` scope** — re-split,
reorder or trim tasks that trace to existing requirements. Introducing a new requirement or changing
what an existing one means is backtracking.

Default if unaskable: proceed to Phase 4.

## Phases 4 and 5 have no gates

Phase 4 flows into Phase 5 automatically. Phase 5 does not ask the user anything: the verification
scope was decided in Phase 3 and is recorded in `tasks.md`.

## The backtracking rule

At a **Phase 2 or Phase 3** gate, if the user's answer — option or free-form — **introduces a new
requirement or modifies an existing one in `spec.md`**, do not iterate the current phase. Reset
Phase 1 and everything after it to `pending`, and re-execute from Phase 1: update `spec.md` first,
then regenerate `plan.md` and `tasks.md`.

Adjusting an artifact *within* the approved `spec.md` scope does not trigger this. The test is
whether `spec.md` itself has to change.

This rule is the reason the gates are worth having. Without it, a requirement introduced at the task
gate gets patched into `tasks.md` and the spec silently stops describing the thing being built.
