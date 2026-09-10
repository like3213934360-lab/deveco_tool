---
name: deveco-arkts-standards
description: Write or modify HarmonyOS ArkTS .ets code, port TypeScript, and implement ArkUI components using the selected SDK rules and native checks.
---

Before the first relevant .ets edit, inspect the project's SDK and decorator family. Use `harmony_knowledge` catalog/search/read to load the applicable `arkts-grammar-standards` rules; read linked examples only for the constructs being changed. Each later edit should apply those rules and receive a check covering the changed files. Do not reread the entire collection mechanically.

Use concrete types and explicit cross-file exports/imports. Avoid TypeScript-only syntax; check SDK declarations for uncertain component APIs. In particular, custom component state named `height`, `width` or another universal attribute conflicts with ArkUI inheritance; use a domain name such as `availableHeight`. Keep V1 and V2 state contracts consistent with their consumers. Verify page registration and the Ability's loadContent route together.

Upstream resources include version-specific examples and occasional conflicting advice. Resolve conflicts against the selected SDK and actual diagnostics. For example, a suggestion to annotate a catch variable as any/unknown does not override ArkTS's catch syntax or typing restrictions.

Run `arkts_check` with the absolute `project_path` and an appropriate `files` set; inspect `success` and `summary.errorCount`. Repair blocking diagnostics and recheck before building. A successful tool return alone is not a clean check. Default `project_build` performs its own fresh full preflight; a deliberate manual override needs a concrete reason and retains the validation boundary. Static checking does not prove build or device behavior.
