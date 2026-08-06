# Delta for Public API Consistency

## MODIFIED Requirements

### Requirement: Component factory replaces verb-specific mount methods

The system MUST expose mountable UI exclusively through `tonder.create(type,
options)`, returning a component handle with `mount()` and `unmount()`.
`mountCardFields`, `unmountCardFields`, `revealCardFields`, and any other
verb-specific mount/unmount/reveal method MUST NOT exist on the public
facade. Multiple component instances MUST be able to coexist with
independently scoped state. `create<T>()` MUST return the exact handle type
for the requested `T`, not a union of every possible handle. All component
handles MUST be built on a shared `TonderMountableComponent` base declaring
`mount(): Promise<void>` and `unmount(): void`, exported from
`src/index.ts` — by `extends` when the handle adds members of its own
(e.g. `CardFieldsComponent.reveal()`), or by type alias when it adds none,
since an empty `extends` interface would require an eslint suppression.
`ComponentOptionsByType` MUST be an explicit map keyed by
`TonderComponentType`, not `Record<TonderComponentType, CardFieldsOptions |
undefined>`. A component type MUST be added to `TonderComponentType`, to
`ComponentOptionsByType` and to `ComponentByType` only in the change that
implements its runtime — never ahead of it. Declaring a member the factory
cannot construct makes `create()` type-check and then throw.
`TonderComponentType` MUST include `'apple_pay_button'`, mapped in
`ComponentOptionsByType` to `ApplePayButtonOptions | undefined` and in
`ComponentByType` to `ApplePayButtonComponent`.
(Previously: did not specify per-type return narrowing, a shared handle
base, an explicit `ComponentOptionsByType` map, or a second component type
— `TonderComponentType` had exactly one member, `'card_fields'`.)

#### Scenario: Creating and mounting a card-fields component

- GIVEN a merchant calls `tonder.create('card_fields', options)`
- WHEN they call `.mount()` on the returned handle
- THEN the card fields render inside the per-field containers declared in `options.fields`
- AND calling `.unmount()` on the same handle tears down only that instance

#### Scenario: Creating and mounting the Apple Pay button component

- GIVEN a merchant calls `tonder.create('apple_pay_button', options)`
- WHEN they inspect the return type at compile time and call `.mount()` at runtime
- THEN the return type is exactly `ApplePayButtonComponent`, not a union with `CardFieldsComponent`
- AND `.mount()` and `.unmount()` compile and behave per `TonderMountableComponent`

#### Scenario: Verb-specific mount methods are absent from the public facade

- GIVEN a merchant inspects the SDK's public facade
- WHEN they look for `mountCardFields`, `unmountCardFields`, or `revealCardFields`
- THEN none of these methods exist

#### Scenario: Multiple components coexist independently

- GIVEN a merchant creates a `card_fields` component for a new card
- AND separately creates a component for a saved card's CVV field
- WHEN both are mounted at the same time
- THEN each maintains independent scoped state
- AND unmounting one does not affect the other

#### Scenario: create<T>() narrows to the exact handle type for every existing call site

- GIVEN every existing call site invokes `tonder.create('card_fields', options)`
- WHEN the code compiles
- THEN the return type is exactly `CardFieldsComponent`, not a union
- AND every existing `.mount()`, `.unmount()`, `.reveal()` call on that return value compiles unchanged

#### Scenario: CardFieldsComponent structurally satisfies TonderMountableComponent

- GIVEN `CardFieldsComponent` extends `TonderMountableComponent`
- WHEN a value typed `CardFieldsComponent` is assigned to a variable typed `TonderMountableComponent`
- THEN it type-checks

#### Scenario: A component type is never declared ahead of its runtime

- GIVEN `TonderComponentType`
- WHEN its members are compared against the components `create()` can actually construct
- THEN every member has a runtime — no member exists that `create()` would reject

## ADDED Requirements

### Requirement: Instance-level payment events fire for every SDK-completed payment, read at fire time (D4, D5)

`config.events.payment` (`PaymentEvents`) MUST be the shared result surface
for every payment method the SDK completes, `pay()` included — not a
component-specific event map. Its callbacks MUST be read at fire time
(`getConfig().events?.payment?.on_success?.(...)` and siblings, never
captured at construction or mount time), mirroring
`config.events.presentation`, so a callback assigned after `createTonder()`
still fires. The callbacks MUST be opt-in: leaving them undefined MUST NOT
change `pay()`'s existing promise-based contract — its return value, its
thrown `AppError`, and every existing `pay()` test MUST behave unchanged.
`pay()` MUST invoke `on_success(transaction)` for every resolved outcome
including a decline, `on_error(error)` when it rejects with `AppError`, and
MUST NOT invoke `on_cancel` — cancellation has no meaning for `pay()`.
Multiple mounted components on one `Tonder` instance share this one set of
callbacks; the transaction identifies which payment produced a given
callback invocation.

#### Scenario: A callback assigned after createTonder is honored (fire-time read)

- GIVEN `config.events.payment` had no `on_success` callback at `createTonder()` time
- AND one is assigned onto the config object before a payment later completes
- WHEN that payment resolves
- THEN the later-assigned `on_success` callback is invoked

#### Scenario: pay() invokes on_success for both a successful and a declined resolution

- GIVEN `config.events.payment.on_success` is set
- WHEN `pay()` resolves, whether with an authorized transaction or a decline
- THEN `on_success` is invoked with that transaction

#### Scenario: pay() invokes on_error when it rejects

- GIVEN `config.events.payment.on_error` is set
- WHEN `pay()` rejects with an `AppError`
- THEN `on_error` is invoked with that error

#### Scenario: pay() never invokes on_cancel

- GIVEN `config.events.payment.on_cancel` is set
- WHEN `pay()` resolves or rejects, by any outcome
- THEN `on_cancel` is never invoked

#### Scenario: Every existing pay() test passes unchanged with the callbacks undefined

- GIVEN `config.events.payment` is not set
- WHEN the full existing `pay()` test suite runs
- THEN it passes unchanged — `pay()`'s returned promise and thrown errors are unaffected by the callbacks' absence
