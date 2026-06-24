# Change: apm-payments — alternative payment methods (APMs: getPaymentMethods, getApmBanks, apm/spei pay())

## Intent
Add alternative payment method support to the headless v1 SDK: discover available methods, list SafetyPay
banks, and pay with APM/SPEI. This is the LAST functional block for SDK v1. APMs settle asynchronously
(SPEI/OXXO via webhook, not in-session), so the SDK must NOT poll APMs to a final status.

## Why now
`pay()` only handles `card`/`savedCard`. The backend already exposes payment-method discovery, SafetyPay
banks, and APM/SPEI processing via Direct API. Closing this completes the v1 payment surface.

## What changes (two slices)
**Slice A — read-only discovery (zero risk to `pay()`):**
- `getPaymentMethods()` → `GET /api/v1/payment_methods?status=active` (Token apiKey header) →
  map to public `PaymentMethodInfo[]` (camelCase: `id`, `paymentMethod`, `acquirer`, `status`, `priority`,
  `category`, `unavailableCountries`).
- `getApmBanks()` → `GET /api/v1/safetypay/banks/{apiKey}/` (apiKey in PATH, not header) →
  `{ cash: ApmBank[]; transfer: ApmBank[] }` (camelCase, snake_case mapped at adapter/model).

**Slice B — APM/SPEI `pay()` + pending result model:**
- New pure `apm.strategy`: `buildApmPaymentMethod({apm, config?})` → `{ type: <apm lowercased>, apm_config? }`;
  `buildSpeiPaymentMethod()` → `{ type: 'spei' }`.
- `resolvePaymentMethod` branches for `paymentMethod.type` `'apm'` and `'spei'`; extend
  `ProcessPaymentBody.payment_method` union.
- SafetyPay config validation (`country`, `channel`, `bank_ids`) → `INVALID_APM_CONFIG`.
- NEW `PayResult` variant `pending` for async APMs, carrying `transaction`, optional `nextAction.url`,
  `paymentInstructions`, `voucher`, `clabe`, `bankName`. Extend `BackendTransactionResponse` with
  `payment_instructions`, `voucher_pdf`, `clabe`, `bank_name`.
- `handleApmResult`: reuse `ThreeDsHostPort` ONLY to present `nextAction.url` — `redirect` mode →
  `host.redirect(url)`; `embedded` mode → `host.mountIframe(url, containerId)`. Return `pending` unchanged.
  **NO `pollTransaction`** for APMs. Card 3DS keeps `requires_action` + poll, untouched.

## Pending-result decision (vs reusing requires_action)
A new `pending` variant is introduced rather than reusing `requires_action`. Rationale: `requires_action`
semantics mean "act, then poll to final in-session" (card 3DS). APMs NEVER reach a final status in-session
(webhook settlement, hours/days). Overloading `requires_action` would force callers to distinguish two
incompatible lifecycles on one variant and risk the embedded auto-poll firing on an APM. A distinct
`pending` variant makes the async contract explicit and keeps the card poll path isolated.

## Error codes
- ADD `FETCH_APM_BANKS_ERROR` — SafetyPay banks fetch failure.
- ADD `INVALID_APM_CONFIG` — APM config validation failure (SafetyPay missing `country`/`channel`/`bank_ids`).
- CONFIRMED existing: `FETCH_PAYMENT_METHODS_ERROR` (already in `ErrorKeyEnum`, line 28 — reuse, do NOT add).

## Capabilities
### New Capabilities
- `payment-method-discovery`: list available payment methods and SafetyPay banks (Slice A).
- `apm-payments`: pay with APM/SPEI, async `pending` result model, APM nextAction presentation (Slice B).

### Modified Capabilities
None at spec level beyond the two new capabilities. (`PayResult` gains a variant — covered by `apm-payments`.)

## Affected areas
| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/types/index.ts` | Modified | Add `PaymentMethodInfo`, `ApmBank`; APM/SPEI `PaymentMethod` union members. |
| `src/shared/errors/ErrorKeyEnum.ts` | Modified | Add `FETCH_APM_BANKS_ERROR`, `INVALID_APM_CONFIG`. |
| `src/models/transaction.model.ts` | Modified | APM fields on `BackendTransactionResponse`; `pending` `PayResult` variant + `mapPayResult`. |
| `src/core/strategies/apm.strategy.ts` | New | Pure `buildApmPaymentMethod`, `buildSpeiPaymentMethod`. |
| `src/core/services/direct-api.service.ts` | Modified | `getPaymentMethods()`, `getApmBanks()`; extend `ProcessPaymentBody` union. |
| `src/tonder.ts` | Modified | Public `getPaymentMethods()`, `getApmBanks()`; `resolvePaymentMethod` + `handleApmResult`. |

## Hard constraints
- No internal vendor names (Skyflow/Kushki) in any return value, error code, or message. APM product names
  (`spei`, `oxxopay`, `mercadopago`, `safetypaycash`, `safetypaytransfer`, `neosurf`) and `payflow` are
  Tonder's own — acceptable.
- Public surface camelCase, no `I`-prefix; backend snake_case mapped at adapters/models.
- `core/` stays PURE (no DOM/HTTP/external-SDK imports); `apm.strategy` is pure functions only.

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Embedded auto-poll fires on an APM | Med | Distinct `pending` variant + dedicated `handleApmResult` with NO poll call; covered by tests. |
| `apiKey`-in-path leaks via header path | Low | `getApmBanks` builds path explicitly; unit test asserts URL shape and absence of header auth. |
| APM `apm_config` shape drift | Low | Validate SafetyPay required keys before send → `INVALID_APM_CONFIG`. |

## Non-goals
- In-session APM settlement / final-status resolution (webhook-driven; merchant uses `getTransaction`).
- B2 CheckoutMessenger / payflow-wrapped completion signal (future embedded enhancement).
- Polling APMs to final status in any mode.

## Rollback plan
Slices are independent. Revert Slice B commits to remove APM/SPEI `pay()` and the `pending` variant while
keeping Slice A discovery. Revert Slice A commits to drop discovery entirely. `card`/`savedCard` flows are
untouched, so either rollback leaves existing payment behavior intact.

## Dependencies
- `ThreeDsHostPort` / `Browser3dsHost` (from threeds-presentation, already merged) — reused for APM nextAction.

## Success criteria
- [ ] `getPaymentMethods()` returns mapped `PaymentMethodInfo[]`; failure → `FETCH_PAYMENT_METHODS_ERROR`.
- [ ] `getApmBanks()` returns `{ cash, transfer }` `ApmBank[]` via apiKey-in-path; failure → `FETCH_APM_BANKS_ERROR`.
- [ ] `pay()` with `type:'apm'`/`'spei'` builds the `/process` block via `apm.strategy` and returns `pending`.
- [ ] APM `nextAction.url` is presented (redirect/embedded) with NO `pollTransaction`; card 3DS unchanged.
- [ ] Invalid SafetyPay config → `INVALID_APM_CONFIG`.
- [ ] No vendor names leak; public camelCase / no I-prefix; `core/` pure. Gates green (typecheck, lint, build, `vitest run`).

## Delivery
Slice A then Slice B as separate apply batches; work-unit commits on `feature/DEV-2245`. STRICT TDD active.
