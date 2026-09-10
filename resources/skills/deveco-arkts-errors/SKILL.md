---
name: deveco-arkts-errors
description: Diagnose and repair ArkTS compiler, linter, import/export, component attribute and type errors using native diagnostics and corresponding error cases.
---

Capture the actual diagnostic, selected project/module and source location. Use `harmony_knowledge search` for its rule or error text, then read the matching `arkts-error-fixes` entries and relevant examples. Treat examples as guidance for the selected SDK, not automatic patches. Read the affected declaration and its consumers before changing a shared type.

Fix the cause with a focused patch. Do not suppress an error using arbitrary casts, fabricated APIs or broad fallback logic. Check cross-file export/import pairs and custom component names that conflict with universal attributes.

Run `arkts_check` on the changed files and dependent scope. When `success=false` or `summary.errorCount>0`, continue repair and recheck; do not start the same failing build. Once clean, use `workflow_catalog` to select `project_build` when building is within scope, then inspect the terminal result and retained artifacts. Record static-check and build results separately. A file change invalidates earlier evidence for that source.
