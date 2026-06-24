# Cross-Cutting Spec — Message Contract, Regression, and Scope Guards

## ADDED Requirements

### Requirement: postMessage event strings match BrowserCheckoutMessenger contract

The postMessage events emitted by `spa-midd-checkout/ProcessCheckout.tsx` MUST use exactly the event strings defined in `COMPLETION_EVENTS` inside `BrowserCheckoutMessenger`:
- `'checkout.completed'` — on success
- `'checkout.failed'` — on failure

No other event string is a recognized completion event. The shape MUST be `{ event: '<string>' }` at minimum; additional fields in the object are ignored by the adapter and are acceptable but not required.

#### Scenario: SDK adapter accepts checkout.completed

- GIVEN `BrowserCheckoutMessenger.waitForCompletion()` is listening
- AND the origin of the message is in `allowedOrigins` (payflow domain)
- WHEN a `MessageEvent` arrives with `data.event === 'checkout.completed'`
- THEN the promise resolves (fast path wins over poll)

#### Scenario: SDK adapter accepts checkout.failed

- GIVEN `BrowserCheckoutMessenger.waitForCompletion()` is listening
- AND the origin is allowed
- WHEN a `MessageEvent` arrives with `data.event === 'checkout.failed'`
- THEN the promise resolves (fast path; SDK proceeds to getTransaction to determine error detail)

#### Scenario: SDK adapter ignores unrecognized event strings

- GIVEN `BrowserCheckoutMessenger.waitForCompletion()` is listening
- WHEN a `MessageEvent` arrives with `data.event` set to any string not in `COMPLETION_EVENTS`
- THEN the adapter ignores it (promise remains pending; poll fallback may still win)

---

## ADDED Requirements (Regression Guards)

### Requirement: redirect mode is end-to-end unchanged

No code path activated when `config.threeDsMode !== 'embedded'` (or is unset) MUST change behavior compared to the pre-change state. This applies across all three repositories.

#### Scenario: redirect flow unaffected in web-sdk

- GIVEN `threeDsMode` is `'redirect'` or unset
- WHEN a payment is processed end-to-end
- THEN no `embedded_completion` field is sent in the POST /api/v1/process/ body
- AND the redirect flow proceeds identically to pre-change behavior

#### Scenario: redirect flow unaffected in zplit-back

- GIVEN the POST /api/v1/process/ request body does not include `embedded_completion`
- WHEN the backend processes the request
- THEN no behavioral change occurs; serializer default (`False`) propagates silently

#### Scenario: redirect flow unaffected in spa-midd-checkout

- GIVEN the JWT decoded by ProcessCheckout.tsx does not have `embedded_completion === true` at the top-level
- WHEN the 3DS flow completes
- THEN `window.location.href` redirect behavior is identical to pre-change behavior; no postMessage

---

### Requirement: hosted-checkout flow is untouched

The `app/checkout` (hosted-checkout) module in `spa-midd-checkout`, the `post_message_enabled` session-level flag in `zplit-back`, and the hosted-checkout templates MUST NOT be modified by this change. These are a separate flow and MUST remain isolated.

#### Scenario: hosted-checkout files unmodified

- GIVEN this change is fully applied
- WHEN a diff is inspected
- THEN no files under `spa-midd-checkout/src/app/checkout/**` have been modified

---

### Requirement: no polling added to spa-midd-checkout /process page

The `ProcessCheckout.tsx` component and any child component rendered at the `/process` route MUST NOT introduce any polling mechanism (interval-based status checks, recursive fetch calls, or equivalent). The `/process` page reads final status from URL params appended by `challengeCallbackHandler` and emits postMessage. All polling remains the SDK's responsibility via `pollTransaction`.

#### Scenario: no polling code on /process page

- GIVEN this change is applied
- WHEN `ProcessCheckout.tsx` and its direct children are inspected
- THEN no `setInterval`, `setTimeout`-loop, or recursive polling fetch is present in the completion path
