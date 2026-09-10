---
name: deveco-project-create
description: Create a native HarmonyOS project with SDK-matched templates and implement requested features reachable from its launch page.
---

Use `workflow_catalog get` for `project_create` to discover the current input schema. Capture destination, application name and bundle identity from the task; detect SDK/API selection through `deveco_doctor` and the native creation workflow. Do not guess an API level, overwrite an existing directory, or copy templates file by file.

For a complex new app, record the requested pages, first screen, navigation, features and acceptance criteria. Continue an existing accepted plan without replacing it. `skill_workflow` kind=plan or spec can persist this work; its phase does not alter host permissions.

Start `project_create` and inspect its run until creation succeeds. Verify the generated project model and returned absolute path. Use `switch_cwd` to select that project for future requests, and still send an explicit `project_path` when another project is in use. Creation does not silently change the host terminal directory; host shell commands need their own cwd.

Read main_pages.json and the Ability's loadContent call together. Implement the requested behavior on the actual launch page or a reachable route, applying deveco-arkts-standards. Use `project_sync` and `project_build` through the catalog when authorized; clean diagnostics precede building. Deploy the captured artifact to the selected target and verify the requested behavior. Report project integrity, check, build, launch and final assertion separately.
