# Proposal: public-api-consistency

**Change:** `public-api-consistency`
**Package:** `@tonder.io/web-sdk` v3 — **UNRELEASED** (v0.x, no external consumers)
**Artifact store:** hybrid
**Status:** proposed

## 1. Intent

Unify the public API surface of the SDK into ONE consistent, future-proof shape before the first release. This is a pre-release consistency pass that removes duplicated concepts, ambiguous configuration, verb-specific methods that will not scale, and dead/anonymous types — aligning the shipped code with the SDK's own documented architecture (PRD, 04-proposal.md) and with the converging industry patterns (Stripe, Adyen, MercadoPago).

### Why now

- **Pre-release, last cheap window.** The package is UNRELEASED with no external consumers. Every breaking change here is free today and becomes a major-version migration the day a merchant integrates. The biggest item (`create().mount()`) is cheap to do now and expensive to do post-release.
- **The docs already mandate this.** PRD §7 / E3-S1 AC4 and 04-proposal.md §3 require ONE `customer` object with no duplicated flat fields; 04-proposal.md §2 already sketches a generic `mount(type, container)`. The shipped code drifted from its own committed design. This change closes the docs-vs-code gap.
- **Refactor cost compounds.** Four independent inconsistencies (duplicated customer, scattered events, verb-specific mount, mixed type suffixes) all touch the same hot files (`tonder.ts`, `types/index.ts`, `types/card.ts`) and the same test suites. Landing them together, once, avoids repeated re-churn of the mount/pay test surface.

### Success looks like

- Exactly ONE `Customer` interface, used everywhere customer data appears.
- Customer is set once in config, immutable, and required to pay — no per-call customer, no IDOR surface.
- ONE component factory `tonder.create(type, options).mount(container?)` for all mountable UI, matching the documented future and all three competitors.
- Events live where they belong: input-field events scoped to the component, presentation callbacks under a single `events.presentation` namespace.
- ONE type-suffix policy; no dead or anonymous public types.
- Docs, e2e, and sibling demos all reflect the final API.

## 2. New public surface (before / after)

### 2.1 Customer

| | Before | After |
|---|---|---|
| Config | `TonderConfig.customer?: CustomerInput` `{email; firstName?; lastName?; phone?}` | `TonderConfig.customer?: Customer` (same fields) — single canonical interface |
| Pay | `PayInput.customer` REQUIRED inline `{name; email; phone?}` (different shape; `phone` silently dropped) | **removed** — `pay()` reads `config.customer` |
| customer.service / enroll | maps from `CustomerInput` / reads `config.customer` | reuse the one `Customer` interface |
| `/process` payload | `{name, email}` (name from inline `name`) | `{name, email}` — adapter derives `name = [firstName, lastName].join(' ')`; sends only `{name, email}` |

Missing customer at `pay()` → SDK throws `MISSING_CUSTOMER` pre-flight (backend requires customer for all payment ops — direct_serializers.py:213-217; no guest pay).

### 2.2 Components (mount)

| | Before | After |
|---|---|---|
| Collect card fields | `tonder.mountCardFields(request)` / `unmountCardFields(ctx?)` | `tonder.create('cardFields', options).mount(container?)` → handle with `mount()`, `unmount()` |
| Reveal | `tonder.revealCardFields(request)` | `tonder.create(<revealType>, options).mount(container?)` (exact type set decided in design) |
| Future | new verbs (`mountCheckout`, …) — sprawl | `tonder.create('checkout' \| 'savedCards' \| …)` — zero new top-level verbs |

The returned component handle owns its own scoped state and lifecycle (`mount`/`unmount`).

### 2.3 Events

| | Before | After |
|---|---|---|
| Input-field events | `MountCardFieldsRequest.events` (per-mount map) | inside component options: `create('cardFields', { events: { cardNumber: { onChange?, onBlur?, onFocus?, onReady? }, … } })` — per-component scope (solves saved-card CVV multi-context) |
| Presentation callbacks | flat `TonderConfig.onOpen` / `onClose` / `onComplete` (ambiguous "close of WHAT?") | `TonderConfig.events?: { presentation?: { onOpen?, onClose?, onComplete? } }` |

Flat `onOpen/onClose/onComplete` config fields are REMOVED.

### 2.4 Type hygiene

- ONE suffix policy: `<Method>Input` for requests, `<Noun>` / `<Method>Result` for responses. Rename `MountCardFieldsRequest` / `RevealCardFieldsRequest` accordingly (now component options), reconcile `PaymentMethodInfo`.
- DELETE dead exports `PublicSuccess` / `PublicError`.
- Named response type for `getApmBanks()` — e.g. `ApmBanks { cash: ApmBank[]; transfer: ApmBank[] }`.
- `errorMessages` stays in config (already shipped).
- `RawTransaction` return for pay/getTransaction/pollTransaction stays unchanged (out of scope).

## 3. Scope

### In scope
- Unify to ONE `Customer` interface reused everywhere (config, COF/customer.service, enroll contact, `/process` adapter input).
- Remove `PayInput.customer`; `pay()` reads `config.customer`; throw `MISSING_CUSTOMER` when absent.
- Replace `mountCardFields` / `unmountCardFields` / `revealCardFields` with `tonder.create(type, options).mount(container?)` returning a component handle.
- Move input-field events into component options; move presentation callbacks to `config.events.presentation`; remove flat `onOpen/onClose/onComplete`.
- Apply one type-suffix policy; delete `PublicSuccess`/`PublicError`; add `ApmBanks` named type.
- Update README, e2e fixtures/tests, and sibling demos (`/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3`) to the final API.
- Update stale docs references (`threeDsMode` → `presentationMode`, etc.) as a docs task.
- No back-compat, no deprecation aliases (unreleased). Strict TDD (vitest) at apply.

### Out of scope (explicitly unchanged)
- Bare `RawTransaction` return contract for `pay`/`getTransaction`/`pollTransaction` (decided in `sdk-return-contracts`).
- COF camelCase return contracts.
- SDK-owned presentation modal behavior (`presentation-modal-events`) — EXCEPT where its config callbacks move under `events.presentation`.
- Backend / any server-side change.

### Affected files (from exploration inventory)
- `src/shared/types/index.ts` — `Customer`, remove `PayInput.customer`, `events` namespace, delete `PublicSuccess`/`PublicError`, `ApmBanks`, suffix renames.
- `src/types/card.ts` — component options types (from `MountCardFieldsRequest`/`RevealCardFieldsRequest`), events placement.
- `src/tonder.ts` — facade: `create()`/handle, remove mount/unmount/reveal verbs, `pay()` reads config.customer, `assertValidPayInput`, `buildProcessBody`, presentation-callback wiring.
- Skyflow adapter mount plumbing — component mount/unmount + event wiring.
- `src/index.ts` — exports (add `create`/handle types, drop dead types, renamed types).
- Tests touching `mountCardFields`/`revealCardFields`/`pay` customer, `handleRequiresAction`, `assertValidPayInput`.
- `README.md`, e2e specs/fixtures.
- Sibling demos `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3`.

## 4. Approach & rationale

Land as ONE umbrella change with sliced tasks (per the exploration recommendation), because the four items share the same hot files and test suites; slicing into separate PRs would re-churn the same mount/pay tests repeatedly. Delivery/PR-chaining decided at tasks time based on the changed-line forecast.

Rationale is maintainer-locked with evidence:
- **One customer + config-only** completes the `remove-register-customer` set-once/immutable decision (no per-call swap → no customer-confusion IDOR) and matches the Stripe server-scoped-customer model. Backend verified to require customer for all payment ops.
- **`create(type).mount()`** matches Stripe `elements.create().mount()`, Adyen `checkout.create().mount()`, MP `bricks.create()`, AND the SDK's own 04-proposal §2 generic-mount sketch. Scales to the full checkout roadmap with zero new top-level verbs.
- **Per-component events** naturally resolve the saved-card-CVV multi-context problem (each component instance carries its own event map) and match all three competitors' creation-time callbacks. `events.presentation` namespace kills the ambiguous flat `onClose`.

## 5. Decisions deferred to sdd-design

1. **Component type set** — exact initial `type` string values: `'cardFields'` (collect) + the type covering today's reveal flow (single reveal type vs a mode on `cardFields`).
2. **Component handle interface** — final method set (`unmount` vs also `destroy`; is there a `state`/status accessor; are events strictly on options or also settable on the handle; does `mount(container?)` default container come from options or a config default).
3. **Suffix policy final table** — the exact per-type mapping (`<Method>Input` / `<Noun>` / `<Method>Result`), including how renamed component-options types and `PaymentMethodInfo` land.
4. **`MISSING_CUSTOMER` error semantics** — throw at `pay()` call time (pre-flight) vs validate earlier at `create`/config time; error code/shape and message copy.
5. **`ApmBanks` naming** — confirm `ApmBanks` vs `ApmBanksResult` under the final suffix policy.
6. **Events merge/override rules** (if any) — whether component options are the sole event source or if a config-level default merges (design confirms per-component-only unless a default is warranted).

## 6. Acceptance criteria

- **AC1 (one Customer):** A single exported `Customer` interface `{ email: string; firstName?: string; lastName?: string; phone?: string }` is the only customer shape in the public API; no inline/duplicate customer object remains.
- **AC2 (config-only customer):** `PayInput.customer` is removed. `pay()` sources customer from `config.customer`. When `config.customer` is absent, `pay()` throws `MISSING_CUSTOMER` before any network call.
- **AC3 (/process adapter):** The `/process` request sends only `{ name, email }`, with `name` derived from `firstName`/`lastName`; `phone` is not silently dropped from a public field (it is not present on the pay path).
- **AC4 (component factory):** `mountCardFields`/`unmountCardFields`/`revealCardFields` are removed. `tonder.create(type, options)` returns a handle exposing `mount(container?)` and `unmount()`, with scoped state. Initial types cover collect and the current reveal flow.
- **AC5 (input events in component):** Input-field events are configured via component options (`create('cardFields', { events: { <field>: { onChange?, onBlur?, onFocus?, onReady? } } })`) and correctly resolve per component instance (incl. saved-card CVV multi-context).
- **AC6 (presentation events namespace):** Presentation callbacks are under `config.events.presentation.{onOpen?,onClose?,onComplete?}`. Flat `TonderConfig.onOpen/onClose/onComplete` no longer exist.
- **AC7 (type hygiene):** One suffix policy is applied across public request/response types; `PublicSuccess`/`PublicError` exports are deleted; `getApmBanks()` returns a named type (`ApmBanks`).
- **AC8 (docs/demos/e2e):** README, e2e specs, and sibling demos compile and pass against the new API; stale `threeDsMode`/`threeDsContainerId` doc references are updated to `presentationMode`.
- **AC9 (no back-compat):** No deprecation aliases or compatibility shims for any removed/renamed symbol.

## 7. Breaking-change & test-surface estimate

This is the **largest public-API change in the project to date**; be honest about blast radius.

- **`create()/mount()` (concern #4):** largest surface — `index.ts` exports, `tonder.ts` method removal/addition, skyflow adapter mount plumbing, all `mountCardFields.*` / `revealCardFields.*` tests, e2e fixtures, README, demos.
- **Remove `PayInput.customer` (concern #2):** breaks `PayInput`, `assertValidPayInput`, `buildProcessBody`; ~10+ occurrences in `tonder.pay.test.ts`, plus README §pay and demos.
- **Events namespace (concern #3):** `TonderConfig` (remove flat callbacks), component options events, `handleRequiresAction`/`handleApmResult` wiring, skyflow adapter, related tests.
- **Unify Customer (concern #1):** `PayInput`, `buildProcessBody`, `customer.service` map; pay + customer tests.

Combined test impact is **HIGH** across a ~243-test suite under strict TDD. Expect the changed-line total to exceed a single-PR review budget → tasks phase must produce a chained/sliced delivery plan (Review Workload Forecast likely flags chained PRs).

## Assumptions carried into spec/design (from locked decisions)

- Backend needs only `{name, email}` for `/process`; `name` derived at adapter. (verified)
- No guest pay; customer required for all payment ops. (verified)
- Umbrella change with sliced tasks, not four separate proposals.
- No deprecation aliases; strict TDD with vitest at apply.
