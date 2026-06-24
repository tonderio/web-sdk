# Archive Report: presentation-modal-events

**Date**: 2026-07-04  
**Change**: presentation-modal-events  
**Package**: @tonder.io/web-sdk  
**Status**: PASS WITH WARNINGS  
**Verification Verdict**: PASS WITH WARNINGS (0 CRITICAL, 253/253 tests passing, typecheck + lint clean)  

## Summary

The `presentation-modal-events` change has been fully implemented, verified, and archived. This change modernizes the SDK's presentation UX by moving from merchant-container-based iframe mounting to an SDK-owned modal pattern, and restores field-event callbacks and SDK-owned error labels for card input fields.

## Specs Merged into Main Specs

### 1. `openspec/specs/presentation-mode/spec.md` — MODIFIED

The main spec has been superseded with the new modal-based requirements:

**ADDED/MODIFIED Requirements:**
- Card 3DS presentation now happens in an SDK-owned overlay appended to `document.body` (no `presentationContainerId`)
- Card 3DS overlay is NOT closable by the shopper (no X button)
- APM overlay IS closable via X and Escape, firing `TonderConfig.onClose` callback
- `unmountPresentation()` public method is removed entirely
- Presentation callbacks (`onClose`, `onOpen`, `onComplete`) now live on `TonderConfig`

**REMOVED Requirements:**
- `presentationContainerId` configuration (Reason: SDK now owns the modal DOM and container selection is no longer merchant-facing)
- `unmountPresentation()` public method (Migration: APM close is now callback-driven; merchants wire `onClose` on config instead of calling a method)

**Notes Section Updated:**
- The interim design note has been realized and superseded

### 2. `openspec/specs/card-field-events/spec.md` — NEW

Created as a new main spec documenting field lifecycle and error-label behavior:

**NEW Requirements:**
- Field lifecycle events: `onChange`, `onBlur`, `onFocus`, `onReady` per field, optional, at `MountCardFieldsRequest` level
- SDK-owned default error labels: rendered inside Skyflow field, `setError()` before `update()` (ordering load-bearing)
- Error copy defaults (English) and merchant override via `errorMessages` config map

## Archive Location

```
openspec/changes/archive/2026-07-04-presentation-modal-events/
├── proposal.md
├── exploration.md
├── design.md
├── tasks.md
├── verify-report.md
└── specs/
    ├── presentation-mode/spec.md
    └── card-field-events/spec.md
```

All change artifacts have been moved to the archive with complete audit trail.

## Implementation Summary (8 Commits)

The change landed in two slices on feature/DEV-2245:

**Slice A (4 commits):** Field events + error labels
- ce65b55: Card field types + events payload
- a5112e3: Skyflow element wiring (on, setError, resetError, update)
- 2a00e4f: Error-message resolution + config threading
- 42e750c: Field event wiring + tests (wireFieldEvents, emit, payload normalization)

**Slice B (4 commits):** Presentation modal + facade wiring
- 1c32d7e: ThreeDsHostPort + Browser3dsHost (shadow-DOM modal)
- b91539a: handleRequiresAction + handleApmResult wiring
- b4c3a65: Delete unmountPresentation, thread errorMessages into adapter
- 415134d: E2E + README + demo updates

Total: **1189 insertions / 240 deletions** across 16 files (~1429 changed lines).

## Verification Results

### Test Coverage
- **npm test**: 253/253 passing (29 files)
- **npm run typecheck**: PASS, 0 errors
- **npm run lint**: PASS, 0 errors (1 pre-existing warning unrelated to this change)

### Spec Compliance
All 10 spec requirements fully satisfied:
- Presentation mode: 7 requirements (container removed, SDK-owned modal, 3DS non-closable, APM closable with X, no unmountPresentation method)
- Card field events: 2 requirements (field lifecycle events, SDK-owned default error labels with override)
- Plus 1 supporting requirement on error-message override map

### Code Quality
- `presentationContainerId` removed from `TonderConfig`
- `onClose?()`, `onOpen?()`, `onComplete?()` added to config
- `unmountPresentation()` completely deleted (no shim)
- `ThreeDsHostPort` contract changed from `mountIframe`/`unmount` to `open`/`close`
- `Browser3dsHost` builds and appends shadow-DOM modal to `document.body`
- Field events wired via `element.on()` with load-bearing `setError` → `update` ordering
- Error labels SDK-owned (English defaults), overridable via `errorMessages` map

## Non-Blocking Warnings

### WARNING 1: Unverified Skyflow Signature Claims
**Impact**: Medium (not a code defect, but a verification gap)

The apply-progress and design docs claim that Skyflow `.on()`/`setError()`/`resetError()`/`update()`/`EventName`/`onReady` signatures were "verified against real type defs." However:
- This repo has NO `skyflow-js` npm dependency
- The SDK is loaded at runtime via `<script src="https://js.skyflow.com/v1/index.js">` tag
- There are no bundled Skyflow type definitions in the codebase
- Unit tests use a fake Skyflow element, so a real-SDK signature mismatch would only surface in live browser against a real Skyflow vault
- The verification evidence is not present in the codebase

**Recommendation**: Perform a manual smoke test against a real Skyflow sandbox vault before shipping to production to validate that `onReady` fires per-element as expected and that all event names align with the live SDK.

### WARNING 2: PR Chaining Not Applied
**Impact**: Low (process concern, not functional)

The `tasks.md` Review Workload Forecast explicitly flagged:
- `400-line budget risk: High`
- `Chained PRs recommended: Yes`
- `Decision needed before apply: Yes`

However, the entire change (~1429 lines) was landed as a single commit chain on `feature/DEV-2245` without splitting into the recommended 2-3 independent PRs. While the code is correct, the PR review/merge process may want to consider splitting this change when pushing to main.

## Delivery Notes

- **Branch**: feature/DEV-2245
- **Status**: Clean working tree, all changes committed, not yet pushed to main
- **Demos**: `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3` (sibling repo, separate uncommitted git tree) — `pay.html` and `apms.html` have been updated and verified clean, but remain uncommitted in that separate repo

## Artifacts Traceability

| Artifact | Location | Status |
|----------|----------|--------|
| Proposal | `openspec/changes/archive/.../proposal.md` | Archived |
| Exploration | `openspec/changes/archive/.../exploration.md` | Archived |
| Design | `openspec/changes/archive/.../design.md` | Archived |
| Tasks | `openspec/changes/archive/.../tasks.md` | Archived (100% complete) |
| Verify Report | `openspec/changes/archive/.../verify-report.md` | Archived |
| Presentation Mode Spec | `openspec/specs/presentation-mode/spec.md` | MERGED (superseded) |
| Card Field Events Spec | `openspec/specs/card-field-events/spec.md` | CREATED (new) |

## SDD Cycle Complete

The change has been fully:
- **Proposed** (Intent, scope, approach defined; design decisions captured)
- **Specified** (2 specs: presentation-mode MODIFIED, card-field-events NEW)
- **Designed** (Architecture, types, contracts, data flow documented)
- **Tasked** (6 groups, 100% complete)
- **Implemented** (All tasks done via strict TDD, Slice A + Slice B)
- **Verified** (PASS WITH WARNINGS — tests 253/253, typecheck/lint clean, 0 CRITICAL issues)
- **Archived** (All artifacts moved to archive folder, specs merged into main)

Ready for merge to main.
