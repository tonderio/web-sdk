# Delta for Apple Pay

## MODIFIED Requirements

### Requirement: Public Apple Pay availability wiring waits for its full runtime

`Tonder` MUST expose a public `isApplePayAvailable(): boolean` method. It
MUST be synchronous, MUST perform no network call, and MUST NOT throw under
any input, including before `init()` runs. It MUST return the composition
`port.canUseApplePay() && hasActiveApplePayMethod(state.paymentMethodCatalog)
&& Boolean(state.business?.business.country_code)` — the browser check, the
catalog-only gate (D4), and the business country code, evaluated with `&&`
short-circuiting. A missing or empty `country_code`, an empty or unset
catalog, or a browser without Apple Pay support each independently make the
method report `false`; no one of the three is optional or bypassed by
another.
(Previously: `isApplePayAvailable()` was absent from the public facade,
deferred until browser detection, the catalog gate, and
`business.country_code` were composed together.)

#### Scenario: isApplePayAvailable exists on the public Tonder instance

- GIVEN the `Tonder` instance returned by `createTonder()`
- WHEN its members are inspected
- THEN `isApplePayAvailable` exists as a method returning `boolean`

#### Scenario: Returns true only when browser, catalog, and country all pass

- GIVEN `port.canUseApplePay()` returns `true`
- AND the cached catalog contains an active `apple_pay_*` entry
- AND `business.country_code` is a non-empty string
- WHEN `isApplePayAvailable()` runs
- THEN it returns `true`

#### Scenario: False when the browser check fails, independent of catalog and country

- GIVEN `port.canUseApplePay()` returns `false`
- AND the catalog and country checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: False when the catalog gate fails, independent of browser and country

- GIVEN the cached catalog contains no `apple_pay_*` entry
- AND the browser and country checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: False when country_code is absent, independent of browser and catalog

- GIVEN `business.country_code` is absent or empty
- AND the browser and catalog checks would otherwise pass
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`

#### Scenario: Never throws, including before init()

- GIVEN `init()` has not been called, so the catalog and business state are unset
- WHEN `isApplePayAvailable()` runs
- THEN it returns `false`
- AND it does not throw

### Requirement: Nothing added by the browser core is exported or reachable from merchant code

`src/index.ts` MUST export exactly `ApplePayButtonOptions`,
`ApplePayPaymentInput`, `ApplePayButtonComponent`, `PaymentEvents`, and
`ApplePayButtonCustomization`; no `ApplePayJS.*` member MUST reach
`dist/index.d.ts`. `ApplePayPort`, `ApplePayButtonPort`,
`ApplePaySessionHandle`, `ApplePaySessionHandlers`, `ApplePayCompletion`,
`ApplePayCompletionError`, `BrowserApplePay`, `ApplePayService`, and the
checkout orchestration service's own module MUST remain unexported —
reachability is granted to the five merchant-facing types and to the
`create('apple_pay_button', …)` / `isApplePayAvailable()` methods on
`Tonder`, never to the ports or the adapter directly. `TonderCustomization`
MUST gain an `apple_pay_button` key; `TonderComponentType`,
`ComponentOptionsByType`, and `ComponentByType` MUST gain an
`apple_pay_button` member (see `public-api/spec.md`).
(Previously: no port, adapter, or strategy builder produced any new export,
any `TonderCustomization` key, or any member on an existing exported config
type; reachability from merchant code did not exist yet.)

#### Scenario: src/index.ts exports exactly the five Apple Pay types

- GIVEN the public entry point `src/index.ts`
- WHEN its exports are inspected
- THEN `ApplePayButtonOptions`, `ApplePayPaymentInput`,
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

## ADDED Requirements

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

| Order | Check                                        | Code                            |
| ----- | -------------------------------------------- | ------------------------------- |
| 1     | `assertReady()`                              | `NOT_INITIALIZED`               |
| 2     | `port.canUseApplePay()`                      | `APPLE_PAY_UNSUPPORTED_BROWSER` |
| 3     | the catalog gate and `business.country_code` | `APPLE_PAY_NOT_ENABLED`         |
| 4     | `render()`'s container lookup                | `APPLE_PAY_CONTAINER_NOT_FOUND` |

When all four pass, `mount()` MUST call `ApplePayButtonPort.render()` with
`containerId` translated from `options.container_id` (default
`'#tonder-apple-pay-button'`) and `customization` set to
`config.customization?.apple_pay_button` when present. A second `mount()`
call on the same component handle MUST dispose the previously rendered
button before rendering again; it MUST NOT abort a session already in
flight from the first mount — only `unmount()` does that.

#### Scenario: NOT_INITIALIZED when the SDK is not ready

- GIVEN `init()` has not resolved
- WHEN `mount()` is called
- THEN it throws `AppError(NOT_INITIALIZED)`
- AND no later check runs

#### Scenario: APPLE_PAY_UNSUPPORTED_BROWSER when the browser check fails

- GIVEN the SDK is ready and `port.canUseApplePay()` returns `false`
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_UNSUPPORTED_BROWSER)`
- AND the catalog/country and container checks do not run

#### Scenario: APPLE_PAY_NOT_ENABLED when the catalog gate or country code fails

- GIVEN the SDK is ready, the browser supports Apple Pay, and either no `apple_pay_*` method is active or `business.country_code` is absent
- WHEN `mount()` is called
- THEN it throws `AppError(APPLE_PAY_NOT_ENABLED)`
- AND the container check does not run

#### Scenario: APPLE_PAY_CONTAINER_NOT_FOUND when the container is missing

- GIVEN the SDK is ready, the browser supports Apple Pay, and at least one `apple_pay_*` method is active with a country code set
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

#### Scenario: completePayment precedes on_success for an authorized charge

- GIVEN `/process` resolves with a `Success` or `Authorized` transaction
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'success' })` is invoked strictly before `events.payment.on_success`

#### Scenario: completePayment precedes on_success for a declined charge

- GIVEN `/process` resolves with a declined transaction
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_success`

#### Scenario: completePayment precedes on_error for a thrown or network failure

- GIVEN `/process` rejects
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_error`

#### Scenario: completePayment precedes on_error for an unexpected next_action

- GIVEN `/process` resolves with a `next_action.redirect_to_url.url`
- WHEN `onpaymentauthorized` completes
- THEN `handle.completePayment({ status: 'failure' })` is invoked strictly before `events.payment.on_error`

### Requirement: /process outcomes map to completePayment and the merchant callback per a fixed table (D6)

| `/process` outcome                           | `completePayment`       | Merchant callback                                  |
| -------------------------------------------- | ----------------------- | -------------------------------------------------- |
| `Success` / `Authorized`                     | `{ status: 'success' }` | `on_success(transaction)`                          |
| Declined — HTTP 200 with a decline `status`  | `{ status: 'failure' }` | `on_success(transaction)`                          |
| Throws / network failure                     | `{ status: 'failure' }` | `on_error(AppError)`                               |
| Unexpected `next_action.redirect_to_url.url` | `{ status: 'failure' }` | `on_error(AppError(APPLE_PAY_UNSUPPORTED_ACTION))` |

Row 2 is load-bearing: a decline MUST report `{ status: 'failure' }` to the
sheet (so Apple does not tell the shopper the payment went through) while
still invoking `on_success(transaction)` with the declined transaction — the
same outcome `pay()` already returns for a decline, never a throw. `Success`
and `Authorized` are the only statuses this mapping treats as an
`on_success` sourced from a `{ status: 'success' }` completion; every other
resolved transaction is `on_success` sourced from a `{ status: 'failure' }`
completion.

#### Scenario: An authorized charge completes as success and calls on_success

- GIVEN `/process` resolves with status `Success` or `Authorized`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'success' }`
- AND `events.payment.on_success` is invoked with the transaction

#### Scenario: A declined charge completes as failure to Apple but success to the merchant

- GIVEN `/process` resolves with a decline `status`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }`
- AND `events.payment.on_success` is invoked with the same declined transaction — not `on_error`

#### Scenario: A thrown or network failure completes as failure and calls on_error

- GIVEN `/process` rejects with a transport error
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }`
- AND `events.payment.on_error` is invoked with an `AppError`

#### Scenario: An unexpected next_action completes as failure with APPLE_PAY_UNSUPPORTED_ACTION

- GIVEN `/process` resolves with a `next_action.redirect_to_url.url`
- WHEN the orchestration processes the result
- THEN `completePayment` receives `{ status: 'failure' }`
- AND `events.payment.on_error` is invoked with `AppError(APPLE_PAY_UNSUPPORTED_ACTION)`

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

### Requirement: MESSAGES_EN resolves all six Apple Pay codes; INVALID_COMPONENT_TYPE names both component types

`MESSAGES_EN` MUST gain three entries — `APPLE_PAY_NOT_ENABLED`,
`APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_UNSUPPORTED_ACTION` —
completing all six Apple Pay codes with code-specific copy; none of the six
MUST resolve to the `UNKNOWN_ERROR` fallback.
`MESSAGES_EN[ErrorKeyEnum.INVALID_COMPONENT_TYPE]` MUST name both
`'card_fields'` and `'apple_pay_button'` as supported component types.

#### Scenario: All six Apple Pay codes resolve to code-specific copy

- GIVEN `MESSAGES_EN`
- WHEN each of the six Apple Pay `ErrorKeyEnum` members is looked up
- THEN each resolves to a distinct, code-specific string
- AND none resolves to the `UNKNOWN_ERROR` copy

#### Scenario: INVALID_COMPONENT_TYPE names both supported component types

- GIVEN `MESSAGES_EN[ErrorKeyEnum.INVALID_COMPONENT_TYPE]`
- WHEN the string is inspected
- THEN it names both `'card_fields'` and `'apple_pay_button'`
