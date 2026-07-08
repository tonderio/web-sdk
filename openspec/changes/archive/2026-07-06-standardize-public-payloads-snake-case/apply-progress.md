# Apply Progress: SDK slice — Standardize Public Payloads to snake_case

**Change**: `standardize-public-payloads-snake-case`  
**Slice**: SDK work unit only (`/Volumes/MacDev/Tonder/SDKs/tonder-js`)  
**Mode**: Strict TDD  
**Delivery**: `exception-ok` / `size:exception`; user chose work-unit commits. No commit or staging performed.

## Completed Tasks

- [x] 1.1 Updated public config/session/customer/pay/card/error types to expose snake_case fields; `PayInput` now uses `return_url` and `payment_method`.
- [x] 1.2 Updated the SDK facade to read `environment`, `presentation_mode`, `session.secure_token`, `pay({ return_url })`, and snake_case customer fields while keeping method names camelCase.
- [x] 1.3 Updated saved-card and public error shapes to return `card_id`, `card_number`, `status_code`, and `details.system_error` without camelCase public aliases.
- [x] 2.1 Updated payment-method discovery to return `payment_method`; preserved `RawTransaction` passthrough and raw `next_action` access.
- [x] 2.2 Wired presentation callbacks from `events.presentation.on_open` and `on_close`; embedded bridge `postMessage({ event })` remains unchanged.
- [x] 2.3 Refreshed README, e2e fixtures/tests/types, and contract tests to use snake_case public payloads.
- [x] 5.1 Added/adjusted unit tests for snake_case config validation, payment input mapping, error shapes, saved-card shapes, and raw transaction passthrough coverage.
- [x] 5.2 Added/adjusted integration-style facade/service tests for `pay({ return_url })` and `getPaymentMethods()` public payload shape.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `src/tonder.snake-case-contract.test.ts`, `src/types/card.test.ts` | Unit/type contract | Existing targeted tests initially failed under old contract | ✅ Written first; new snake_case config/pay test failed on `config.apiKey` validation | ✅ Passed after public type/facade updates | ✅ Config + pay input + no-alias assertions | ✅ Tests and types cleaned; typecheck green |
| 1.2 | `src/tonder.pay.test.ts`, `src/tonder.handleRequiresAction.test.ts` | Unit/facade integration | Targeted facade tests run during cycle | ✅ Snake_case facade test required `environment`, `presentation_mode`, and `return_url` | ✅ Passed after facade mapping updates | ✅ Covered card, saved-card, APM, redirect, embedded modes | ✅ Removed config `return_url` dependency; kept methods camelCase |
| 1.3 | `src/tonder.snake-case-contract.test.ts`, `src/models/card.model.test.ts`, error tests | Unit | Targeted model/error tests run during cycle | ✅ Tests expected `card_id`, `status_code`, `details.system_error` and failed on old aliases | ✅ Passed after model/error updates | ✅ Covered non-null/null card fields and error status/system details | ✅ Error normalization kept method names camelCase while public fields are snake_case |
| 2.1 | `src/core/services/direct-api.service.test.ts`, `src/tonder.getPaymentMethods.test.ts` | Unit/service | Targeted payment-method tests run during cycle | ✅ Tests expected `payment_method` and failed on old `paymentMethod` | ✅ Passed after mapping update | ✅ Covered service and facade discovery paths | ✅ Raw transaction model left untouched |
| 2.2 | `src/tonder.handleRequiresAction.test.ts`, `src/tonder.pay.test.ts` | Unit/facade integration | Embedded presentation tests run during cycle | ✅ Tests required `events.presentation.on_open/on_close` wiring | ✅ Passed after callback access update | ✅ Covered embedded 3DS and embedded APM user-close paths | ✅ Kept bridge messenger `{ event }` unchanged |
| 2.3 | README/e2e/typecheck | Docs/e2e contract | Typecheck run after e2e updates | ✅ Stale docs/e2e usages identified via grep and typecheck | ✅ Typecheck passed after docs/e2e refresh | ✅ Covered card, APM, 3DS, COF e2e examples | ✅ Removed config-level `return_url` from docs/fixtures |
| 5.1 | All targeted unit tests | Unit | Full Vitest suite before final status | ✅ Contract tests written before implementation | ✅ `npm test` passed | ✅ 284 passing tests cover multiple behavior paths | ✅ No build artifact changes |
| 5.2 | Facade/service tests | Unit/integration-style | Typecheck and full Vitest suite | ✅ Integration-style expectations failed before mapping updates | ✅ `npm test` and `npm run typecheck -- --pretty false` passed | ✅ `pay({ return_url })` and discovery shape covered | ✅ Kept verification targeted to SDK repo |

## Verification

Commands run:

1. `npm test -- src/tonder.snake-case-contract.test.ts` — RED first: 4 failing tests under old camelCase contract.
2. `npx tsc --noEmit --pretty false` — intermediate type safety check after production changes.
3. `npm test -- src/tonder.snake-case-contract.test.ts` — GREEN for new contract tests.
4. `npm test -- src/tonder.pay.test.ts src/tonder.getPaymentMethods.test.ts src/models/card.model.test.ts src/core/services/direct-api.service.test.ts src/tonder.enrollCard.test.ts src/tonder.getCustomerCards.test.ts src/tonder.handleRequiresAction.test.ts` — intermediate targeted suite; failures guided test/docs updates.
5. `npm test -- src/tonder.snake-case-contract.test.ts src/tonder.getPaymentMethods.test.ts src/models/card.model.test.ts src/core/services/direct-api.service.test.ts` — passed.
6. `npm test -- src/tonder.pay.test.ts src/tonder.handleRequiresAction.test.ts src/tonder.enrollCard.test.ts src/tonder.getCustomerCards.test.ts src/tonder.customer.test.ts src/tonder.removeCustomerCard.test.ts src/tonder.getTransaction.test.ts src/tonder.getPaymentMethodBanks.test.ts src/tonder.test.ts src/types/card.test.ts` — passed after callback/enrollment expectations were updated.
7. `npm test -- src/tonder.create.test.ts src/tonder.test.ts src/adapters/http/fetch-http.client.test.ts src/shared/utils/poll.test.ts src/core/services/customer.service.test.ts src/core/services/card.service.test.ts src/core/services/cof.service.test.ts` — passed.
8. `npm run typecheck -- --pretty false` — passed.
9. `npm test` — passed: 30 test files, 284 tests.

## Notes / Deviations

- `RawTransaction` and `toRawTransaction()` were not renamed; raw backend fields remain passthrough.
- Internal service/acquirer parameter names such as `apiKey`, `cardId`, `secureToken`, and `subscriptionId` remain camelCase where they are not public SDK object payload fields.
- `postMessage({ event })` remains unchanged via the existing `BrowserCheckoutMessenger` contract.
- External repos `zplit-back` and `spa-midd-checkout` were not edited.

---

# Apply Progress: External slices — Embedded redirect hand-off

**Mode**: Work-unit commits / `size:exception` accepted by user.  
**Contract decision**: SDK sends `X-Presentation-Mode`; zplit-back treats that header as the trusted source for `checkout_data.presentation_mode` and mints embedded checkout JWTs with `extra_data.needs_redirect=false`.

## Completed Tasks

- [x] 3.1 zplit-back `DirectProcessView` reads `X-Presentation-Mode` and `DirectPaymentService` carries `presentation_mode` into checkout data.
- [x] 3.2 zplit-back `Checkout.generate_checkout_token()` merges provider `extra_data` with `needs_redirect=false` for embedded mode only.
- [x] 4.1 spa-midd-checkout keeps using `extra_data.needs_redirect` in `ProcessCheckout.redirectToReturnUrl()`.
- [x] 4.2 spa-midd-checkout passes `needsRedirect` into `ThreeDSPayment`, which no longer redirects when `needsRedirect === false`.
- [x] 5.3 Cross-repo verification added through zplit-back focused tests and hosted-checkout typecheck/lint; SDK direct-api tests now assert `X-Presentation-Mode` is sent.

## Verification

- SDK: `npm test -- src/core/services/direct-api.service.test.ts src/tonder.snake-case-contract.test.ts src/tonder.pay.test.ts` — passed.
- SDK: `npm run typecheck -- --pretty false` — passed.
- zplit-back: `python3 -m py_compile ...` — passed; pytest blocked locally because `pytest` is unavailable.
- hosted-checkout: `npx tsc --noEmit` — passed.
- hosted-checkout: `npm run lint` — passed with pre-existing unrelated warning in `src/modules/unlimit/components/Payment.tsx`.

## Notes

- The body still carries `presentation_mode` for SDK-side traceability, but zplit-back does not trust body input; it derives the persisted value from `X-Presentation-Mode`.
- Raw transaction fields and embedded `postMessage({ event })` remain unchanged.

---

## Remediation Notes — SDK verifier failures (2026-07-06)

Scope: SDK repo only. No changes were made to `zplit-back` or `hosted-checkout`, and no files were staged or committed.

### Remediated Failures

- Public component/customization/options payloads now use snake_case object fields:
  - `CardFieldState` emits `element_type`, `is_empty`, `is_focused`, and `is_valid`.
  - `CardFieldEvents` accepts `on_change`, `on_blur`, `on_focus`, and `on_ready`.
  - `CardFieldsOptions` accepts `card_id`, `unmount_context`, and `container_id` field overrides.
  - `RevealCardField` accepts `container_id` and `alt_text`.
  - `TonderCustomization` accepts `card_fields`, `card_form`, `input_styles`, `label_styles`, `error_styles`, `error_messages`, `enable_card_icon`, and snake_case per-field keys.
- RawTransaction e2e assertions no longer expect forbidden camelCase aliases:
  - Replaced `paymentInstructions`, `bankName`, `nextAction`, `declineCode`, and `declineReason` assertions with raw snake_case assertions plus no-alias checks.
  - `RawTransaction` passthrough implementation remains unchanged.
- SDK lint failures were fixed:
  - Removed the unused e2e fixture `return_url` config plumbing.
  - Removed the stale `no-new-func` eslint-disable directive.
  - Replaced the unsafe optional-chain non-null assertion in `buildProcessBody()` with an explicit `MISSING_CUSTOMER` guard.

### Remediation Verification

- `npm test -- --run src/types/card.test.ts src/tonder.snake-case-contract.test.ts src/tonder.create.test.ts src/adapters/skyflow/skyflow.adapter.test.ts` — passed: 61 tests.
- `npm test -- --run src/types/card.test.ts src/tonder.snake-case-contract.test.ts src/tonder.create.test.ts src/adapters/skyflow/skyflow.adapter.test.ts src/tonder.pay.test.ts src/tonder.handleRequiresAction.test.ts` — passed: 134 tests.
- `npm test -- --run src/tonder.test.ts src/tonder.create.test.ts src/types/card.test.ts src/adapters/skyflow/skyflow.adapter.test.ts src/tonder.snake-case-contract.test.ts` — passed: 71 tests.
- `npm run typecheck -- --pretty false` — passed.
- `npm run lint` — passed.
- `npx playwright test e2e/tests/apms.spec.ts e2e/tests/card-pay.spec.ts` — passed with 6 skipped because stage credentials are not present.
- `git diff --check` — passed.
