# Tasks: SDK Return Contracts (v2 — bare RawTransaction, no wrapper)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260-330 (net, incl. test deletions/rewrites) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single unit — one PR, work-unit commits |
| Delivery strategy | ask-on-risk (pre-decided: single unit, `size:exception`, no chained PRs) |
| Chain strategy | n/a (single PR) |

Decision needed before apply: No (already decided — single PR, `size:exception`, work-unit commits)
Chained PRs recommended: No
400-line budget risk: Low

### Line estimate breakdown

| Area | File | Est. delta |
|------|------|-----------|
| Mapper | `src/models/transaction.model.ts` | -140 / +45 (net shrink — deletes `Transaction`, `PayResult`, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction`; adds `RawTransaction` + `toRawTransaction`) |
| Facade | `src/tonder.ts` | ~60-80 changed lines (imports, `pay()`, `handleRequiresAction`, `handleApmResult`, `getTransaction`/`pollTransaction`/`getTransactionMapped` signatures) |
| Exports | `src/shared/types/index.ts`, `src/index.ts` | ~10 lines |
| Tests | `transaction.model.test.ts`, `tonder.pay.test.ts`, `tonder.handleRequiresAction.test.ts`, `tonder.getTransaction.test.ts`, `tonder.pollTransaction.test.ts` | net shrink — v2 removes the entire outcome-classification test axis; expect fewer assertions than today |
| Docs | `README.md` | ~30-50 lines (status table + return-shape note) |

v2 is materially smaller than v1's forecast (was 550-700 lines, chained-PR recommended) because the `outcome` wrapper — and its whole classification test surface — is gone. This is a single cohesive slice; no natural chain boundary exists (mapper and facade changes are tightly coupled to the same type).

### Suggested Work Units (commits within the single PR)

| Unit | Goal | Notes |
|------|------|-------|
| 1 | Mapper/types (`transaction.model.ts`) RED→GREEN | Self-contained; no facade changes yet |
| 2 | Facade + 3DS handlers (`tonder.ts`) RED→GREEN | Depends on Unit 1's `RawTransaction`/`toRawTransaction` |
| 3 | Exports + dead-code cleanup | Mechanical, depends on Units 1-2 landing |
| 4 | README/JSDoc status table | Independent of code; can run last |

## Phase 1: Mapper & Types (`src/models/transaction.model.ts`)

Satisfies: Raw Transaction Passthrough, Amount Coercion, psp_response Stripped, No Legacy Wrapper Fields.

- [x] 1.1 RED: write failing tests in `transaction.model.test.ts` for `toRawTransaction` — `amount` coercion (string `"150"` → number `150`; number `200` → unchanged `200`)
- [x] 1.2 RED: write failing test — `psp_response` present in backend body is stripped from the result
- [x] 1.3 RED: write failing test — `psp_response` absent is a no-op (result still has no `psp_response` key)
- [x] **1.4 HIGH-VALUE RED: write failing test — unknown/unlisted fields (e.g. `next_action`, `clabe`, `bank_name`, an arbitrary future field) pass through verbatim under their own snake_case keys** (open-index `[k: string]: unknown` behavior)
- [x] 1.5 GREEN: delete `Transaction` interface, `mapToTransaction`, `PayResult` type, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction` from `transaction.model.ts`
- [x] 1.6 GREEN: add `RawTransaction` interface — known fields (`id`, `operation_type`, `status`, `amount: number`, `currency`, optional `next_action`, `decline_code`, `decline_reason`, `clabe`, `bank_name`, etc.) plus `[k: string]: unknown` (open type)
- [x] 1.7 GREEN: implement `toRawTransaction(raw: BackendTransactionResponse): RawTransaction` — shallow copy, `delete result.psp_response`, `amount = Number(raw.amount)`, all other fields pass through verbatim
- [x] 1.8 REFACTOR: confirm `DECLINE_STATUSES`, `DECLINED_FINAL_STATUSES`, and `FINAL_STATUSES`/`pollUntilFinal` (in `shared/utils/poll.ts`) remain as INTERNAL-only flow-control utilities — read `status` only, never return a classification; retype any signature currently pinned to `Transaction` to `RawTransaction`
- [x] 1.9 Verify: run `transaction.model.test.ts` green; grep-confirm no remaining references to `Transaction`, `mapToTransaction`, `PayResult`, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction` in the file

## Phase 2: Facade & 3DS Handlers (`src/tonder.ts`)

Satisfies: pay() Returns Bare Raw Transaction, Transaction Reads Return Bare Transaction, No Legacy Wrapper Fields.

- [x] 2.1 GREEN (mechanical): update imports — remove `mapPayResult`, `mapPendingResult`, `payResultFromTransaction`, `Transaction`, `PayResult`; import `toRawTransaction`, `RawTransaction`
- [x] 2.2 RED (in `tonder.pay.test.ts`): frictionless card success — `pay()` resolves the bare raw transaction (`toEqual(rawTransaction)`, not `{outcome, transaction}`), `status === 'Success'`
- [x] 2.3 RED (in `tonder.pay.test.ts`): frictionless card decline — `pay()` resolves the bare raw transaction with `status === 'Declined'` and carries `decline_code`/`decline_reason` verbatim if the backend sent them
- [x] 2.4 RED (in `tonder.pay.test.ts`): redirect-mode 3DS — `pay()` resolves the raw `/process` transaction (`status: 'Pending'`, carrying `next_action`) BEFORE the host navigates away
- [x] 2.5 RED (in `tonder.pay.test.ts`): APM/SPEI — `pay()` resolves the raw transaction (`status: 'Pending'`, carrying `next_action`/`clabe`/`bank_name` exactly as the backend sent them, when present)
- [x] **2.6 HIGH-VALUE RED (in `tonder.handleRequiresAction.test.ts`): embedded 3DS, messenger single-read path — a still-`"Pending"` read from `getTransaction` after the messenger signals completion must NOT be treated as final; the handler must not resolve with a `"Pending"` transaction as if it were settled** (assert it keeps waiting on the poll fallback or rejects/times out — does not silently return Pending as done)
- [x] **2.7 HIGH-VALUE RED (in `tonder.handleRequiresAction.test.ts`): embedded 3DS, poll path — `pollTransaction`/`pollUntilFinal` never resolves on an intermediate `"Pending"` or `"requires_action"` status; only resolves once the backend reaches a FINAL status** (reuses/extends existing poll-until-final coverage against `RawTransaction`)
- [x] 2.8 RED (in `tonder.handleRequiresAction.test.ts`): embedded 3DS resolves to success/decline — handler returns the FINAL bare `RawTransaction` (no `outcome`, no `payResultFromTransaction` wrapper), id sourced from `tx.id`
- [x] 2.9 RED (in `tonder.handleRequiresAction.test.ts`): redirect 3DS — handler returns the bare `RawTransaction` (`status: 'Pending'`) before calling `host.redirect`
- [x] 2.10 RED (in `tonder.getTransaction.test.ts`): `getTransaction` returns bare `RawTransaction` — `amount` coerced to number, `psp_response` stripped, no wrapper
- [x] 2.11 RED (in `tonder.pollTransaction.test.ts`): `pollTransaction` returns bare `RawTransaction`, no wrapper
- [x] 2.12 GREEN: rewrite `pay()` — branch off the RAW body (`raw.next_action`/`raw.status`) and the captured `inputType`, not a mapped wrapper; call `toRawTransaction(raw)` once and pass the raw body (or the raw tx) into `handleApmResult`/`handleRequiresAction` as appropriate; return type `Promise<RawTransaction>`
- [x] 2.13 GREEN: rewrite `handleRequiresAction(tx: RawTransaction): Promise<RawTransaction>` — redirect path returns `tx` (status Pending) before `host.redirect`; embedded path polls to FINAL via `pollUntilFinal`/race against messenger, returns the final `RawTransaction`; id read from `tx.id` (not `result.transactionId`)
- [x] 2.14 GREEN: rewrite `handleApmResult(tx: RawTransaction): Promise<RawTransaction>` — returns `tx` unchanged (mount/redirect side effects only, no reclassification)
- [x] 2.15 GREEN: retype `getTransaction(id): Promise<RawTransaction>`, `pollTransaction(id, options): Promise<RawTransaction>`, `getTransactionMapped(id, signal?): Promise<RawTransaction>` — body calls `toRawTransaction(raw)` instead of `mapToTransaction(raw)`
- [x] 2.16 Verify: confirm no top-level `nextAction`, `transactionId`, `declineCode`, `declineReason`, `paymentInstructions`, `voucher`, `clabe`, `bankName`, or `outcome` fields remain on any Direct-API-fed result; equivalent data only reachable at `transaction.<snake_case_field>`
- [x] 2.17 Verify: confirm every raw body/transaction returned by `pay()`, `getTransaction`, `pollTransaction` always carries `id` (no path can return a transaction without it)
- [x] 2.18 Verify: `getPaymentMethods`/`getApmBanks` untouched — existing `tonder.getPaymentMethods.test.ts`/`tonder.getApmBanks.test.ts` still pass unmodified
- [x] 2.19 Verify: COF trio untouched — existing `tonder.enrollCard.test.ts`, `tonder.getCustomerCards.test.ts`, `tonder.removeCustomerCard.test.ts` still pass unmodified (camelCase contract, vault-fed, out of scope)

## Phase 3: Exports & Dead-Code Cleanup

Satisfies: No Legacy Wrapper Fields, COF Methods Keep camelCase (regression guard).

- [x] 3.1 Update `src/shared/types/index.ts` — export `RawTransaction` from `../../models/transaction.model`; remove `Transaction`/`PayResult` re-export
- [x] 3.2 Update `src/index.ts` — export `RawTransaction` in place of `PayResult`/`Transaction` in the public type list
- [x] 3.3 Grep-verify no remaining references anywhere in `src/` to `Transaction` (the deleted camelCase type), `PayResult`, `Outcome`, `mapToTransaction`, `mapPayResult`, `mapPendingResult`, `payResultFromTransaction` (watch for stale JSDoc `@link` references too, e.g. the `getTransaction` recovers-status comment block in `tonder.ts`)
- [x] 3.4 Verify: `tsc`/build passes with zero references to deleted types

## Phase 4: Documentation

Satisfies: pay() Returns Bare Raw Transaction (status-normalization guidance clause).

- [x] 4.1 Add a status→meaning table to `README.md` documenting which raw `status` values integrators should treat as paid/declined/pending (e.g. `Success` → paid, `Declined`/`Failed` → declined, `Pending`/`requires_action` intermediate → not yet final) — explicitly note this is DOCUMENTATION ONLY, no helper/enum ships
- [x] 4.2 Update `README.md` public API section — `pay()` returns the bare `RawTransaction` (same shape as `getTransaction`/`pollTransaction`), no wrapper/`outcome` field; note the redirect/APM async-pending caveat (caller polls or reads later)
- [x] 4.3 Update JSDoc on `pay`, `getTransaction`, `pollTransaction`, `handleRequiresAction`, `handleApmResult` in `src/tonder.ts` to reflect `RawTransaction` return types and the removal of the outcome wrapper
