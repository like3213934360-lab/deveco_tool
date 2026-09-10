---
name: deveco-runtime-debug
description: Investigate HarmonyOS ArkTS crashes, runtime failures and UI regressions using scoped device logs, retained evidence, hypotheses and verified repairs.
---

Start `skill_workflow` with kind=debug, the existing absolute project path and the observed failure. Write notes.md containing the reproduction, expected behavior, known facts, hypotheses and the next discriminating observation. Keep the returned run_id and expected_revision when updating. The MCP owns the investigation state and returns the next step's bundled instructions; no client Skill loader is involved.

Select an explicit device and application. Use `hdc_log probe/fetch` or the `crash_diagnose` workflow for bounded fault evidence, and `harmony_knowledge` to read matching `arkts-runtime-fix` cases. Preserve stack/source/version/time associations. An empty log or absent process is not proof of a fix. Do not clear production logs merely to simplify the investigation.

For a UI reproduction, follow [the evidence workflow](references/debug-evidence.md). Separate the system-to-process delay, app initialization, data arrival and first frame before assigning a cause. Record unsupported SDK paths and inaccessible evidence explicitly.

Move the builtin workflow to implementing when the user's request authorizes a repair, then verifying after the focused change and clean static check. Complete only after the observed failure has an applicable successful native workflow/test receipt and the host has compared that evidence to the original symptom. Include evidence_run_ids and a concrete rationale. If verification is prohibited or unavailable, preserve the investigation's pending state or cancel at the user's request; do not invent a passing receipt.
