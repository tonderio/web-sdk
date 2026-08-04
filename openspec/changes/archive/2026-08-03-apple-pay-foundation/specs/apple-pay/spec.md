# Apple Pay Specification

## Purpose

Declares the compile-time contract surface for Apple Pay: error codes, the
catalog transport field, and option/handle/customization types. Per D3 ("a
type may be declared before its behavior exists; it may not be wired into a
reachable public surface before its behavior exists"), nothing declared here
is reachable from a merchant's code — no export, no key on an existing
public config type, no consumer. `country_code` (D1) and the catalog
`configuration` field are optional so absence never becomes a compile error.

**Verification note**: type-level scenarios below are enforced only by
`npm run typecheck`. `tsconfig.json` excludes `**/*.test.ts`, so a type
assertion (e.g. `@ts-expect-error`) written inside a `*.test.ts` file proves
nothing on its own — a green `npm run test` does not verify it. The one
compiled call site that genuinely exercises `create('card_fields', ...)` is
`e2e/support/fixtures.ts:123`, checked via `e2e/tsconfig.json`.

## Requirements

### Requirement: BusinessProfile declares country_code; no ApplePayConfig exists anywhere

`BusinessProfile` MUST declare `country_code?: string`, optional. No
`ApplePayConfig` interface and no `apple_pay` field on `BusinessConfig` or
any other type MUST exist anywhere in `src/` — availability moved to the
payment-method catalog (D5) and no longer lives on the business config.

#### Scenario: BusinessConfig type-checks with and without country_code

- GIVEN two `BusinessConfig` fixtures — one with `business.country_code: 'MX'`, one with `country_code` absent
- WHEN each is assigned to the `BusinessConfig` type
- THEN both type-check with no error

#### Scenario: No ApplePayConfig interface exists

- GIVEN the full `src/` type surface
- WHEN searched for an `ApplePayConfig` interface or an `apple_pay` field on any exported type
- THEN neither is found

### Requirement: Catalog transport type declares an unread configuration field

The catalog transport type `BackendPaymentMethod`
(`src/core/services/direct-api.service.ts`) MUST declare
`configuration?: { supported_networks?: string[] }`. No code path MUST read
`configuration` in this phase.

#### Scenario: BackendPaymentMethod type-checks with and without configuration

- GIVEN two `BackendPaymentMethod` fixtures — one with `configuration: { supported_networks: ['visa'] }`, one with `configuration` absent
- WHEN each is assigned to the type
- THEN both type-check with no error

#### Scenario: getPaymentMethods() output is byte-identical to before

- GIVEN the existing `getPaymentMethods()` test fixtures and assertions
- WHEN `npm run test` runs after this change
- THEN output is unchanged — no code reads `configuration`, so no consumer can observe it

### Requirement: Apple Pay error codes exist in ErrorKeyEnum

`ErrorKeyEnum` MUST declare six new members: `APPLE_PAY_NOT_ENABLED`,
`APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_CONTAINER_NOT_FOUND`,
`APPLE_PAY_SESSION_ERROR`, `APPLE_PAY_VALIDATION_ERROR`,
`APPLE_PAY_UNSUPPORTED_ACTION`. No existing member's identifier or value
MUST change. `APPLE_PAY_NOT_ENABLED`'s documented meaning is "no active
`apple_pay_*` method in the catalog, or no `country_code` on the business" —
only the description changes with the availability-source move (D5), never
the identifier.

#### Scenario: Six new codes are members of the enum

- GIVEN `ErrorKeyEnum`
- WHEN a test references each of the six new codes by name
- THEN each resolves to a string enum member

#### Scenario: No code path constructs these errors yet

- GIVEN the full test suite
- WHEN it runs
- THEN no code path constructs an `AppError` with any of the six codes — throwing them is a later-phase contract, declared but not enforced here

### Requirement: Payment, option, and customization types are declared but unreachable (D3)

`PaymentEvents`, `ApplePayButtonCustomization`, `ApplePayButtonOptions`,
`ApplePayPaymentInput`, and `ApplePayButtonComponent` MUST be declared and
MUST NOT be exported from `src/index.ts`. `PaymentEvents` MUST NOT be added
to `TonderEvents`. `ApplePayButtonCustomization` MUST NOT be added to
`TonderCustomization`. `ApplePayPaymentInput` MUST be
`Omit<PayInput, 'payment_method'>`, not a parallel shape.
`ApplePayButtonComponent` MUST expose exactly the `TonderMountableComponent`
contract and add no members of its own. It is declared as a type alias rather
than an empty `extends` interface: the two are structurally identical to
TypeScript, but an empty interface trips
`@typescript-eslint/no-empty-object-type` and would introduce the only eslint
suppression in `src/`. The phase that gives the button a member of its own
converts the alias to an interface.

#### Scenario: TonderEvents has no payment key; TonderCustomization has no apple_pay_button key

- GIVEN `TonderEvents` and `TonderCustomization`
- WHEN their keys are inspected
- THEN neither `payment` nor `apple_pay_button` exists on either — both callback and style surfaces are declared, not wired

#### Scenario: None of the five types are exported from src/index.ts

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are inspected
- THEN `PaymentEvents`, `ApplePayButtonCustomization`, `ApplePayButtonOptions`, `ApplePayPaymentInput`, and `ApplePayButtonComponent` are all absent

#### Scenario: ApplePayPaymentInput inherits future PayInput fields with no edit

- GIVEN a field is added to `PayInput` other than `payment_method`
- WHEN `ApplePayPaymentInput` is inspected
- THEN the new field is present with no change to `apple-pay.ts`

#### Scenario: payment_method is not assignable on ApplePayPaymentInput

- GIVEN a value typed `ApplePayPaymentInput`
- WHEN a caller attempts to set `payment_method`
- THEN it is a type error

#### Scenario: No icon or image field on ApplePayButtonCustomization

- GIVEN `ApplePayButtonCustomization`
- WHEN its keys are inspected
- THEN no `icon`, `image`, or `logo` field exists

### Requirement: Apple's types are development-only and excluded from the bundle

`@types/applepayjs` MUST be a `devDependency`, never a runtime `dependency`.
No `src/` module MUST import a runtime value from it — only ambient/global
types.

#### Scenario: Package manifest declares it as devDependency only

- GIVEN `package.json`
- WHEN `dependencies` and `devDependencies` are inspected
- THEN `@types/applepayjs` is present only under `devDependencies`

#### Scenario: Build output carries no trace of the package

- GIVEN `npm run build` output (`dist/*.cjs`, `dist/*.mjs`, IIFE bundle)
- WHEN the emitted JavaScript is inspected
- THEN no reference to `@types/applepayjs` module code exists — it is a type-only package, erased at compile time
