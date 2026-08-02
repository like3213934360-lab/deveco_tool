---
name: harmony-debug-instrumentation
description: Evidence-driven debugging loop for reproducible ArkTS behavioural bugs - hypothesis generation, ArkTS-safe log instrumentation with a greppable [DEBUG][H<id>] marker, hdc_log collection, pre-fix/post-fix comparison, and a mandatory instrumentation cleanup gate. Load this skill when a HarmonyOS app builds and runs but behaves wrong, when state does not refresh, when a page renders incorrectly, or when the user asks to debug/排查/定位 an issue that reproduces on device. Triggers - debug, 调试, 排查, 定位问题, 不刷新, 状态不更新, 点了没反应, 打日志, hilog, hdc_log, instrumentation, console.log.
---

# HarmonyOS Debug Instrumentation Loop

Extracted from the DevEco Code v0.1.5 `debug` agent system prompt. Use it for bugs that **reproduce
on device but do not crash**. For a hard crash (jscrash, 闪退, white screen) load `arkts-runtime-fix`
instead — it starts from a faultlog/stack anchor rather than from instrumentation.

Never claim a fix without runtime log evidence.

## Workflow

1. Generate 3-5 hypotheses before changing logic.
2. Insert 3-8 ArkTS-safe logs to verify hypotheses; each log must map to at least one hypothesis.
3. Run `build_project` until the build is clean.
4. Run `start_app` to launch the device/emulator and run the project.
5. Clear logs with `hdc_log(action="clear")`.
6. Ask the user to reproduce, then collect logs with `hdc_log(action="collect", log_prefix="[DEBUG]")`. Always pass `log_prefix="[DEBUG]"` explicitly; the tool's default prefix does NOT match the log format template below.
7. Confirm/reject each hypothesis using log evidence, citing the actual log lines.
8. Only apply fixes proven by runtime evidence.
9. Re-run `build_project` + `start_app`, clear logs, then ask the user to verify the exact scenario again and wait for their answer.
10. After the user replies, collect post-fix logs with `hdc_log(action="collect", log_prefix="[DEBUG]")`. Use `runId=post-fix` in the logs to compare against pre-fix data.
11. If the user says the bug still happens, keep debugging: collect logs, confirm/reject hypotheses, and generate new hypotheses if needed.
12. If all hypotheses are rejected, generate new hypotheses from different subsystems and add more instrumentation. Do not give up.
13. **Cleanup gate (MANDATORY once the user confirms the fix and post-fix logs prove success)**: remove EVERY instrumentation log you inserted. Run `grep` with pattern `\[DEBUG\]\[H` across the project, delete each matching line, then run the same `grep` again and confirm ZERO matches remain. If any match remains, keep cleaning; do not exit.
14. After cleanup, re-run `build_project` and confirm the build is clean. Only then produce the final summary. The summary must state the cleanup result (grep zero matches) and the post-cleanup build status.

## Log instrumentation rules

- Do not put logs directly in the `build()` UI declaration body or in `@Builder` functions.
- Do not use anonymous object literals (triggers `arkts-no-untyped-obj-literals`).
- Safe insertion points: `aboutToAppear`, `aboutToDisappear`, `onPageShow`, `onPageHide`, event handlers, `.onAppear(() => { ... })` modifiers, and custom methods not decorated with `@Builder`.
- Every instrumentation log MUST follow the log format template below exactly, so the `[DEBUG][H` marker is greppable during the cleanup gate. Never invent a different prefix.
- Each log must be exactly ONE standalone `console.log(...)` statement on its own line, never combined with other code on the same line, so cleanup can remove it by deleting that single line.
- Mark each hypothesis as confirmed / rejected / inconclusive with cited log lines.

Log format template:

```ts
console.log(`[DEBUG][H<id>] location=<filePath> | message=<desc> | data=${<var>} | ts=${Date.now()} | runId=<pre-fix|post-fix>`);
```

## Interactive debugging

- A normal text response asking the user to do something does not pause execution. When you need the user to reproduce a scenario or confirm a result, ask explicitly and stop — do not continue as if they had answered.
- If the debug request is empty, generic, or missing the concrete symptom, ask for the minimum details needed first: error message, crash/blank screen, abnormal UI behavior, expected behavior, actual behavior, and reproduction steps.
- After you build and start the app for either pre-fix reproduction or post-fix verification, ask the user to perform the exact manual action and wait for their answer.
- Do not collect post-fix logs, remove instrumentation, or claim verification until the user confirms they have attempted the exact scenario you asked about.
- Finish only when one of these is true:
  1. The user confirms the issue is fixed, runtime/build/log evidence supports the conclusion, AND the cleanup gate has passed (`grep` for `\[DEBUG\]\[H` returns zero matches and the post-cleanup `build_project` is clean).
  2. You are clearly blocked by missing user-provided information, unavailable tools, or an unreproducible scenario; summarize the blocker and the precise next action needed.
- If the user cannot reproduce yet, summarize the current debug state, the instrumentation already added, and the exact next action. Mark the result as pending reproduction instead of claiming a fix.
- Final responses must summarize: issue location, evidence, changes made, verification status, instrumentation cleanup status, and remaining next steps.
- Instrumentation cleanup status must be one of: (a) cleaned — cite the zero-match `grep` result and post-cleanup build success; or (b) intentionally left in place for a blocked / pending-reproduction exit — list EVERY remaining instrumentation location as `file:line` so it can be removed later.

## Constraints

- Never claim a fix without runtime log evidence.
- Treat source as ArkTS, not generic TypeScript.
- If API behavior is uncertain, confirm with `arkts_knowledge_search` first.
- FORBIDDEN: using `setTimeout`, sleep, or artificial delays as a "fix"; use proper reactivity / events / lifecycles.
- FORBIDDEN: removing instrumentation before post-fix verification logs prove success and the user confirms.
- FORBIDDEN: finishing after a confirmed fix while ANY inserted instrumentation log remains in source. The cleanup gate (zero `grep` matches for `\[DEBUG\]\[H` + clean post-cleanup build) is mandatory, not optional.
- Instrumentation may remain in source ONLY for a blocked or pending-reproduction exit, and every remaining location must be listed as `file:line` in the final summary.
- Use `hdc_log` rather than raw `hdc` shell commands for log collection.
