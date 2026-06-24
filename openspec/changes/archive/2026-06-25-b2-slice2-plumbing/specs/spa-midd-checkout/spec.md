# Delta for spa-midd-checkout — embedded_completion postMessage emission

## ADDED Requirements

### Requirement: CheckoutTokenInterface declares embedded_completion

`CheckoutTokenInterface` (or the equivalent TypeScript interface that models the decoded JWT payload) MUST include `embedded_completion?: boolean` as a top-level optional field, consistent with how the backend places the flag in the JWT.

#### Scenario: interface accepts the flag

- GIVEN a decoded JWT payload that includes `embedded_completion: true` at the top-level
- WHEN the type is used in ProcessCheckout.tsx
- THEN TypeScript compilation succeeds with no type error when accessing `decodedToken?.embedded_completion`

---

### Requirement: ProcessCheckout emits postMessage on completion when flag is set

`ProcessCheckout.tsx` MUST emit `window.parent.postMessage({ event: 'checkout.completed' | 'checkout.failed' }, '*')` when ALL of:
1. The decoded JWT has `embedded_completion === true` at the top-level
2. The 3DS flow on the page reaches its final state (success or failure)

The emit MUST occur for BOTH provider branches — `ThreeDSPayment.tsx` (provider `'tonder'`) and `KushkiPayment.tsx` (provider `'kushki'`) via a shared helper function.
The emit MUST use `targetOrigin: '*'` (no secrets are in the payload; origin validation is on the SDK side).
The emit MUST use the exact event strings `'checkout.completed'` and `'checkout.failed'` — no other strings.

#### Scenario: tonder provider — success emits checkout.completed

- GIVEN the decoded JWT has `embedded_completion === true` at the top-level
- AND `provider === 'tonder'`
- WHEN the `ThreeDSPayment.tsx` branch signals a successful completion
- THEN `window.parent.postMessage({ event: 'checkout.completed' }, '*')` is called

#### Scenario: tonder provider — failure emits checkout.failed

- GIVEN the decoded JWT has `embedded_completion === true` at the top-level
- AND `provider === 'tonder'`
- WHEN the `ThreeDSPayment.tsx` branch signals a failure or error state
- THEN `window.parent.postMessage({ event: 'checkout.failed' }, '*')` is called

#### Scenario: kushki provider — success emits checkout.completed

- GIVEN the decoded JWT has `embedded_completion === true` at the top-level
- AND `provider === 'kushki'`
- WHEN the `KushkiPayment.tsx` branch signals a successful completion
- THEN `window.parent.postMessage({ event: 'checkout.completed' }, '*')` is called

#### Scenario: kushki provider — failure emits checkout.failed

- GIVEN the decoded JWT has `embedded_completion === true` at the top-level
- AND `provider === 'kushki'`
- WHEN the `KushkiPayment.tsx` branch signals a failure
- THEN `window.parent.postMessage({ event: 'checkout.failed' }, '*')` is called

---

### Requirement: postMessage is NOT emitted when embedded_completion is false or absent

When the top-level JWT claim `embedded_completion` is `false`, `undefined`, or absent from the decoded JWT, `ProcessCheckout.tsx` MUST NOT call `window.parent.postMessage` for any completion event.
The existing `redirectToReturnUrl()` behavior (`window.location.href = return_url`) MUST remain intact for this path.

#### Scenario: flag absent — redirect behavior preserved

- GIVEN the decoded JWT does NOT have `embedded_completion === true` at the top-level
- WHEN the 3DS flow on the page reaches its final state
- THEN `window.parent.postMessage` is NOT called
- AND `window.location.href` is set to `return_url` (existing redirect behavior)

#### Scenario: flag false — redirect behavior preserved

- GIVEN the decoded JWT has `embedded_completion === false` at the top-level
- WHEN the 3DS flow on the page reaches its final state
- THEN `window.parent.postMessage` is NOT called
- AND `window.location.href` is set to `return_url`
