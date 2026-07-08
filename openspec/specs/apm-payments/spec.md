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

### Requirement: pay() Validates APM Input

The system MUST validate APM-specific inputs before issuing any network call.

- Missing/empty `paymentMethod.type` → MUST reject with `AppError(INVALID_PAYMENT_REQUEST)`.
- Legacy wrapper `paymentMethod: { type: 'apm', apm: '<method>' }` → MUST reject with `AppError(INVALID_PAYMENT_REQUEST)`; callers MUST pass the method code directly.
- `type` is `safetypaycash` or `safetypaytransfer` with missing/incomplete `config` (must have `country`, `channel`, and `bank_ids`) → MUST reject with `AppError(INVALID_APM_CONFIG)`.
- All other APMs pass `apm_config` through to the request unvalidated (v1 scope).
