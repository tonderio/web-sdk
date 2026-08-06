# Apple Pay Specification

## Purpose

Declares the compile-time contract surface for Apple Pay: error codes, the
catalog transport field, and option/handle/customization types. Per D3 ("a
type may be declared before its behavior exists; it may not be wired into a
reachable public surface before its behavior exists"), nothing declared here
is reachable from a merchant's code — no export, no key on an existing
public config type, no consumer. `country_code` (D1) and the catalog
`configuration` field are optional so absence never becomes a compile error.

**Verification note**: type-level scenarios below are enforced by
`npm run typecheck`, never by `npm run test` — Vitest transpiles without
checking types, so a green test run says nothing about a type assertion.
`npm run typecheck` runs three projects: the root `tsconfig.json` over the
shipped sources, `tsconfig.test.json` over the unit tests, and
`e2e/tsconfig.json` over the end-to-end suite. The root config excludes
`**/*.test.ts` so tests are never emitted into `dist`; `tsconfig.test.json`
exists to type-check them anyway. A type assertion (e.g. `@ts-expect-error`)
written inside a `*.test.ts` file is therefore genuinely enforced, by the
typecheck project rather than by the test run.

## Requirements

### Requirement: BusinessProfile declares country_code; no ApplePayConfig exists anywhere

`BusinessProfile` MUST declare `country_code?: string`, optional, inside
`business`. A named default constant for that field MUST exist, MUST hold the
ISO 3166-1 alpha-2 code for Mexico, and MUST be declared outside any
payment-method-specific module, so a second country-gated method can read it
without importing from the Apple Pay code. The business-config mapping MUST
NOT apply that default: the cached config MUST keep reporting whatever the
API sent, so an omitted country stays distinguishable from an explicitly sent
one in captured state. Consumers MUST resolve the default at the point of
read. An empty-string `country_code` MUST resolve to the default, not be
forwarded as a country. `BusinessConfig` MUST declare `apple_pay?: ApplePayConfig` at the
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

#### Scenario: The country default is declared outside the Apple Pay modules and applied nowhere in the config load

- GIVEN the full `src/` surface
- WHEN searched for the default country constant
- THEN exactly one declaration is found, and it is not inside a
  payment-method-specific module
- AND no code on the business-config load path writes it into the returned
  `BusinessConfig`, so a business whose API response omitted `country_code`
  still reads back as having none

#### Scenario: Exactly one ApplePayConfig interface exists, on BusinessConfig.apple_pay

- GIVEN the full `src/` type surface
- WHEN searched for an `ApplePayConfig` interface
- THEN exactly one is found, declared as the type of `BusinessConfig.apple_pay`

### Requirement: Apple Pay error codes exist in ErrorKeyEnum

`ErrorKeyEnum` MUST declare five new members: `APPLE_PAY_NOT_ENABLED`,
`APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_CONTAINER_NOT_FOUND`,
`APPLE_PAY_SESSION_ERROR` and `APPLE_PAY_VALIDATION_ERROR`. Every declared
code MUST have a thrower: a code no path constructs is a public promise the
SDK does not keep. No existing member's identifier or value MUST change. `APPLE_PAY_NOT_ENABLED`'s documented meaning is "the business's
`apple_pay.enabled` is false or absent" — only the description changes with
the availability-source move, never the identifier. Neither that description
nor the merchant-facing message for the code MUST cite a missing business
country as a cause, since the country resolves to a default and can no longer
make the code fire.

(Previously: the documented meaning and the merchant-facing message also
named "no `country_code` on the business" as a cause, back when a missing
country made the business unavailable instead of resolving to a default.
Earlier still, six members were declared, including
`APPLE_PAY_UNSUPPORTED_ACTION` for a `/process` response carrying a
`next_action`. That response now reports the transaction through
`on_completed`, so the code lost its only thrower and was removed rather than
left as a declared code nothing raises. Earlier still, none of the codes had
a thrower at all, because each was declared ahead of the change that would
raise it; and `APPLE_PAY_NOT_ENABLED`'s documented meaning read "no active
`apple_pay_*` method in the catalog".)

#### Scenario: Each declared code is a member of the enum

- GIVEN `ErrorKeyEnum`
- WHEN a test references each Apple Pay code by name
- THEN each resolves to a string enum member

#### Scenario: Every code has a code-specific message

- GIVEN `MESSAGES_EN`
- WHEN every Apple Pay code is resolved
- THEN each returns a distinct string, and none falls back to the `UNKNOWN_ERROR` copy

#### Scenario: No declared code is left without a thrower

- GIVEN the Apple Pay codes in `ErrorKeyEnum`
- WHEN `src/` is searched for a construction site of each
- THEN every one is raised by at least one path

### Requirement: Payment, option, and customization types are declared but unreachable (D3)

`PaymentEvents`, `ApplePayButtonCustomization`, `ApplePayButtonOptions`,
`ApplePayPaymentInput`, and `ApplePayButtonComponent` MUST be declared and
exported from `src/index.ts`. `TonderEvents` MUST declare
`payment?: PaymentEvents` as a sibling of `presentation`.
`TonderCustomization` MUST declare
`apple_pay_button?: ApplePayButtonCustomization`. `ApplePayPaymentInput`
MUST remain `Omit<PayInput, 'payment_method'>`, not a parallel shape, so a
field added to `PayInput` later appears here with no edit.
`ApplePayButtonComponent` MUST continue to expose exactly the
`TonderMountableComponent` contract and add no members of its own, and MUST
remain declared as a type alias rather than an `extends` interface for as
long as that holds. `ApplePayButtonCustomization` MUST continue to declare
no `icon`, `image`, or `logo` field.

**Verification note**: the type-shape scenarios below (derivation, alias
status, absent icon field) are enforced by `npm run typecheck`; the runtime
behavior of firing `PaymentEvents` callbacks is specified in
`public-api/spec.md`.
(Previously: all five types were declared and unexported, `TonderEvents` had
no `payment` key, and `TonderCustomization` had no `apple_pay_button` key —
wiring a callback or style surface a merchant could not observe firing or
applying would have been a silent no-op.)

#### Scenario: TonderEvents has a payment key; TonderCustomization has an apple_pay_button key

- GIVEN `TonderEvents` and `TonderCustomization`
- WHEN their keys are inspected
- THEN `TonderEvents.payment` is typed `PaymentEvents | undefined`
- AND `TonderCustomization.apple_pay_button` is typed `ApplePayButtonCustomization | undefined`

#### Scenario: All five types are exported from src/index.ts

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are inspected
- THEN `PaymentEvents`, `ApplePayButtonCustomization`, `ApplePayButtonOptions`,
  `ApplePayPaymentInput`, and `ApplePayButtonComponent` are all present

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

### Requirement: isApplePayAvailable() reports availability with its reason

`Tonder` MUST expose a public `isApplePayAvailable(): ApplePayAvailability`
method. It MUST be synchronous, MUST perform no network call, and MUST NOT
throw under any input, including before `init()` runs.

`ApplePayAvailability` MUST be a discriminated union on a boolean `available`
field: `{ available: true }`, or `{ available: false; code: string; message:
string }`. It MUST NOT be an `Error` or an `AppError`. The probe answers a
question a merchant may ask on every render, and an unavailable answer is not
an exceptional condition, so no stack is allocated for one.

The method MUST run the same checks the `mount()` gate runs, in the same
order, stopping at the first failure and reporting only that failure:

| Order | Check                         | `code`                          |
| ----- | ----------------------------- | ------------------------------- |
| 1     | the instance is ready         | `NOT_INITIALIZED`               |
| 2     | `port.canUseApplePay()`       | `APPLE_PAY_UNSUPPORTED_BROWSER` |
| 3     | `business.apple_pay?.enabled` | `APPLE_PAY_NOT_ENABLED`         |

`code` MUST be the `ErrorKeyEnum` value named above and `message` MUST be the
`MESSAGES_EN` copy for that code, so the probe and the error the same
condition throws carry identical wording. When more than one check would
fail, the reported code MUST be the one `mount()` would throw.

The business country MUST NOT be a term. It resolves to a default at every
read site, so a country term could never evaluate false and would read as a
check while gating nothing. A business the backend has enabled but sent no
`country_code` for MUST report available.

`available: true` MUST NOT be specified as a guarantee that the payment sheet
will open. It asserts only that the browser exposes Apple Pay and the business
has it enabled; the sheet's fate is Apple's and is observable only after the
tap, through the payment events. The published documentation MUST state this
limitation wherever the method's return value is described.

No boolean-returning form, overload, or alias of this method MUST exist.

(Previously: the method returned a bare `boolean`, the composition
`port.canUseApplePay() && business.apple_pay?.enabled === true`, with no
readiness term and no way for a caller to tell the three causes apart.
Earlier still, a third term required a non-empty `business.country_code`, and
before that the middle term scanned a cached copy of the payment-method
catalog for an active Apple Pay entry. The browser term is unchanged
throughout.)

#### Scenario: Available when the browser and apple_pay.enabled checks both pass

- GIVEN the instance is ready
- AND `port.canUseApplePay()` returns `true`
- AND `business.apple_pay?.enabled` is `true`
- WHEN `isApplePayAvailable()` runs
- THEN it returns `{ available: true }`
- AND the result carries no `code` or `message`

#### Scenario: NOT_INITIALIZED before init() resolves

- GIVEN `init()` has not resolved
- AND the browser and `apple_pay.enabled` checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN `available` is `false` and `code` is `NOT_INITIALIZED`
- AND no network call is made
- AND it does not throw

#### Scenario: APPLE_PAY_UNSUPPORTED_BROWSER when the browser check fails

- GIVEN the instance is ready and `port.canUseApplePay()` returns `false`
- AND the `apple_pay.enabled` check would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN `available` is `false` and `code` is `APPLE_PAY_UNSUPPORTED_BROWSER`

#### Scenario: APPLE_PAY_NOT_ENABLED when apple_pay.enabled is false or absent

- GIVEN the instance is ready and the browser check passes
- AND `business.apple_pay` is absent, or `apple_pay.enabled` is `false`
- WHEN `isApplePayAvailable()` runs
- THEN `available` is `false` and `code` is `APPLE_PAY_NOT_ENABLED`

#### Scenario: The reported message matches the error thrown for the same code

- GIVEN any unavailable result
- WHEN `message` is compared with the message of `AppError(code)`
- THEN the two strings are identical

#### Scenario: Precedence matches the mount() gate when two checks fail

- GIVEN two of the three checks would fail for the same instance
- WHEN `isApplePayAvailable()` and `mount()` are both run against it
- THEN the reported `code` equals the code `mount()` throws

#### Scenario: Available when country_code is absent or empty

- GIVEN `business.country_code` is absent or an empty string
- AND the readiness, browser, and `apple_pay.enabled` checks all pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `{ available: true }`

### Requirement: ApplePayPort reports browser capability without throwing

`ApplePayPort` MUST expose `canUseApplePay(): boolean`. It MUST return `false`,
with no throw, when `window.ApplePaySession` is undefined. Otherwise it MUST
return the result of `ApplePaySession.supportsVersion(3) &&
ApplePaySession.canMakePayments()`. Apple Pay's absence from a browser MUST be
reported as a state the method returns, never raised as a failure.

#### Scenario: Returns false with no throw when ApplePaySession is undefined

- GIVEN a global with no `window.ApplePaySession`
- WHEN `canUseApplePay()` runs
- THEN it returns `false`
- AND it does not throw

#### Scenario: Returns true when both static checks pass

- GIVEN a fake `ApplePaySession` global whose `supportsVersion(3)` and
  `canMakePayments()` both return `true`
- WHEN `canUseApplePay()` runs
- THEN it returns `true`

#### Scenario: Returns false when supportsVersion(3) fails, independent of canMakePayments()

- GIVEN a fake `ApplePaySession` global whose `supportsVersion(3)` returns
  `false` and `canMakePayments()` returns `true`
- WHEN `canUseApplePay()` runs
- THEN it returns `false`

#### Scenario: Declared, not verifiable here — real return values on hardware

- GIVEN this test suite runs in Node/jsdom, not Safari
- WHEN `supportsVersion(3)` and `canMakePayments()` are stubbed on a fake
  global
- THEN the composition logic above is verified
- AND what these two static methods actually return on real Safari hardware
  is verified only in Phase 7, on a device

### Requirement: ApplePayPort.createSession takes handlers as constructor arguments

`ApplePayPort.createSession(request, handlers): ApplePaySessionHandle` MUST be
synchronous and MUST accept `handlers` (`ApplePaySessionHandlers`) as an
argument to the call, never as properties assigned onto the returned handle
afterward. This makes create-and-wire-in-one-tick a type-level guarantee: a
caller cannot obtain a session handle without supplying its handlers in the
same call, which is what the gesture constraint
(`ApplePaySession.md:261` — the constructor throws outside a user-gesture
handler) requires in practice.

#### Scenario: Handlers are supplied as the second argument

- GIVEN a call to `createSession(request, handlers)`
- WHEN a fake port implementation captures its arguments
- THEN all three handlers arrive inside the second argument, with no
  subsequent property assignment on the returned handle

#### Scenario: createSession does not defer the underlying constructor call

- GIVEN a click handler that calls `createSession` directly
- WHEN a jsdom test asserts call order
- THEN the underlying `new ApplePaySession(...)` runs before any microtask
  the test can observe

#### Scenario: Declared, not verifiable here — the real gesture requirement

- GIVEN jsdom models no user activation
- WHEN the synchrony of `createSession` is asserted as a proxy for the
  gesture requirement
- THEN the proxy is verified
- AND Safari's real user-activation enforcement is verified only in Phase 7,
  on a device

### Requirement: Session handlers are normalized so Apple's event objects never cross the port

`ApplePaySessionHandlers` MUST be normalized at the port boundary:
`onValidateMerchant()` MUST take no arguments, and the adapter MUST NOT read
`event.validationURL` — Apple's current guidance is the static hostname
(`ApplePaySession.md:303-309`), and forwarding a client-supplied URL is an
SSRF surface. `onPaymentAuthorized(token)` MUST receive only
`event.payment.token`, never the full `ApplePayPaymentAuthorizedEvent`.
`onCancel()` MUST take no arguments. No `ApplePayJS.*` event type MUST appear
in `ApplePayPort`'s public signature.

#### Scenario: onValidateMerchant receives no arguments and validationURL is unread

- GIVEN a fake session that fires its validate-merchant event with a
  `validationURL` field
- WHEN the adapter invokes the registered `onValidateMerchant` handler
- THEN the handler is called with zero arguments
- AND the adapter never reads `event.validationURL`

#### Scenario: onPaymentAuthorized receives only the token

- GIVEN a fake payment-authorized event carrying `payment.token` plus an
  unrelated field
- WHEN the adapter invokes the registered `onPaymentAuthorized` handler
- THEN the handler receives only the token value, not the event or any other
  field

#### Scenario: onCancel receives no arguments

- GIVEN a fake session that fires its cancel event
- WHEN the adapter invokes the registered `onCancel` handler
- THEN the handler is called with zero arguments

### Requirement: The adapter surfaces construction and container failures as AppError

The adapter MUST throw `AppError(ErrorKeyEnum.APPLE_PAY_SESSION_ERROR)` when
`new ApplePaySession(...)` throws, wrapping the failure rather than letting it
escape uncaught. `ApplePayButtonPort.render()` MUST throw
`AppError(ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND)` when `container_id`
matches no element. `MESSAGES_EN` MUST gain exactly two entries, one per code,
so `AppError` no longer falls back to the `UNKNOWN_ERROR` copy for either.
`ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER` MUST NOT be thrown by this port
or adapter; it is thrown only by the `mount()` gate in the change that adds
that gate.

#### Scenario: A throwing constructor surfaces as APPLE_PAY_SESSION_ERROR

- GIVEN a fake `ApplePaySession` constructor that throws
- WHEN `createSession` is called
- THEN it throws `AppError` with code `APPLE_PAY_SESSION_ERROR`
- AND the adapter does not distinguish among Apple's documented causes
  (insecure page, invalid request, missing gesture) or HTTPS/domain
  enforcement — that distinction is verified only in Phase 7, against real
  Safari

#### Scenario: An unmatched container throws APPLE_PAY_CONTAINER_NOT_FOUND

- GIVEN a `container_id` matching no element in the DOM
- WHEN `render()` is called
- THEN it throws `AppError` with code `APPLE_PAY_CONTAINER_NOT_FOUND`

#### Scenario: Both new codes resolve to real copy, not the UNKNOWN_ERROR fallback

- GIVEN `MESSAGES_EN`
- WHEN `APPLE_PAY_SESSION_ERROR` and `APPLE_PAY_CONTAINER_NOT_FOUND` are
  looked up
- THEN both resolve to a code-specific string, neither to the
  `UNKNOWN_ERROR` copy

#### Scenario: canUseApplePay() reporting false throws nothing

- GIVEN `canUseApplePay()` returns `false`
- WHEN no session-creation or render call follows
- THEN no `AppError` of any code is thrown — absence is reported, not raised

### Requirement: ApplePayButtonPort renders the WebKit button and owns its click lifecycle

`ApplePayButtonPort.render(container_id, customization, onClick)` MUST create
a button node inside the resolved container with the WebKit appearance
property set to `-apple-pay-button`, MUST apply each present field of
`ApplePayButtonCustomization` (`type`, `style`, `locale`, `height`,
`border_radius`) to its corresponding WebKit CSS property, and MUST attach
`onClick` via `addEventListener('click', ...)`. It MUST NOT set any icon,
image, or logo — `ApplePayButtonCustomization` declares none, per Apple's
Human Interface Guidelines. `render()` MUST return a disposer that removes
both the button node and its click listener; invoking the disposer a second
time MUST be a no-op.

#### Scenario: render() sets the WebKit appearance property

- GIVEN a valid container and no customization
- WHEN `render()` runs
- THEN the created node's WebKit appearance property is `-apple-pay-button`
- AND this asserts the property was set — jsdom has no WebKit, so it does not
  prove Safari renders the native button, which is verified only in Phase 7

#### Scenario: Customization fields map to WebKit properties

- GIVEN a customization with `type: 'donate'`, `style: 'white-outline'`, and
  `locale: 'es-MX'`
- WHEN `render()` runs
- THEN the node's corresponding WebKit properties reflect each supplied value
- AND an omitted field is left at Apple's own default, not overridden

#### Scenario: Click invokes the caller-supplied handler

- GIVEN a rendered button node
- WHEN a `click` event fires on it
- THEN `onClick` is invoked

#### Scenario: The disposer removes both node and listener, twice is a no-op

- GIVEN a rendered button and its returned disposer
- WHEN the disposer is called once
- THEN the node is removed from the DOM and the click listener no longer
  fires
- WHEN the disposer is called a second time
- THEN no error is thrown and nothing further changes

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
MUST be supplied by the caller already resolved — `business.country_code`
when the API sent a non-empty one, the default country otherwise — and the
builder MUST NOT apply the default itself, for the same reason it does not
default `currencyCode`: a second independent default could drift and let the
sheet and the charge disagree. The sheet's total label MUST come from
`business.name`.

(Previously: `countryCode` was documented as coming straight from
`business.country_code`, with the `mount()` gate guaranteeing it was present.
Earlier still, `resolveApplePayMerchantCapabilities` and
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

#### Scenario: An absent or empty business country reaches the sheet as the default

- GIVEN a business whose config carries no `country_code`, or an empty one
- WHEN the button is mounted, clicked, and the request reaches the Apple Pay
  session constructor
- THEN its `countryCode` is the default country

#### Scenario: A configured business country is never replaced by the default

- GIVEN a business whose config carries a `country_code` that is not the
  default
- WHEN the button is mounted, clicked, and the request reaches the Apple Pay
  session constructor
- THEN its `countryCode` is the configured value
- AND the assertion MUST use a country distinguishable from the default, so it
  fails against an implementation that overwrites an explicitly configured
  country

#### Scenario: Declared, not verifiable here — Safari's acceptance of the built request

- GIVEN a fake `ApplePaySession` constructor that accepts any well-formed
  object
- WHEN a request built by this function is passed to it in this test suite
- THEN the fake proves nothing about Apple's own field-validation rules
- AND actual acceptance by Safari's real constructor is verified only in
  Phase 7

### Requirement: buildApplePayPaymentMethod returns a local, non-public payment-method shape

`buildApplePayPaymentMethod(token)` MUST return `{ type: 'APPLE_PAY', token }`
using a payment-method interface local to the strategy module, mirroring the
shape of the existing card payment method without extending or modifying the
public `PayInput`/`PaymentMethod` union.

The public union MUST gain no `apple_pay` member. It does NOT follow that
`pay({ payment_method: { type: 'apple_pay' } })` is a type error — the union's
third member, `{ type: string; config?: Record<string, unknown> }`
(`src/shared/types/index.ts:121-124`), accepts any string literal, so that call
type-checks and always has. Rejecting it MUST therefore be a runtime
`AppError`, owned by the change that ships the button component.

That guard is not developer-experience polish: without it the call is treated
as a generic alternative payment method and reaches `/process` as
`{ type: 'apple_pay' }`, so the merchant sees a backend rejection instead of a
message naming the component.

#### Scenario: Builder returns the token unmodified

- GIVEN a token object
- WHEN `buildApplePayPaymentMethod(token)` runs
- THEN the result is `{ type: 'APPLE_PAY', token }` with `token` passed
  through unchanged

#### Scenario: The public union does not gain an apple_pay member

- GIVEN the exported `PaymentMethod` union
- WHEN its members are inspected
- THEN no member names `apple_pay`, and the `APPLE_PAY` payment-method shape is
  declared only inside the strategy module

#### Scenario: The catch-all member still accepts the literal, so the guard must be runtime

- GIVEN `PaymentMethod`'s third member accepts any `type: string`
- WHEN `pay({ payment_method: { type: 'apple_pay' } })` is type-checked
- THEN it compiles — the compiler cannot be the guard, and the runtime rejection
  is owned by the change that ships the component

### Requirement: ApplePaySessionHandle.completePayment uses the version-3 object form

`ApplePaySessionHandle.completePayment` MUST accept the version-3 object form
`{ status, errors }`. It MUST NOT accept or forward a bare `STATUS_*` numeric
constant.

#### Scenario: completePayment forwards the object form unchanged

- GIVEN a call to `completePayment({ status: 'success' })`
- WHEN a fake underlying session captures the call
- THEN it receives that object, not a bare status number

#### Scenario: Declared, not verifiable here — Safari's real v3 acceptance of this shape

- GIVEN this test suite exercises only a fake session
- WHEN the object form is asserted as the contract
- THEN whether real Safari's v3 `ApplePaySession.completePayment` accepts
  exactly this shape at runtime is governed by Apple and verified only in
  Phase 7

### Requirement: Nothing added by the browser core is exported or reachable from merchant code

`src/index.ts` MUST export exactly `ApplePayAvailability`,
`ApplePayButtonOptions`, `ApplePayPaymentInput`, `ApplePayButtonComponent`,
`PaymentEvents`, and `ApplePayButtonCustomization`; no `ApplePayJS.*` member
MUST reach `dist/index.d.ts`. `ApplePayPort`, `ApplePayButtonPort`,
`ApplePaySessionHandle`, `ApplePaySessionHandlers`, `ApplePayCompletion`,
`ApplePayCompletionError`, `BrowserApplePay`, `ApplePayService`, and the
checkout orchestration service's own module MUST remain unexported —
reachability is granted to those merchant-facing types and to the
`create('apple_pay_button', …)` / `isApplePayAvailable()` methods on
`Tonder`, never to the ports or the adapter directly. `TonderCustomization`
MUST gain an `apple_pay_button` key; `TonderComponentType`,
`ComponentOptionsByType`, and `ComponentByType` MUST gain an
`apple_pay_button` member (see `public-api/spec.md`).
(Previously: no port, adapter, or strategy builder produced any new export,
any `TonderCustomization` key, or any member on an existing exported config
type; reachability from merchant code did not exist yet.)

#### Scenario: src/index.ts exports exactly the merchant-facing Apple Pay types

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are inspected
- THEN `ApplePayAvailability`, `ApplePayButtonOptions`, `ApplePayPaymentInput`,
  `ApplePayButtonComponent`, `PaymentEvents`, and `ApplePayButtonCustomization`
  are all present
- AND no `ApplePayJS.*` member is exported

#### Scenario: The port, adapter, and orchestration service classes stay unexported

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are inspected
- THEN `ApplePayPort`, `ApplePayButtonPort`, `BrowserApplePay`,
  `ApplePayService`, and the checkout orchestration service are all absent

#### Scenario: TonderCustomization has an apple_pay_button key

- GIVEN `TonderCustomization`
- WHEN its keys are inspected
- THEN `apple_pay_button` is present, typed `ApplePayButtonCustomization | undefined`

### Requirement: validateMerchant() posts an empty body to the merchant-validation endpoint

`ApplePayService.validateMerchant()` MUST issue exactly one `POST` to
`/api/v1/payments/apple-pay/validate-merchant/` over the injected
`HttpPort`, with an empty body (`{}`) and no `Authorization` header set by
the service itself — auth stays the transport's job.

#### Scenario: Exact method, path, and empty body

- GIVEN a fake `HttpPort` that resolves
- WHEN `validateMerchant()` is called
- THEN the fake receives exactly one `POST` to
  `/api/v1/payments/apple-pay/validate-merchant/` with body `{}`

#### Scenario: No client-derived value travels in the request

- GIVEN a call to `validateMerchant()`
- WHEN the captured request is inspected
- THEN it carries no `validationURL`, `merchant_identifier`, `domain_name`,
  or `initiative_context` field, and no service-set `Authorization` header

### Requirement: event.validationURL is never sent to the backend

`validateMerchant()` MUST take no parameter carrying Apple's
`event.validationURL` or any other value read from the `onvalidatemerchant`
event. No field name in the request MUST carry a client-supplied
validation URL — the backend resolves the target validation host itself.

#### Scenario: The signature has no room for a URL, and none leaks through

- GIVEN a test double exposing a `validationURL`-shaped value in scope
- WHEN `validateMerchant()` is called
- THEN its signature accepts no such argument, and the captured request
  contains no trace of that value

### Requirement: The merchant session response is returned opaque and unparsed

`validateMerchant()` MUST return the `HttpPort` response unmodified, typed
`unknown`. The service MUST NOT parse, validate, reshape, or log it.

#### Scenario: An arbitrary opaque response is passed through unchanged

- GIVEN a fake `HttpPort` that resolves with an arbitrary opaque object
- WHEN `validateMerchant()` resolves
- THEN the returned value is byte-identical to the fake's response and
  typed `unknown`

### Requirement: Transport failure wraps as APPLE_PAY_VALIDATION_ERROR

A rejecting `HttpPort` call MUST cause `validateMerchant()` to throw
`AppError` with code `ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR`, preserving
the original error via `originalError`.

#### Scenario: A rejecting HttpPort wraps into AppError

- GIVEN a fake `HttpPort` whose `request()` rejects
- WHEN `validateMerchant()` is called
- THEN it throws `AppError` with code `APPLE_PAY_VALIDATION_ERROR`
- AND the original rejection is preserved via `originalError`

### Requirement: validateMerchant() holds no session state

`validateMerchant()` MUST NOT cache a merchant session, MUST NOT retry a
failed or successful call, and MUST NOT deduplicate concurrent in-flight
calls — each invocation issues its own independent request, matching
Apple's per-transaction, single-use, five-minute-expiry rules for the
session it returns.

#### Scenario: Two calls issue two independent requests

- GIVEN a fake `HttpPort` that resolves with a distinct value on each call
- WHEN `validateMerchant()` is called twice in sequence
- THEN the fake records two separate requests, neither reusing the other's
  result

#### Scenario: A rejected call is not retried

- GIVEN a fake `HttpPort` whose `request()` rejects exactly once
- WHEN `validateMerchant()` is called and its rejection is awaited
- THEN the fake recorded exactly one request — no automatic retry occurred

### Requirement: The service depends only on the injected HttpPort

`ApplePayService` MUST depend only on the `HttpPort` passed to its
constructor. The module MUST import no DOM global and no `fetch`.

#### Scenario: The module imports no DOM or fetch API

- GIVEN the `apple-pay.service.ts` module
- WHEN its imports are inspected
- THEN only `HttpPort`, `AppError`, and `ErrorKeyEnum` appear — no DOM
  global, no `fetch`

### Requirement: APPLE_PAY_VALIDATION_ERROR resolves to a cause-hedged, distinct message

`MESSAGES_EN` MUST gain exactly one entry,
`[ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR]`, so `AppError` no longer falls
back to the `UNKNOWN_ERROR` copy for this code. The entry MUST name an
unregistered merchant domain as the most likely cause without asserting
it, and MUST remain accurate for an ordinary transport failure. It MUST
read as distinct from `APPLE_PAY_SESSION_ERROR`: this code describes the
backend failing to **obtain** a merchant session from Apple, never the
page failing to **start** a session.

#### Scenario: Entry resolves to code-specific, hedged, distinguishable copy

- GIVEN `MESSAGES_EN`
- WHEN `APPLE_PAY_VALIDATION_ERROR` is looked up
- THEN it resolves to a string distinct from both the `UNKNOWN_ERROR`
  fallback and the `APPLE_PAY_SESSION_ERROR` copy
- AND it names an unregistered domain as the most likely cause using
  hedging language, without asserting it as the sole or certain cause
- AND it describes the backend failing to obtain a session, not the page
  failing to start one

### Requirement: The click path invokes createSession and begin() synchronously, with no observable microtask in between (D1)

`create('apple_pay_button', options).mount()` MUST attach a click listener
that, on invocation, runs the following as one synchronous call stack with
no `await` anywhere in it: resolve `options.payment` (calling it
synchronously when it is a function), call `buildApplePayPaymentRequest(...)`,
call `port.createSession(request, handlers)`, then call the returned
handle's `begin()`. Any state the request needs — readiness, the cached
catalog, the cached business config, customization — MUST be read
synchronously from state `init()` already populated; none of it MUST be
awaited inside the click path. A failure thrown anywhere in this synchronous
chain MUST be reported through `events.payment.on_error`, never through a
rejected promise — the click path returns no promise a merchant can hold.

This is a proxy for Apple's real user-gesture rule
(`ApplePaySession.md:261`: the constructor throws outside a user-gesture
handler): jsdom models no user activation, so no test in this suite proves
the browser accepts the call — only that nothing in the SDK's own code
inserts an `await` before it.

#### Scenario: createSession runs before any microtask the test can observe

- GIVEN a rendered Apple Pay button and a click handler that resolves payment data synchronously
- WHEN the button is clicked
- THEN `port.createSession` is invoked before any microtask the test can observe

#### Scenario: begin() runs in the same synchronous tick as createSession

- GIVEN the same click
- WHEN `port.createSession` returns a handle
- THEN `handle.begin()` is invoked in the same synchronous call stack, with no intervening `await`

#### Scenario: A synchronous options.payment function is invoked inside the click handler

- GIVEN `options.payment` is a function
- WHEN the button is clicked
- THEN the function is called synchronously inside the click handler, and its return value is used to build the request

#### Scenario: A failure inside the click path is reported through events.payment.on_error, not a rejected promise

- GIVEN `buildApplePayPaymentRequest` throws (e.g. a zero amount)
- WHEN the button is clicked
- THEN `events.payment.on_error` is invoked with the resulting `AppError`
- AND the click handler returns no promise for the merchant to catch the failure from

#### Scenario: Declared, not verifiable here — the real gesture requirement

- GIVEN jsdom models no user activation
- WHEN the click-path synchrony above is asserted
- THEN the proxy is verified — nothing in the SDK's own code defers the call with an `await`
- AND whether Safari's real user-activation enforcement accepts a call built this way is verified only in Phase 7, on a device

### Requirement: mount() runs four ordered gates, each with its own error code (D7)

`create('apple_pay_button', options).mount()` MUST run four checks in this
fixed order, stopping at the first failure and throwing only that failure's
code — a later check MUST NOT run once an earlier one has failed:

| Order | Check                         | Code                            |
| ----- | ----------------------------- | ------------------------------- |
| 1     | `assertReady()`               | `NOT_INITIALIZED`               |
| 2     | `port.canUseApplePay()`       | `APPLE_PAY_UNSUPPORTED_BROWSER` |
| 3     | `business.apple_pay?.enabled` | `APPLE_PAY_NOT_ENABLED`         |
| 4     | `render()`'s container lookup | `APPLE_PAY_CONTAINER_NOT_FOUND` |

Gate 3 MUST NOT test the business country. A business without a `country_code`
MUST pass this gate and mount, taking the default country; no gate in this
table MUST be able to fail on an absent country.

`mount()` MUST NOT delegate to `isApplePayAvailable()`: it throws a distinct
code per gate, including the container gate the probe cannot answer. Gates 1
to 3 are nonetheless the probe's checks in the probe's order, and the two MUST
stay in step — reordering a gate here changes which reason the probe reports.

When all four pass, `mount()` MUST call `ApplePayButtonPort.render()` with
`containerId` translated from `options.container_id` (default
`'#tonder-apple-pay-button'`) and `customization` set to
`config.customization?.apple_pay_button` when present. A second `mount()`
call on the same component handle MUST dispose the previously rendered
button before rendering again; it MUST NOT abort a session already in
flight from the first mount — only `unmount()` does that.

(Previously: row 3 also required a non-empty `business.country_code`, so a
business the backend had enabled but sent no country for could not mount.
Earlier still, row 3 was "the catalog gate and `business.country_code`",
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
- AND the `apple_pay.enabled` and container checks do not run

#### Scenario: APPLE_PAY_NOT_ENABLED when apple_pay is disabled or absent

- GIVEN the SDK is ready, the browser supports Apple Pay, and `business.apple_pay?.enabled` is false or absent
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_NOT_ENABLED)`
- AND the container check does not run

#### Scenario: mount() succeeds when the business country is absent

- GIVEN the SDK is ready, the browser supports Apple Pay, `business.apple_pay?.enabled` is `true`, and `business.country_code` is absent
- WHEN `mount()` is called
- THEN it does not throw
- AND `render()` is called

#### Scenario: APPLE_PAY_CONTAINER_NOT_FOUND when the container is missing

- GIVEN the SDK is ready, the browser supports Apple Pay, and `business.apple_pay?.enabled` is `true`
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

### Requirement: A failed merchant validation aborts the session and reports the original error

When `onValidateMerchant` fails — `ApplePayService.validateMerchant()`
throwing `AppError(APPLE_PAY_VALIDATION_ERROR)` — the orchestration MUST
call `handle.abort()` and then invoke `events.payment.on_error` with that
same `AppError` instance, unmodified. It MUST NOT re-wrap the error into a
different code or a new `AppError`.

#### Scenario: A failed validate-merchant call aborts the session and reports the original error

- GIVEN a fake `HttpPort` whose validate-merchant request rejects
- WHEN the click path runs to `onvalidatemerchant`
- THEN `handle.abort()` is called
- AND `events.payment.on_error` is invoked with an `AppError` whose code is `APPLE_PAY_VALIDATION_ERROR`
- AND that error is the same instance `validateMerchant()` threw, not a newly constructed one

### Requirement: completePayment settles the sheet before the merchant callback runs, for every outcome (D2)

The orchestration MUST invoke `handle.completePayment(...)` before invoking
any `events.payment` callback, for every row of the response-mapping table
below. This ordering MUST be independently verifiable via call order (e.g.
`mock.invocationCallOrder`), because settling the sheet after the
merchant's callback would let the merchant navigate away — the callback
commonly does — while the Apple Pay sheet is still on screen.

#### Scenario: completePayment precedes on_completed for an authorized charge

- GIVEN `/process` resolves with a `Success` or `Authorized` transaction
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'success' })` is invoked strictly before `events.payment.on_completed`

#### Scenario: completePayment precedes on_completed for a declined charge

- GIVEN `/process` resolves with a declined transaction
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_completed`

#### Scenario: completePayment precedes on_error for a thrown or network failure

- GIVEN `/process` rejects
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_error`

#### Scenario: completePayment precedes on_error for an unexpected next_action

- GIVEN `/process` resolves with a `next_action.redirect_to_url.url`
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_error`

### Requirement: /process outcomes map to completePayment and the merchant callback per a fixed table (D6)

| `/process` outcome                          | `completePayment`       | Merchant callback           |
| ------------------------------------------- | ----------------------- | --------------------------- |
| `Success` / `Authorized`                    | `{ status: 'success' }` | `on_completed(transaction)` |
| Declined — HTTP 200 with a decline `status` | `{ status: 'failure' }` | `on_completed(transaction)` |
| Carries `next_action`                       | `{ status: 'failure' }` | `on_completed(transaction)` |
| Throws / network failure                    | `{ status: 'failure' }` | `on_error(AppError)`        |

The channel MUST be decided by whether a transaction exists, not by whether
its status is one the sheet can present: every `/process` response carrying a
transaction goes to `on_completed`, and only an operational failure — where
there is none — goes to `on_error`. `on_error` takes an `AppError` and no
transaction, so routing a settled charge there would cost the merchant the id
they need to reconcile or look it up. A pending action travels on
`transaction.next_action`, exactly as `pay()` delivers it.

Row 2 is load-bearing: a decline MUST report `{ status: 'failure' }` to the
sheet (so Apple does not tell the shopper the payment went through) while
still invoking `on_completed(transaction)` with the declined transaction — the
same outcome `pay()` already returns for a decline, never a throw. `Success`
and `Authorized` are the only statuses this mapping treats as an
`on_completed` sourced from a `{ status: 'success' }` completion; every other
resolved transaction is `on_completed` sourced from a `{ status: 'failure' }`
completion.

#### Scenario: An authorized charge completes as success and calls on_completed

- GIVEN `/process` resolves with status `Success` or `Authorized`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'success' }`
- AND `events.payment.on_completed` is invoked with the transaction

#### Scenario: A declined charge completes as failure to Apple but as a completed result to the merchant

- GIVEN `/process` resolves with a decline `status`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }`
- AND `events.payment.on_completed` is invoked with the same declined transaction — not `on_error`

#### Scenario: A thrown or network failure completes as failure and calls on_error

- GIVEN `/process` rejects with a transport error
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }`
- AND `events.payment.on_error` is invoked with an `AppError`

#### Scenario: A next_action response completes as failure and still reports the transaction

- GIVEN `/process` resolves with a transaction carrying `next_action.redirect_to_url.url`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }` — the charge was not approved
- AND `events.payment.on_completed` is invoked with that transaction, its pending action readable on `next_action`
- AND `events.payment.on_error` is not invoked

### Requirement: oncancel fires on_cancel and never on_error

When Apple's `oncancel` fires, the orchestration MUST invoke
`events.payment.on_cancel()` and MUST NOT invoke `events.payment.on_error`.
`completePayment` MUST NOT be called for a cancellation — the sheet is
already dismissed.

#### Scenario: Cancelling the sheet fires on_cancel only

- GIVEN a live session
- WHEN `oncancel` fires
- THEN `events.payment.on_cancel` is invoked with no arguments
- AND `events.payment.on_error` is not invoked
- AND `completePayment` is not called

### Requirement: unmount() aborts a live session; both disposal and abort are idempotent (D8)

`unmount()` MUST dispose the rendered button (the idempotent disposer
`render()` returns) and, when a session is live — created by the current
mount's click and not yet settled by `completePayment`, `abort()`, or a
fired `oncancel` — MUST call `handle.abort()`. A second `unmount()` call
MUST be a no-op: it MUST NOT call the disposer or `abort()` again, and MUST
NOT throw.

#### Scenario: unmount() during a live session aborts it

- GIVEN a click has created a session that has not yet completed
- WHEN `unmount()` is called
- THEN `handle.abort()` is called
- AND the rendered button is disposed

#### Scenario: unmount() with no live session does not call abort

- GIVEN no session has been created since the last mount, or the prior session already settled
- WHEN `unmount()` is called
- THEN `handle.abort()` is not called
- AND the rendered button is still disposed

#### Scenario: A second unmount() call is a no-op

- GIVEN `unmount()` has already been called once
- WHEN `unmount()` is called again
- THEN no error is thrown
- AND neither the disposer nor `abort()` runs a second time

### Requirement: The Apple Pay /process body is built by the same shared builder pay() uses; the token travels by reference (D3)

`ApplePayPaymentMethod` MUST join `ProcessPaymentBody['payment_method']`.
The Apple Pay orchestration MUST build its `/process` body by calling the
same exported pure function `pay()` delegates to
(`process-body.strategy.ts`) — a second, independent body-construction path
MUST NOT exist. `event.payment.token` MUST reach that body as the payment
method's `token` field BY REFERENCE — the same object `onPaymentAuthorized`
received, never `JSON.stringify`d or reshaped. The Apple Pay charge MUST be
issued through `DirectApiService.processPayment`, the same method `pay()`
calls.

#### Scenario: Both callers invoke the same exported builder function

- GIVEN a spy on the process-body builder module
- WHEN `pay()` and the Apple Pay orchestration each build a `/process` body for equivalent input
- THEN the spy observes both call sites invoking the same exported function

#### Scenario: Equivalent input produces field-for-field identical bodies outside payment_method

- GIVEN `pay()` and the Apple Pay orchestration are given equivalent amount, currency, customer, and client_reference input
- WHEN each builds its `/process` body
- THEN every field except `payment_method` is identical between the two bodies

#### Scenario: The token reaches the body by reference, never JSON.stringify'd

- GIVEN a token object received via `onPaymentAuthorized`
- WHEN the `/process` body is built
- THEN `body.payment_method.token` is that exact object (`===`), not a JSON round trip or a reshaped copy

#### Scenario: The Apple Pay charge goes through DirectApiService.processPayment

- GIVEN a completed Apple Pay authorization
- WHEN the orchestration issues the charge
- THEN it calls `DirectApiService.processPayment`, the same method `pay()` calls for every other payment method

### Requirement: pay({ payment_method: { type: 'apple_pay' } }) is rejected at runtime before any network call (D9)

`pay()` MUST throw `AppError(INVALID_PAYMENT_REQUEST)` with a
`details.system_error` naming `create('apple_pay_button')` when
`input.payment_method.type === 'apple_pay'`, before any network call. This
call type-checks: `PaymentMethod`'s third member,
`{ type: string; config?: Record<string, unknown> }`, accepts any string
literal, so the TypeScript compiler does not and structurally cannot reject
it — the guard MUST be a runtime check, not a type constraint, and no later
change MUST attempt to close this by narrowing the union.

#### Scenario: pay() rejects apple_pay before any network call

- GIVEN `pay({ payment_method: { type: 'apple_pay' } })` is called
- WHEN it runs
- THEN it throws `AppError(INVALID_PAYMENT_REQUEST)` with `details.system_error` naming `create('apple_pay_button')`
- AND no request reaches `/process`

#### Scenario: The same call still type-checks

- GIVEN `pay({ payment_method: { type: 'apple_pay' } })`
- WHEN it is type-checked
- THEN it compiles with no error — confirming the guard above is necessary and cannot be replaced by a type-level check

### Requirement: MESSAGES_EN resolves every Apple Pay code; INVALID_COMPONENT_TYPE names both component types

`MESSAGES_EN` MUST carry code-specific copy for every Apple Pay member of
`ErrorKeyEnum`, and none MUST resolve to the `UNKNOWN_ERROR` fallback. The
assertion MUST be derived from the code list rather than a fixed count, so
adding or removing a code cannot leave the check silently passing.
`MESSAGES_EN[ErrorKeyEnum.INVALID_COMPONENT_TYPE]` MUST name both
`'card_fields'` and `'apple_pay_button'` as supported component types.

(Previously: this named three added entries completing six codes.
`APPLE_PAY_UNSUPPORTED_ACTION` was later removed along with its copy, when a
`/process` response carrying `next_action` began reporting its transaction
through `on_completed`.)

#### Scenario: Every Apple Pay code resolves to code-specific copy

- GIVEN `MESSAGES_EN`
- WHEN each Apple Pay `ErrorKeyEnum` member is looked up
- THEN each resolves to a distinct, code-specific string
- AND none resolves to the `UNKNOWN_ERROR` copy

#### Scenario: INVALID_COMPONENT_TYPE names both supported component types

- GIVEN `MESSAGES_EN[ErrorKeyEnum.INVALID_COMPONENT_TYPE]`
- WHEN the string is inspected
- THEN it names both `'card_fields'` and `'apple_pay_button'`
