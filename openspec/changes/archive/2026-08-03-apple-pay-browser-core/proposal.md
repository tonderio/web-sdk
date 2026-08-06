# Proposal: Apple Pay Browser Core (Phase 3)

## Intent

Phase 3 of `docs/apple-pay-integration-plan.md` §6. The first change that touches the
browser, and the last one that ships **no reachable surface**: a port, its browser adapter,
and two pure builders. Nothing is exported, nothing is wired, no merchant can call any of it.

The reason to isolate it is not size — it is **testability**. Vitest runs in Node. There is no
`ApplePaySession`, no Safari, no HTTPS and no registered Apple domain in CI, so a real session
can only be exercised on a device. The port boundary drawn here is therefore what decides
which parts of the Phase 5 orchestration stay verifiable against a fake and which can only be
checked on hardware. A badly cut port leaves Phase 5 holding logic nobody can test until a
human opens Safari.

Phase 2 left three pure catalog helpers with no consumer. This change gives them their first
one: `buildApplePayPaymentRequest()` assembles their output into the request object Apple's
constructor accepts.

## Scope

### In Scope

| Item                                                                                                                                                                                                                                     | File                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `buildApplePayPaymentRequest(...)` — `total.amount` as a `> 0` 2-decimal **string**, `merchantCapabilities` and `supportedNetworks` from Phase 2's helpers, `countryCode` from `business.country_code`, sheet label from `business.name` | `src/core/strategies/apple-pay.strategy.ts` (new) |
| `buildApplePayPaymentMethod(token)` → `{ type: 'APPLE_PAY', token }`, a **local** interface mirroring `CardPaymentMethod`, not a new member of the public `PayInput` union                                                               | same file                                         |
| `ApplePayPort` (capability + session creation), `ApplePaySessionHandle`, `ApplePaySessionHandlers`, `ApplePayButtonPort`                                                                                                                 | `src/ports/apple-pay.port.ts` (new)               |
| Browser adapter — the ONLY module touching `window.ApplePaySession` or button DOM; renders via `-webkit-appearance: -apple-pay-button`, applies `ApplePayButtonCustomization`, returns a disposer                                        | `src/adapters/browser/apple-pay.adapter.ts` (new) |
| `MESSAGES_EN` entries for the **two** codes this change is the first to throw — `APPLE_PAY_SESSION_ERROR` and `APPLE_PAY_CONTAINER_NOT_FOUND` (plan §5.2 forward constraint)                                                             | `src/shared/errors/`                              |

### Out of Scope

Orchestration (click → session → validate → process), `tonder.create('apple_pay_button')`,
`tonder.isApplePayAvailable()`, the merchant-validation service, `TonderComponentType`
widening, `events.payment` wiring, README. Phases 4 and 5.

**Also out of scope — rejecting `pay({ payment_method: { type: 'apple_pay' } })`.** The public
`PaymentMethod` union is left deliberately unchanged, and it does **not** catch this today:

```ts
// src/shared/types/index.ts:121-124
export type PaymentMethod =
  | { type: 'card' }
  | { type: 'saved_card'; card_id: string }
  | { type: string; config?: Record<string, unknown> }; // ← swallows any string literal
```

The third member accepts any string, so `{ type: 'apple_pay' }` type-checks now and will keep
type-checking. Rejection is a **runtime `AppError`, owned by Phase 5** (plan §1.2).

> **Forward constraint (Phase 5).** The guard must run **before the request body is built**,
> and its message must name the component as the correct path. Without it the call falls
> through as a generic APM and is **sent to `/process` as `{ type: 'apple_pay' }`** — the
> merchant gets a confusing backend error instead of a pointer to
> `create('apple_pay_button')`. That guard is not developer-experience polish; it is what stops
> a malformed charge attempt from reaching the API.

**Also out of scope — every form of reachability (inherited D3).** No `src/index.ts` export,
and specifically **no `apple_pay_button?` key on `TonderCustomization`** (see D1 below).

The other four error codes keep their `MESSAGES_EN` entries deferred: `APPLE_PAY_NOT_ENABLED`
and `APPLE_PAY_UNSUPPORTED_BROWSER` are thrown by Phase 5's `mount()` gate,
`APPLE_PAY_VALIDATION_ERROR` by Phase 4, `APPLE_PAY_UNSUPPORTED_ACTION` by Phase 5's response
mapping.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `apple-pay`: adds the port contract, the browser adapter's behavior, and the two pure
  request/payment-method builders. Extends the existing derivation requirements with their
  first consumer. Delta targets `openspec/specs/apple-pay/spec.md`.

## Approach

### The port cut, and what it buys

`ApplePayPort` exposes exactly three things, and each one exists to move a Phase 5 assertion
from "hardware only" to "fake only".

```ts
canUseApplePay(): boolean                                 // never throws — absence is a state
createSession(request, handlers): ApplePaySessionHandle   // SYNCHRONOUS; throws AppError
// ApplePaySessionHandle: begin | completeMerchantValidation | completePayment | abort
```

**Handlers are constructor arguments, not assignable properties.** The gesture constraint
(plan §1.2) means create-and-wire must happen in one tick; passing handlers into
`createSession` makes that a type-level guarantee instead of a convention, and lets a fake
capture them and drive the whole flow from a test.

**Apple's event objects never cross the port.** The handlers are normalized:

| Handler                 | Argument       | Why                                                                                                                                                                                  |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onValidateMerchant`    | none           | `event.validationURL` is deliberately unread (plan §4.2 — SSRF, and Apple's current guidance is a static hostname). A port that passed it through would invite Phase 5 to forward it |
| `onPaymentAuthorized`   | the token only | Everything else on the event is Apple's business                                                                                                                                     |
| `oncancel` → `onCancel` | none           | Cancellation carries no data                                                                                                                                                         |

camelCase handler names follow the existing internal port precedent (`ThreeDsHostOptions.onOpen`
/ `onUserClose`); the snake_case rule binds merchant-facing surfaces, and none of this is one.

`ApplePayButtonPort.render()` owns `addEventListener('click')` and returns a disposer that
removes both node and listener. The listener cannot live in core — and routing the click
through a merchant-visible callback layer is exactly how a gesture chain gets broken.

### What stays verifiable, and what genuinely does not

**Verifiable with a fake port, in Phase 5** — the entire orchestration: `createSession` called
synchronously inside the click listener before any microtask; `completePayment` before the
merchant callback; all four rows of the §4.4 response mapping; the four `mount()` failures;
`unmount()` aborting a live session; cancel firing `on_cancel` and never `on_error`.

**Verifiable with jsdom + a fake global, in this change** — `canUseApplePay()` returning
`false` without throwing when `window.ApplePaySession` is undefined; the button node, its
customization mapping and its disposer; a throwing constructor surfacing as
`AppError(APPLE_PAY_SESSION_ERROR)` and a missing container as
`AppError(APPLE_PAY_CONTAINER_NOT_FOUND)`.

**Only verifiable in Safari on a device (Phase 7). Named, not papered over:**

1. That Safari **accepts** our `ApplePayPaymentRequest`. A fake constructor accepts anything;
   the validity rules are Apple's (`ApplePaySession.md:257-261`).
2. That `-webkit-appearance: -apple-pay-button` **renders**. jsdom has no WebKit — the test can
   only assert we set the property.
3. The **real** gesture requirement. jsdom models no user activation; the synchrony assertion
   is a proxy for it, and a good one, but a proxy.
4. HTTPS + registered-domain enforcement, the merchant-validation round trip, Face ID, and the
   sheet's own lifecycle.
5. What `supportsVersion(3)` and `canMakePayments()` actually return on real hardware.

The port does not eliminate that list. It reduces it to five statements about **Apple's**
behavior, none about ours.

### Decisions

**D1 — `ApplePayButtonCustomization` is consumed here but NOT wired onto `TonderCustomization`.**
The adapter applies customization it is _handed_; nothing hands it any until Phase 5 mounts a
button, so a merchant setting `customization.apple_pay_button` today gets a config that is
accepted and silently ignored — the exact failure inherited D3 exists to prevent. Wiring lands
with `create('apple_pay_button')`, in one change.

> **Not a disagreement with the plan.** `docs/apple-pay-integration-plan.md` §3.3 assigned this
> wiring to "the phase whose adapter applies them", which reads like this phase because the
> adapter lands here. The plan wording is being corrected to **"the phase where the styles
> actually reach the DOM"** — which is Phase 5. Same rule, sharper test. D1 is that correction
> applied, not an exception to it.

**D2 — `canUseApplePay()` is browser-only.** `window.ApplePaySession` present,
`supportsVersion(3)`, `canMakePayments()`. No catalog, no `country_code`. This is D4's split
applied to the other side: Phase 2's gate is catalog-only, this is browser-only, and Phase 5's
public `isApplePayAvailable()` is their composition. Each half stays testable in isolation, and
the browser half never needs a business fixture.

`APPLE_PAY_UNSUPPORTED_BROWSER` is therefore **not** thrown here: it belongs to Phase 5's
`mount()` gate, which raises it when this boolean is `false`. Behind that gate, a
`createSession` call in a browser with no `ApplePaySession` is unreachable; the adapter still
reports it as `APPLE_PAY_SESSION_ERROR` rather than letting a raw `TypeError` escape.

**D3 — The adapter throws `AppError`, matching the majority convention.** A missing container
throws `APPLE_PAY_CONTAINER_NOT_FOUND`; a throwing `ApplePaySession` constructor is caught and
rethrown as `APPLE_PAY_SESSION_ERROR`.

An earlier revision of this proposal returned `null` instead, on the stated grounds that
`ErrorKeyEnum` stays out of `adapters/`. **That is not a property this codebase has** — six of
seven adapters import it and throw:

| Adapter                                                                                                                                             | imports `ErrorKeyEnum` |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `kushki.adapter.ts`, `skyflow.adapter.ts`, `fetch-http.client.ts`, `browser-checkout-messenger.adapter.ts`, `kushki-loader.ts`, `skyflow-loader.ts` | yes                    |
| `browser-3ds-host.adapter.ts`                                                                                                                       | no                     |

The 3DS host is the outlier precisely because it is pure DOM manipulation with no failure mode
worth reporting. This adapter has two.

Two consequences follow, and both are the existing rules working rather than new scope:

1. **The codes already exist for this.** Phase 1 declared `APPLE_PAY_SESSION_ERROR` and
   `APPLE_PAY_CONTAINER_NOT_FOUND` and left them unused, waiting for the phase that throws
   them. `null` would discard the very information they encode and leave them unused again.
2. **`MESSAGES_EN` is owed here.** Plan §5.2's forward constraint says the phase that first
   throws a code owns adding its message. This change throws two, so it adds two entries. It is
   in the scope table above.

**`canUseApplePay()` still returns a plain boolean and never throws.** Apple Pay being absent
is a state, not a failure. The two failures that _are_ failures — "the constructor rejected the
request" and "that container id matches nothing" — stay distinguishable to a merchant debugging
at 2 AM, which is the whole reason §5.2 has four `mount()` codes instead of one
`CREATE_ERROR`.

**D4 — `total.amount` is a string, `/process` `amount` is a number.** Not a bug to be fixed in
either direction: Apple's constructor throws on a zero or negative total and requires the
2-decimal string form (`ApplePaySession.md:260`); `/process` takes the number. Both
representations carry a code comment saying the other exists.

**D5 — Apple's ambient types stay confined to the port and adapter.** `@types/applepayjs` is a
devDependency; a consumer without it must never receive a `.d.ts` referencing `ApplePayJS.*`.
Nothing here is exported from `src/index.ts`, so the constraint holds trivially today — it is
recorded because Phase 5 is where it could break.

### Work units

Commits only — **no pull requests**. Three units, each green on `npm run test`,
`npm run typecheck` and `npm run build`:

1. `apple-pay.strategy.ts` — pure builders, no DOM, no globals, no mocks
2. `apple-pay.port.ts` + the session half of the adapter, tested with a fake `ApplePaySession`;
   carries the `APPLE_PAY_SESSION_ERROR` message entry
3. The button half of the adapter — render, customization, disposer — tested in jsdom; carries
   the `APPLE_PAY_CONTAINER_NOT_FOUND` message entry

Each message entry ships in the unit that first throws its code, not in a separate copy commit.

Strict TDD applies to all three: this is runtime behavior, not the erased type assertions of
Phase 1.

Binding constraints (plan §7): `core/` stays pure; the adapter is the only DOM/global consumer;
test doubles live in `*.test.ts` and never under `src/`; `completePayment` takes the v3 object
form `{ status, errors }`, never a bare `STATUS_*`; no duplicated interfaces; no unnecessary
validation.

## Affected Areas

| Area                                        | Impact    | Description                                                                            |
| ------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `src/core/strategies/apple-pay.strategy.ts` | New       | Pure request + payment-method builders                                                 |
| `src/ports/apple-pay.port.ts`               | New       | Capability, session and button contracts                                               |
| `src/adapters/browser/apple-pay.adapter.ts` | New       | Sole `window.ApplePaySession` / button DOM consumer; throws the two codes it detects   |
| `src/shared/errors/`                        | Modified  | Two `MESSAGES_EN` entries — `APPLE_PAY_SESSION_ERROR`, `APPLE_PAY_CONTAINER_NOT_FOUND` |
| `src/index.ts`                              | Unchanged | Verified by absence                                                                    |
| `src/types/customization.ts`                | Unchanged | D1 — no `apple_pay_button` key yet                                                     |

## Risks

| Risk                                                                                                                    | Likelihood | Mitigation                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The port proves wrong in Phase 5 and gets reshaped inside a behavioral diff                                             | **Med**    | The port is designed backwards from Phase 5's required-test list (plan §6); every listed assertion must be expressible against the fake before the port is accepted |
| A fake global makes the adapter look correct while Safari rejects the request                                           | **Med**    | Explicitly named as Phase 7 work, not claimed as covered. The builders are asserted against Apple's documented field rules, not against a fake's tolerance          |
| Someone "finishes the job" by wiring `apple_pay_button` onto `TonderCustomization` or exporting a type                  | **Med**    | D1 states it; success criteria verify absence in both places                                                                                                        |
| The two new `MESSAGES_EN` entries drift from the merchant copy Phase 5 writes for the other four codes                  | Low        | Written in the existing "what do I do now?" style (plan §7); Phase 5 reviews all six together when it adds the remaining four                                       |
| `merchantCapabilities: ['supports3DS']` deleted as contradictory with "Apple Pay bypasses 3DS"                          | Low        | Comment already exists at the Phase 2 derivation site; the request builder repeats the pointer                                                                      |
| jsdom silently drops `-webkit-appearance`, so the button test asserts nothing real                                      | Low        | Assert the property we set on the node, and state in the test what it does and does not prove                                                                       |
| Pre-existing red `npm run lint` (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) hides a new error | Low        | Compare the lint error set before and after; do not fix the two                                                                                                     |

## Rollback Plan

Revert the three commits in reverse order. Every file is new and has no importer outside its
own test — units 2 and 3 can be dropped independently, unit 1 is a pure module. No public
surface, no persisted data, no backend contract, no migration.

## Dependencies

- Phase 2 (`apple-pay-catalog-gate`) — archived. Supplies `resolveApplePayNetworks`,
  `resolveApplePayMerchantCapabilities`, `hasActiveApplePayMethod`.
- Phase 1 (`apple-pay-foundation`) — archived. Supplies `@types/applepayjs`, the six error
  codes and `ApplePayButtonCustomization`.
- Backend: none. Nothing here makes a network call.

## Success Criteria

- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass
- [ ] Strategy is tested with **no mocks** — pure input, pure output
- [ ] `total.amount` is a 2-decimal string and rejects a zero or negative total before Apple's
      constructor ever sees it
- [ ] `merchantCapabilities` and `supportedNetworks` come from Phase 2's helpers, not
      recomputed
- [ ] `buildApplePayPaymentMethod` returns a local type — the public `PaymentMethod` union in
      `src/shared/types/index.ts` is unchanged, gaining no `apple_pay` member
- [ ] `canUseApplePay()` returns `false` with no throw when `window.ApplePaySession` is
      undefined — absence is a state, never an error
- [ ] `createSession` throws `AppError(APPLE_PAY_SESSION_ERROR)` when the constructor throws,
      and `render` throws `AppError(APPLE_PAY_CONTAINER_NOT_FOUND)` for an unmatched container
      id — the two remain distinguishable
- [ ] `MESSAGES_EN` gains exactly two entries, and `AppError` no longer falls back to the
      `UNKNOWN_ERROR` copy for either code. The other four codes still have no entry
- [ ] The button disposer removes both the node and its click listener; a second call is a
      no-op
- [ ] `src/index.ts` exports nothing new; `TonderCustomization` has no `apple_pay_button` key;
      `TonderComponentType` is still exactly `'card_fields'`
- [ ] No file under `src/` exists only for testing; `core/` imports no DOM or HTTP module
- [ ] The lint error set is identical before and after

## Proposal question round — resolved

| #   | Question                                                                        | Ruling                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does `TonderCustomization.apple_pay_button` get wired here, as plan §3.3 reads? | **No — confirmed.** Nothing invokes the adapter until Phase 5, so the key would be accepted and silently ignored. Plan §3.3 is being reworded to "the phase where the styles actually reach the DOM"; D1 is that correction, not a deviation from it |
| 2   | Adapter returns `null`, or throws `AppError`?                                   | **Throws — reversed from the first revision.** The "keep `ErrorKeyEnum` out of `adapters/`" premise was false: six of seven adapters already throw. See D3 for the table, and for the two `MESSAGES_EN` entries that follow from plan §5.2           |
| 3   | Handlers as `createSession` arguments rather than assignable properties?        | **Yes.** It converts the gesture constraint from something a future author must remember into something the type system enforces, and the fake never has to synthesize an Apple event                                                                |
| 4   | Does `canUseApplePay()` include `canMakePayments()`?                            | **Yes.** Phase 5 must not have to call it separately. It still returns a plain boolean and never throws                                                                                                                                              |

No open questions remain. Scope is frozen at the four files in the table above.
