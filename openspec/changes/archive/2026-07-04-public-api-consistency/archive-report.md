# Archive Report: public-api-consistency

**Date**: 2026-07-04  
**Change**: public-api-consistency  
**Package**: @tonder.io/web-sdk  
**Status**: PASS (279/279 tests, 0 CRITICAL)  
**Verification Verdict**: PASS (279/279 tests passing, typecheck + lint clean, 59/59 tasks complete)

## Summary

The `public-api-consistency` change has been fully implemented, verified, and archived. This change unifies the SDK's public API surface into a single, cohesive shape before the first release — establishing ONE customer shape (config-only, required to pay), a generic component factory (`tonder.create(type, options)`) replacing verb-specific mount methods, namespaced presentation callbacks, and one type-suffix policy. The change landed in two slices on feature/DEV-2245 with complete spec coverage.

## Specs Merged into Main Specs

### 1. `openspec/specs/public-api/spec.md` — CREATED (NEW)

New main spec documenting the unified public API surface:

**Requirements:**
- One Customer shape: `{ email: string; firstName?: string; lastName?: string; phone?: string }` — canonical, reused everywhere
- Customer is config-only and required to pay: `pay()` throws `MISSING_CUSTOMER` before network call when absent
- Component factory replaces verb methods: `tonder.create(type, options)` with `mount()` / `unmount()` / `reveal()` handle methods
- One type-suffix policy: requests as `<X>Input`, responses as named nouns or `<X>Result`; no dead exports (`PublicSuccess`/`PublicError`); `getApmBanks()` returns named `ApmBanks` type

### 2. `openspec/specs/card-field-events/spec.md` — MODIFIED

Updated from mount-level to component-level event configuration:

**MODIFIED Requirements:**
- Field lifecycle events now configured via `tonder.create('cardFields', { events: { <field>: { onChange?, onBlur?, onFocus?, onReady? } } })` instead of `mountCardFields` config level
- Events resolve per-component-instance (solves saved-card CVV multi-context)
- SDK-owned error-label ordering (`setError` before `update`) preserved; merchant override via `config.errorMessages` unchanged

### 3. `openspec/specs/presentation-mode/spec.md` — MODIFIED

Updated callback location from flat config fields to namespaced `events.presentation.*`:

**MODIFIED Requirements:**
- Presentation callbacks read from `config.events.presentation.{onOpen?, onClose?, onComplete?}` at fire time
- Flat `TonderConfig.onOpen/onClose/onComplete` fields removed
- APM overlay close fires `config.events.presentation.onClose`; 3DS auto-closes without shopper affordance

## Archive Location

```
openspec/changes/archive/2026-07-04-public-api-consistency/
├── proposal.md
├── exploration.md
├── design.md
├── tasks.md
├── verify-report.md
└── specs/
    ├── public-api/spec.md
    ├── card-field-events/spec.md
    └── presentation-mode/spec.md
```

All change artifacts have been moved to the archive with complete audit trail.

## Implementation Summary (6 Commits)

The change landed in two slices on feature/DEV-2245:

**Slice A (3 commits):** Customer unification + config-only pay
- a33168d: Rename `CustomerInput` → `Customer`; remove `PayInput.customer`; add MISSING_CUSTOMER pre-flight
- 2d93161: Derive `/process` name from `firstName`/`lastName`; thread config.customer through pay path
- aa3dc08: Update tests; verify customer pre-flight guards all payment methods

**Slice B (3 commits):** Component factory + events namespace + type hygiene
- db1b2f4: Implement `create('cardFields', options)` factory; delete `mountCardFields`/`unmountCardFields`/`revealCardFields`
- 6921805: Rewire presentation callbacks to `config.events.presentation.*`; move input events to component options
- da00512: Rename types (`CardFieldsOptions`, `RevealCardFieldsInput`, etc.); add `ApmBanks` named type; delete `PublicSuccess`/`PublicError`; update README and demos

Total: **~1400 insertions / 250 deletions** across 20+ files.

## Verification Results

### Test Coverage
- **npm test**: 279/279 passing (30 test files)
- **npm run typecheck**: PASS, 0 errors
- **npm run lint**: PASS, 0 errors (1 pre-existing warning unrelated to this change)

### Spec Compliance
All 4 requirement domains fully satisfied:
- Public API consistency: ONE Customer, config-only customer, component factory, type hygiene — 100% (4 spec requirements)
- Card field events: Per-component events, SDK-owned error labels — 100% (2 spec requirements)
- Presentation mode: APM/3DS overlays, callback namespacing — 100% (3 spec requirements)

### Code Quality
- `CustomerInput` completely removed; `Customer` canonical and reused
- `PayInput.customer` removed; `pay()` reads `config.customer` exclusively
- `mountCardFields`, `unmountCardFields`, `revealCardFields` deleted; `tonder.create('cardFields', options)` returns component handle
- Presentation callbacks read from `config.events?.presentation?.{onOpen,onClose,onComplete}` at fire time only
- `PublicSuccess`/`PublicError` deleted; `getApmBanks()` returns named `ApmBanks` type
- Input-field events stay per-component on `CardFieldsOptions.events` (unchanged wiring in Skyflow adapter)

## Non-Blocking Suggestions

**SUGGESTION 1**: Follow-up doc-refresh task for `docs/` planning artifacts (PRD.md, 04-proposal.md, etc.) if the team wants historical planning docs to reflect the new API — currently correctly left untouched as history (out of scope per apply-progress).

**SUGGESTION 2**: The pre-existing lint warning in `e2e/support/fixtures.ts:222` (unused eslint-disable) is unrelated to this change but could be cleaned up opportunistically.

## Delivery Notes

- **Branch**: feature/DEV-2245
- **Status**: Clean working tree, all 59 tasks marked complete, all changes committed, not yet pushed to main
- **Demos**: `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3` (sibling repo, separate uncommitted git tree) — `pay.html`, `apms.html`, and `enroll.html` have been updated and verified clean, but remain uncommitted in that separate repo (per convention — demos are demonstration artifacts outside the main SDK commit history)

## Artifacts Traceability

| Artifact | Location | Status |
|----------|----------|--------|
| Proposal | `openspec/changes/archive/.../proposal.md` | Archived |
| Exploration | `openspec/changes/archive/.../exploration.md` | Archived |
| Design | `openspec/changes/archive/.../design.md` | Archived |
| Tasks | `openspec/changes/archive/.../tasks.md` | Archived (59/59 complete) |
| Verify Report | `openspec/changes/archive/.../verify-report.md` | Archived (PASS verdict) |
| Public API Spec | `openspec/specs/public-api/spec.md` | CREATED (new main spec) |
| Card Field Events Spec | `openspec/specs/card-field-events/spec.md` | MERGED (updated with component-level events) |
| Presentation Mode Spec | `openspec/specs/presentation-mode/spec.md` | MERGED (updated with events.presentation namespace) |

## SDD Cycle Complete

The change has been fully:
- **Proposed** (Intent, scope, approach defined; design decisions captured)
- **Explored** (Public API audit, docs/code divergence identified; alternatives evaluated)
- **Specified** (3 specs: public-api NEW, card-field-events MODIFIED, presentation-mode MODIFIED)
- **Designed** (Architecture, types, contracts, facade wiring, test surface, migration notes)
- **Tasked** (6 groups, 59 tasks total, all marked complete)
- **Implemented** (All tasks done via strict TDD, Slice A + Slice B, 6 commits)
- **Verified** (PASS — tests 279/279, typecheck/lint clean, 0 CRITICAL issues)
- **Archived** (All artifacts moved to archive folder, specs merged into main, ready for merge to main)

Ready for merge to main.
