# Delta for Apple Pay

## ADDED Requirements

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
equal the output of the Apple Pay catalog gate's `resolveApplePayMerchantCapabilities`
helper, never a re-derivation. `supportedNetworks` MUST equal the output of
that gate's `resolveApplePayNetworks` helper. `countryCode` MUST come from
`business.country_code`; the sheet's total label MUST come from
`business.name`.

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

#### Scenario: Capabilities and networks pass through the catalog helpers unchanged

- GIVEN a catalog whose helper outputs are known
- WHEN the request is built
- THEN `merchantCapabilities` and `supportedNetworks` exactly equal what
  `resolveApplePayMerchantCapabilities` and `resolveApplePayNetworks` return
  for that catalog

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

`src/index.ts` MUST export no new member as a result of the port, the
adapter, or the two strategy builders. `TonderCustomization` MUST NOT gain an
`apple_pay_button` key. No existing exported config type MUST gain a member
referencing `ApplePayPort`, `ApplePayButtonPort`, the adapter, or either
strategy builder. Reachability from merchant code is established only in the
change that wires a public entry point to this code.

#### Scenario: src/index.ts gains no new export

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are diffed against the state before this change
- THEN no new member is exported

#### Scenario: TonderCustomization has no apple_pay_button key

- GIVEN `TonderCustomization`
- WHEN its keys are inspected
- THEN `apple_pay_button` is absent
