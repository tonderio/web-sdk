# Delta for Public API

## ADDED Requirements

### Requirement: Public object fields use snake_case

All public object fields accepted or returned by the SDK MUST use `snake_case`.
JavaScript method and class names MUST remain camelCase. Public config,
payment inputs, customer/session payloads, public errors, component options,
component event payloads, customization payloads, cards, enrollment results,
and payment-method discovery payloads MUST NOT expose camelCase field names.
Protocol/control fields that are not merchant-authored SDK payloads are exempt
when they are part of an external integration contract; specifically, embedded
payflow completion MUST keep `postMessage({ event })`.

#### Scenario: Config and payment input use snake_case fields
- GIVEN a merchant initializes the SDK with `return_url`,
  `presentation_mode`, `session.secure_token`, `session.customer.first_name`,
  and `session.customer.last_name`
- WHEN the SDK validates the config or a payment input
- THEN the snake_case fields are accepted
- AND camelCase field names are not part of the public contract

#### Scenario: Method names remain camelCase
- GIVEN a merchant inspects the SDK facade
- WHEN they look for public methods
- THEN method names such as `createTonder` and `getTransaction` remain camelCase
- AND object payload fields still use snake_case

#### Scenario: Public errors use snake_case fields

- GIVEN a public SDK method rejects with `AppError`
- WHEN the merchant inspects the error
- THEN the error exposes `status_code`
- AND nested details expose `system_error`
- AND camelCase aliases are not part of the public contract

#### Scenario: Embedded payflow bridge keeps event control field

- GIVEN embedded payflow posts a completion signal to the SDK iframe parent
- WHEN the SDK receives the message
- THEN the message shape still uses `{ event: 'checkout.completed' | 'checkout.failed' }`
- AND the SDK does not require `event_name`
