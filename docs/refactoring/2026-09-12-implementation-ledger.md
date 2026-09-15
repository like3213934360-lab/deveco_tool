# Universal HarmonyOS domain MCP implementation ledger

This is a new implementation record. The audit directory and original handoff prompt remain unchanged. All pre-existing release/acceptance reports are historical evidence, not verification of this worktree.

## Baseline and ownership

- Original workspace: main / d2d3efdc5577dfcbe36a591f0eee6675e6e252f9 / package 0.2.0.
- Preserved untracked inputs: docs/audits/ and docs/refactoring/2026-09-12-universal-mcp-prompt.md.
- Installed audit baseline: 0.3.0 / native-7 at the recorded installation path. Installation package remains present; no installation is modified by this task.
- 713734c8eaf40d52013ff88982306aef0d0c563f is the sole parent of archive 6ad95551a0edac9fb8f4a5a7fbe7d45d342a6519. Its tree is identical to merge 39e3c5664557071231650aca7dce9adbfc1c6d29.
- Archive delta: 206 files, 20,611 additions, 1,187 removals. Archive includes candidate 0.4.0 implementation, never accepted here as tested output.
- Working branch: codex/universal-domain-mcp, created in this directory at 6ad9555 without reset or overwrite of untracked user files.
- Root owns runtime, worker, workflow engine, store/schema, project context, legacy guidance migration, UI test evidence and acceptance receipts.
- Protocol agent owns contracts/catalog/server and new stateless recipe protocol. Native agent owns LSP/UI-action/recording/log/startup/hot services. Upstream agent owns knowledge/content/source discovery and provenance.

## Product and migration decisions

Native MCP owns deterministic SDK/device execution and recoverable evidence. The host owns reasoning, editing, plans, models, sessions, agents and permissions.

The 8 fixed native workflows remain. Old guidance runs retain encrypted payloads, original objective, documents, revisions and evidence dependencies. They can be read/exported/archived; new guidance start/write/publish/forward transitions return GUIDANCE_LIFECYCLE_RETIRED. Archiving records cancellation rather than inventing successful acceptance. Existing SQLite tables and native-7 storage protocol remain readable. No production state is opened by validation.

ProjectService no longer stores a selected/default project. project_context resolves an explicit absolute path/product/module selection into a descriptor; the switch_cwd alias returns a migration descriptor and cannot influence later calls. Configuration default_project is tolerated only as an old configuration field and does not restore shared mutable scope.

New native runs capture fixed definition and runtime digests. Resuming changed runtime bytes is blocked before effects; reconcile using the original installation and export. Legacy native runs without that binding retain recovery compatibility but cannot satisfy new requirement-bound acceptance unless evidence actually captured those requirements.

Domain acceptance is an immutable assessment receipt, not a project/plan state machine. Requirements, immutable original text, revision history, task references and explicit build-only/run/ui/host-review modes are host supplied. Native evidence must have captured the same requirement text/revision when started. Assessment checks current input and build/deployment/patch artifact identities and protects referenced runs. Project-scoped UI acceptance requires deployment_run_id captured before the UI test and rechecked at completion. The linked native deployment receipt proves the package dispatched by MCP; external installation changes are not independently attested. UI status reports historical capture verification separately from current freshness. A structured contract result does not prove complete natural-language translation or objectively correct visual judgment.

## Implementation status / final acceptance status

Implementation and final verification are separate columns. Implementation and shared integration finished before test changes and execution began. The frozen candidate4 is now in final verification. Current evidence and exact source/runtime/build/resource hashes are indexed in [final validation](2026-09-12-final-validation.md) and its [machine-readable receipt index](2026-09-12-final-validation.json). Implementation locations, scoped results and remaining conditions are detailed in [the G01–G13 and A–D review](2026-09-12-g01-g13-review.md).

| Item | Implementation | Current final verification and remaining scope |
| --- | --- | --- |
| G01 identities | Baseline genealogy and independent source/runtime/build/resource/lock identities recorded | Candidate4 matches Node22/24 regressions and real SDK/device reports; the same sealed ZIP passes both isolated clean installs. No production replacement or release. |
| G02 coverage | Native/host/boundary implementation, evidence and environment dispositions separated | Current receipts satisfy all 50 listed operation scopes: 28 native, 20 host contracts and 2 intentional boundaries, indexed separately from the formal pending matrix. Neither missing native evidence nor unsupported environments are counted as executed. |
| G03 discovery | Fixed-commit AST/source-content discovery, transitive references, source digests and unknown-change gates implemented | Discovery/mutation regressions pass. Formal source-baseline acceptance remains open; static CLI contracts do not prove full runtime parity. |
| G04 completion | Stateless guidance and immutable requirement/task/evidence assessment; native and prose judgments separate | Real SDK build-only assessment and negative requirement cases pass. The real project deployment/UI/host-review chain passes 43 observations. |
| G05 freshness | Native completion seal, source/config/toolchain and artifact fingerprints, captured UI requirements and scope | Current regression and SDK stale-input cases pass; final project UI chain includes actual image inspection and stale-source/revised-requirement rejection. Cheap status explicitly reports historical verification. |
| G06 host boundary | Optional host connection recipe and explicit capability declaration | Public MCP recipe/resource/prompt parity, missing host capability and fixed optional groups pass. Host declarations are not measured host capabilities. |
| G07 resources | Stable knowledge references, original/adapted Skill assets and explicit missing-source explanation | Full resource integrity/reference graph passes: 79 knowledge entries, 14,683 indexed documents, 50 repaired links and one documented missing upstream source. |
| G08 source assets | Skills, SDD, agents, commands and development/test boundaries tracked independently | Current source-manifest review and discovery regressions pass. Source methods are not transplanted into an MCP agent runner. |
| G09 LSP | Archived native operations reused; actual language/SDK/operation support exposed | Real Studio ArkTS and Studio/CLT clangd checks pass within scope. CLT ArkTS is missing; clangd outgoingCalls returns genuine -32601 and remains unsupported. |
| G10 UI actions | Shared v2 contract, bounded v1 migration and explicit direct/recordable support | Real privacy recording, restart/replay, mouse/drag/fling and final assertion checks pass. Physical/multi-display combinations remain unavailable. |
| G11 logs | Bounded continuous capture, gaps, truncation, lifecycle and privacy strengthened | Real app restart, owned-emulator reboot/reconnect, MCP restart, preserved log prefixes, cancellation and export hashes pass. Missing windows remain explicit gaps. |
| G12 effects | Startup, hot apply and emulator observation strengthened | Current startup fault matrix, two HQFs without observed PID change, cold fallback, light/battery app observations and negative assertions pass. Other sensors/cloud/physical targets retain their actual limits. |
| G13 exceptions | No added exceptions; 48 acceptance entries, 19 performance capabilities and 60+6 minute soak remain required | Node22/24 each pass 581 regressions; actual SDK/device/upgrade/install reports are selected by candidate4 identity. The prior performance run failed on baseline ArkTS sample 714; an instrumented fresh run is running serially after soak cleanup. The full 60+6 minute mixed soak retry passed under the root operator only: 477 LSP/UI cycles, 40 verified patches, all retained-resource counts zero and owned emulator cleaned. All 48 rows distinguish scoped pass, partial and unavailable evidence. Full release gates remain open. |

## Verification phase rule

Tests and test changes start only after implementation and shared integration finish. Use isolated state, projects and task-owned applications. No release, push, install replacement or broad cloud writes are authorized here. Missing external platforms/devices/accounts remain explicit unaccepted conditions; they do not become verified or exclusions.
