# Public API Consistency Specification

## Purpose

Defines the unified public API surface for customer data, payment execution,
and mountable UI components in `@tonder.io/web-sdk`. Establishes ONE customer
shape, config-only customer sourcing for payments, a generic component
factory replacing verb-specific mount methods, and one type-suffix policy.

## Requirements

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

### Requirement: One Customer shape

The system MUST expose exactly ONE `Customer` shape — `{ email: string;
firstName?: string; lastName?: string; phone?: string }` — as the only
customer input accepted anywhere in the public API (config.session, customer-on-file
operations, enroll contact). No public method MUST accept an alternative or
duplicated customer shape.

#### Scenario: Config accepts the canonical Customer shape

- GIVEN a merchant initializes the SDK config with `session: { customer: { email, firstName, lastName, phone } }`
- WHEN the SDK validates the config
- THEN the customer object is accepted with no shape mismatch

#### Scenario: No alternate customer shape exists elsewhere in the public API

- GIVEN a merchant inspects the SDK's public types and methods
- WHEN they look for a customer-shaped input outside of `config.session.customer`
- THEN no public method accepts a different or duplicated customer shape

### Requirement: Customer is config-only and required to pay

`pay()` MUST NOT accept a `customer` argument or field. `pay()` MUST source
the customer exclusively from `config.session.customer`. When `config.session.customer` is
absent, `pay()` MUST throw `MISSING_CUSTOMER` before any network call. The
`/process` request body MUST carry `{ name, email }`, where `name` is derived
by joining `first_name` and `last_name` from `config.session.customer`.
`PayInput.client_reference` MUST be required and remain in the `/process` body
as the merchant business reference. `PayInput.idempotency_key`, when provided,
MUST be sent as the Direct API `X-Request-Id` header for `POST /api/v1/process/`.
When `idempotency_key` is omitted, the SDK MUST omit `X-Request-Id` entirely.
The SDK MUST NOT generate a random idempotency key and MUST NOT fall back from
`client_reference` to `X-Request-Id`.

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

### Requirement: Customer is optional at initialization and required only for customer-dependent flows

The system MUST allow `createTonder()` to be called without `session.customer` so read-only flows can initialize on a return_url page. The system MUST still require customer context for customer-dependent operations: `pay()`, `enrollCard()`, `getCustomerCards()`, `removeCustomerCard()`, and any COF/customer path that derives from those operations. Those methods MUST throw `MISSING_CUSTOMER` before any network call when customer context is absent.
(Previously: `session.customer` was required broadly for pay and card operations, which implied initialization itself needed customer context.)

#### Scenario: Read-only initialization without customer is allowed

- GIVEN a merchant calls `createTonder()` with no `session.customer`
- WHEN the SDK initializes for read-only usage
- THEN initialization succeeds
- AND `getTransaction()` remains available for later use

#### Scenario: pay() still requires customer context

- GIVEN the SDK was created without `session.customer`
- WHEN a merchant calls `pay()`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no payment network call is made

#### Scenario: COF customer flows still require customer context

- GIVEN the SDK was created without `session.customer`
- WHEN a merchant calls `enrollCard()`, `getCustomerCards()`, or `removeCustomerCard()`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no customer/COF network call is made

### Requirement: Component factory replaces verb-specific mount methods

The system MUST expose mountable UI exclusively through `tonder.create(type,
options)`, returning a component handle with `mount()` and
`unmount()`. `mountCardFields`, `unmountCardFields`, `revealCardFields`, and
any other verb-specific mount/unmount/reveal method MUST NOT exist on the
public facade. Multiple component instances MUST be able to coexist with
independently scoped state.

#### Scenario: Creating and mounting a card-fields component

- GIVEN a merchant calls `tonder.create('cardFields', options)`
- WHEN they call `.mount()` on the returned handle
- THEN the card fields render inside the per-field containers declared in `options.fields`
- AND calling `.unmount()` on the same handle tears down only that instance

#### Scenario: Verb-specific mount methods are absent from the public facade

- GIVEN a merchant inspects the SDK's public facade
- WHEN they look for `mountCardFields`, `unmountCardFields`, or `revealCardFields`
- THEN none of these methods exist

#### Scenario: Multiple components coexist independently

- GIVEN a merchant creates a `cardFields` component for a new card
- AND separately creates a component for a saved card's CVV field
- WHEN both are mounted at the same time
- THEN each maintains independent scoped state
- AND unmounting one does not affect the other

### Requirement: One type-suffix policy and no dead public types

The system MUST apply one consistent type-suffix policy across public
request/response types. `PublicSuccess` and `PublicError` MUST NOT be
exported. `getPaymentMethodBanks()` MUST return a named `PaymentMethodBanks` type containing `PaymentMethodBank[]`, not an
anonymous inline shape.

#### Scenario: getPaymentMethodBanks returns a named type

- GIVEN a merchant calls `getPaymentMethodBanks()`
- WHEN they inspect the return type in the SDK's type declarations
- THEN the return type is a named `PaymentMethodBanks` type, not an anonymous object literal

#### Scenario: Dead types are not part of the public surface

- GIVEN a merchant inspects the SDK's exported public types
- WHEN they look for `PublicSuccess` or `PublicError`
- THEN neither type is exported
