---
name: deveco-runtime-debug
description: Investigate HarmonyOS ArkTS crashes, runtime failures and UI regressions using scoped device logs, retained evidence, hypotheses and verified repairs.
---

Read `domain_recipe read` id=debug with the observed failure. The host keeps reproduction, expected behavior, known facts, hypotheses and the next discriminating observation in project notes. Use explicit project_path and app/device scope for native crash_diagnose, code_diagnose and verification. Only these native runs have run_id/revision; the MCP does not own a duplicate investigation lifecycle.

Select an explicit device and application. Use `hdc_log probe/fetch` or the `crash_diagnose` workflow for bounded fault evidence, and `harmony_knowledge` to read matching `arkts-runtime-fix` cases. Preserve stack/source/version/time associations. An empty log or absent process is not proof of a fix. Do not clear production logs merely to simplify the investigation.

For a UI reproduction, follow [the evidence workflow](references/debug-evidence.md). Separate the system-to-process delay, app initialization, data arrival and first frame before assigning a cause. Record unsupported SDK paths and inaccessible evidence explicitly.

One-off UI reproduction can observe and act directly. When reusing navigation helps, discover project-local paths with `ui_flow list/routes`. Read/validate a matching flow and reuse its ID for a new authorized reproduction. If the path will be reused and none fits, record the first authorized navigation with `record_start`, scoped `ui_control` actions and `record_stop` with a final assertion; wait for verification to confirm saving. Complete setup before ui_test start with fresh_start=false to preserve its app state. Keep navigation success separate from the regression's business assertion. Inspect an interrupted run before retrying, reconcile unknown effects, and keep active `ui_test` steps within its act/check protocol.

When the user's request authorizes a repair, implement the focused change through the host and perform the applicable static check and verification. Keep investigation progress in host-owned notes. Complete only after the observed failure has an applicable successful native workflow/test receipt and the host has compared that evidence to the original symptom. Retain evidence run IDs and a concrete rationale. If verification is prohibited or unavailable, report the pending evidence; do not invent a passing receipt or create a retired guidance lifecycle.
