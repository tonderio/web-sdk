# Public API Consistency Specification

## Purpose

Defines the unified public API surface for customer data, payment execution,
and mountable UI components in `@tonder.io/web-sdk`. Establishes ONE customer
shape, config-only customer sourcing for payments, a generic component
factory replacing verb-specific mount methods, and one type-suffix policy.

## Requirements

### Requirement: One Customer shape

The system MUST expose exactly ONE `Customer` shape — `{ email: string;
firstName?: string; lastName?: string; phone?: string }` — as the only
customer input accepted anywhere in the public API (config, customer-on-file
operations, enroll contact). No public method MUST accept an alternative or
duplicated customer shape.

#### Scenario: Config accepts the canonical Customer shape

- GIVEN a merchant initializes the SDK config with `customer: { email, firstName, lastName, phone }`
- WHEN the SDK validates the config
- THEN the customer object is accepted with no shape mismatch

#### Scenario: No alternate customer shape exists elsewhere in the public API

- GIVEN a merchant inspects the SDK's public types and methods
- WHEN they look for a customer-shaped input outside of `config.customer`
- THEN no public method accepts a different or duplicated customer shape

### Requirement: Customer is config-only and required to pay

`pay()` MUST NOT accept a `customer` argument or field. `pay()` MUST source
the customer exclusively from `config.customer`. When `config.customer` is
absent, `pay()` MUST throw `MISSING_CUSTOMER` before any network call. The
`/process` request body MUST carry `{ name, email }`, where `name` is derived
by joining `firstName` and `lastName` from `config.customer`.

#### Scenario: pay() with a configured customer sends a derived name and email

- GIVEN `config.customer = { email: 'a@b.com', firstName: 'Ana', lastName: 'Ruiz' }`
- WHEN a merchant calls `pay(...)` without any customer argument
- THEN the `/process` request body includes `{ name: 'Ana Ruiz', email: 'a@b.com' }`

#### Scenario: pay() without a configured customer throws before any network call

- GIVEN the SDK config has no `customer` set
- WHEN a merchant calls `pay(...)`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no request is sent to `/process`

#### Scenario: pay() input has no customer field

- GIVEN the `pay()` input type
- WHEN a merchant inspects its accepted fields
- THEN no `customer` field exists on the pay input
- AND passing one is a type error, not a supported override

### Requirement: Component factory replaces verb-specific mount methods

The system MUST expose mountable UI exclusively through `tonder.create(type,
options)`, returning a component handle with `mount(container?)` and
`unmount()`. `mountCardFields`, `unmountCardFields`, `revealCardFields`, and
any other verb-specific mount/unmount/reveal method MUST NOT exist on the
public facade. Multiple component instances MUST be able to coexist with
independently scoped state.

#### Scenario: Creating and mounting a card-fields component

- GIVEN a merchant calls `tonder.create('cardFields', options)`
- WHEN they call `.mount(container)` on the returned handle
- THEN the card fields render inside the container
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
exported. `getApmBanks()` MUST return a named `ApmBanks` type, not an
anonymous inline shape.

#### Scenario: getApmBanks returns a named type

- GIVEN a merchant calls `getApmBanks()`
- WHEN they inspect the return type in the SDK's type declarations
- THEN the return type is a named `ApmBanks` type, not an anonymous object literal

#### Scenario: Dead types are not part of the public surface

- GIVEN a merchant inspects the SDK's exported public types
- WHEN they look for `PublicSuccess` or `PublicError`
- THEN neither type is exported
