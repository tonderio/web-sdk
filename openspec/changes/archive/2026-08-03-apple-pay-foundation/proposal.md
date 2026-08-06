# Proposal: Apple Pay Foundation (Phase 1)

## Intent

Phase 1 of `docs/apple-pay-integration-plan.md`. Lands the compile-time surface only —
types and error codes — and **ships no merchant-visible behavior**. Nothing renders, fires,
or throws.

It exists to isolate one refactor. `ComponentOptionsByType` is today
`Record<TonderComponentType, CardFieldsOptions | undefined>`, which assumes every component
takes the same options; a second component makes it wrong. The second component does **not**
arrive in this phase (D3), so the refactor lands here purely because this is the only phase
with zero behavior — doing it later would bury a type-level change inside a runtime diff.

Everything else this change declares is **unreachable by construction**: declared, unwired
and unexported, so the type system promises nothing the runtime cannot yet deliver (D3).

> **Plan renumbering.** A new **Phase 2 — Catalog gate** was inserted after this change.
> The former Phases 2–6 are now **3–7**. References below use the new numbering.

## Scope

### In Scope

| Item                                                                                                                                                                                                      | File                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@types/applepayjs` in `devDependencies` — types only, must not reach the bundle                                                                                                                          | `package.json`                                           |
| `country_code?: string` on `BusinessProfile`                                                                                                                                                              | `src/models/business.model.ts`                           |
| `configuration?: { supported_networks?: string[] }` on the catalog transport type `BackendPaymentMethod` — **declaration only, nothing reads it**                                                         | `src/core/services/direct-api.service.ts` (~lines 17-30) |
| Six codes: `APPLE_PAY_NOT_ENABLED`, `_UNSUPPORTED_BROWSER`, `_CONTAINER_NOT_FOUND`, `_SESSION_ERROR`, `_VALIDATION_ERROR`, `_UNSUPPORTED_ACTION`                                                          | `src/shared/errors/ErrorKeyEnum.ts`                      |
| `PaymentEvents` — **declared only**, NOT added to `TonderEvents`, not exported                                                                                                                            | `src/shared/types/index.ts`                              |
| `ApplePayButtonOptions`, `ApplePayPaymentInput = Omit<PayInput, 'payment_method'>`, `ApplePayButtonComponent` — **declared only**, not exported                                                           | `src/types/apple-pay.ts` (new)                           |
| Extract `TonderMountableComponent` — declared, wired **and** exported                                                                                                                                     | `src/types/component.ts` (new)                           |
| `CardFieldsComponent` extends `TonderMountableComponent`; `ComponentOptionsByType` → explicit per-type map; `create<T>()` returns the handle for `T`. `TonderComponentType` stays exactly `'card_fields'` | `src/types/card.ts`, `src/tonder.ts`                     |
| `ApplePayButtonCustomization` — **declared only**, NOT added to `TonderCustomization`, not exported                                                                                                       | `src/types/customization.ts`                             |
| Exactly **one** new export: `TonderMountableComponent`                                                                                                                                                    | `src/index.ts`                                           |

### Out of Scope

Ports, adapters, strategies, services, orchestration, `create('apple_pay_button')` runtime
behavior, `isApplePayAvailable()`, README and docs. Those are Phases 3–7.

**Also out of scope — wiring any declared type into a reachable public surface (D3):**
`payment?: PaymentEvents` on `TonderEvents`, `apple_pay_button?` on `TonderCustomization`,
`apple_pay_button` in `TonderComponentType`, and every export except
`TonderMountableComponent`. Each lands in the phase that makes it real.

**Also out of scope — all catalog runtime behavior, which is the new Phase 2:** `init()`
fetching business + catalog in parallel via `Promise.all` with a non-fatal catalog request,
caching the raw catalog in core state, `getPaymentMethods()` filtering out every
`apple_pay_*` entry, and deriving availability / `supportedNetworks` /
`merchantCapabilities`. This change declares the transport field and nothing more.

## Capabilities

### New Capabilities

- `apple-pay`: the Apple Pay contract surface — error codes, option, handle and
  customization types, and the catalog transport field. **Declared and unreachable** in
  this phase; each type is wired and exported by the later phase that gives it behavior
  (D3). Runtime requirements arrive in Phases 2–5.

### Modified Capabilities

- `public-api`: `create<T>()` returns the handle for the requested type instead of the
  union, and `TonderMountableComponent` becomes a public base type. `TonderEvents` and
  `TonderCustomization` are **unchanged** by this phase.

## Approach

**Two** reviewable work units, **commits only, no pull requests**. D3 collapsed the former
unit 2 — see "Work unit re-scope" below.

1. **Inert declarations.** Nothing reads, references or exports any of it: `country_code?`,
   `BackendPaymentMethod.configuration?`, the six error codes, `PaymentEvents`,
   `ApplePayButtonCustomization`, `@types/applepayjs`.
2. **Component types.** `src/types/component.ts` (`TonderMountableComponent`) +
   `CardFieldsComponent` extending it + `ComponentOptionsByType` explicit map +
   `create<T>()` + the single `src/index.ts` export + `src/types/apple-pay.ts`. The only
   unit that touches existing type signatures.

`src/types/apple-pay.ts` sits in unit 2, not unit 1, because `ApplePayButtonComponent`
extends `TonderMountableComponent` — it cannot compile before the base exists.

### Work unit re-scope (consequence of D3)

The former unit 2 was "`PaymentEvents` + `ApplePayButtonCustomization` wired into the public
config types". D3 removes the wiring, which leaves two interface declarations that nothing
references — roughly 25 lines across two files, no call sites, no behavior, and no test
beyond a type-level assertion.

**That is too thin to justify its own commit, so merge it into unit 1 rather than pad it.**
Unit 1's identity is already "additive declarations nothing reads", and both interfaces are
exactly that. The result is two units with sharper identities than the original three: one
that cannot affect anything, and one that touches existing signatures. The split that
matters for review is inert-vs-signature-touching, and this is precisely that line.

Binding constraints (plan §3.2 and §7): no parallel interfaces — derive from `PayInput`,
extend `TonderMountableComponent`, reuse `RawTransaction` and `AppError`; snake_case on
every merchant-facing key (`ApplePayJS.*` keeps Apple's camelCase, which is Apple's
contract, not ours); no unnecessary validation; test doubles only in `*.test.ts`.

`events.payment` is **instance-level**, a sibling of `events.presentation` — not a
per-method event map. Rationale (plan §3.1): Apple Pay is the first method where the SDK
owns the trigger and will not be the last. Per-method maps would force N near-identical
contracts and make a merchant with three wallet buttons write the same handlers three
times.

### Resolved decisions

> Decisions are labelled D1–D5 here. D3 is new and shifted the later labels; the Engram
> copy (stale at revision 2) uses an older numbering.

**D1 — `country_code` is optional permanently — `country_code?: string`.** This intentionally
differs from plan §4.1, which declares it required; the plan is the older statement. §4.1
also defines the degradation rule — missing or empty `country_code` means the business is
not configured for Apple Pay, so `isApplePayAvailable()` returns `false` and `mount()`
throws `APPLE_PAY_NOT_ENABLED` (Phase 5). A required field contradicts that rule: absence
would become a compile error instead of the runtime state the SDK already handles, and it
would lie about the wire until the backend deploys. The SDK degrades; it does not fail to
compile. No fixture churn. `country_code` is unaffected by the availability move below —
it never lived in the Apple Pay block.

**D2 — `create<T>()` narrowing is compatibility-preserving, not a risk.** `TonderComponent`
is today a single-member union (`= CardFieldsComponent`, `src/types/card.ts:194`), so
`create('card_fields')` already returns `CardFieldsComponent` and returns exactly that
after the narrowing — identical for every existing caller. No version gate.

_Rationale corrected by D3._ D2 originally argued the narrowing _prevents_ a break, because
adding `apple_pay_button` would widen `TonderComponent` to a two-member union and break
every `create('card_fields')` call site. Under D3 that widening **does not happen in this
phase** — `TonderComponentType` stays exactly `'card_fields'`. So the narrowing prevents
nothing _here_; it is preparation for the phase that adds the union member. It still belongs
in this change for a different and better reason: it is a pure type-level refactor with zero
behavior, and this is the only phase with zero behavior. Doing it later means doing it
inside a diff that also changes runtime, which is exactly what this change exists to avoid.

**D3 — Declaring a type is not wiring it.** (Plan §3.3.) _A type may be declared before its
behavior exists. It may not be wired into a reachable public surface before its behavior
exists._

| Wiring                                       | What a merchant gets without the runtime              |
| -------------------------------------------- | ----------------------------------------------------- |
| `apple_pay_button` in `TonderComponentType`  | `create('apple_pay_button')` type-checks, then throws |
| `payment?: PaymentEvents` on `TonderEvents`  | callbacks accepted, silently never fire               |
| `apple_pay_button?` on `TonderCustomization` | styles accepted, silently ignored                     |

The failure is identical in all three: the type system promising what the runtime does not
deliver. A silent no-op is _worse_ than a throw, because nothing tells the merchant they are
holding it wrong. Rejecting the dead union entry while accepting dead callbacks would make
the principle arbitrary, so it generalizes.

| Surface                                                                    | Declared | Wired + exported                                                               |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `TonderMountableComponent`                                                 | Phase 1  | **Phase 1** — `CardFieldsComponent` extends it today, so it is real on arrival |
| `PaymentEvents`                                                            | Phase 1  | the phase that fires them                                                      |
| `ApplePayButtonCustomization`                                              | Phase 1  | the phase whose adapter applies them                                           |
| `ApplePayButtonOptions`, `ApplePayPaymentInput`, `ApplePayButtonComponent` | Phase 1  | the phase that implements the component                                        |

Net effect: `src/index.ts` gains **exactly one** export, `TonderMountableComponent`.
Everything else is an inert declaration that cannot mislead anyone.

**D4 — `ApplePayButtonCustomization` ships its full shape now.** Phase 1 is the
declare-the-types phase; deferring means writing the interface twice for no gain. Declaring
the full shape costs nothing under D3, because the interface is unreachable until the
adapter phase attaches it to `TonderCustomization`.

```ts
/** Customization for the Apple Pay button surface. */
export interface ApplePayButtonCustomization {
  /** Maps to -apple-pay-button-type. Defaults to 'buy'. */
  type?:
    | 'buy'
    | 'plain'
    | 'donate'
    | 'book'
    | 'subscribe'
    | 'check-out'
    | 'set-up'
    | 'continue'
    | 'order';
  /** Maps to -apple-pay-button-style. Defaults to 'black'. */
  style?: 'black' | 'white' | 'white-outline';
  /** Maps to -apple-pay-button-locale, e.g. 'es-MX'. */
  locale?: string;
  height?: string;
  border_radius?: string;
}
```

Every field maps to a WebKit CSS property Apple actually exposes; nothing invented. There
is deliberately **no image or icon option** — Apple's HIG forbids custom Apple Pay logo
artwork, which is also why the Phase 3 adapter renders via
`-webkit-appearance: -apple-pay-button` and never an `<img>`. Phase 1 declares; Phase 3
wires it onto `TonderCustomization`, exports it, and applies it.

**D5 — Availability moved out of the business config — `ApplePayConfig` is gone.** The backend
will not ship an `apple_pay` block on `GET /payments/business/{apiKey}`. Availability,
networks and capabilities now derive from the payment-method catalog
(`GET /payment_methods?status=active`), which gains `apple_pay_debit_card` and
`apple_pay_credit_card`, each carrying `configuration.supported_networks` (plan §4.1
source B). This change therefore declares **no** `ApplePayConfig` and **no**
`apple_pay?` field on `BusinessConfig` — that interface does not exist in the design any
more. Only the catalog transport field `configuration?` is declared here.

`APPLE_PAY_NOT_ENABLED` **keeps its identifier and code**; only its meaning shifts, to match
plan §5.2: _"No active `apple*pay*_`method in the catalog, or no`country_code` on the
business."\* Update the description, never the identifier.

## Forward constraints (later phases, not this change)

Recorded so later phases inherit them; **none of this is work here**.

**Wiring rule (D3, general).** Each later phase wires and exports its own types in the same
change that gives them behavior. A phase that adds a runtime capability is responsible for
attaching the corresponding type to its public surface and adding its `src/index.ts` export
— never earlier.

Phase 2 specifics:

| Constraint             | Rule                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Availability gate      | At least one active `apple_pay_*` method                                                                                                                                             |
| `supportedNetworks`    | Deduplicated **union** of `configuration.supported_networks` across active `apple_pay_*` entries; falls back to `['visa', 'masterCard']`                                             |
| `merchantCapabilities` | **Mandatory on every Apple Pay request and always sent.** `'supports3DS'` is a constant that is never replaced; `'supportsDebit'` / `'supportsCredit'` are _added_ per active method |
| Caching                | Cache the catalog **raw** in core state; filter `apple_pay_*` only at the `getPaymentMethods()` boundary                                                                             |
| `init()`               | Business + catalog fetched in parallel (`Promise.all`); the catalog request is **non-fatal** — `init()` still reaches `ready` on failure                                             |

## Risks

| Risk                                                                                                       | Likelihood | Mitigation                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@types/applepayjs` leaks into the bundle                                                                  | Low        | devDependency only; verify `npm run build` output and emitted `.d.ts`                                                        |
| Declared-but-dead surface if Phases 2–5 stall                                                              | Low        | Under D3 nothing declared here is reachable, so a stall costs nothing merchant-visible — the types are invisible until wired |
| `ApplePayButtonCustomization` field set proves incomplete once the adapter lands                           | Low        | All fields are optional and unwired; Phase 3 can extend it before exposing it                                                |
| A reviewer or implementer "finishes the job" by wiring `payment?`, `apple_pay_button?` or `configuration?` | **Med**    | D3 states the rule, the scope table marks every type declared-only, and the success criteria verify the absence of each key  |
| D2's original prevent-a-break rationale no longer applies, inviting a push to defer the refactor           | Low        | Deferring means landing it inside a behavioral diff — the one thing this phase exists to prevent                             |

## Rollback Plan

Revert the two commits in reverse order. Everything here is inert type declarations plus one
type-level refactor — no runtime code path, no persisted data, no network contract.
Reverting unit 2 alone restores the previous `create()` typing and removes the only new
public export. Unit 1 is unreachable by construction, so leaving it in place breaks nothing.

## Dependencies

- Backend must ship `country_code` inside `business`, and `apple_pay_debit_card` /
  `apple_pay_credit_card` entries with `configuration.supported_networks` in
  `GET /payment_methods?status=active`. **Not blocking, and never blocking**: both stay
  optional in the types and the SDK degrades to Apple Pay unavailable until they arrive.
- `DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard']` and the union/fallback derivation
  land in Phase 2; only the optionality of `supported_networks` is declared here.

## Success Criteria

- [x] `npm run test`, `npm run typecheck` and `npm run build` pass
- [x] No existing behavior changed; no existing test edited beyond type-signature updates
- [x] `create('card_fields', …)` returns `CardFieldsComponent`, not a union — every
      existing call site compiles untouched
- [x] A `BusinessConfig` fixture with no `country_code`, and a `BackendPaymentMethod`
      fixture with no `configuration`, both still type-check
- [x] No `ApplePayConfig` interface and no `apple_pay` field exist anywhere in `src/`
- [x] **D3, verifiable by absence**: `TonderEvents` has no `payment` key,
      `TonderCustomization` has no `apple_pay_button` key, and `TonderComponentType` is
      still exactly `'card_fields'` at the end of this change
- [x] `src/index.ts` exports exactly **one** new name — `TonderMountableComponent`. Diffing
      the emitted `.d.ts` public surface shows that single addition and nothing else
- [x] Nothing reads `BackendPaymentMethod.configuration` — `getPaymentMethods()` output is
      byte-identical to before
- [x] `@types/applepayjs` absent from runtime `dependencies` and from the published bundle
- [x] No new interface duplicates one that plan §3.2 says to reuse
- [x] No file under `src/` exists only for testing
