# Tasks: Apple Pay Checkout — Orchestration and Public API (Phase 5)

Seven commits (DD13), strict TDD, delivery is commits only — no PRs, no PR chain.
Each commit ends green on `npm run test`, `npm run typecheck` (runs both root and
`e2e/tsconfig.json`) and `npm run build`, lint error set identical to baseline.

## Review Workload Forecast

| Field                   | Value                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~1450–2000 total across 7 commits (see per-commit table)                                                                                       |
| 400-line budget risk    | High for WU3 and WU5; Low–Medium elsewhere                                                                                                     |
| Chained PRs recommended | No — delivery mode is commits-only, set by the launching instruction, not the standard PR guard                                                |
| Suggested split         | WU5 may split into 5a (types/maps/messages/exports) + 5b (component runtime) if its diff feels oversized — still two commits, never a PR chain |
| Delivery strategy       | commits-only (fixed by orchestrator; `branch-pr`/`chained-pr` skills explicitly excluded)                                                      |
| Chain strategy          | size-exception (closest fit — no PR gate exists to chain)                                                                                      |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

| Commit | Est. lines | Risk   | Remedy if oversized                                                 |
| ------ | ---------- | ------ | ------------------------------------------------------------------- |
| WU1    | ~150–200   | Low    | —                                                                   |
| WU2    | ~180–250   | Medium | —                                                                   |
| WU3    | ~500–650   | High   | test-heavy by design (T1–T14); do not trim tests to shrink the diff |
| WU4    | ~100–150   | Low    | —                                                                   |
| WU5    | ~550–750   | High   | split into 5a (maps/messages/exports) + 5b (component runtime)      |
| WU6    | ~40–70     | Low    | —                                                                   |
| WU7    | ~80–130    | Low    | —                                                                   |

### Suggested Work Units (= commits, per DD13)

| #   | Commit                                                                | Goal                                                       |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `refactor: extract the /process body builder as a pure function`      | Zero behavior change; `pay()` suite is the regression test |
| 2   | `feat: fire instance-level payment events from pay()`                 | `PaymentEventSink`, fire-time read, DD7 isolation          |
| 3   | `feat: add the Apple Pay checkout orchestration service`              | Service + fakes; T1,T2,T4–T14 green; no facade importer    |
| 4   | `feat: inject the Apple Pay adapter and expose isApplePayAvailable()` | 7th positional param; no component yet                     |
| 5   | `feat: add the Apple Pay button component`                            | 3 maps, `create`/`mount`/`unmount`, exports; T3 green      |
| 6   | `feat: reject apple_pay as a pay() payment method`                    | D9 runtime guard                                           |
| 7   | `docs: document Apple Pay in the README`                              | Plan §6 Phase 5 table                                      |

## Phase 0: Baseline (prerequisite, no code change)

- [x] 0.1 Run `npm run lint`; capture the current error set. Confirm it is exactly two
      pre-existing errors: `src/tonder.handleRequiresAction.test.ts:184` and
      `src/tonder.pay.test.ts:483`. Do not fix them — this is the baseline WU7 diffs against.

## Phase 1 (WU1): Extract the /process body builder — refactor, zero behavior change

- [x] 1.1 RED — `src/core/strategies/process-body.strategy.test.ts`: unit tests for
      `buildProcessBody(input)` (DD1) covering the happy path and the `MISSING_CUSTOMER`
      throw when `customer` is undefined (moved verbatim — relocating a throw is still a
      behavior change if it's dropped); tests for `scopeRequestId(idempotencyKey, businessPk)`
      (DD2); assert `DEFAULT_CURRENCY = 'MXN'` and `DEFAULT_PRESENTATION_MODE = 'redirect'` are
      exported.
- [x] 1.2 GREEN — implement `src/core/strategies/process-body.strategy.ts` per design §2
      (DD1/DD2 signatures exactly).
- [x] 1.3 REFACTOR — in `src/tonder.ts`, delete the private `buildProcessBody`/
      `buildProcessRequestId` methods (not kept as a shim); `pay()` delegates per the §2
      snippet; import `DEFAULT_CURRENCY`/`DEFAULT_PRESENTATION_MODE` from the new module.
- [x] 1.4 Verify — full existing `src/tonder.pay.test.ts` suite passes **unchanged** (D3's
      regression test); `npm run test`/`typecheck`/`build` green; lint set unchanged from 0.1.

## Phase 2 (WU2): Fire instance-level payment events from pay()

- [x] 2.1 RED — extend `src/tonder.pay.test.ts` (or a sibling `*.test.ts`) with failing tests
      per `public-api/spec.md`'s "Instance-level payment events..." requirement: fire-time read
      (mutate `config.events` **wholesale** after `createTonder()`, not just swap `on_success`
      in place — a partial swap would pass against a construction-time snapshot too);
      `on_success` fires for both an authorized and a declined resolution; `on_error` fires on
      rejection; `on_cancel` never fires from `pay()`; the full existing `pay()` suite is
      unaffected with callbacks undefined.
- [x] 2.2 RED — DD7 isolation test: a throwing `on_success` callback leaves `pay()` **resolved
      with the transaction** — assert the resolved value, not `console.warn` being called. A
      test that only checks the warning would go green on the log alone while the promise still
      rejected (same wrong-reason class as DD11/DD12).
- [x] 2.3 GREEN — export `PaymentEvents` and add `payment?: PaymentEvents` to `TonderEvents`
      (`src/shared/types/index.ts`, JSDoc per design §11); implement `PaymentEventSink` and
      `emitPayment()` on `Tonder` per DD7's snippet (fire-time `getConfig().events?.payment`
      read, `try`/`catch` + `console.warn`, never throws back).
- [x] 2.4 GREEN — rename the existing `pay()` body to `runPay()`; `pay()` becomes the DD8
      wrapper (`onSuccess` cannot throw, so a success can never fall into the `onError` catch).
- [x] 2.5 Verify — `npm run test`/`typecheck`/`build` green; lint set unchanged.

## Phase 3 (WU3): Apple Pay checkout orchestration service

No facade importer yet — the service is drivable end-to-end by local fakes.

- [x] 3.1 RED — `src/models/transaction.model.test.ts`: `isSuccessfulStatus` true for
      `'Success'`/`'Authorized'`, false otherwise (DD6).
- [x] 3.2 GREEN — add and export `isSuccessfulStatus`; replace `pay()`'s inline literal
      (`src/tonder.ts:393`) with it — one predicate, not two copies.
- [x] 3.3 RED/GREEN — `src/core/services/direct-api.service.ts`: add `ApplePayPaymentMethod`
      explicitly to `ProcessPaymentBody['payment_method']` (not relying on `ApmPaymentMethod`'s
      structural `type: string` accident, D3/proposal §6.1); update/add a
      `direct-api.service.test.ts` assertion confirming it.
- [x] 3.4 RED — `src/core/services/apple-pay-checkout.service.test.ts`, DD11 synchrony (T1/T2):
      queue a microtask sentinel **before** calling `checkout.start(...)`; assert exact
      `toEqual` on the order array both before and after a `Promise.resolve()` tick. Do not
      write the naive `expect(createSession).toHaveBeenCalled()` — it stays green the day
      someone adds `await flushPromises()` before the assertion; the pre-queued array is the
      only form no later deferral can defeat.
- [x] 3.5 GREEN — implement `ApplePayCheckoutService.start()` per DD4 (non-`async`; gate-proved
      values as args, live values via `deps.getContext()`; non-`AppError` wrapped as
      `PAYMENT_PROCESS_ERROR`, incoming `AppError` re-emitted as-is).
- [x] 3.6 RED — `onValidateMerchant`: success path calls `completeMerchantValidation`; failure
      path (T12) calls `session.abort()` and emits `on_error` with the **same** `AppError`
      instance `validateMerchant()` threw — assert both `errorCode` and identity (`===`); a
      re-wrap would show `PAYMENT_PROCESS_ERROR`, not `APPLE_PAY_VALIDATION_ERROR`.
- [x] 3.7 GREEN — implement `onValidateMerchant` per §3.1, including the `if (!session) return`
      guard for a callback arriving after `abort()`.
- [x] 3.8 RED — `onPaymentAuthorized`, one test per D6 row, **exact** `toEqual`/
      `toHaveBeenCalledWith` only — `expect.objectContaining` is banned in this change (DD12;
      it would pass `completePayment({status:'failure'})` even with a stray `errors` key): - row 1 success/authorized: `completePayment({status:'success'})` strictly before
      `emit.onSuccess(tx)` (`invocationCallOrder`, D2/T8). - row 2 decline: `completePayment({status:'failure'})` then `emit.onSuccess(tx)` — not
      `onError`. - row 3 throw/network failure: `completePayment({status:'failure'})` first (via the
      captured local, not the nulled `this.session`), then `emit.onError(AppError)` — assert
      exactly `{status:'failure'}` with `errors` unpopulated (T5, corrected: S9 keeps
      `errors` unasserted, not the phase-3 row that included it). - row 4 `next_action.redirect_to_url.url`: `completePayment({status:'failure'})` then
      `emit.onError(AppError(APPLE_PAY_UNSUPPORTED_ACTION))`.
- [x] 3.9 GREEN — implement `onPaymentAuthorized` per §3.1: capture `session` into a local
      before nulling `this.session` (DD5); `buildApplePayPaymentMethod(token)` **by reference**
      (T13 — `toBe`, not `JSON.stringify` or a spread); `scopeRequestId`; D6 branching.
- [x] 3.10 RED/GREEN — `oncancel` (T10): `on_cancel` fires with no args, `on_error` asserted
      `not.toHaveBeenCalled()`, `completePayment` not called.
- [x] 3.11 RED/GREEN — `abort()` (T9, service-level): nulls `session`; a late
      `onPaymentAuthorized` after `abort()` is a no-op (drops the charge via the `if (!session)
return` guard).
- [x] 3.12 RED — cross-body test (spec: "same shared builder", D3): spy on the process-body
      module; feed `pay()` and `checkout`'s `onPaymentAuthorized` equivalent input against a
      fake `HttpPort`; assert both call sites invoke the **same exported function**; assert
      every field except `payment_method` is identical (exact `toEqual`, DD12); assert
      `body.payment_method.token === originalToken` (`toBe`, T13).
- [x] 3.13 GREEN — wire/confirm (largely satisfied by 1.2 + 3.9's shared import).
- [x] 3.14 Verify — `npm run test`/`typecheck`/`build` green; lint set unchanged; confirm the
      service has zero importers outside its own test file.

## Phase 4 (WU4): Inject the Apple Pay adapter; expose isApplePayAvailable()

- [x] 4.1 RED — `isApplePayAvailable()` per the MODIFIED requirement: exists, returns
      `boolean`; true only when browser+catalog+country all pass; **three** false-case tests,
      each forcing the **other two checks true** so the `false` is attributable to exactly one
      cause (the same isolation trap as phase 3's); never throws before `init()`, returns
      `false` when catalog/business are unset.
- [x] 4.2 GREEN — implement per §5.3 (no `assertReady`, no network, no throw).
- [x] 4.3 RED — DI tests: `ApplePayAdapter` (`src/ports/apple-pay.port.ts`) is
      `ApplePayPort & ApplePayButtonPort`, adds no members; constructor's 7th positional
      param defaults to `new BrowserApplePay()` when omitted; a fake adapter passed in is used
      instead; `_createTonderWithDeps` accepts an `applePay` key.
- [x] 4.4 GREEN — implement DD10 (constructor signature, `this.applePay` assignment,
      `_createTonderWithDeps` key). No `create('apple_pay_button')` branch yet.
- [x] 4.5 Verify — `npm run test`/`typecheck`/`build` green; lint set unchanged.

## Phase 5 (WU5): Apple Pay button component

Largest single commit. If the diff feels oversized for one review pass, split into **5a**
(5.1–5.6, 5.15–5.16: types/maps/messages/exports) and **5b** (5.7–5.14, 5.17: component
runtime) — two commits, still no PR chain.

- [x] 5.1 Type-level only — the `ComponentOptionsByType`/`ComponentByType` guardrail fires as
      **TS2536 on the `create` declaration**, under `npm run typecheck` only (`tsconfig.json`
      excludes `**/*.test.ts`, so no `*.test.ts` assertion proves this). Confirm by inspection
      that widening the maps without `apple_pay_button` in both would fail typecheck; do not
      write a `*.test.ts` claiming to demonstrate it.
- [x] 5.2 GREEN — widen `TonderComponentType`, `ComponentOptionsByType`, `ComponentByType` in
      `src/types/card.ts` (design §6); add `apple_pay_button?: ApplePayButtonCustomization` to
      `TonderCustomization` (`src/types/customization.ts`).
- [x] 5.3 RED — `MESSAGES_EN` tests: each of the three new entries
      (`APPLE_PAY_NOT_ENABLED`/`APPLE_PAY_UNSUPPORTED_BROWSER`/`APPLE_PAY_UNSUPPORTED_ACTION`)
      resolves to a string **distinct from `UNKNOWN_ERROR`'s copy and from each other**, and
      distinct from the three pre-existing Apple Pay codes — all six reviewed together, as
      phases 3 and 4 both promised; `INVALID_COMPONENT_TYPE` names both `'card_fields'` and
      `'apple_pay_button'`.
- [x] 5.4 GREEN — add the three `MESSAGES_EN` entries + update `INVALID_COMPONENT_TYPE` per
      design §10.
- [x] 5.5 RED — `create('apple_pay_button')` with no `options.payment` throws
      `INVALID_PAYMENT_REQUEST`, `details.system_error` = `"create('apple_pay_button') requires
options.payment."`.
- [x] 5.6 GREEN — implement the `create()` branch guard (§5.1).
- [x] 5.7 RED — `mount()` four-gate tests (T3), each asserting the code **and** that no later
      check ran: `NOT_INITIALIZED` (leave `init()` uncalled); `APPLE_PAY_UNSUPPORTED_BROWSER`;
      `APPLE_PAY_NOT_ENABLED` (catalog or country); `APPLE_PAY_CONTAINER_NOT_FOUND`; happy path
      calls `render()` with translated `containerId` and configured `customization`, no other
      transform.
- [x] 5.8 GREEN — implement `mount()` per DD9, gate order fixed, `dispose?.()` before `render`
      (Q3 idempotent-by-disposal).
- [x] 5.9 RED — second `mount()`: disposes the first button before rendering the second; does
      **not** abort an in-flight session from the first mount (only `unmount()` does).
- [x] 5.10 GREEN — confirm `dispose`/`checkout` are per-component closure vars (DD3).
- [x] 5.11 RED — click delegation: clicking the rendered button calls `checkout.start({payment,
countryCode, merchantName})` with the mount-gate-narrowed `countryCode`/`merchantName`.
- [x] 5.12 GREEN — wire the `onClick` handler.
- [x] 5.13 RED — `unmount()`: live session → `abort()` called + button disposed (D8); no live
      session → `abort()` not called, button still disposed; second `unmount()` call is a
      no-op (no double abort/dispose, no throw).
- [x] 5.14 GREEN — implement `unmount()` per §5.2.
- [x] 5.15 Mechanical, not a `*.test.ts` assertion — `rg` `src/index.ts` for the five required
      exports (`ApplePayButtonOptions`, `ApplePayPaymentInput`, `ApplePayButtonComponent`,
      `PaymentEvents`, `ApplePayButtonCustomization`) and confirm no `ApplePayPort`,
      `ApplePayButtonPort`, `BrowserApplePay`, `ApplePayService`, or the checkout service is
      exported. Read the output.
- [x] 5.16 GREEN — add the five exports to `src/index.ts`.
- [x] 5.17 Verify — `npm run test`/`typecheck`/`build` green (typecheck covers
      `e2e/tsconfig.json`, i.e. `e2e/support/fixtures.ts:123` compiles untouched); lint set
      unchanged.

## Phase 6 (WU6): Reject apple_pay as a pay() payment method

- [x] 6.1 RED — `pay({payment_method:{type:'apple_pay'}})` throws
      `AppError(INVALID_PAYMENT_REQUEST)` with `details.system_error` naming
      `create('apple_pay_button')`, before any network call (assert the fake `HttpPort` was
      never invoked).
- [x] 6.2 GREEN — add the guard inside `assertValidPayInput` (design §5.4).
- [x] 6.3 Documentation note, not a runtime test — the same call still **type-checks**
      (`PaymentMethod`'s third member accepts any string); do not add a `*.test.ts` assertion
      claiming a compile error exists here — none does.
- [x] 6.4 Verify — `npm run test`/`typecheck`/`build` green; lint set unchanged.

## Phase 7 (WU7): README + final mechanical verification

- [x] 7.1 Update `README.md` per plan §6 Phase 5 table: state the SDK renders the button and
      owns the click; state that `payment` as a function must be synchronous; must **not**
      mention gestures, `ApplePaySession`, `validationURL`, `merchantSession`, or
      `PKPaymentToken` — those are internals, not the merchant contract.
- [x] 7.2 Mechanical — `rg` `README.md` for the five forbidden terms above; confirm zero
      matches. Read the output.
- [x] 7.3 Mechanical — after `npm run build`, `rg 'ApplePayJS'` against `dist/index.d.ts`;
      confirm zero matches. Read the output.
- [x] 7.4 Mechanical — re-run the 5.15 export check against the built output as a final
      confirmation.
- [x] 7.5 Final lint diff — `npm run lint`; compare against the Phase 0 baseline. Confirm the
      error set is **identical**: exactly `src/tonder.handleRequiresAction.test.ts:184` and
      `src/tonder.pay.test.ts:483`. Do not fix them.
- [x] 7.6 Full verification — `npm run test`, `npm run typecheck`, `npm run build` green across
      the whole change.

## What this change cannot prove — do not claim it in any task

S1–S10 stay Phase 7's. T1/T2 (DD11, WU3) are **proxies** for Apple's real user-activation rule
— jsdom models no user activation, so no assertion here touches Safari's real gesture
enforcement, HTTPS/domain checks, or whether Apple accepts plain objects for
`completePayment.errors` (S9). No task in this file may attach a verification command implying
otherwise.

## Execution notes — deviations, recorded

1. **WU5 was NOT split into 5a/5b.** The suggested 5a (maps/messages/exports) would have
   added `apple_pay_button` to `TonderComponentType`, `ComponentOptionsByType` and
   `ComponentByType` in a commit where `create()` could not construct it — which
   `public-api/spec.md` explicitly forbids ("A component type MUST be added … only in the
   change that implements its runtime — never ahead of it"). Seven commits, as DD13 says.

2. **DD10 was amended: the constructor's seventh parameter is typed `unknown`, not
   `ApplePayAdapter`.** DD10 and the `apple-pay` spec turned out to be in direct conflict.
   `rollup-plugin-dts` inlines the types of every public signature, so annotating that
   parameter pulled `ApplePayPort` → `ApplePayPaymentRequest` → the ambient `ApplePayJS`
   namespace into `dist/index.d.ts`. `@types/applepayjs` is a devDependency, so the
   published types then failed to compile for any merchant without it —
   `TS2503: Cannot find namespace 'ApplePayJS'`, reproduced against the built artifact,
   and a violation of the spec's "no `ApplePayJS.*` member MUST reach `dist/index.d.ts`".
   Nothing was lost: the same spec keeps `ApplePayPort` and `ApplePayButtonPort`
   unexported, so the annotation could never have helped a merchant. The fully-typed
   injection seam is `_createTonderWithDeps({ applePay })`, which never reaches the bundle.
   **This is a design amendment and should be reviewed, not assumed correct.**

3. **One pre-existing README sentence was rewritten.** `getPaymentMethods()`'s Apple Pay
   note said Apple Pay "requires its own button and a user gesture". WU7 owns the README
   and forbids the word, so it now points at the Apple Pay section instead.

## Implementation Order

Strictly sequential, WU1 → WU7. WU1 is a pure prerequisite (the shared builder). WU2 is
independent of WU3–WU6 but must land before WU3 needs `PaymentEventSink` as a dep shape. WU3
has no facade importer and can be fully green in isolation. WU4 must precede WU5 (component
needs the injected adapter and `isApplePayAvailable()`). WU6 depends only on WU1's guard shape.
WU7 depends on everything else being merged so the README describes shipped behavior.
