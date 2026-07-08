# Tasks: Standardize Public Payloads to snake_case

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 450–650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: SDK public contract + tests; PR 2: zplit-back checkout JWT; PR 3: spa-midd-checkout redirect guards |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Decision: User chose reviewable work-unit commits instead of chained PRs; proceed as a size exception while keeping each repo/scope in its own commit.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Lock the SDK public snake_case contract | PR 1 | `/Volumes/MacDev/Tonder/SDKs/tonder-js` only; add failing tests first, then runtime/type updates. |
| 2 | Propagate embedded checkout redirect metadata | PR 2 | `/Volumes/MacDev/Tonder/zplit-back/zplit_back` only; carry `presentation_mode` and mint `extra_data.needs_redirect=false`. |
| 3 | Prevent embedded iframe redirects in checkout UI | PR 3 | `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout` only; guard both ProcessCheckout and ThreeDSPayment. |

## Phase 1: SDK Contract Foundation

- [x] 1.1 Update `src/shared/types/index.ts` so public config/session/customer/pay/card/error types expose snake_case fields and `PayInput` uses `return_url`.
- [x] 1.2 Update `src/tonder.ts` to read `environment`, `presentation_mode`, and `pay({ return_url })` while preserving camelCase method names.
- [x] 1.3 Update `src/models/card.model.ts` and `src/shared/errors/*` to return `card_id`, `card_number`, `status_code`, and `details.system_error`.

## Phase 2: SDK Behavior and Mapping

- [x] 2.1 Update `src/core/services/direct-api.service.ts` and `src/models/transaction.model.ts` usage so `RawTransaction` stays untouched and payment-method discovery returns `payment_method`.
- [x] 2.2 Wire embedded checkout event handlers to `events.presentation.on_open` and `on_close`; keep `postMessage({ event })` unchanged.
- [x] 2.3 Refresh `README.md`, `e2e/`, and contract tests to remove stale camelCase expectations and assert snake_case inputs/outputs.

## Phase 3: Backend Checkout Hand-off

- [x] 3.1 In `/Volumes/MacDev/Tonder/zplit-back/zplit_back`, carry SDK `presentation_mode` through checkout creation.
- [x] 3.2 Mint checkout JWTs with `extra_data.needs_redirect=false` for embedded flow and preserve current redirect behavior for non-embedded flow.

## Phase 4: Hosted Checkout Guardrails

- [x] 4.1 In `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout/src/modules/process/components/ProcessCheckout.tsx`, keep respecting `extra_data.needs_redirect` when deciding whether to redirect.
- [x] 4.2 In `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout/src/modules/tonder/components/ThreeDSPayment.tsx`, add the same `needs_redirect` guard so embedded 3DS stays inside the SDK iframe.

## Phase 5: Verification

- [x] 5.1 Add/adjust unit tests for snake_case config validation, payment input mapping, error shapes, and raw transaction passthrough.
- [x] 5.2 Add integration tests for `pay({ return_url })` and `getPaymentMethods()` public payload shape.
- [x] 5.3 Add cross-repo verification for embedded checkout so the iframe does not navigate on Tonder 3DS completion.
