# Implementation Plan: [FEATURE]

**Input**: Feature specification from `spec/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/spec-plan` command.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**State Management**: [Harmony/ArkTS: State Management V2 for greenfield (0-to-1) projects; retain the project's existing State Management V1/V2 for incremental work; otherwise N/A]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Project Structure

### Documentation (this feature)

```text
spec/[###-feature]/
├── plan.md              # This file (/spec-plan command output)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.

  HarmonyOS/ArkTS structure guidance:
  Existing projects must follow their current architecture and directory
  conventions unless the feature request explicitly asks to optimize or migrate
  to MVVM. New HarmonyOS/ArkTS structures should choose the lightest tier:
  Trivial, Light, or MVVM.

  MVVM is a responsibility boundary, not a request to create many files. Use the
  smallest file set that preserves page assembly, business UI, state/event
  orchestration, models, services/algorithms, and persistence boundaries.

  Standard HarmonyOS/ArkTS MVVM directory boundary:
  entry/src/main/ets/
  |-- entryability/
  |-- pages/       # Page entry, navigation, and assembly
  |-- views/       # Business UI views
  |-- components/  # Reusable generic UI components
  |-- viewmodel/   # UI state, events, and business orchestration
  |-- model/       # Domain types and data models
  |-- service/     # Domain services, algorithms, external wrappers
  |-- data/        # Persistence, preferences, storage access
  `-- common/      # Constants, utilities, shared definitions

  For HarmonyOS/ArkTS plans, resources belong under entry/src/main/resources/,
  not under entry/src/main/ets/. Structure Decision must state whether the plan
  follows an existing project architecture or selects a new tier. New-tier plans
  must name the tier and justify the planned file count.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above. For HarmonyOS/ArkTS plans, state that the plan
follows the existing project architecture, or name the selected new-project tier
and justify why the planned file count is sufficient.]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Research & Decisions

## Data Model

## Contracts & Interfaces
