# Delta for public-api

## MODIFIED Requirements

### Requirement: Customer is config-only and required to pay

`pay()` MUST NOT accept a `customer` argument or field. `pay()` MUST source the customer exclusively from `config.session.customer`. When `config.session.customer` is absent, `pay()` MUST throw `MISSING_CUSTOMER` before any network call. The `/process` request body MUST carry `{ name, email }`, where `name` is derived by joining `first_name` and `last_name` from `config.session.customer`. `PayInput.client_reference` MUST be required. `PayInput.idempotency_key`, when provided, MUST be sent as the Direct API `X-Request-Id` header for `POST /api/v1/process/`. When `idempotency_key` is omitted, the SDK MUST omit `X-Request-Id` entirely. The SDK MUST NOT generate a random idempotency key and MUST NOT fall back from `client_reference` to `X-Request-Id`.

(Previously: `PayInput.client_reference` was optional and no explicit idempotency key field existed on the public input.)

#### Scenario: pay() with a configured customer sends a derived name and email

- GIVEN `config.session.customer = { email: 'a@b.com', first_name: 'Ana', last_name: 'Ruiz' }`
- WHEN a merchant calls `pay(...)` without any customer argument
- THEN the `/process` request body includes `{ name: 'Ana Ruiz', email: 'a@b.com' }`

#### Scenario: pay() without a configured customer throws before any network call

- GIVEN the SDK config has no `session.customer` set
- WHEN a merchant calls `pay(...)`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no request is sent to `/process`

#### Scenario: pay() input has no customer field

- GIVEN the `pay()` input type
- WHEN a merchant inspects its accepted fields
- THEN no `customer` field exists on the pay input
- AND passing one is a type error, not a supported override

#### Scenario: pay() requires a business reference and can carry idempotency separately

- GIVEN a merchant prepares a `PayInput`
- WHEN they inspect the required fields
- THEN `client_reference` is mandatory
- AND `idempotency_key` is optional and maps only to `X-Request-Id`

#### Scenario: pay() omits X-Request-Id when no idempotency key is provided

- GIVEN a valid pay request with `client_reference` set and no `idempotency_key`
- WHEN the SDK calls `POST /api/v1/process/`
- THEN the request does not include `X-Request-Id`
- AND the SDK does not synthesize a replacement value

#### Scenario: pay() does not use client_reference as idempotency

- GIVEN a valid pay request with `client_reference` set and no `idempotency_key`
- WHEN the SDK calls `POST /api/v1/process/`
- THEN `client_reference` is present only in the payment payload
- AND `X-Request-Id` is absent
