---
name: deveco-arkts-errors
description: Diagnose and repair ArkTS compiler, linter, import/export, component attribute and type errors using native diagnostics and corresponding error cases.
---

Use the original failed build's diagnostic, project/module, source location and report. Follow its candidate case `read` references first; use `harmony_knowledge search` for the rule or error text when more context is needed. Treat examples as guidance for the selected SDK, not automatic patches or a verified root cause. Read the affected declaration and its consumers before changing a shared type.

Fix the cause with a focused patch. Do not suppress an error using arbitrary casts, fabricated APIs or broad fallback logic. Check cross-file export/import pairs and custom component names that conflict with universal attributes.

When building is within scope, submit the repaired sources directly to `project_build`; its fresh full preflight replaces an extra complete check. For focused investigation without a build, use `arkts_check`, `code_lint` or LSP for the affected scope. Use `code_diagnose` when several sources need correlation. When `success=false` or `summary.errorCount>0`, continue repair; don't resubmit unchanged failing sources. Record static-check and build results separately. A file change invalidates earlier evidence for that source.
