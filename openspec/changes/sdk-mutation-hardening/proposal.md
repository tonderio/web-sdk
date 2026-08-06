# Proposal: Make SDK configuration immutable after `createTonder()`

## Intent

QA AC-11 (DEV-2277, follow-on to DEV-2245) reports that a merchant can mutate `config.session.customer.email` after `createTonder()` and the SDK honors it. The defect is real, but the reported field is not the worst instance of it, and the fix everyone reaches for first does not fix it at all.

**There are two orthogonal causes.**

| #   | Cause                                                                                                                              | Evidence                                                                                                                                                                                     | Fixed by                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **Instance-field reachability** — all 18 `private` fields on `Tonder` are enumerable at runtime. TypeScript's `private` is erased. | `src/tonder.ts:141-157` (17 fields) + `:418` (`paymentEvents`). Probed on `dist/index.mjs`.                                                                                                  | `#private`                        |
| 2   | **Config object-graph aliasing** — `TonderCore` stores and returns the exact object the merchant passed.                           | `src/core/TonderCore.ts:37` (`this.config = config`), `:49` (`return this.config`). Probed: `tonder.core.getConfig() === myConfig` → `true`; `inside.session === myConfig.session` → `true`. | copy or freeze — **nothing else** |

> **The single most likely way this change gets done wrong:** shipping `#private` and calling AC-11 closed. `#private` hides `tonder.core`. It does not touch the merchant's own retained `config` variable, which is the same object the SDK reads on every call. A hide-only change leaves the reported defect **fully intact** while looking fixed.

**Aggravating factor — the fix conflicts with a documented API.** `README.md:697`: _"Every outcome arrives on `config.events.payment`, which you can also assign after `createTonder()`."_ That documented contract is powered by the very aliasing this change must break. A freeze or a copy that does not carve out `events` breaks a documented public API loudly, at runtime, in a shopper's browser mid-checkout.

**Supporting evidence that a snapshot is the intended semantics, not a new invention.** `src/shared/types/index.ts:119-124` already documents `session` as: _"These values are fixed for the SDK instance lifetime; recreate the SDK instance to switch customers or refresh an expired secure token."_ The contract is already written down. Only the enforcement is missing.

### Risk ranking — this corrects the originating ticket

QA named `customer.email`. It is not the largest window.

| Surface                            | Read pattern                                                        | Site                         | Why it ranks here                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.secure_token`             | **Live on every saved-card call, never memoized**                   | `tonder.ts:1164`             | Largest window of all. Exploitable for the whole instance lifetime, not just before the first call.                                                                         |
| `paymentEvents` (instance field)   | Reachable object literal wrapping `emitPayment`                     | `tonder.ts:418-423`, `:436`  | External code can call `tonder.paymentEvents.onSuccess(forgedTx)` and the **merchant's own** `on_success` runs with a fabricated transaction. Payment-confirmation forgery. |
| `http`, `acquirer`, the 6 services | Reachable transports/wrappers with a baked API key                  | `tonder.ts:144-152`          | Transport hijack, and direct `directApiService.processPayment(body)` bypasses every guard `pay()` enforces.                                                                 |
| `core`                             | Exposes `setState()`                                                | `TonderCore.ts:66`           | `setState({ lifecycle: 'ready' })` fakes past every `assertReady()` without a real `init()`.                                                                                |
| `session.customer`                 | Live until first registration, then memoized; `pay()` re-reads live | `tonder.ts:1141`, `:566`     | QA's reported field. Real, but narrower than `secure_token`.                                                                                                                |
| `api_key`                          | Baked into `FetchHttpClient`/`KushkiAdapter` at construction        | `fetch-http.client.ts:25-27` | **Lower risk than it sounds.** Mutating it does _not_ change the `/process` Authorization header.                                                                           |

## Decision 1 — Semantics: defensive snapshot, not freeze

**Recommendation: deep-copy the config at construction. Late mutation becomes inert. Nothing throws, ever.**

Probed on `dist/index.mjs`, not reasoned:

- `Object.freeze` + a later assignment in bundled ESM **throws `TypeError`**. Bundled ESM is always strict.
- Adding a _new_ key to a shallow-frozen object also **throws**.

So "freeze it and silently ignore late writes" is not on the menu. Freeze means a `TypeError` raised **inside the merchant's code, at a moment they did not choose** — plausibly during checkout, in front of a shopper, in a `try`-less handler. Worse, whether it throws or silently no-ops depends on the _merchant's_ module mode (ESM bundle → throws; legacy `<script>` + the IIFE CDN build → no-ops), so the SDK's observable behavior would fork by integration style. That is a worse contract than the bug.

Snapshot behaves identically in every host, matches AC-11's "no effect" wording exactly, and matches the already-published `TonderSession` doc.

**The counter-argument is real and we answer it, not dismiss it.** Silence is its own footgun: a merchant who expects `cfg.session.customer.email = x` to take effect gets no signal and debugs the wrong thing for an afternoon. Mitigation — **config-drift warning**:

- The instance keeps a private reference to the original config object _for detection only_.
- On the guarded read paths (`ensureCustomerRegistered`, `resolveCardAuth`, `runPay`), compare the snapshot's `session.secure_token` and `session.customer` against the original's current values.
- On the first divergence, emit one `console.warn` naming the field and pointing at "recreate the instance to switch customers or refresh the token". **At most once per instance. Wrapped so it can never throw. It never changes behavior.**

That converts silence into a signal without importing freeze's failure mode.

**Rejected: a real API (`tonder.setEvents()` / `tonder.on()`) in this change.** It would let the config be copied wholesale with no carve-out, and it is probably the right long-term shape — but it retires a documented pattern, forces a migration story on every merchant on `0.1.5`, and expands the public surface. That is a product decision, not a defect fix. Recorded as a forward finding.

## Decision 2 — `events` gets a carve-out, not an API

`events` is excluded from the snapshot and read **live from the original config reference** at fire time.

Concretely: `TonderCore` holds the deep-copied snapshot plus the original reference. `getConfig()` returns an object whose `events` is a **getter** reading `original.events`. Every existing call site is unchanged — `emitPayment` (`tonder.ts:436`) still does `this.core.getConfig().events?.payment`, and the presentation callbacks (`:680-681`, `:737-738`) still resolve at fire time.

**This is what makes the hard case work.** A merchant who constructed with **no `events` key at all** and later assigns `cfg.events = { payment: {...} }` is mutating the original object. The getter reads the original. It works. A design that merely "keeps the `events` sub-object by reference" would fail this case outright — there is no sub-object to keep — and it is exactly the case `README.md:640-655` shows.

Everything reachable through the `events` getter stays live and stays mutable, by design. That is the documented contract, not an oversight.

**Two behaviors intentionally become inert**, and both are currently live only _by accident_ of the aliasing:

| Field                            | Today                                    | After    | Justification                                                                                                                               |
| -------------------------------- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation_mode`              | live every call (`:567`, `:675`, `:729`) | snapshot | Never documented as live. Only `events` is documented as fire-time.                                                                         |
| `customization.apple_pay_button` | live every `mount()` (`:362`)            | snapshot | Same. `customization.card_fields` is already snapshotted at construction (`:200-217`), so this makes `customization` internally consistent. |

Both are called out as observable changes and get a README line.

## Decision 3 — Scope: harden all 18 fields

All 18 become `#private`. Not a subset.

The ranking above separates _dangerous_ (`core`, `http`, `acquirer`, `businessService`, `vaultService`, `directApiService`, `customerService`, `cardService`, `cofService`, `tokenizer`, `applePayService`, `paymentEvents`, `services`) from _merely untidy_ (`env`, `host`, `messenger`, `applePay`, `mountedCardFields`). We harden the untidy ones anyway because:

1. Cost is a one-character rename per field. `tsconfig.json` `target: "ESNext"` → `#private` survives natively into `dist/`, **no WeakMap downlevel**; terser `5.48.0` handles ES2022 private fields.
2. A partial fix invites the next reach-in. Today `messenger` is 3DS plumbing; the line between "untidy" and "dangerous" moves every time a service grows a method.
3. The QA probe enumerates instance keys. A partial fix still reports a non-empty surface, and the finding stays open.

## Decision 4 — The `_createTonderWithDeps` seam survives untouched

`_createTonderWithDeps` (`tonder.ts:1245-1263`) passes constructor **parameters**; it never reads a field back off the returned instance. Grep confirms nothing in `src/` or `e2e/` reaches a private field by bracket access or an `as any` cast. `#private` is therefore invisible to it and to all 9 test files that use it.

Guard: the full existing suite must pass **with zero test-file edits**. Any test needing an edit means the seam broke and the approach is wrong.

## Scope

### In scope

- `src/tonder.ts` — 18 `private` fields → `#private` (including the `paymentEvents` literal at `:418`).
- `src/core/TonderCore.ts` — snapshot-at-construction + live `events` getter on `getConfig()`.
- A bounded config-clone helper (see Risks for the non-plain-value rule).
- Config-drift `console.warn` on the guarded read paths.
- New unit tests for every acceptance criterion below.
- A post-build probe script asserting the guarantees hold on **built** `dist/index.mjs` (the QA probe lives in an unreachable repo — see Risks).
- README/JSDoc: state that config is snapshotted at construction, that `events` remains live, and that `presentation_mode` / `customization` no longer are.

### Out of scope (non-goals)

- Renaming or restructuring the public `TonderConfig` shape.
- Changing **what** `pay()` reads live — only **where it reads from** changes.
- Anything Apple Pay beyond `customization.apple_pay_button` becoming a snapshot.
- A new `setEvents()` / `on()` public API.
- `Object.freeze` in any form, on config or on instances.
- Backend-side validation that a `secure_token` and a `User-Token` belong to the same customer (not this SDK's code).
- README edits beyond the three behavior statements above.

## Acceptance criteria (falsifiable)

All driven through `_createTonderWithDeps` with a fake `HttpPort` that records outgoing requests. Command for every unit criterion: `npm run test`.

- [ ] **AC-1 — `secure_token`, the widest window.** Create with token `T1`; mutate `cfg.session.secure_token = 'T2'`; call `getCustomerCards()` twice. Every recorded request carries `T1`. Never `T2`.
- [ ] **AC-2 — mutate BEFORE first call (the hard one; QA field `cardsC_firstCallAfterPreMutation`).** Create for customer A. Mutate `cfg.session.customer` to B **before any SDK call**. Call `getCustomerCards()`. The recorded `POST /api/v1/customer/` body carries **A's** email and the cards request carries A's resolved token. The result is A's cards, an empty list, or an error — **never B's**.
- [ ] **AC-3 — mutate after first call.** Same, but mutate after a successful `pay()`. The next `/process` body still carries A's customer block (`tonder.ts:566` re-reads live today).
- [ ] **AC-4 — documented `events` contract, absent-at-construction case.** Create with **no `events` key**. Assign `cfg.events = { payment: { on_success } }`. Drive a success. `on_success` fires. _This test is the guard on `README.md:697`._
- [ ] **AC-5 — `events` replaced late.** Construct with `events.payment.on_success = h1`; replace with `h2`; drive a success. `h2` fires, `h1` does not.
- [ ] **AC-6 — nothing throws.** Every mutation in AC-1..AC-5 completes without a `TypeError`. (Vitest ESM is strict, so a stray freeze would fail this.)
- [ ] **AC-7 — instance surface sealed.** `Object.keys(tonder)` is `[]`; `JSON.stringify(tonder) === '{}'`; `tonder.core`, `tonder.http`, `tonder.paymentEvents` are all `undefined`.
- [ ] **AC-8 — drift warning.** Mutating `session.secure_token` then calling produces exactly one `console.warn` naming the field; a second call produces none; a stubbed-throwing `console.warn` does not fail the payment.
- [ ] **AC-9 — seam intact.** `npm run test` green with **zero edits to existing test files**.
- [ ] **AC-10 — built artifact.** `npm run build && node scripts/probe-mutation-hardening.mjs` exits 0, asserting on `dist/index.mjs`: `getConfig() !== myConfig`, `Object.keys(instance).length === 0`, and late `events` assignment still visible.
- [ ] **AC-11 — gates.** `npm run typecheck` and `npm run build` green.

## Risks

| Risk                                                                                                                                                                                                                                         | Likelihood                                                                 | Mitigation                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Breaking the documented `events` contract** (`README.md:697`). Affects every merchant on npm `0.1.5` who assigns `events` post-construction. Failure mode: handlers silently never fire — a payment that succeeded looks like it vanished. | **High if the carve-out is wrong; this is the biggest risk in the change** | Decision 2's live getter, plus AC-4 and AC-5 as dedicated regression tests. AC-4 covers the absent-at-construction case that a naive carve-out fails.                                                                                                                                                                                         |
| Naive deep clone mangles non-plain values (functions, class instances, getters, `Date`, `Map`, DOM nodes) if a merchant puts one in `customization`.                                                                                         | Med                                                                        | **Binding rule: clone recursively only plain objects and arrays; copy everything else by reference.** `structuredClone` is rejected — it _throws_ on functions and drops prototypes. The clone walks the known `TonderConfig` shape (`api_key`, `environment`, `session`, `customization`, `presentation_mode`), which is a closed interface. |
| `#private` changes what `Object.keys`, spreading, and `JSON.stringify` see on an instance — silently. A merchant logging `JSON.stringify(tonder)` goes from a large object to `{}`.                                                          | Low                                                                        | This is a security improvement (that object leaked config today), but it is a behavior change. Note it in the README line. AC-7 pins it.                                                                                                                                                                                                      |
| `presentation_mode` / `customization.apple_pay_button` become inert. Undocumented-but-observable.                                                                                                                                            | Low-Med                                                                    | Called out explicitly in Decision 2 + a README line. A merchant relying on it recreates the instance.                                                                                                                                                                                                                                         |
| Drift warning becomes noise, or throws inside a payment path.                                                                                                                                                                                | Low                                                                        | Once per instance, on divergence only, wrapped in `try`/`catch`. AC-8 pins both.                                                                                                                                                                                                                                                              |
| The QA probe repo (`tonder-qa`, folder `SDK 2.0`) was unreachable and remains unverified.                                                                                                                                                    | Confirmed                                                                  | We do not depend on it. AC-2 reproduces `cardsC_firstCallAfterPreMutation` in-repo; AC-10 reproduces the enumeration probe against built `dist/`. Re-running QA's probe is a nice-to-have, not a gate.                                                                                                                                        |
| Whether the backend returns A's cards, empty, or an error under AC-2 is a backend authorization decision.                                                                                                                                    | Known limit                                                                | AC-2 asserts on the **outgoing request**, which is entirely within this SDK's control. Backend behavior is explicitly a non-goal.                                                                                                                                                                                                             |

## Rollback

Single revert of this change's commits. No data migration, no persisted state, no public type change.

## Forward findings (not this change)

- **`tonder.setEvents()` / `tonder.on()`** — the right long-term shape. It would retire the config-mutation pattern and remove the carve-out entirely. Needs a deprecation window and a product decision.
- **Backend cross-check** that a `secure_token` Bearer and a `User-Token` belong to the same customer. AC-2 is defense in depth on the client; the server-side check is the real boundary.
- `TonderCore.setState` stays publicly callable on the class; `#private` on the `core` field is what keeps it unreachable. Making `setState` internal is a separate refactor.

## Delivery

**Commits only. No PR, no PR chain.** Strict TDD: tests for each AC land before the implementation that satisfies them. Gates per commit: `npm run test`, `npm run typecheck`, `npm run build`. Estimated ~250–350 changed lines, majority tests.
