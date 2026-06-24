# APM Payments Specification

## Purpose

Extends `pay()` to support alternative payment methods (APM) and SPEI. APMs settle asynchronously via webhook — the SDK MUST NOT poll them to a final status in-session. Introduces the `pending` PayResult variant and the pure `apm.strategy` builders.

## Requirements

### Requirement: APM Payment Method Builders

The system MUST provide two pure builder functions in `apm.strategy`:

- `buildApmPaymentMethod(apm, config?)` → `{ type: apm.toLowerCase(), apm_config?: object }` — `apm_config` MUST be included only when `config` has at least one key.
- `buildSpeiPaymentMethod()` → `{ type: 'spei' }` (no config).

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

#### Scenario: buildSpeiPaymentMethod

- GIVEN no arguments
- WHEN `buildSpeiPaymentMethod()` is called
- THEN it returns `{ type: 'spei' }`

---

### Requirement: pay() Validates APM Input

The system MUST validate APM-specific inputs before issuing any network call.

- `type: 'apm'` with missing or empty `apm` field → MUST reject with `AppError(INVALID_PAYMENT_REQUEST)`.
- `type: 'apm'` where `apm` is `safetypaycash` or `safetypaytransfer` with missing/incomplete `apm_config` (must have `country`, `channel`, and `bank_ids`) → MUST reject with `AppError(INVALID_APM_CONFIG)`.
- All other APMs pass `apm_config` through to the request unvalidated (v1 scope).
