# Delta for web-sdk — Embedded 3DS Request Flag

## ADDED Requirements

### Requirement: ProcessPaymentBody includes optional embedded_completion flag

`ProcessPaymentBody` MUST include `embedded_completion?: boolean` as an optional top-level field.
The field is absent when the mode is redirect; it is present and `true` only when the SDK is in embedded 3DS mode.

#### Scenario: embedded mode sets the flag

- GIVEN the SDK is configured with `threeDsMode === 'embedded'`
- WHEN `buildProcessBody()` is called
- THEN the returned object includes `embedded_completion: true`

#### Scenario: redirect mode omits the flag

- GIVEN the SDK is configured with `threeDsMode === 'redirect'` or `threeDsMode` is not set (default)
- WHEN `buildProcessBody()` is called
- THEN the returned object does NOT contain the key `embedded_completion` (key absent, not `false`)

#### Scenario: card payment shape is unchanged

- GIVEN any `threeDsMode` value
- WHEN `buildProcessBody()` is called with a card payment method
- THEN all existing fields (`operation_type`, `amount`, `currency`, `return_url`, `customer`, `payment_method`) are present and unchanged

#### Scenario: saved-card and APM payment shapes are unchanged

- GIVEN any `threeDsMode` value
- WHEN `buildProcessBody()` is called with a saved-card or APM payment method
- THEN all existing fields are present and unchanged (regression guard)
