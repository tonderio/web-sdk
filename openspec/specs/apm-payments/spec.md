# APM Payments Specification

## Purpose

Extends `pay()` to support alternative payment methods (APM) and SPEI. APMs settle asynchronously via webhook — the SDK MUST NOT poll them to a final status in-session. Alternative methods are passed directly as `paymentMethod.type` values and settle asynchronously via webhook.

## Requirements

### Requirement: APM Payment Method Builders

The system MUST provide a pure builder function in `apm.strategy`:

- `buildApmPaymentMethod(apm, config?)` → `{ type: apm.toLowerCase(), apm_config?: object }` — `apm_config` MUST be included only when `config` has at least one key.

No I/O, no side effects; builders MUST be pure functions.

#### Scenario: buildApmPaymentMethod with config

- GIVEN `apm = 'SafetyPayCash'` and `config = { country: 'PE', channel: 1, bank_ids: [1] }`
- WHEN `buildApmPaymentMethod(apm, config)` is called
- THEN it returns `{ type: 'safetypaycash', apm_config: { country: 'PE', channel: 1, bank_ids: [1] } }`

#### Scenario: buildApmPaymentMethod without config

- GIVEN `apm = 'OxxoPay'` and no config argument
- WHEN `buildApmPaymentMethod(apm)` is called
- THEN it returns `{ type: 'oxxopay' }` with no `apm_config` key present

#### Scenario: buildApmPaymentMethod with empty config

- GIVEN `apm = 'Neosurf'` and `config = {}`
- WHEN `buildApmPaymentMethod(apm, config)` is called
- THEN it returns `{ type: 'neosurf' }` with no `apm_config` key present (empty config suppressed)

---

### Requirement: APM Payments Follow the Business Engine

For a business with `core_payments_enabled === true` (strictly the boolean), the system MUST send `oxxopay`, `mercadopago`, `safetypaycash`, `safetypaytransfer`, `neosurf`, `qr` and `transfer` (any case) to the transactions API's process route with `payment_method.type` as written (never re-cased) and `apm_config` unchanged; case MUST NOT change the engine. Any other code (SPEI, unknown) and every payment of another business MUST keep the Direct API route with the code as written. The answer is handled as the Direct API's: `next_action.redirect_to_url.url` is redirected or opened per `presentation_mode`, `display_*` data is returned untouched, the SDK never polls and has no verify call, and `getTransaction` reads the engine that created the payment. The transactions API stores and answers the type upper-case (a declared difference from the Direct API, which echoes the merchant's spelling): `getTransaction` and webhooks carry `OXXOPAY` for a payment sent as `oxxopay`; the SDK sends the code as written and does not re-case it. A failure is never retried on the other engine.

#### Scenario: OXXO for a core business

- GIVEN `core_payments_enabled` is `true`
- WHEN `pay({ payment_method: { type: 'oxxopay' } })` runs
- THEN `POST /transactions/v1/process` carries `payment_method: { type: 'oxxopay' }` and no Direct API call is made

#### Scenario: OXXO for any other business

- GIVEN `core_payments_enabled` is absent, `false` or not the boolean `true`
- WHEN `pay({ payment_method: { type: 'oxxopay' } })` runs
- THEN `POST /api/v1/process/` carries `payment_method: { type: 'oxxopay' }`

---

### Requirement: pay() Validates APM Input

The system MUST validate APM-specific inputs before issuing any network call.

- Missing/empty `paymentMethod.type` → MUST reject with `AppError(INVALID_PAYMENT_REQUEST)`.
- Legacy wrapper `paymentMethod: { type: 'apm', apm: '<method>' }` → MUST reject with `AppError(INVALID_PAYMENT_REQUEST)`; callers MUST pass the method code directly.
- `type` is `safetypaycash` or `safetypaytransfer` with missing/incomplete `config` (must have `country`, `channel`, and `bank_ids`) → MUST reject with `AppError(INVALID_APM_CONFIG)`.
- All other APMs pass `apm_config` through to the request unvalidated (v1 scope).
