---
name: hmos-runtime-fix-skill
description: Load for ArkTS/JavaScript jscrash, runtime crash, uncaught exception, stack trace, faultlog, or hilog diagnosis. Also load when the app 闪退/崩溃/白屏, exits after 点击/启动/launch, or build succeeds but runtime fails (no compile error). Use before broad Read/Glob on crash-only tasks.
---

# Harmony JSCrash Fixes

Use this skill to diagnose and fix ArkTS or JavaScript runtime crashes with minimal edits.

> Adapted from DevEco Code's `hmos-runtime-fix-skill` (MIT). Device access and crash parsing go through the **deveco MCP tools** (`diagnose`, `device`, `run`, `ui`) instead of `devecocli` and private scripts.

## When To Load

Load this skill when the issue looks like one of these:

- Runtime logs show `TypeError`, `ReferenceError`, `RangeError`, `SyntaxError`, `BusinessError`, or similar exceptions.
- The app exits, flashes back, or white-screens during launch or after a tap (`run` reports `smoke: FAIL_CRASH` or `FAIL_BLANK`).
- The user provides a `jscrash` log, stack trace, or a log file.
- Build succeeds, but runtime behavior fails immediately.

## Core Approach

Prefer a concrete crash anchor before broad code exploration. A good anchor can come from:

- a provided crash log
- a stack trace
- a clear page or module named by the user
- a recent device-side faultlog or hilog when no better evidence is available

Avoid broad `Read` / `Glob` / `Explore` across the whole project until you have at least one concrete anchor: error type, error message, suspected file, top app stack frame, or a clearly named crash entry point from the user.

Do not over-collect logs. If the user already gave enough crash evidence, parse that evidence first and move into focused reading and minimal fixes.

## Getting Evidence (deveco MCP)

### Case A: The user provided crash text or a log file

Read the file if needed, then:

```text
diagnose action=crash log="<crash text>"
```

### Case B: Only symptoms, no logs

1. Read `AppScope/app.json5` and take the exact `app.bundleName`. Do not guess it from `vendor`, module folder names or prefixes.
2. Resolve the device with `device action=list`:
   - exactly one device → use it;
   - several devices → ask the user which one (`target`);
   - none → report that device evidence cannot be collected and ask for a device or a local crash log.
3. Reproduce (ask the user, or use `run action=build_run` and `ui act`), then fetch the latest matching crash:

```text
diagnose action=crash target=<serial> bundle=<bundleName> since_minutes=10
```

4. If there is no crash report (e.g. a white screen or a caught exception), fall back to hilog:

```text
device action=log target=<serial> bundle=<bundleName> level=E lines=400
```

`diagnose` returns `type`, `kind` (error name), `message`, `code`, app `frames`, `candidates` (matched patterns from this skill's references) and `guidance`. It works on emulators and production phones.

If no matching crash is returned, ask the user to reproduce and retry immediately; do not guess from symptoms alone.

## JSCrash Fix Knowledge Base

Knowledge source (synced): [hmos-jscrash-analysis](https://gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills/tree/main/03-solutions/quality/stability/hmos-jscrash-analysis). The same tables drive `diagnose` pattern matching.

After obtaining the error type, match patterns from the knowledge base and apply the corresponding fix. Do not invent root causes or fixes outside these references.

1. Start from `candidates` returned by `diagnose`.
2. Read [references/fault-mode-library.md](./references/fault-mode-library.md) to confirm: match `JSError` → secondary cause → tertiary cause using `Reason` / `Error name` / `Error message`.
3. Based on the error type, read only the corresponding patterns file:
   - `ReferenceError` → [references/referenceerror_patterns.md](./references/referenceerror_patterns.md)
   - `TypeError` → [references/typeerror_patterns.md](./references/typeerror_patterns.md)
   - `Error` → [references/error_patterns.md](./references/error_patterns.md)
   - `BusinessError` → [references/businesserror_patterns.md](./references/businesserror_patterns.md)
   - `SyntaxError` → [references/syntaxerror_patterns.md](./references/syntaxerror_patterns.md)
   - `RangeError` → [references/rangeerror_patterns.md](./references/rangeerror_patterns.md)
   - `OutOfMemoryError` → [references/outofmemoryerror_patterns.md](./references/outofmemoryerror_patterns.md)
   - `URIError` → [references/urierror_patterns.md](./references/urierror_patterns.md)
4. When multiple patterns match, prefer the one supported by error message + error code + top application stack frame simultaneously (see credibility rules in each reference file).
5. Apply a minimal fix to the suspected file from the stack. Do not refactor broadly.

### Quick Reference

| Error type / message keyword | Root cause | Reference |
|---|---|---|
| ReferenceError + `@Provide` / `@Consume` | Missing or duplicate @Provide/@Consume | [referenceerror_patterns.md](./references/referenceerror_patterns.md) |
| ReferenceError + `is not initialized` | Variable used before assignment | [referenceerror_patterns.md](./references/referenceerror_patterns.md) |
| ReferenceError + `<name> is not defined` | Variable scope or import missing | [fault-mode-library.md](./references/fault-mode-library.md) |
| ReferenceError + `super()` before `this` | super() not called before this | [fault-mode-library.md](./references/fault-mode-library.md) |
| TypeError + `Cannot read property` / `null or undefined` | Accessing property on undefined/null | [typeerror_patterns.md](./references/typeerror_patterns.md) |
| TypeError + `is not callable` | Calling a non-function value | [typeerror_patterns.md](./references/typeerror_patterns.md) |
| TypeError + `circular structure` | Circular reference in JSON.stringify | [typeerror_patterns.md](./references/typeerror_patterns.md) |
| TypeError + `Receiver is not a JSObject` / N-API scope | N-API receiver type mismatch | [typeerror_patterns.md](./references/typeerror_patterns.md) |
| SyntaxError + `Unexpected Text in JSON` / `Invalid Token` | Malformed JSON.parse input | [syntaxerror_patterns.md](./references/syntaxerror_patterns.md) |
| RangeError + `Invalid array length` | Negative or non-integer array length | [rangeerror_patterns.md](./references/rangeerror_patterns.md) |
| RangeError + `Stack overflow` | Unbounded recursion | [rangeerror_patterns.md](./references/rangeerror_patterns.md) |
| URIError + `DecodeURI: invalid character` | Malformed URI in decodeURI | [urierror_patterns.md](./references/urierror_patterns.md) |
| Error + `UI execution context not found` / `100001` | UI context not bound to router | [error_patterns.md](./references/error_patterns.md) |
| Error + `WebviewController must be associated` / `17100001` | WebviewController not linked to Web component | [error_patterns.md](./references/error_patterns.md) |
| Error + `ForEach id` / id generator | ForEach keyGenerator missing or invalid | [error_patterns.md](./references/error_patterns.md) |
| Error + `ArrayBuffer is null or detached` | Using detached ArrayBuffer | [fault-mode-library.md](./references/fault-mode-library.md) |
| Error + `Map's constructor cannot be directly invoked` | ArkTS Map constructor misuse | [fault-mode-library.md](./references/fault-mode-library.md) |
| Error + SQLite / RDB / resource ID / window state | DB handle, resource ID, or window API misuse | [error_patterns.md](./references/error_patterns.md) |
| BusinessError + `Parameter error` / URL / JSON / XML | Invalid API parameter type or value | [businesserror_patterns.md](./references/businesserror_patterns.md) |
| OutOfMemoryError + allocate / leak | Heap allocation failure or memory leak | [outofmemoryerror_patterns.md](./references/outofmemoryerror_patterns.md) |
| TerminationError + `Terminate execution!` | Forced termination by runtime | [fault-mode-library.md](./references/fault-mode-library.md) |
| AggregateError + `Promise.any()` all rejected | All promises in Promise.any() rejected | [fault-mode-library.md](./references/fault-mode-library.md) |

## Interpretation Rules

- Prefer application frames over framework noise.
- Treat the first concrete `.ets`, `.ts`, or `.js` path as the starting point, not the final truth.
- If the user gave repro steps, trust them over a simplistic stack-only guess.
- If the stack points to a non-entry page, assume an interaction-triggered path unless evidence proves a cold-start crash.
- Do not refactor broadly. Fix the crash path first.

## Verify The Fix

1. `code action=check` on the changed files, then `run action=build_run` (expect `smoke: PASS`).
2. Repeat the repro steps with `ui act`, and confirm with `ui assert` (or a `ui test_start` session for multi-step repros).
3. `diagnose action=crash bundle=<bundleName> since_minutes=5` must return no new report.

## Conversational Shape

1. Say what evidence you already have.
2. If logs are missing, say whether you are using a crash log or hilog to get a better anchor.
3. Once you have an anchor, switch into focused code reading and minimal fixing.

## Constraints

- Never claim a crash fix from prompt reasoning alone; verify on a device.
- Never replace a root-cause fix with retries, arbitrary delays, or broad defensive rewrites.
- If unfamiliar `@ohos.*` or `@kit.*` APIs are involved, check their constraints (`knowledge action=search`, `code action=lsp op=hover`) before editing.
