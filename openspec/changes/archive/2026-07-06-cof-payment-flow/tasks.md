# Tasks: COF payment flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 220-320 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR: tests + facade wiring |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Prove COF-active pay(card) behavior | PR 1 | RED tests in `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.pay.test.ts` |
| 2 | Implement facade composition + rollback | PR 1 | GREEN/REFACTOR in `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts` |

## Phase 1: RED tests

- [x] 1.1 In `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.pay.test.ts`, add helpers for COF business config, customer registration/card endpoints, and acquirer subscription mocking.
- [x] 1.2 Add failing test: COF-active `pay({ paymentMethod: { type: 'card' } })` enrolls before `/api/v1/process/`, calls `tokenizer.collect()` once, then processes.
- [x] 1.3 Add failing payload test: `/process/` receives `payment_method: { type: 'CARD', token: 'sky_1' }` and omits raw fields, `enable_card_on_file`, `subscription_id`.
- [x] 1.4 Add failing regression tests: non-COF `pay(card)` remains raw-card, and `pay(savedCard)` does not collect/enroll.
- [x] 1.5 Add failing rollback tests: process throw removes enrolled card and rethrows original `PAYMENT_PROCESS_ERROR`; declined/pending/embedded poll failure do not remove.

## Phase 2: GREEN implementation

- [x] 2.1 In `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts`, add `isCofActive()` using `this.core.getState().business?.cardonfile_keys?.public_key`.
- [x] 2.2 In `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts`, extract `buildCofEnrollParams(currency?)` from `enrollCard()` auth/contact mapping; keep `core/` pure.
- [x] 2.3 Change `resolvePaymentMethod` in `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts` to accept `PayInput` and return local metadata `{ paymentMethod, enrolledCardId?, rollbackAuth? }`.
- [x] 2.4 Implement COF-active card branch: call `cofService.enrollCard(params)` and build `buildSavedCardPaymentMethod(cardId)`; never call `tokenizer.collect()` in this branch directly.
- [x] 2.5 Wrap only `directApiService.processPayment()` in `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts`; on pre-body throw after auto-enrollment, best-effort `cardService.removeCard(...)`, swallow remove errors, rethrow original process error.

## Phase 3: REFACTOR / verification

- [x] 3.1 Refactor duplicated auth/contact mapping between public `enrollCard()` and auto-pay helper without changing exports or public API.
- [x] 3.2 Run targeted verification only: `vitest run src/tonder.pay.test.ts`; do not build.
