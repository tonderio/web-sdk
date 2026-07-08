# Archive Report: sdk-return-contracts

**Change**: sdk-return-contracts
**Archived**: 2026-07-03
**Verdict**: PASS — Ready for production

## Completion Status

All 35 implementation tasks completed and verified. Test suite: 223/223 pass. Typecheck clean. Lint clean.

## Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| sdk-return-contracts | Created | New domain spec copied to `openspec/specs/sdk-return-contracts/spec.md`. Defines raw transaction passthrough contract for all Direct-API-fed methods (pay, getTransaction, pollTransaction, getPaymentMethods, getApmBanks). |

## Archive Contents

- proposal.md (intent, scope, approach, risks, rollback plan)
- exploration.md (5 decision points, comparative research)
- design.md (v2 simplified, bare RawTransaction, no outcome wrapper)
- tasks.md (35 tasks, 4 work units, all marked complete)
- verify-report.md (PASS WITH WARNINGS: 0 CRITICAL, 0 WARNING, 2 SUGGESTION)
- specs/sdk-return-contracts/spec.md (full specification)

## Key Changes

### Return Shape Redesign
- **Before**: `pay()` returned `PayResult` wrapper with outcome enum, nested transaction (camelCase Transaction)
- **After**: `pay()` returns bare `RawTransaction` (raw backend body, snake_case, `amount: number`, psp_response stripped)
- **Impact**: Unifies `pay()`/`getTransaction()`/`pollTransaction()` on one type, eliminates outcome duplication

### Type System
- **Deleted**: `Transaction` (camelCase), `PayResult`, `Outcome`, `mapToTransaction`, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction`
- **Added**: `RawTransaction` (open type with `[k:string]:unknown`), `toRawTransaction(raw)` choke point
- **Kept internal**: `FINAL_STATUSES`, `pollUntilFinal`, flow-control utilities

### Code Impact
- **src/models/transaction.model.ts**: Mapper collapses from 200+ lines to ~150 lines (net shrink). Single public function `toRawTransaction`.
- **src/tonder.ts**: `pay()`, `handleRequiresAction()`, `handleApmResult()`, `getTransaction()`, `pollTransaction()` all retype to `Promise<RawTransaction>`. Branch logic simplifies (off raw body, not wrapper).
- **src/index.ts**, **src/shared/types/index.ts**: Export `RawTransaction` in place of removed types.
- **README.md**: Status→meaning table added. `pay()` documented to return bare transaction.

### Test Impact
- **Total tests**: 223/223 pass
- **Test assertions**: Entire outcome-classification axis removed from public surface (~55 assertions vs. many more in v1)
- **Key assertion changes**:
  - `tonder.pay.test.ts`: No wrapper; assert `'outcome' in result === false` at 4 locations
  - `tonder.handleRequiresAction.test.ts`: Still-Pending messenger read does NOT settle (HIGH-VALUE); poll never settles on intermediate status (HIGH-VALUE)
  - `transaction.model.test.ts`: Amount coercion both directions; psp_response strip; unknown field passthrough

## Verification Evidence

**Test/Build**:
- `npm test` → 223/223 pass, 28/28 files
- `npm run typecheck` → clean (tsc --noEmit)
- `npm run lint` → 0 errors

**Spec Compliance**:
- Raw Transaction Passthrough: PASS (open type, snake_case verbatim)
- Amount Coercion: PASS (Number() in toRawTransaction)
- psp_response Stripped: PASS (delete in toRawTransaction)
- pay() Returns Bare: PASS (Promise<RawTransaction>)
- Embedded 3DS still-Pending safety: PASS (messenger + poll both route through pollUntilFinal)
- Redirect async pending: PASS (returns Pending raw tx before unload)
- APM/SPEI async: PASS (returns Pending with next_action/clabe/bank_name)
- Transaction Reads: PASS (bare RawTransaction)
- COF Methods: PASS (camelCase, unchanged, tests pass)
- No Legacy Wrapper Fields: PASS (grep-clean of all deleted symbols)

## Warnings / Follow-ups

**SUGGESTION 1 (out-of-scope)**: Demo `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/pay.html` (lines 110-118) still consumes v1 wrapper contract. Will break silently against v2 SDK. Follow-up change required: update demo to read `result.id` (not `result.transactionId`), `result.status` (not a wrapper field), remove wrapper assumptions.

**SUGGESTION 2**: No other public type leaks removed shapes. `src/index.ts` export list verified line-by-line.

## Traceability

**Engram Observation IDs** (full artifact records):
- Proposal: #3287
- Specification: #3289
- Design: #3290
- Tasks: #3291
- Verification Report: #3310
- Archive Report: (this document + `sdd/sdk-return-contracts/archive-report` topic)

## Archive Integrity

- Change folder moved: `openspec/changes/sdk-return-contracts/` → `openspec/changes/archive/2026-07-03-sdk-return-contracts/`
- All artifacts present: proposal, exploration, design, tasks, verify-report, specs/
- No src/, dist/, or demo/ mutations (clean sandbox)
- Ready for long-term audit trail

## Rollback Plan

Revert the single merge commit (`chore(sdd): archive sdk-return-contracts`). Feature branch can be deleted. No released consumers, no migration needed, no backend coupling.

## SDD Cycle Complete

Proposal → Exploration → Specification → Design → Tasks → Implementation → Verification → **Archive**.

The change is fully planned, implemented, verified, and closed. Ready for the next change.
