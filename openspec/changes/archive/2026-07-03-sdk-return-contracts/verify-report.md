# Verify Report: sdk-return-contracts

**Verdict: PASS WITH WARNINGS**

## Test/Build Evidence

- `npm test` → 223/223 tests passed, 28/28 files passed.
- `npm run typecheck` → clean (`tsc --noEmit` main + e2e), zero errors.
- `npm run lint` → 0 errors, 1 pre-existing unrelated warning (unused eslint-disable in `e2e/support/fixtures.ts`, not touched by this change).

## Task Completeness

All 35 tasks in `openspec/changes/sdk-return-contracts/tasks.md` marked `[x]`. Verified against actual code state — no discrepancies found between claimed and actual completion.

## Spec Compliance Matrix

| Requirement | Status | Evidence |
|---|---|---|
| Raw Transaction Passthrough | PASS | `src/models/transaction.model.ts:84-111` — `RawTransaction` open type (`[k: string]: unknown`); covered by `transaction.model.test.ts` |
| Amount Coercion | PASS | `toRawTransaction` line 140: `result.amount = Number(raw.amount)`; tests 1.1 |
| psp_response Stripped | PASS | line 139: `delete result.psp_response`; tests 1.2/1.3 |
| pay() Returns Bare Raw Transaction | PASS | `src/tonder.ts:278` returns `Promise<RawTransaction>`; `tonder.pay.test.ts` asserts `'outcome' in result === false` at lines 181, 241, 268, 644 |
| requires_action never reaches caller as final (embedded 3DS) | PASS | `handleRequiresAction` (tonder.ts:349-399) routes BOTH the messenger `.then()` (line 369) and the poll path through `pollUntilFinal`; dedicated HIGH-VALUE tests in `tonder.handleRequiresAction.test.ts:272` ("still-Pending messenger single read does NOT settle") and `:315` ("poll never resolves on an intermediate Pending status") both pass |
| Redirect-style pending transaction returned as-is | PASS | `tonder.handleRequiresAction.test.ts:447` — redirect mode returns bare `Pending` transaction before `host.redirect` |
| APM/SPEI async pending | PASS | `handleApmResult` (tonder.ts:418-442) returns `tx` unchanged, never polls; `tonder.handleRequiresAction.test.ts:469` |
| Transaction Reads Return Bare Transaction | PASS | `getTransaction` (line 544) and `pollTransaction` (line 609) both typed `Promise<RawTransaction>`, both route through `getTransactionMapped` → `toRawTransaction` |
| COF Methods Keep camelCase | PASS | `enrollCard`/`getCustomerCards`/`removeCustomerCard` unchanged, camelCase (tonder.ts:651-738); untouched by this change, existing tests unmodified and pass |
| No Legacy Wrapper Fields | PASS | Grep across `src/` for `PayResult`, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction`, `mapToTransaction`, camelCase `Transaction` type, `Outcome` (excluding unrelated pre-existing `CofEnrollOutcome`) — zero matches |

## Correctness Details

- `RawTransaction` is snake_case, open type, `amount: number`, `psp_response` absent from the type definition — matches spec exactly (`src/models/transaction.model.ts:84-111`).
- `toRawTransaction` (line 135-142) is the single coercion choke point: shallow copy, strip `psp_response`, coerce `amount`. Confirmed no other function performs these normalizations.
- `src/index.ts` exports `RawTransaction` in place of `PayResult`/`Transaction` (lines 4-31); `src/shared/types/index.ts:4` re-exports `RawTransaction` only.
- `getPaymentMethods`/`getApmBanks` untouched (task 2.18 verified — existing tests unmodified and pass).

## Findings

### CRITICAL
None.

### WARNING
None — the implementation and tests correctly cover every spec requirement and scenario with passing runtime evidence.

### SUGGESTION
1. **CDN demo drift (out of scope, real breakage)** — `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/pay.html` (lines 110-118) still consumes the v1 wrapper contract: `result.status === 'success'`, `result.transaction.id`, `result.transactionId`. None of these fields exist on the v2 `RawTransaction` (status values are the backend's own strings like `"Success"`/`"Pending"`, not lowercase `'success'`; there is no `result.transaction` wrapper; there is no `result.transactionId` — it's `result.id`). This demo will break silently against the v2 SDK and should be updated in a follow-up change, not blocking this archive.
2. No other public type leaks a removed shape — `src/index.ts` export list was checked line-by-line; only `RawTransaction` is exported for transaction-shaped data.

## Verdict

**PASS WITH WARNINGS** (0 CRITICAL, 0 WARNING, 2 SUGGESTION — both non-blocking follow-ups). Implementation fully matches the v2 contract spec, design, and tasks. All 223 tests pass, typecheck clean, lint clean. Ready for archive.
