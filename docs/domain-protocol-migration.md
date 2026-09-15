# HarmonyOS domain MCP protocol migration

This document describes the candidate implementation in this workspace. It is not a claim that the installed 0.3 release has these interfaces, or that final device/platform validation has passed. The unchanged audit snapshot remains under `docs/audits/2026-09-12-upstream-parity/`.

## Responsibilities and tool mapping

The host retains reasoning, file editing, general planning, model/provider selection, sessions, agents and permissions. MCP owns typed HarmonyOS operations, fixed native workflows, stateful UI tests, reliable side-effect recovery and evidence. A recipe read creates no run and makes no completion claim.

| Previous entry | Primary entry | Migration behavior |
| --- | --- | --- |
| `skill_workflow catalog/start/write/transition/publish` | `domain_recipe catalog/read` | Guidance is on demand. New lifecycle mutations return `GUIDANCE_LIFECYCLE_RETIRED`; they cannot succeed from a nonempty document. |
| Existing `skill_workflow` runs | `skill_workflow list/read/export/archive` | Preserve encrypted SQLite documents, revisions, original objectives and evidence references. Export before optional archive/cleanup. Cancel transitions remain a compatibility path to archive. No automatic loss of existing state. |
| `plan` | `domain_recipe read id=plan` | Host-owned planning guidance, no persistent MCP planning task. |
| `customize` | `domain_recipe read id=customize` | Optional host connection guidance. Does not administer arbitrary models, providers, permissions, agents or plugins. |
| `spec` | `domain_recipe read id=spec`, `domain_acceptance assess` | Optional templates and requirement/story → task → assertion/review → evidence links. No new project-management state machine. |
| `arkts`, `repair`, `create`, `debug` guidance | `domain_recipe read` plus fixed native workflows | Methods and traceable Skill/knowledge references retained. The host edits; native workflows execute. |
| `ui_observe`, `ui_find`, `ui_inspect` | `ui_query` with `action=observe/find/inspect` and typed `query` | One dispatcher reuses the existing observation/query implementations. Cached legacy calls remain accepted during migration. |
| `ui_snapshot` | `ui_snapshot` or `ui_query action=snapshot` | Lightweight screenshot entry retained; tree/both capture available through the typed query. |
| `ui_tap` | `ui_control` | Legacy exact-selector tap remains a compatibility alias. Low-level typed actions remain available. |
| `verify_ui`, `ui_review`, `ui_test check` | Same entries | Share control assertions, image-artifact receipts and visual-review evidence. Native assertions and host visual assessment remain distinct. |
| `ui_flow` | Same entry | Routes, recording, save/validate/replay retained with the shared versioned action vocabulary. |
| `switch_cwd` | `project_context resolve` | Returns an immutable descriptor. Never changes a shared default; pass `project_path`, product and module targets on later project calls. |
| `deveco_restart` | `maintenance restart` | Keeps worker cancellation and recovery behavior. Legacy name remains callable. |
| `workflow_run capacity/cleanup_plan/cleanup_apply/export/storage_receipt` | Corresponding `maintenance` action | Uses the same quota, exact selection, digest, export and durable receipt mechanisms. Old calls remain compatible. |
| Cloud signing certificate/profile/device actions in `app_signature` | `signature_admin` | Optional connection group; daily local signing and validation remain in `app_signature`. |
| Instance/image/license administration in `emulator_manage` | `emulator_admin` | Optional connection group; `list/start/stop` remain in `emulator_manage`. |

The nine fixed native workflows are `project_create`, `project_sync`, `project_build`, `app_deploy`, `build_run`, `build_deploy_verify`, `code_diagnose`, `crash_diagnose` and `api_compatibility`. `build_run` performs ordinary build/deploy/startup checks; `build_deploy_verify` still requires its original UI assertion. Atomic diagnostics and direct UI control do not force an entire build/deploy chain.

## Connection groups and compatibility period

The server captures `DEVECO_TOOL_GROUPS` once when starting the connection. Allowed comma-separated groups are `core`, `signing-admin`, `emulator-admin`, and `compatibility`; `core` is always included and is the default. Device appearance, authentication and SDK detection do not change the advertised tools during a connection. Set the desired groups in the host's process environment and reconnect to change them.

Example: `DEVECO_TOOL_GROUPS=core,signing-admin,emulator-admin` advertises both optional administration groups. The `compatibility` group additionally advertises legacy names for older integrations. Legacy names remain callable without being advertised; management actions always require their administration group, including calls made using the old tool name. Groups express configured capability exposure and do not replace the host's authorization controls. MCP annotations are hints, never authorization boundaries.

Compatibility aliases are scoped to the 0.4 migration line. The next minor release must either remove them after publishing migration instructions and preserving read/export access, or record a specific unresolved compatibility requirement and a new removal version. They are not an indefinite fallback chain. Old state readability does not imply old evidence is fresh enough for a new acceptance claim.

## Typed calls and content reads

`workflow_run` exposes action-specific parameters and all nine workflow input contracts in `tools/list`. A known workflow can be started directly; `workflow_catalog get` remains the on-demand capability/completion reference. Unrelated fields are rejected: for example, `input` belongs to `start`, `resume_input` to `resume`, and `wait_ms` to `start/status/resume`. Missing workflow input or a run/artifact ID fails before execution. Result continuation pages require the first page's digest; image reads reject pagination. `maintenance` advertises storage operations; their old `workflow_run` action names remain callable during the same compatibility period.

The default `wait_ms` is 1000 (range 0–20000). Observation timeout or observer cancellation does not cancel the durable run. Default `detail:"summary"` bounds status/result previews and returns exact read calls. Integrations that parse the old full `result/error/scope` fields must request `detail:"full"`, or follow `read_result`; retained historical runs use these same read paths. Event `offset` is an event-ID cursor, while result/artifact offsets are bytes. Do not pass defaults for fields belonging to another action.

Build `sync` now defaults to `"auto"`; `true`/`false` retain `"force"`/`"skip"` meanings. Auto reuse requires verified installed dependencies, model, configuration, toolchain and retained sync evidence. `project_sync` remains an explicit synchronization/repair action. `app_deploy`, `build_run` and `build_deploy_verify` can reference a successful `build_run_id`; source and package identity are rechecked and conflicting fresh-build/package parameters are rejected.

`project_create` accepts a new or empty directory. Existing nonempty content requires explicit `merge:true`, with conflict checks and publication that never overwrites existing files. Omitted SDK selection uses installed/default configuration under the declared constraints; the returned descriptor supplies the selected SDK and next build input.

`ui_test start` initializes complete plans by default; `initialize:false` retains staged setup, and `fresh_start:false` preserves existing app state. `act check_after` performs bounded settling and the same step's check while preserving the action receipt. Follow `next` for checks, review and completion. Pending visual reviews can deliver their exact image and completion parameters inline; large/invalid images retain the artifact-read fallback. One-off tests can act directly; recording is useful when a path will be reused. See [UI workflows](native-ui-workflows.md).

UI start can now pass `deployment_run_id` with its original plan/steps and omit app, target and project selection. These values and omitted requirements are inherited from the captured deployment; freshness and any explicitly conflicting scope are checked before creating the test. Explicit UI requirements still bind this new test at start and never relabel its source deployment. Identical request-key retries return the captured test even if later inputs change; a new start must pass current identity checks.

For optional requirement assessment, pass `domain_acceptance assess` with the declared requirements/task mappings and `evidence_run_ids`. It resolves captured UI assertion/review/task IDs and digest-matching build/deployment references (at most two links). For a build/run requirement with exactly one declared task it can use that mapping; multiple tasks still need explicit `evidence`. Unbound or revised requirements are reported as excluded candidates. The assessment retains selected existing runs, reports bounded resolution issues, and independently validates every resolved reference before accepting it. Explicit evidence references remain supported.

`crash_diagnose.input.source_run_id` freezes retained deployment/UI-task logs and scope. Default historical analysis is offline. `collect_missing:true` explicitly permits a bounded faultlog supplement inside the original device-time window; missing clocks, expiry, truncation and unavailable devices remain evidence gaps. Other evidence inputs and scope overrides cannot be mixed with a source task. No failure operation is replayed.

`ui_query` uses an action-specific `query` object, not arbitrary `action:any` execution:

```json
{"action":"observe","query":{"target":"DEVICE","selectors":[{"id":"save","selector":{"text":"Save"}}]}}
```

Use `action=find` for a live `snapshot_id` or a saved `tree_file/tree_artifact_id`, with the existing mutually exclusive source contract. Offline trees do not verify live state. `action=inspect` exposes window/display filters, node paging and optional screenshot capture. `ui_control` still sends individually typed native touch, text, keyboard and mouse operations.

Tools, MCP Resources and Prompts use the same recipe/content backend:

| Content | Resource URI | Tool fallback |
| --- | --- | --- |
| Skill file | `deveco://skill/{name}/{file}` | `skill_manage catalog/read` |
| Rule/case/example | `deveco://knowledge/{id}` | `harmony_knowledge catalog/search/read` |
| Domain recipe | `deveco://recipe/{id}` | `domain_recipe catalog/read` |
| Reviewed source asset | `deveco://source/{id}` | `domain_content catalog/read` |

`domain_content catalog/read` is the shared tool fallback for all four content kinds. Resource listing is paginated. Prompts are named `harmonyos-{recipe-id}` and optionally accept the original objective, explicit project path and declared host capabilities. A declaration is capability negotiation, not a verified capability measurement. Missing capabilities return a concrete boundary and a host/human alternative; MCP does not embed an LLM/provider or general agent runner. Local indexed documentation remains searchable through `harmony_knowledge`; clients need not support Resources or Prompts.

Global server instructions contain only routing, scope and result semantics. ArkTS traps, implementation methods, UI review steps and maintenance details are loaded when relevant. Descriptions are not multiplied manually in source; the older audit measured a host-expanded shared instruction prefix. Character counts are not token counts, and no performance percentage is claimed.

## Evidence and result interpretation

Every tool declares an output envelope with `ok`, `request_id` and either `data` or a structured `error` containing `code`, `message`, `details` where applicable and `retryable`. Tool annotations conservatively describe a whole mixed-action tool. Read-only hints do not authorize mutations.

Native `workflow_run start` can capture requirement IDs, revisions and text. UI tests retain the original plan and requirement bindings, and their steps associate requirement/task IDs. `domain_acceptance` checks the current native source/configuration/toolchain/artifact identity and explicit task/evidence relationships. Coordination, command completion and business verification are separate. A captured image-read receipt proves which bytes were read, not that a visual assessment is objectively correct. The host remains responsible for translating all natural-language requirements into the chosen assertions/reviews.

Started native runs still retain run ID/revision, scope/leases, checkpoints, idempotency, cancellation, uncertain-side-effect reconciliation, quotas, evidence protection and export/recovery. No alias or recipe bypasses those mechanisms.

## Final verification checklist

The [2026-09-12 validation report](refactoring/2026-09-12-final-validation.md) records the earlier candidate's checks. It does not validate the subsequent workflow changes. The current implementation and scoped results are recorded in [the workflow optimization progress](refactoring/2026-09-15-workflow-optimization-progress.md), with remaining final SDK/device/platform checks in [the TODO](refactoring/2026-09-15-workflow-optimization-todo.md). A scoped test pass does not imply full release acceptance.
