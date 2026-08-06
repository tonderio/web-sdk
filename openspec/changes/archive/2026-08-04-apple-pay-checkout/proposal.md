# Proposal: Apple Pay Checkout — Orchestration and Public API (Phase 5)

## Intent

Phase 5 of `docs/apple-pay-integration-plan.md` §6. The first phase a merchant can use, and
the largest: it assembles the pieces Phases 1–4 shipped into a working payment.

Four changes have landed types, a catalog gate, a port + adapter + pure strategy, and the
merchant-validation round trip. None of them is reachable from merchant code. This change
adds the orchestration that connects them — click → build request → create session →
`onValidateMerchant` → `/process` → `completePayment` (plan §2) — and the public surface that
exposes it: `tonder.create('apple_pay_button', options)` with `mount()` / `unmount()`, and
`tonder.isApplePayAvailable()`.

**This is also the change that earns the wiring.** Inherited decision D3 — _a type may be
declared before its behavior exists; it may not be wired into a reachable public surface
before its behavior exists_ — has been used four times to defer. `events.payment` on
`TonderEvents`, `apple_pay_button` on `TonderCustomization`, `apple_pay_button` in
`TonderComponentType` / `ComponentOptionsByType` / `ComponentByType`, and the corresponding
`src/index.ts` exports all land here, because here is where each of them acquires behavior.
D3 stops deferring in this change; it does not get invoked again.

## Scope

### In Scope

| Item                                                                                                                                                                             | File                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Extract `Tonder.buildProcessBody()` (private, `src/tonder.ts:982`) into a shared pure function; `pay()` delegates to it, unchanged                                               | `src/core/strategies/process-body.strategy.ts` (new)                                           |
| Orchestration: click → resolve payment → build request → `createSession` → `begin()` → validate → `/process` → `completePayment` → merchant callback                             | `src/core/services/apple-pay-checkout.service.ts` (new)                                        |
| `ApplePayPaymentMethod` joins the `ProcessPaymentBody['payment_method']` union (`direct-api.service.ts:63`)                                                                      | `src/core/services/direct-api.service.ts`                                                      |
| `tonder.create('apple_pay_button', options)` → `mount()` / `unmount()`; `tonder.isApplePayAvailable()`; runtime rejection of `pay({ payment_method: { type: 'apple_pay' } })`    | `src/tonder.ts`                                                                                |
| `pay()` and the button both fire `config.events.payment` (D5)                                                                                                                    | `src/tonder.ts`                                                                                |
| The four deferred wirings: `payment?` on `TonderEvents`, `apple_pay_button?` on `TonderCustomization`, `apple_pay_button` in all three component maps, and the barrel exports    | `src/shared/types/index.ts`, `src/types/customization.ts`, `src/types/card.ts`, `src/index.ts` |
| The three remaining `MESSAGES_EN` entries — `APPLE_PAY_NOT_ENABLED`, `APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_UNSUPPORTED_ACTION` — plus `INVALID_COMPONENT_TYPE` copy update | `src/shared/errors/messages.ts`                                                                |
| Merchant-facing README updates (plan §6 Phase 5 table). Docs ship with the code                                                                                                  | `README.md`                                                                                    |

### Out of Scope

**Everything Safari proves.** The ten statements in the archived Phase 3 design (S1–S10) —
that Safari accepts our request, that WebKit renders the mark, that the real user-activation
rule is satisfied, HTTPS/domain enforcement, Face ID, whether `completePayment.errors`
requires real `ApplePayError` instances — remain unproven and belong to Phase 7. This change
must not claim any of them.

**Internal documentation and the demo portal.** Phase 6.

**Third-party browsers (`applePayCapabilities`), `openPaymentSetup`, shipping/contact fields,
subscriptions, Google Pay.** Plan §9, unchanged.

**`completePayment.errors` population.** The field exists on `ApplePayCompletion` (Phase 3,
DD3) and stays unpopulated: whether Apple accepts plain objects is S9. The failure rows send
`{ status: 'failure' }` only.

**A `WalletPort` generalization.** Google Pay gets its own port when it arrives (plan §5).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `apple-pay`: adds the orchestration contract (gesture synchrony, validation round trip,
  response mapping, `completePayment`-before-callback ordering, `unmount()` abort), the
  `mount()` gate codes, `isApplePayAvailable()`'s composition, and the three `MESSAGES_EN`
  entries. Supersedes "Public Apple Pay availability wiring waits for its full runtime" and
  "Nothing added by the browser core is exported or reachable from merchant code".
- `public-api`: adds `apple_pay_button` to the component factory, `events.payment` as an
  instance-level payment-result surface fired by every SDK-completed payment, and the
  `customization.apple_pay_button` key.

## Approach

### D1 — The gesture is a synchronous call chain, and the design's job is to make an `await` impossible

`ApplePaySession`'s constructor throws outside a user-gesture handler
(`ApplePaySession.md:261`). One `await` before it breaks the chain, and the failure is
invisible outside real Safari.

Phase 3 already made create-and-wire atomic: `createSession(request, handlers)` takes the
handlers as an argument, so a caller cannot obtain a handle without supplying them in the
same call. This change must not reintroduce an `await` in front of it. Concretely, the click
path is one synchronous function:

```
onClick()                                   [the adapter owns the listener]
  resolve payment  (object, or the merchant's SYNC function)
  buildApplePayPaymentRequest(...)          [pure, may throw INVALID_PAYMENT_REQUEST]
  port.createSession(request, handlers)     [sync — the gesture]
  handle.begin()                            [same tick]
```

Only the handlers are async. Anything that could be awaited — readiness, catalog, business
config, customization — is read from core state, which `init()` already populated
synchronously-readable. `options.payment` may be a function and is called synchronously; the
type says so and the README must say so too.

A failure thrown inside the click path cannot reject a promise a merchant is holding — there
is none. It is reported through `events.payment.on_error`.

### D2 — `completePayment` runs before the merchant callback

Not an ordering preference: the merchant's `on_success` will navigate. If the callback runs
first, the browser leaves the page while Apple's sheet is still on screen. So the handler
settles the sheet, then reports. Enforced by a test comparing `mock.invocationCallOrder`,
which is the only way this stays true after the next edit.

### D3 — The `/process` body comes from the same builder `pay()` uses, extracted, not copied

Plan §5.1 forbids a second `/process` path. `buildProcessBody()` is a private method on
`Tonder` today and reads `this.core.getConfig()` for the customer, currency default and
presentation mode. It is extracted into a pure function taking those as parameters; `pay()`
delegates to it with no behavior change, in its own commit, with the existing `pay()`
regression suite green before anything Apple Pay is added.

Copying it would mean two bodies that drift the first time a field is added to `PayInput` —
and the SDK would charge Apple Pay differently from cards without anything reporting it.
The charge itself goes through `DirectApiService.processPayment`, the same method `pay()`
calls, so there is exactly one `/process` call site shape.

`ApplePayPaymentMethod` must be added explicitly to `ProcessPaymentBody['payment_method']`.
`ApmPaymentMethod`'s `type: string` makes it structurally assignable today; relying on that
accident would make the union a lie (Phase 3 design §6.1).

### D4 — Payment events are instance-level (`config.events.payment`), not per component

The plan states this (§3.1) but a reviewer meets it here first, so it is restated as a
decision of this change.

`pay()` returns a promise, so card and APM merchants never needed callbacks. Apple Pay is the
first method where **the SDK owns the trigger**, and it will not be the last — Google Pay,
Link-style wallets and any express-checkout button have the same shape. If each ships its own
event map, a merchant with three wallet buttons writes the same three handlers three times
against three near-identical types, and the SDK carries N parallel contracts to keep in sync
forever. That is the duplication the interface-reuse audit (§3.2) exists to prevent.

`config.events` is already the SDK's namespaced event surface, already documented as read at
**fire time** so a config mutated after `createTonder` is honored. `payment` becomes a sibling
of `presentation` and inherits that behavior for free — and must be implemented the same way:
`getConfig().events?.payment?.on_success?.(...)` at emit time, never snapshotted
(`src/tonder.ts:462,519-520` is the existing pattern).

The industry splits the same way: SDKs where the merchant triggers the charge return a promise
(Stripe's `confirmPayment`); SDKs where the SDK owns the trigger use instance-level callbacks
(Adyen Drop-in's `onPaymentCompleted` / `onError`). We are both, so we need both.

**Accepted tradeoff:** two Apple Pay buttons on one page share one set of callbacks. They also
share one SDK instance, one customer and one session, and the transaction arrives in the
payload — so this is a shape, not a limitation.

`on_cancel` is separate from `on_error`: cancelling is a shopper decision, not a failure, and
carries no error code.

### D5 — `events.payment` fires for `pay()` too — confirmed, not narrowed

The plan says all payments. Confirmed, and the reasoning is worth stating because the cheap
option is the other one.

A half-general contract — "instance-level payment events, but only for wallets" — is worse
than either extreme. It is a rule with no statable justification: a merchant reading
`config.events.payment.on_success` has no way to know it silently does not apply to the
payment method they are using. The name says `payment`, not `wallet`.

The cost is zero to existing integrations because the callbacks are **opt-in**: undefined
callbacks do nothing, `pay()` still returns its promise, still throws its `AppError`, and
every existing test passes unchanged. The mapping is the one `pay()` already has:

| `pay()` outcome                             | Event fired               |
| ------------------------------------------- | ------------------------- |
| resolves (including a declined transaction) | `on_success(transaction)` |
| rejects with `AppError`                     | `on_error(error)`         |
| —                                           | `on_cancel` never fires   |

`on_cancel` is sheet-specific; an APM modal close remains `events.presentation.on_close`,
which is a different event about a different thing.

### D6 — Response mapping (plan §4.4)

| `/process` outcome                           | `completePayment`       | Merchant callback                        |
| -------------------------------------------- | ----------------------- | ---------------------------------------- |
| `Success` / `Authorized`                     | `{ status: 'success' }` | `on_success(transaction)`                |
| Declined — HTTP 200 with a decline `status`  | `{ status: 'failure' }` | `on_success(transaction)`                |
| Throws / network failure                     | `{ status: 'failure' }` | `on_error(AppError)`                     |
| Unexpected `next_action.redirect_to_url.url` | `{ status: 'failure' }` | `on_error(APPLE_PAY_UNSUPPORTED_ACTION)` |

Row 2 is the load-bearing one: **a decline is a result, not a failure.** That is the SDK's
existing semantics (`src/tonder.ts:393` treats exactly `Success` and `Authorized` as the
success set; everything else is a returned transaction, not a throw). Apple's sheet needs
`failure` so it does not tell the shopper the payment went through, but the merchant gets the
transaction — with its decline reason — through the same callback as a success, because that
is what `pay()` would have handed them.

Row 4 is defensive and cheap. 3DS does not apply to Apple Pay, but a redirect cannot be
presented while the sheet is open, so an explicit error beats a silent hang until Apple's
30-second timeout (`ApplePaySession.md:550`).

Merchant validation failure sits outside this table: `session.abort()` +
`on_error(APPLE_PAY_VALIDATION_ERROR)`. `ApplePayService` wraps transport failures
unconditionally and records that **collapsing a double wrap is the consumer's job** — so this
change re-throws an incoming `AppError` as-is and never re-wraps it.

### D7 — `mount()` diagnoses; `isApplePayAvailable()` only answers

`isApplePayAvailable()` is a synchronous boolean with no network, composing three checks that
Phases 2–3 built as separate, independently testable halves:

```
port.canUseApplePay()                              [browser]
  && hasActiveApplePayMethod(state.paymentMethodCatalog)   [catalog]
  && Boolean(state.business?.business.country_code)        [country]
```

It never throws, including before `init()` — an unset catalog reports `false`, which is the
honest answer.

`mount()` cannot simply call it, because a merchant debugging at 2 AM needs to know _which_
check failed. It runs them in order and throws a distinct code:

| Order | Check                       | Code                            |
| ----- | --------------------------- | ------------------------------- |
| 1     | `assertReady()`             | `NOT_INITIALIZED`               |
| 2     | `canUseApplePay()`          | `APPLE_PAY_UNSUPPORTED_BROWSER` |
| 3     | catalog gate + country code | `APPLE_PAY_NOT_ENABLED`         |
| 4     | `render()` container lookup | `APPLE_PAY_CONTAINER_NOT_FOUND` |

Four codes instead of one `CREATE_ERROR` is the whole point of §5.2. Catalog and country share
a code deliberately: the merchant resolves both the same way — contact Tonder.

### D8 — `unmount()` aborts a live session

Otherwise the sheet stays open with callbacks pointing at a dead component: the shopper
authorizes, the handler fires against a component the merchant already discarded, and the
sheet never closes. `unmount()` disposes the button (Phase 3's idempotent disposer) **and**
calls `handle.abort()` when a session is in flight. Both are idempotent.

### D9 — Rejecting `pay({ payment_method: { type: 'apple_pay' } })` is a runtime guard

Settled by the existing spec: `PaymentMethod`'s third member `{ type: string; config? }`
accepts any string literal, so this call type-checks and always has. The compiler cannot be
the guard. Without a runtime guard the call is treated as a generic APM and reaches
`/process` as `{ type: 'apple_pay' }`, so the merchant sees a backend rejection instead of a
message naming the component.

The guard reuses `INVALID_PAYMENT_REQUEST` with a `details.system_error` naming
`create('apple_pay_button')` — the same shape `assertValidPayInput` already uses
(`src/tonder.ts:1037-1055`). No new error code, no new `MESSAGES_EN` entry: none of the six
Apple Pay codes describes this, and inventing a seventh for a developer mistake caught before
any network call is not worth a permanent public code. (See question round Q2.)

### D10 — The orchestration lives outside `src/tonder.ts`

`src/tonder.ts` is ~1056 lines. `apple-pay-checkout.service.ts` owns the session lifecycle and
the response mapping; the facade owns only the gate order, the snake_case→camelCase
translation at its one boundary (`container_id` → `containerId`), and the event emission. The
service depends on the ports and `DirectApiService` / `ApplePayService`, never on DOM or
`fetch`; `core/` stays pure.

The Apple Pay adapter is constructed in the `Tonder` constructor like every other adapter, and
is injectable so tests drive the fakes from the archived Phase 3 design §4. Its module has no
top-level DOM access, so SSR is unaffected.

### D11 — Copy owed by this change

Three `MESSAGES_EN` entries land here, completing the six (plan §5.2: the change that first
throws a code owns its message). All six get reviewed together, as Phase 3 and Phase 4 both
promised. `INVALID_COMPONENT_TYPE`'s copy is also updated — it currently reads
`"Unknown component type. Supported: 'card_fields'."` and would be wrong the moment a second
type exists.

### Verification reality

The orchestration is **fully testable in Node against Phase 3's port with a local fake** —
that port was cut backwards from this phase's test list (archived design §3, T1–T14), and
every behavioral row resolved. Fakes stay in `*.test.ts`; nothing under `src/` exists only for
testing.

What this change **cannot** prove is unchanged: S1–S10 remain Phase 7's. In particular, T1's
synchrony assertion is a proxy for the gesture rule, because jsdom models no user activation.
It is a good proxy. It is still a proxy, and no success criterion below claims otherwise.

### Work units

**Commits only — no pull requests.** Expect more units than previous phases. Each is
independently reviewable and green on `npm run test`, `npm run typecheck` and `npm run build`,
with the lint error set identical to `main`. **Strict TDD applies and genuinely bites**: this
is runtime behavior over injected ports, which vitest enforces.

| #   | Commit                                                            | Contents                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `refactor: extract the /process body builder as a pure function`  | `process-body.strategy.ts`; `pay()` delegates. **Zero behavior change**, existing `pay()` suite green before anything is added                                                                               |
| 2   | `feat: fire instance-level payment events from pay()`             | `payment?: PaymentEvents` on `TonderEvents`, `PaymentEvents` exported, `TonderConfig.events` JSDoc, fire-time reads (D4, D5)                                                                                 |
| 3   | `feat: add the Apple Pay checkout orchestration service`          | `apple-pay-checkout.service.ts` + fakes; D1 synchrony, D2 ordering, D6 mapping, validation round trip. Nothing wired to a facade                                                                             |
| 4   | `feat: add the Apple Pay button component and availability check` | `create('apple_pay_button')`, `mount`/`unmount`, `isApplePayAvailable()`, three component maps, `customization.apple_pay_button`, three `MESSAGES_EN` entries, `INVALID_COMPONENT_TYPE` copy, barrel exports |
| 5   | `feat: reject apple_pay as a pay() payment method`                | D9's runtime guard                                                                                                                                                                                           |
| 6   | `docs: document Apple Pay in the README`                          | Plan §6 Phase 5 table                                                                                                                                                                                        |

## Affected Areas

| Area                                              | Impact    | Description                                                                                                                        |
| ------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/strategies/process-body.strategy.ts`    | New       | The extracted pure `/process` body builder, shared by `pay()` and Apple Pay                                                        |
| `src/core/services/apple-pay-checkout.service.ts` | New       | Session lifecycle, validation round trip, response mapping                                                                         |
| `src/core/services/direct-api.service.ts`         | Modified  | `ApplePayPaymentMethod` added to `ProcessPaymentBody['payment_method']`                                                            |
| `src/tonder.ts`                                   | Modified  | `create()` branch, `mount()` gate, `isApplePayAvailable()`, `pay()` guard, event emission, delegation                              |
| `src/shared/types/index.ts`                       | Modified  | `payment?: PaymentEvents` on `TonderEvents`; `TonderConfig.events` JSDoc                                                           |
| `src/types/customization.ts`                      | Modified  | `apple_pay_button?` on `TonderCustomization`                                                                                       |
| `src/types/card.ts`                               | Modified  | `apple_pay_button` in `TonderComponentType`, `ComponentOptionsByType`, `ComponentByType`                                           |
| `src/shared/errors/messages.ts`                   | Modified  | Three entries + `INVALID_COMPONENT_TYPE` copy                                                                                      |
| `src/index.ts`                                    | Modified  | Exports `ApplePayButtonOptions`, `ApplePayPaymentInput`, `ApplePayButtonComponent`, `PaymentEvents`, `ApplePayButtonCustomization` |
| `README.md`                                       | Modified  | Plan §6 Phase 5 table                                                                                                              |
| `src/types/apple-pay.ts`                          | Unchanged | `ApplePayButtonComponent` gains no member, so it stays a type alias (spec-mandated)                                                |

## Risks

| Risk                                                                                                                          | Likelihood | Mitigation                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| An `await` creeps into the click path and the gesture breaks only in real Safari                                              | **High**   | D1; T1 asserts `createSession` runs before any microtask, T2 that `begin()` is the same tick. The single most valuable test here |
| Merchant callback runs before `completePayment`; the merchant navigates with the sheet open                                   | **Med**    | D2 + an `invocationCallOrder` test                                                                                               |
| `buildProcessBody` gets copied rather than extracted, and the two bodies drift                                                | **Med**    | D3; WU1 is a standalone refactor commit with zero behavior change; a test asserts both paths produce the same body for one input |
| Widening `TonderComponentType` breaks `create('card_fields')` narrowing at existing call sites                                | Low        | Phase 1's interface guardrail makes a missed map key a compile error; `e2e/support/fixtures.ts:123` is the acceptance gate       |
| `events.payment` snapshotted at construction, so a config mutated later is ignored                                            | **Med**    | D4; mirrors `presentation`'s fire-time read. A test mutates config after `createTonder` and asserts the new callback runs        |
| Firing `events.payment` from `pay()` regresses an existing integration                                                        | Low        | D5; opt-in — the whole `pay()` suite runs unchanged with the callbacks undefined                                                 |
| A decline is reported as `on_error`, contradicting `pay()`'s semantics                                                        | **Med**    | D6 row 2 has its own test asserting `{ status: 'failure' }` **and** `on_success(transaction)`                                    |
| `unmount()` leaves a live sheet orphaned                                                                                      | **Med**    | D8 + a test asserting `abort()`                                                                                                  |
| `APPLE_PAY_VALIDATION_ERROR` double-wrapped into `PAYMENT_PROCESS_ERROR` and the merchant loses the actionable code           | Low        | D6; the orchestration re-throws `AppError` as-is, per `ApplePayService`'s recorded consumer contract                             |
| The change claims Safari-only behavior as verified                                                                            | **Med**    | S1–S10 restated as out of scope; no success criterion below asserts any of them                                                  |
| A new lint error hides behind the two pre-existing ones (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) | **Med**    | Compare the lint error set before and after; do not fix the two                                                                  |
| The diff exceeds a reviewable size                                                                                            | **High**   | Six work units, each independently green; delivery is commits only                                                               |

## Rollback Plan

Revert in reverse order. WU6 and WU5 are independent. WU4 removes the only new public surface
(component type, customization key, exports) and restores `INVALID_COMPONENT_TYPE`'s copy.
WU3's service has no importer outside its own test once WU4 is gone. WU2 removes
`events.payment` — additive and opt-in, so no existing integration depends on it. WU1 is a
pure refactor and can be left in place safely; reverting it restores the private method.

No persisted data, no migration, no backend contract change (`/process` gains a payment-method
member; `validate-merchant` is unchanged from Phase 4).

## Dependencies

- Phases 1–4, all archived: `ErrorKeyEnum` codes and declared types; the cached raw catalog,
  `hasActiveApplePayMethod`, `resolveApplePayNetworks`, `resolveApplePayMerchantCapabilities`;
  `ApplePayPort` / `ApplePayButtonPort` / `BrowserApplePay` / `buildApplePayPaymentRequest` /
  `buildApplePayPaymentMethod`; `ApplePayService.validateMerchant()`.
- Backend: `POST /api/v1/payments/apple-pay/validate-merchant/` and the `APPLE_PAY`
  payment-method member on `/process` are **not confirmed** (plan §8.2). Not a blocker —
  `HttpPort` is injected, so every response is faked.
- Apple: a registered merchant domain and certificate. Gates Phase 7 only.

## Success Criteria

- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass; the lint error set is
      identical before and after
- [ ] `port.createSession` is invoked **synchronously** inside the click listener, before any
      microtask the test can observe, and `handle.begin()` in the same tick
- [ ] Each of the four `mount()` failures throws its own code, in the D7 order
- [ ] `isApplePayAvailable()` returns a boolean and never throws — including before `init()`,
      when the catalog is unset — and is `false` when any one of browser / catalog / country
      fails
- [ ] All four D6 rows are asserted, including a decline producing `{ status: 'failure' }`
      **and** `on_success(transaction)`
- [ ] `completePayment` is invoked before the merchant callback, asserted on call order
- [ ] A failed `validate-merchant` calls `handle.abort()` and reports
      `on_error(APPLE_PAY_VALIDATION_ERROR)` — not a re-wrapped code
- [ ] `unmount()` during a live session calls `abort()` and disposes the button; a second call
      is a no-op
- [ ] `oncancel` fires `on_cancel` and never `on_error`
- [ ] `events.payment` callbacks are read at fire time: a config mutated after `createTonder`
      is honored, matching `events.presentation`
- [ ] `pay()` fires `events.payment`, and every existing `pay()` test passes unchanged with
      the callbacks undefined
- [ ] The Apple Pay `/process` body is produced by the **same** builder `pay()` uses — asserted
      by feeding both paths equivalent input and comparing the bodies — and the charge goes
      through `DirectApiService.processPayment`
- [ ] `event.payment.token` reaches the `/process` body **by reference**, unmodified and never
      `JSON.stringify`d
- [ ] `pay({ payment_method: { type: 'apple_pay' } })` throws before any network call, with a
      message naming `create('apple_pay_button')`. It still **type-checks** — the compiler
      cannot be the guard, and no criterion here claims it is
- [ ] `create('card_fields', …)` still narrows to `CardFieldsComponent`;
      `e2e/support/fixtures.ts` compiles untouched
- [ ] `MESSAGES_EN` resolves all six Apple Pay codes to code-specific copy — none falls back to
      `UNKNOWN_ERROR` — and `INVALID_COMPONENT_TYPE` names both component types
- [ ] `src/index.ts` exports exactly the five types listed in Affected Areas, and no
      `ApplePayJS.*` member reaches `dist/index.d.ts`
- [ ] No regression across `card`, `saved_card`, APM/SPEI and 3DS presentation
- [ ] The README documents Apple Pay for a merchant with no prior context, states that the SDK
      renders the button and owns the click, that `payment` as a function must be synchronous,
      and mentions **none** of: gestures, `ApplePaySession`, `validationURL`, `merchantSession`,
      `PKPaymentToken`
- [ ] S1–S10 are still open. Nothing in this change is recorded as verifying Safari behavior

## Proposal question round — resolved

All six confirmed as proposed. No open questions.

Q6 gains one detail: the constructor takes `config` plus five optional ports today
(`src/tonder.ts:138-145`), so an Apple Pay adapter as the seventh positional parameter is
consistent rather than novel. `_createTonderWithDeps` already accepts an options object
(`src/tonder.ts:1071`), so the test-facing surface takes a new key and needs no migration.

| #   | Question                                                                                                                                                                          | Ruling (confirmed)                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Does `events.payment` really fire for `pay()` in the first release, or would you rather ship wallet-only and generalize later? (D5)                                               | **Fires for every payment.** Opt-in, so no existing integration changes; a half-general contract cannot be explained to a merchant                                 |
| Q2  | Which error does `pay({ type: 'apple_pay' })` throw — reuse `INVALID_PAYMENT_REQUEST` with a `system_error` naming the component, or a seventh Apple Pay code? (D9)               | **Reuse `INVALID_PAYMENT_REQUEST`.** A developer mistake caught before any network call, in the shape `assertValidPayInput` already uses                           |
| Q3  | When a merchant calls `mount()` twice, or mounts while a sheet is open — is that a supported flow, an error, or an assumed-not-to-happen like Phase 3's one-button-per-container? | **Second `mount()` is idempotent-by-disposal**: dispose the previous button, render again. A live session is not aborted by a re-mount, only by `unmount()`        |
| Q4  | Should `on_error` also receive the transaction when one exists (e.g. an unexpected `next_action`), or is `AppError` alone enough for Support to triage?                           | **`AppError` alone.** `PaymentEvents.on_error(error: AppError)` is already declared and exported-to-be; widening it is a public-contract change with no named need |
| Q5  | Is `container_id` defaulting to `#tonder-apple-pay-button` correct for merchants, given card fields default per-field ids? (Declared in Phase 1)                                  | **Yes, unchanged.** Already declared and documented; changing it now would break a documented default before it ships                                              |
| Q6  | Adapter injection: a seventh positional constructor parameter on `Tonder`, matching the existing six, or start an options object?                                                 | **Seventh positional.** Consistent with the existing constructor; an options-object migration is its own refactor with a wider blast radius                        |

## Next step

`sdd-spec` and `sdd-design` (parallel).
