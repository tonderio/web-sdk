# Delta for Apple Pay

## MODIFIED Requirements

### Requirement: BusinessProfile declares country_code; no ApplePayConfig exists anywhere

`BusinessProfile` MUST declare `country_code?: string`, optional, inside
`business`. `BusinessConfig` MUST declare `apple_pay?: ApplePayConfig` at the
root, sibling of `mercado_pago`. `ApplePayConfig` MUST declare
`enabled: boolean` (required) and `merchant_identifier?: string` (declared,
never read — see the `buildApplePayPaymentRequest` requirement).
`ApplePayConfig` MAY declare additional optional fields carrying supported
networks and card-type capabilities; exact field names are pending backend
confirmation, and an absent or unrecognized field MUST resolve to the SDK's
default rather than failing. No parallel or duplicate Apple Pay configuration
interface MUST exist anywhere in `src/`.

(Previously: no `ApplePayConfig` interface and no `apple_pay` field on
`BusinessConfig` or any other type existed anywhere in `src/` — availability
lived on the payment-method catalog instead.)

#### Scenario: BusinessConfig type-checks with and without apple_pay

- GIVEN two `BusinessConfig` fixtures — one with `apple_pay: { enabled: true, merchant_identifier: 'merchant.io.tonder.checkout' }`, one with `apple_pay` absent
- WHEN each is assigned to the `BusinessConfig` type
- THEN both type-check with no error

#### Scenario: BusinessConfig type-checks with and without country_code

- GIVEN two `BusinessConfig` fixtures — one with `business.country_code: 'MX'`, one with `country_code` absent
- WHEN each is assigned to the `BusinessConfig` type
- THEN both type-check with no error

#### Scenario: Exactly one ApplePayConfig interface exists, on BusinessConfig.apple_pay

- GIVEN the full `src/` type surface
- WHEN searched for an `ApplePayConfig` interface
- THEN exactly one is found, declared as the type of `BusinessConfig.apple_pay`

### Requirement: Apple Pay supported-networks derivation

The SDK MUST expose an internal helper (`resolveApplePayNetworks`) that
derives the Apple Pay `supportedNetworks` list from the `apple_pay` block on
the business config. When the block declares a non-empty networks list, the
helper MUST return that list unchanged in order, value and multiplicity: it
MUST NOT deduplicate and MUST NOT normalize case. One array from one source is
taken at its word, and Apple's network tokens are case-sensitive
(`masterCard`, not `mastercard`), so normalizing would corrupt a valid token.
The returned array MUST be a copy, so a caller cannot mutate the business
config or the fallback constant through it. When the block is absent, or
present without a networks list, or declaring an empty list, the helper MUST
fall back to
`DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard']`. The helper MUST be
total over its input: an absent `apple_pay` block is a valid input for a pure
function and MUST also resolve to the fallback, not to an undefined or
implementation-dependent result. The availability gate determines whether
production ever calls the helper with such an input — it does not relieve
the helper of defining the case.

(Previously: derived from the deduplicated union of every active
`apple_pay_*` catalog entry's `configuration.supported_networks`. The union
was across several entries, where a repeated network was legitimate; a single
declared list is not.)

#### Scenario: Declared networks are returned verbatim, duplicates included

- GIVEN `apple_pay` is present with a networks list containing a duplicate value
- WHEN the helper runs
- THEN the result contains that value as many times as it was declared

#### Scenario: Declared networks keep their case

- GIVEN `apple_pay` declares `['masterCard', 'Visa']`
- WHEN the helper runs
- THEN the result is `['masterCard', 'Visa']`

#### Scenario: The returned array is a copy of the declared list

- GIVEN `apple_pay` declares a networks list
- WHEN the caller mutates the returned array
- THEN the block's own list is unchanged

#### Scenario: Block present without a networks list falls back

- GIVEN `apple_pay` is present but declares no networks list
- WHEN the helper runs
- THEN the result is the fallback `['visa', 'masterCard']`

#### Scenario: The helper is total — an absent block also resolves to the fallback

- GIVEN the business config carries no `apple_pay` block
- WHEN the helper runs directly against that input
- THEN the result is still the fallback `['visa', 'masterCard']`

### Requirement: Apple Pay merchantCapabilities derivation

The SDK MUST expose an internal helper (`resolveApplePayMerchantCapabilities`)
that derives Apple Pay `merchantCapabilities` from the `apple_pay` block on
the business config. `'supports3DS'` MUST be present in every result,
unconditionally — it denotes EMV cryptogram support, unrelated to 3-D
Secure, and its definition site MUST carry a code comment recording that
distinction. `'supportsDebit'` MUST be present only when the block declares
debit support; `'supportsCredit'` MUST be present only when the block
declares credit support. When the block declares neither restriction, Apple
filters by neither type, so declaring both or neither is equivalent —
restricting the type is worth doing only in the asymmetric case. The helper
MUST be total over its input: an absent `apple_pay` block is valid and MUST
resolve to a result containing `'supports3DS'` and neither of the other two.

(Previously: derived from which `apple_pay_debit_card` /
`apple_pay_credit_card` catalog entries were active.)

#### Scenario: Both capabilities declared

- GIVEN `apple_pay` declares both debit and credit support
- WHEN the helper runs
- THEN the result contains `supports3DS`, `supportsDebit`, and `supportsCredit`

#### Scenario: Debit only

- GIVEN `apple_pay` declares only debit support
- WHEN the helper runs
- THEN the result contains `supports3DS` and `supportsDebit`
- AND the result does not contain `supportsCredit`

#### Scenario: Credit only

- GIVEN `apple_pay` declares only credit support
- WHEN the helper runs
- THEN the result contains `supports3DS` and `supportsCredit`
- AND the result does not contain `supportsDebit`

#### Scenario: The helper is total — an absent block resolves to supports3DS only

- GIVEN the business config carries no `apple_pay` block
- WHEN the helper runs directly against that input
- THEN the result still contains `supports3DS`
- AND the result contains neither `supportsDebit` nor `supportsCredit`

### Requirement: Public Apple Pay availability wiring waits for its full runtime

`Tonder` MUST expose a public `isApplePayAvailable(): boolean` method. It
MUST be synchronous, MUST perform no network call, and MUST NOT throw under
any input, including before `init()` runs. It MUST return the composition
`port.canUseApplePay() && business.apple_pay?.enabled === true &&
Boolean(business.business.country_code)` — the browser check, the business's
Apple Pay flag, and the business country code, evaluated with `&&`
short-circuiting. A missing or false `apple_pay.enabled`, a missing or empty
`country_code`, or a browser without Apple Pay support each independently
make the method report `false`; no one of the three is optional or bypassed
by another.

(Previously: composed `port.canUseApplePay() &&
hasActiveApplePayMethod(state.paymentMethodCatalog) &&
Boolean(state.business?.business.country_code)` — the catalog gate stood in
for the business's `apple_pay.enabled` flag.)

#### Scenario: isApplePayAvailable exists on the public Tonder instance

- GIVEN the `Tonder` instance returned by `createTonder()`
- WHEN its members are inspected
- THEN `isApplePayAvailable` exists as a method returning `boolean`

#### Scenario: Returns true only when browser, apple_pay.enabled, and country all pass

- GIVEN `port.canUseApplePay()` returns `true`
- AND `business.apple_pay?.enabled` is `true`
- AND `business.country_code` is a non-empty string
- WHEN `isApplePayAvailable()` runs
- THEN it returns `true`

#### Scenario: False when the browser check fails, independent of apple_pay and country

- GIVEN `port.canUseApplePay()` returns `false`
- AND the `apple_pay.enabled` and country checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: False when apple_pay.enabled is false or absent, independent of browser and country

- GIVEN `business.apple_pay` is absent, or `apple_pay.enabled` is `false`
- AND the browser and country checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: False when country_code is absent, independent of browser and apple_pay.enabled

- GIVEN `business.country_code` is absent or empty
- AND the browser and `apple_pay.enabled` checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: Never throws, including before init()

- GIVEN `init()` has not been called, so the business state is unset
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`
- AND it does not throw

### Requirement: buildApplePayPaymentRequest is a pure builder of Apple's request shape

`buildApplePayPaymentRequest` MUST be pure: no DOM access, no network call, no
global read. It MUST set `total.amount` to a two-decimal string, and MUST
reject (throw) an amount of zero or less before any `ApplePaySession` is
constructed — Apple's own constructor throws on the same condition
(`ApplePaySession.md:260`), and this builder MUST fail closer to the caller.
`merchantCapabilities` MUST always include `'supports3DS'` and MUST otherwise
equal the output of the `resolveApplePayMerchantCapabilities` helper, never a
re-derivation. `supportedNetworks` MUST equal the output of the
`resolveApplePayNetworks` helper. Both helpers MUST take the business's
`apple_pay` block as input, never the payment-method catalog. `countryCode`
MUST come from `business.country_code`; the sheet's total label MUST come
from `business.name`.

(Previously: `resolveApplePayMerchantCapabilities` and
`resolveApplePayNetworks` took the cached raw payment-method catalog as
input.)

#### Scenario: Amount serializes to a two-decimal string

- GIVEN an amount of `10`
- WHEN the request is built
- THEN `total.amount` is `'10.00'`
- GIVEN an amount of `10.5`
- WHEN the request is built
- THEN `total.amount` is `'10.50'`

#### Scenario: Zero or negative amount is rejected before Apple's constructor sees it

- GIVEN an amount of `0` or `-5`
- WHEN the request builder runs
- THEN it throws before any `ApplePaySession` type is touched

#### Scenario: Capabilities and networks are asserted against literal values

- GIVEN an `apple_pay` block declaring `['visa']` and debit support only
- WHEN the request is built
- THEN `merchantCapabilities` equals the literal `['supports3DS', 'supportsDebit']`
- AND `supportedNetworks` equals the literal `['visa']`
- AND the assertion MUST NOT be expressed as equality with a call to
  `resolveApplePayMerchantCapabilities` or `resolveApplePayNetworks`, which
  the builder itself calls and which would therefore hold for any helper
  output, correct or not

#### Scenario: countryCode and label are sourced from the business profile

- GIVEN `business.country_code: 'MX'` and `business.name: 'Ada Store'`
- WHEN the request is built
- THEN `countryCode` is `'MX'` and the total's label is `'Ada Store'`

#### Scenario: Declared, not verifiable here — Safari's acceptance of the built request

- GIVEN a fake `ApplePaySession` constructor that accepts any well-formed
  object
- WHEN a request built by this function is passed to it in this test suite
- THEN the fake proves nothing about Apple's own field-validation rules
- AND actual acceptance by Safari's real constructor is verified only in
  Phase 7

### Requirement: mount() runs four ordered gates, each with its own error code (D7)

`create('apple_pay_button', options).mount()` MUST run four checks in this
fixed order, stopping at the first failure and throwing only that failure's
code — a later check MUST NOT run once an earlier one has failed:

| Order | Check                                                     | Code                            |
| ----- | --------------------------------------------------------- | ------------------------------- |
| 1     | `assertReady()`                                           | `NOT_INITIALIZED`               |
| 2     | `port.canUseApplePay()`                                   | `APPLE_PAY_UNSUPPORTED_BROWSER` |
| 3     | `business.apple_pay?.enabled` and `business.country_code` | `APPLE_PAY_NOT_ENABLED`         |
| 4     | `render()`'s container lookup                             | `APPLE_PAY_CONTAINER_NOT_FOUND` |

When all four pass, `mount()` MUST call `ApplePayButtonPort.render()` with
`containerId` translated from `options.container_id` (default
`'#tonder-apple-pay-button'`) and `customization` set to
`config.customization?.apple_pay_button` when present. A second `mount()`
call on the same component handle MUST dispose the previously rendered
button before rendering again; it MUST NOT abort a session already in
flight from the first mount — only `unmount()` does that.

(Previously: row 3 was "the catalog gate and `business.country_code`",
reading the cached payment-method catalog instead of
`business.apple_pay?.enabled`.)

#### Scenario: NOT_INITIALIZED when the SDK is not ready

- GIVEN `init()` has not resolved
- WHEN `mount()` is called
- THEN it throws `AppError(NOT_INITIALIZED)`
- AND no later check runs

#### Scenario: APPLE_PAY_UNSUPPORTED_BROWSER when the browser check fails

- GIVEN the SDK is ready and `port.canUseApplePay()` returns `false`
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_UNSUPPORTED_BROWSER)`
- AND the `apple_pay.enabled`/country and container checks do not run

#### Scenario: APPLE_PAY_NOT_ENABLED when apple_pay is disabled or country code is absent

- GIVEN the SDK is ready, the browser supports Apple Pay, and either `business.apple_pay?.enabled` is false or absent, or `business.country_code` is absent
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_NOT_ENABLED)`
- AND the container check does not run

#### Scenario: APPLE_PAY_CONTAINER_NOT_FOUND when the container is missing

- GIVEN the SDK is ready, the browser supports Apple Pay, `business.apple_pay?.enabled` is `true`, and `business.country_code` is set
- AND no element matches `options.container_id`
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_CONTAINER_NOT_FOUND)`

#### Scenario: mount() renders using the merchant's configured customization and container id

- GIVEN all four checks pass and `config.customization?.apple_pay_button` is set
- WHEN `mount()` runs
- THEN `render()` is called with that customization and with `containerId` equal to `options.container_id` (or the default) with no other transformation

#### Scenario: A second mount() disposes the previous button and renders again, without touching a live session

- GIVEN a component already mounted once
- AND a session created by the first mounted button's click is still in flight
- WHEN `mount()` is called a second time
- THEN the first button's disposer runs before the second button renders
- AND the in-flight session from the first mount is not aborted by this call — only `unmount()` aborts it

### Requirement: Apple Pay error codes exist in ErrorKeyEnum

`ErrorKeyEnum` MUST declare six new members: `APPLE_PAY_NOT_ENABLED`,
`APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_CONTAINER_NOT_FOUND`,
`APPLE_PAY_SESSION_ERROR`, `APPLE_PAY_VALIDATION_ERROR`,
`APPLE_PAY_UNSUPPORTED_ACTION`. No existing member's identifier or value
MUST change. `APPLE_PAY_NOT_ENABLED`'s documented meaning is "the business's
`apple_pay.enabled` is false or absent, or no `country_code` is set on the
business" — only the description changes with the availability-source move,
never the identifier.

(Previously: no code path constructed any of the six, because each was
declared ahead of the change that would throw it — that state changed when
all six were wired to throw. The documented meaning for
`APPLE_PAY_NOT_ENABLED` then read "no active `apple_pay_*` method in the
catalog".)

#### Scenario: Six new codes are members of the enum

- GIVEN `ErrorKeyEnum`
- WHEN a test references each of the six new codes by name
- THEN each resolves to a string enum member

#### Scenario: Every code has a code-specific message

- GIVEN `MESSAGES_EN`
- WHEN all six Apple Pay codes are resolved
- THEN each returns a distinct string, and none falls back to the `UNKNOWN_ERROR` copy

## REMOVED Requirements

### Requirement: Raw payment-method catalog is fetched and cached during init()

(Reason: availability data now arrives on the `apple_pay` block of the
business config, which `init()` already fetches in a single request. The
cache existed only so the gate could read `apple_pay_*` catalog entries
without paying for a request; with the gate moved, it has no reader.)
(Migration: None. The payment-method catalog is still fetched by
`getPaymentMethods()` on every call — see `payment-method-discovery/spec.md`
— but `init()` no longer fetches or caches it.)

### Requirement: Apple Pay availability gate reads the cached catalog only (D4)

(Reason: the gate reads `business.apple_pay?.enabled` and
`business.country_code` directly; there is no cached catalog left to read.)
(Migration: see the MODIFIED "Public Apple Pay availability wiring waits for
its full runtime" requirement above.)

### Requirement: Catalog transport type declares an unread configuration field

(Reason: `BackendPaymentMethod.configuration` had no reader once the
availability gate moved off the catalog.)
(Migration: the equivalent fields are declared on `ApplePayConfig` — see the
MODIFIED "BusinessProfile declares country_code; no ApplePayConfig exists
anywhere" requirement above.)
