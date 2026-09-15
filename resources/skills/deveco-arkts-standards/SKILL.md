---
name: deveco-arkts-standards
description: Write or modify HarmonyOS ArkTS .ets code, port TypeScript, and implement ArkUI components using the selected SDK rules and native checks.
---

Before the first relevant .ets edit, inspect the project's SDK and decorator family. Use `harmony_knowledge` catalog/search/read to load the applicable `arkts-grammar-standards` rules; read linked examples only for the constructs being changed. Each later edit should apply those rules and receive a check covering the changed files. Do not reread the entire collection mechanically.

Use concrete types and explicit cross-file exports/imports. Avoid TypeScript-only syntax; check SDK declarations for uncertain component APIs. In particular, custom component state named `height`, `width` or another universal attribute conflicts with ArkUI inheritance; use a domain name such as `availableHeight`. Keep V1 and V2 state contracts consistent with their consumers. Verify page registration and the Ability's loadContent route together.

Upstream resources include version-specific examples and occasional conflicting advice. Resolve conflicts against the selected SDK and actual diagnostics. For example, a suggestion to annotate a catch variable as any/unknown does not override ArkTS's catch syntax or typing restrictions.

For ordinary compilation, call `project_build` directly with the absolute `project_path`; its fresh full preflight checks the current sources and blocks compilation on errors. Read the failed run's diagnostic positions, report and candidate case references, repair the cause, then submit the current sources. Do not add a separate full check before every build. A deliberate manual override needs a concrete reason and retains the validation boundary.

For a focused investigation, use `arkts_check` with the relevant files, `code_lint` or an LSP query. Use `code_diagnose` to correlate multiple sources. A successful tool return alone is not a clean check: inspect `success` and `summary.errorCount`. Use `api_compatibility` for an SDK/API upgrade or an explicitly requested scan. Static checking does not prove build or device behavior.
