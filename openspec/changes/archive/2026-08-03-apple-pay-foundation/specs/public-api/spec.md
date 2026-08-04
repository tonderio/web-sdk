# Delta for Public API Consistency

Verification note: see `apple-pay/spec.md`'s Purpose section — type-level
scenarios below are enforced only by `npm run typecheck`
(`e2e/tsconfig.json` covers the real compiled call site at
`e2e/support/fixtures.ts:123`); `*.test.ts` files are excluded from
typecheck, so in-test type assertions alone prove nothing.

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
since an empty `extends` interface would require an eslint suppression. `ComponentOptionsByType` MUST be an
explicit map keyed by `TonderComponentType`, not
`Record<TonderComponentType, CardFieldsOptions | undefined>`.
`TonderComponentType` MUST remain exactly `'card_fields'` in this phase — no
widening.
(Previously: did not specify per-type return narrowing, a shared handle
base, or an explicit `ComponentOptionsByType` map.)

#### Scenario: Creating and mounting a card-fields component

- GIVEN a merchant calls `tonder.create('card_fields', options)`
- WHEN they call `.mount()` on the returned handle
- THEN the card fields render inside the per-field containers declared in `options.fields`
- AND calling `.unmount()` on the same handle tears down only that instance

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
- WHEN the code compiles under this change
- THEN the return type is exactly `CardFieldsComponent`, not a union
- AND every existing `.mount()`, `.unmount()`, `.reveal()` call on that return value compiles unchanged

#### Scenario: CardFieldsComponent structurally satisfies TonderMountableComponent

- GIVEN `CardFieldsComponent` extends `TonderMountableComponent`
- WHEN a value typed `CardFieldsComponent` is assigned to a variable typed `TonderMountableComponent`
- THEN it type-checks

#### Scenario: TonderComponentType stays exactly 'card_fields'

- GIVEN `TonderComponentType` at the end of this change
- WHEN its members are inspected
- THEN `'card_fields'` is the only member — `'apple_pay_button'` is not added in this phase

#### Scenario: src/index.ts gains exactly one new export

- GIVEN the `.d.ts` public surface before and after this change
- WHEN the diff is inspected
- THEN `TonderMountableComponent` is the only addition, and no Apple Pay type is exported

## ADDED Requirements

### Requirement: pay(), enrollCard(), and saved-card behavior are unaffected by this phase

This phase MUST NOT change the runtime behavior, signatures, or return types
of `pay()`, `enrollCard()`, or saved-card `create('card_fields', { card_id })`
flows.

#### Scenario: Pre-existing test suite passes with no behavior change

- GIVEN the pre-change test suite for `pay()`, `enrollCard()`, and saved-card components
- WHEN `npm run test` and `npm run typecheck` run after this change
- THEN all tests pass
- AND no test assertion changes beyond a type-signature update already permitted by the proposal's success criteria
