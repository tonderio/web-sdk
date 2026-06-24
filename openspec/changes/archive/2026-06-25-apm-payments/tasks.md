# Tasks: apm-payments

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~320–370 (additions + deletions) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Two solo commits (Slice A, Slice B) — single branch, no PRs |
| Delivery strategy | exception-ok (solo commits, no PR chain) |
| Chain strategy | N/A — solo commits |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Commit | Notes |
|------|------|--------|-------|
| Slice A | Read methods: types, getPaymentMethods, getApmBanks | commit 1 | Independent of Slice B; no pay() changes |
| Slice B | APM/SPEI pay() + pending result + README | commit 2 | Depends on Slice A types; card 3DS path unchanged |

---

## Slice A — Read Methods (commit 1)

### A1: Types foundation
- [x] A1.1 Add `PaymentMethodInfo` interface to `src/shared/types/index.ts` — fields: `id`, `paymentMethod`, `acquirer`, `status`, `priority`, `category`, `unavailableCountries[]`.
- [x] A1.2 Add `ApmBank` interface to `src/shared/types/index.ts` — fields: `id`, `bankId`, `name`, `bankCode`, `logo?`, `country`, `countryName`, `isActive`, `paymentType`, `isEnabled`, `priority`.
- [x] A1.3 Re-export `PaymentMethodInfo` and `ApmBank` from `src/index.ts`.

### A2: Error codes
- [x] A2.1 Confirm `FETCH_PAYMENT_METHODS_ERROR` already exists in `src/shared/errors/ErrorKeyEnum.ts` — DO NOT re-add (verified: line 28 is present).
- [x] A2.2 Add `FETCH_APM_BANKS_ERROR = 'FETCH_APM_BANKS_ERROR'` to `ErrorKeyEnum` + message `'Error retrieving APM bank list.'` in `src/shared/errors/messages.ts`.
- [x] A2.3 Add `INVALID_APM_CONFIG = 'INVALID_APM_CONFIG'` to `ErrorKeyEnum` + message `'APM configuration is missing required fields (country, channel, bank_ids).'` in `messages.ts`. (Needed in Slice B but lives in shared layer — add here to keep enum coherent.)

### A3: Internal backend types + mappers (DirectApiService-private)
- [x] A3.1 Add `BackendPaymentMethod` and `BackendApmBanksResponse` interfaces inside `src/core/services/direct-api.service.ts` (not exported). Include snake_case fields. Add internal `mapPaymentMethod` and `mapApmBanks` pure functions in the same file.

### A4: DirectApiService.getPaymentMethods — RED → GREEN
- [x] A4.1 **RED** — in `src/core/services/direct-api.service.test.ts`, add `getPaymentMethods` describe block: assert GET `/api/v1/payment_methods?status=active`, `Authorization: Token` header present, response snake→camel mapped to `PaymentMethodInfo[]`, transport failure throws `FETCH_PAYMENT_METHODS_ERROR`. Run `npx vitest run src/core/services/direct-api.service.test.ts` — expect FAIL.
- [x] A4.2 **GREEN** — implement `getPaymentMethods(): Promise<PaymentMethodInfo[]>` in `DirectApiService`. Run test — expect PASS.

### A5: DirectApiService.getApmBanks — RED → GREEN
- [x] A5.1 **RED** — add `getApmBanks` describe block in `direct-api.service.test.ts`: assert GET path is `/api/v1/safetypay/banks/{apiKey}/` (apiKey URI-encoded in path), response maps to `{ cash: ApmBank[]; transfer: ApmBank[] }`, transport failure throws `FETCH_APM_BANKS_ERROR`. Run — expect FAIL.
- [x] A5.2 **GREEN** — implement `getApmBanks(apiKey: string): Promise<{ cash: ApmBank[]; transfer: ApmBank[] }>` in `DirectApiService`; use `encodeURIComponent(apiKey)` in path construction. Run test — expect PASS.

### A6: Facade methods — RED → GREEN
- [x] A6.1 **RED** — create `src/tonder.getPaymentMethods.test.ts`: assert `tonder.getPaymentMethods()` delegates to `DirectApiService.getPaymentMethods()` and returns the mapped array. Run — expect FAIL.
- [x] A6.2 **GREEN** — add `getPaymentMethods(): Promise<PaymentMethodInfo[]>` to `src/tonder.ts`; no `assertReady` guard (read-only, like `getTransaction`); wrap non-`AppError` in `FETCH_PAYMENT_METHODS_ERROR`. Run test — expect PASS.
- [x] A6.3 **RED** — create `src/tonder.getApmBanks.test.ts`: assert `tonder.getApmBanks()` reads `apiKey` from config, delegates to `DirectApiService.getApmBanks(apiKey)`, returns `{ cash, transfer }`. Run — expect FAIL.
- [x] A6.4 **GREEN** — add `getApmBanks(): Promise<{ cash: ApmBank[]; transfer: ApmBank[] }>` to `src/tonder.ts`; reads `this.core.getConfig().apiKey`; wrap non-`AppError` in `FETCH_APM_BANKS_ERROR`. Run test — expect PASS.

### A-GATE: Slice A quality check
- [x] A7.1 `npm run typecheck` — zero errors.
- [x] A7.2 `npm run lint` — zero errors.
- [x] A7.3 `npx vitest run` — all tests green.
- [x] A7.4 Commit: `feat(apm): read methods — getPaymentMethods, getApmBanks (Slice A)` (9fe864c).

---

## Slice B — APM/SPEI pay() + Pending Result (commit 2)

### B1: pending PayResult variant — RED → GREEN
- [x] B1.1 **RED** — add test cases to `src/models/transaction.model.test.ts`: `mapPendingResult` with `next_action.redirect_to_url.url` → `nextAction.url`; with `payment_instructions` → `paymentInstructions`; with `clabe` + `bank_name` (top-level flat) → `clabe` + `bankName`. Run — expect FAIL.
- [x] B1.2 **GREEN** — in `src/models/transaction.model.ts`: extend `BackendTransactionResponse` with `payment_instructions?`, `voucher_pdf?`, `clabe?`, `bank_name?`. Add `pending` variant to `PayResult` union. Add pure `mapPendingResult(raw: BackendTransactionResponse): PayResult` function. Do NOT alter `mapPayResult`. Run test — expect PASS.

### B2: apm.strategy.ts — RED → GREEN
- [x] B2.1 **RED** — create `src/core/strategies/apm.strategy.test.ts`: assert `buildApmPaymentMethod({apm:'OXXOPAY'})` → `{type:'oxxopay'}` (no `apm_config`); with config → includes `apm_config`; empty config → `apm_config` suppressed; `buildSpeiPaymentMethod()` → `{type:'spei'}`. Run — expect FAIL.
- [x] B2.2 **GREEN** — create `src/core/strategies/apm.strategy.ts` with `ApmPaymentMethod`, `SpeiPaymentMethod` interfaces, `buildApmPaymentMethod`, `buildSpeiPaymentMethod` pure functions. Run test — expect PASS.

### B3: ProcessPaymentBody union extension
- [x] B3.1 In `src/core/services/direct-api.service.ts`, extend `ProcessPaymentBody.payment_method` union to include `ApmPaymentMethod | SpeiPaymentMethod` (imported from `apm.strategy`). No test needed — type-level only; typecheck gate catches regressions.

### B4: resolvePaymentMethod apm/spei branches — RED → GREEN
- [x] B4.1 **RED** — add cases to `src/tonder.pay.test.ts`: `type:'apm'` with missing/empty `apm` → throws `INVALID_PAYMENT_REQUEST`; `type:'apm'` `apm:'safetypaycash'` missing `config.country` → throws `INVALID_APM_CONFIG`; `type:'apm'` `apm:'safetypaycash'` missing `config.channel` → throws `INVALID_APM_CONFIG`; `type:'apm'` `apm:'safetypaycash'` missing `config.bank_ids` → throws `INVALID_APM_CONFIG`; non-SafetyPay APM with no config → passes through. Run — expect FAIL.
- [x] B4.2 **GREEN** — in `src/tonder.ts` `resolvePaymentMethod`: add `'apm'` branch (require non-empty `input.paymentMethod.apm`, throw `INVALID_PAYMENT_REQUEST` if absent; for safetypaycash/safetypaytransfer assert `config.country`, `config.channel`, `config.bank_ids`, throw `INVALID_APM_CONFIG` if any missing; call `buildApmPaymentMethod`). Add `'spei'` branch (call `buildSpeiPaymentMethod`). Run test — expect PASS.

### B5: pay() branching + handleApmResult — RED → GREEN
- [x] B5.1 **RED** — add `handleApmResult` / APM pay path cases to `src/tonder.pay.test.ts`:
  - APM redirect with URL: `host.redirect` called once, `pollTransaction` NOT called, result is `{status:'pending'}`.
  - APM embedded with URL: `host.mountIframe` called, `pollTransaction` NOT called, `host.unmount` called, result is `{status:'pending'}`.
  - APM no URL (instructions-only): no `host.redirect`, no `host.mountIframe`, no poll, result is `{status:'pending'}` with `paymentInstructions`.
  - SPEI pay: `pollTransaction` NOT called, result is `{status:'pending'}`.
  - **Regression**: card 3DS embedded still calls `mountIframe` AND `pollTransaction` — result NOT pending.
  - Run — expect FAIL.
- [x] B5.2 **GREEN** — in `src/tonder.ts` `pay()`: capture `const inputType = input.paymentMethod.type` BEFORE `resolvePaymentMethod`. After `processPayment` returns `raw`: if `inputType === 'apm' || inputType === 'spei'`, call `mapPendingResult(raw)` → `handleApmResult(pending)`; else follow existing `mapPayResult` → `handleRequiresAction` path. Add private `handleApmResult(result: PayResult): Promise<PayResult>`: no-url → return; redirect → `host.redirect(url)` → return; embedded → `host.mountIframe(url, containerId)`; `try { return result; } finally { host.unmount(); }` — NO `pollTransaction`. Run test — expect PASS.

### B6: README update
- [x] B6.1 Add `## Alternative Payment Methods` section to `README.md`: show `getPaymentMethods()`, `getApmBanks()`, `pay({ paymentMethod: { type:'apm', apm:'OXXOPAY' } })` examples. Add SPEI example. Document pending result shape and note: settlement is async — listen for webhook, do not poll in-session.
- [x] B6.2 Remove or update any `🚧 in development` banner that covers APM/SPEI and the two new read methods.

### B-GATE: Slice B quality check
- [x] B7.1 `npm run typecheck` — zero errors.
- [x] B7.2 `npm run lint` — zero errors.
- [x] B7.3 `npx vitest run` — all tests green (including card 3DS regression).
- [x] B7.4 Commit: `feat(apm): apm/spei pay(), pending result, handleApmResult (Slice B)` (27398cb).
