---
name: harmony-build-loop
description: The edit → arkts_check → build_project → start_app loop for HarmonyOS/ArkTS projects, plus ArkTS hard rules, build-failure diagnosis categories, and device/emulator selection. Load this skill at the start of any session that edits, builds, or runs an ArkTS project. Triggers - build, compile, hvigor, build_project, start_app, arkts_check, run on device, 真机, emulator, simulator, DEVECO_HOME, build failed, 编译失败, 跑起来, 装到手机上.
---

# HarmonyOS Build & Run Loop

Extracted from the DevEco Code v0.1.5 `build` agent system prompt. This is the tool-orchestration
layer that the ArkTS knowledge skills sit underneath: `arkts-grammar-standards` tells you what to
write, `arkts-error-fixes` tells you how to fix a compile error, and this skill tells you in what
order to run things and when you are actually done.

## Tool guidelines

1. To launch the device/simulator or run the project on it, use `start_app` instead of the `hdc` shell command.
2. To execute compilation, build, and export build artifacts, use `build_project` instead of shell commands.
3. To run fast static checks on individual `.ets` files, use `arkts_check`. It catches ArkTS strict-mode violations without a full build. Use it after every file edit as a fast feedback loop.
4. MUST `build_project` successfully before `start_app`. Try `start_app` after `build_project` succeeds.
5. MUST `build_project` successfully before the task ends.
6. If `arkts_check` or `build_project` fail with ERROR, load skill `arkts-error-fixes` to fix the error. After fixing, re-run `arkts_check` first, then `build_project`.
7. Rules for `start_app`:
   - Check connected device/simulator or startable emulator first.
   - ALWAYS run apps on connected device/simulator if available.
   - ALWAYS use physical device (真机) directly if available.
   - ALWAYS use connected device/simulator first, then emulator not started.
   - Ask the user to choose the target device if multiple devices are available.
   - If `start_app` fails on a physical device (真机) due to unsigned/unconfigured signing: do NOT retry blindly. Tell the user to manually configure signing in DevEco Studio first.
8. When the user asks about ArkTS / ArkUI / OpenHarmony behavior, syntax, decorators, lifecycle, state refresh issues, build errors, `.ets` code, `@kit.*` / `@ohos.*` APIs, or provides OpenHarmony documentation URLs, call `arkts_knowledge_search` FIRST before answering from memory. For code snippets, extract a concise question with key symbols such as `@Builder`, `@ComponentV2`, `@State`, `@Local`, `aboutToAppear`, API names, error text, and the observed symptom.

### Examples

<example>
user: "Fix the compilation errors."
assistant: [Runs `build_project`, reads error output, fixes code (load skill `arkts-error-fixes`), runs `arkts_check` on fixed files, runs `build_project` again, project builds SUCCESS, `start_app`]
</example>

<example>
user: "Run the apps."
assistant: [Runs `build_project`, project builds SUCCESS, `start_app`]
</example>

<example>
user: "Modify the font size of title."
assistant: [modify the code, runs `arkts_check` on the modified file, fixes any violations, runs `build_project`, project builds SUCCESS, `start_app`]
</example>

## ArkTS rules

- Treat project as ArkTS, not generic TypeScript.
- NEVER use `any` or `unknown` unless user explicitly allows.
- NEVER use `as` type assertions.
- NEVER use structural typing; use explicit inheritance instead.
- NEVER use dynamic property access (e.g., `obj[dynamicKey]`).
- Object literals must have explicit type context (typed variable or typed function parameter).

Full rule dictionary: load skill `arkts-grammar-standards`.

## ArkTS project build failure diagnosis

- Focus on lines containing `ERROR`, ignore `WARN` lines unless relevant.
- Common error categories:
  - **Type errors**: ArkTS strict type checking failures. Fix by adding explicit types or removing unsafe casts.
  - **Import errors**: Missing module or wrong import path. Check `oh-package.json5` dependencies.
  - **Resource errors**: Missing or misnamed resources in `resources/` directory.
  - **Permission errors**: Undeclared permissions in `module.json5`.
  - **SDK version errors**: API level mismatch. Check `compileSdkVersion` in `build-profile.json5`.
- After fixing errors, run `build_project` again incrementally.
- If incremental build fails unexpectedly, suggest deleting `.hvigor` and `build` directories for a clean build.
- If `DEVECO_HOME` is missing, explain how to set it and continue with other safe work.

## Runtime failures

A clean build is not a working app. If the app builds but crashes, white-screens, or exits after a
tap, stop using this skill and load `arkts-runtime-fix` — it owns crash-anchor collection
(faultlogger / hilog) and the JS crash pattern library. For a reproducible-but-not-crashing
behavioural bug, load `harmony-debug-instrumentation` instead.

## Scope

This pack excludes the UI auto-verification chain. A successful `build_project` (plus `start_app`
where a device is available) is the completion bar — do not treat missing UI verification as an
unresolved issue, and do not claim visual or behavioural acceptance you have not performed.
