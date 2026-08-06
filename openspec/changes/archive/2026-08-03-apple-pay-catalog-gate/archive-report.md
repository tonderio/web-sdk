# Archive Report — apple-pay-catalog-gate

**Change**: apple-pay-catalog-gate (Phase 2 of `docs/apple-pay-integration-plan.md`)
**Archived to**: `openspec/changes/archive/2026-08-03-apple-pay-catalog-gate/`
**Date**: 2026-08-03
**Mode**: hybrid (openspec files + Engram)

## Task Completion Gate

`openspec/changes/apple-pay-catalog-gate/tasks.md` — all boxes 0.1 through 4.3 checked (`[x]`), verified against the tasks observation (Engram #4004, confirmed against the on-disk copy). No stale unchecked implementation tasks. No reconciliation was needed.

## Verification Gate

`sdd-verify` (Engram #4006) returned **PASS WITH WARNINGS**, 0 CRITICAL. Three WARNINGs were raised (tasks.md drift on the post-task-list refactor's file layout in 1.1/1.2/3.3; task 4.3's rollback claim no longer holding cleanly at HEAD after the same refactor; duplicate test coverage in `direct-api.service.test.ts`). Per the archive brief, all three were fixed in commit `9ff8c47`, with the full command suite re-run afterward: `npm run test` 361 passing / 36 files, `npm run typecheck` clean, `npm run build` clean, `npm run lint` at the same two pre-existing unrelated errors. This archive executor did not re-run those commands itself (no shell access in this session) and is relying on the orchestrator's report of that re-run.

No CRITICAL issues were raised at verify time or after. Archive proceeds cleanly, not as an intentional-partial or exception-backed archive.

## Specs Synced

| Domain                     | Action  | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apple-pay`                | Updated | 5 requirements **added** (Raw catalog fetched and cached during init(); Availability gate reads cached catalog only (D4); Supported-networks derivation; merchantCapabilities derivation; Public availability wiring waits for its full runtime). 0 modified, 0 removed. All 5 pre-existing requirements (BusinessProfile/country_code, catalog `configuration` field, six ErrorKeyEnum codes, declared-but-unreachable payment/option/customization types, `@types/applepayjs` dev-only) preserved verbatim. |
| `public-api`               | Updated | 1 requirement **added** (`init()` fetches business config and the Apple Pay catalog concurrently; the catalog leg is non-fatal). 0 modified, 0 removed. All 6 pre-existing requirements (snake_case public fields, one Customer shape, config-only customer for `pay()`, customer optional at init, component factory, one type-suffix policy) preserved verbatim.                                                                                                                                            |
| `payment-method-discovery` | Updated | 1 requirement **modified** (`Fetch Payment Methods` — now filters `apple_pay_*` entries, adds the "own request, never cache-served" constraint, and gains 2 new scenarios: filtered-fetch and cache-bypass-on-init-failure). 0 added, 0 removed. `Fetch APM Banks` (the only other requirement in this spec) preserved verbatim, untouched by the delta.                                                                                                                                                      |

## Load-bearing decisions verified present in canonical text

- **D3 — `getPaymentMethods()` never serves from the `init()` cache.** Present verbatim in the merged `payment-method-discovery/spec.md` constraint list and in the new scenario "getPaymentMethods() issues its own request even when init()'s catalog leg failed," with the reason stated (non-fatal `init()` can leave the cache empty; a cache-served read would silently return `[]` instead of real methods).
- **D1/DD1 — the catalog leg is non-fatal, concurrent with the business leg, only the business leg is fatal.** Present verbatim in the new `public-api/spec.md` requirement and its four scenarios, and echoed in the `apple-pay/spec.md` "Raw payment-method catalog is fetched and cached during init()" requirement.
- **DD3/DD4 — single-producer guarantee for `PaymentMethodInfo[]`.** The delta requirement text (and this archive's `verify-report.md`) states the structural claim; the current code location (`models/payment-method.model.ts` for the projection, `shared/payment-method-catalog.ts` for the predicate, `tonder.ts` composing fetch+projection) is recorded in `design.md`'s DD3/DD4 sections and in `verify-report.md`'s "late refactor — judged" section, not misattributed to `direct-api.service.ts`.
- **DD5 — prefix match, not allow-list, and the reason (asymmetric failure cost).** Present verbatim in `design.md` DD5 and reflected in the canonical `payment-method-discovery/spec.md` constraint ("An entry MUST be dropped whenever its `payment_method` starts with `apple_pay_`... the filter matches only that prefix").
- **Case-sensitive network dedup (Apple's exact `masterCard` casing).** Present in `design.md` DD6 ("Dedup is exact-string, deliberately not case-insensitive") and reflected in the canonical `apple-pay/spec.md` "Apple Pay supported-networks derivation" requirement's "A network value MUST NOT appear twice... regardless of how many active entries carry it" combined with the "Apple's tokens keep Apple's casing" design note.

## In-flight wording check (the apple-pay-foundation defect, checked against)

Every requirement promoted into canonical text was read for "this phase" / "this change" / "before this change" / "not yet" wording that would wrongly become a permanent constraint:

- The one requirement most at risk of repeating the defect — "Public Apple Pay availability wiring waits for its full runtime" — was written in the durable form already established by `public-api/spec.md`'s existing "A component type MUST be added... only in the change that implements its runtime" pattern, not as an in-flight prohibition. It states a rule about _when_ the public method may be wired (together with its runtime), not that it can never be added. No fix needed.
- "Apple Pay availability gate reads the cached catalog only (D4)" references `apple-pay-foundation`'s superseded design by name to record why D4 differs from it. This is historical attribution (parallel to the `(Previously: ...)` convention already used elsewhere in these specs), not a forward-looking constraint on future changes. No fix needed.
- No requirement text stated a non-regression property ("X is unaffected by this phase") as a durable rule. Non-regression claims stayed in the archived apply-progress/verify-report/tasks trail, not in canonical text.
- No requirement text forbade future modification of a field/behavior this change did not own (the `apple-pay-foundation` defect's `TonderComponentType` example). Every MUST/MUST NOT in the promoted text describes the system's behavior as of this change, not a freeze on future changes.

No corrections were required before merge; the delta specs were already written to this standard.

## Archive Contents

- `proposal.md` ✅ (revision 2, D1–D4 confirmed)
- `design.md` ✅ (DD1–DD8, forward constraints F1–F7)
- `tasks.md` ✅ (44/44 checked, 0.1–4.3)
- `specs/apple-pay/spec.md` ✅ (delta, ADDED only)
- `specs/public-api/spec.md` ✅ (delta, ADDED only)
- `specs/payment-method-discovery/spec.md` ✅ (delta, MODIFIED only)
- `apply-progress.md` ✅ (pulled from Engram #4005, with a note on the post-apply refactor)
- `verify-report.md` ✅ (pulled from Engram #4006, with a note on post-verify remediation)
- `archive-report.md` ✅ (this file)

## Source of Truth Updated

- `openspec/specs/apple-pay/spec.md` — 10 requirements (5 pre-existing + 5 new)
- `openspec/specs/public-api/spec.md` — 7 requirements (6 pre-existing + 1 new)
- `openspec/specs/payment-method-discovery/spec.md` — 2 requirements (1 modified, 1 untouched)

## What this executor did NOT do

- Did not delete or move `openspec/changes/apple-pay-catalog-gate/` (the original change folder). No shell/git access in this session — the orchestrator/user is expected to perform that removal and any commit.
- Did not re-run `npm run test`/`typecheck`/`build`/`lint`. Relied on the orchestrator's stated re-verification after `9ff8c47`.
- Did not modify `docs/apple-pay-integration-plan.md` or any other planning document outside `openspec/`.

## Traceability — Engram observation IDs

| Artifact                      | Observation ID | Topic key                                   |
| ----------------------------- | -------------- | ------------------------------------------- |
| Proposal                      | #3996          | `sdd/apple-pay-catalog-gate/proposal`       |
| Spec (delta authoring record) | #4001          | `sdd/apple-pay-catalog-gate/spec`           |
| Design                        | #4003          | `sdd/apple-pay-catalog-gate/design`         |
| Tasks                         | #4004          | `sdd/apple-pay-catalog-gate/tasks`          |
| Apply progress                | #4005          | `sdd/apple-pay-catalog-gate/apply-progress` |
| Verify report                 | #4006          | `sdd/apple-pay-catalog-gate/verify-report`  |

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived (spec merge + archive file copy). Remaining mechanical steps (deleting the original change folder, git commit) are explicitly deferred to the user/orchestrator per this session's tooling constraints.
