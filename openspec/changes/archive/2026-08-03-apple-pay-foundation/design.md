# Design: Apple Pay Foundation (Phase 1)

Type architecture only. No algorithms, no runtime paths, no merchant-visible behavior.
The deliverable is a set of **unreachable-by-construction** declarations plus one structural
refactor (`ComponentOptionsByType` + `create<T>()`), isolated from every phase that has
behavior.

Aligned to `proposal.md` **revision 4** and plan §§3.2, 3.3, 4.1, 5.3, 6. Two scope changes
since the first draft of this document: availability left the business config (proposal D5),
and declaring a type no longer implies wiring it (proposal D3).

> **Label namespace.** This document numbers its own decisions `DD1…DD7` to avoid colliding
> with the proposal's `D1…D5`. Cross-references to proposal decisions are written `proposal D3`.

## Quick path

1. **Unit 1 — inert declarations.** Nothing references, reads or exports any of it.
2. **Unit 2 — component types.** The only unit that touches existing type signatures.

Green between the units: `npm run test`, `npm run typecheck`, `npm run build`.
Delivery is **commits only — no pull requests**.

## Architecture decisions

### DD1 — `ComponentOptionsByType` becomes a single-key interface, plus a sibling `ComponentByType`

**Choice.** Replace `Record<TonderComponentType, CardFieldsOptions | undefined>` with two
explicit interfaces and type `create<T>()` by lookup on both. `TonderComponentType` stays
exactly `'card_fields'`.

```ts
// src/types/card.ts
export type TonderComponentType = 'card_fields';

/** Construction options per component type. One key today (DD2). */
export interface ComponentOptionsByType {
  card_fields: CardFieldsOptions | undefined;
}

/** Handle type per component type. One key today (DD2). */
export interface ComponentByType {
  card_fields: CardFieldsComponent;
}

/** Union of every handle `create()` can return. Derived — never hand-maintained. */
export type TonderComponent = ComponentByType[TonderComponentType];
```

```ts
// src/tonder.ts
public create<T extends TonderComponentType>(
  type: T,
  options?: ComponentOptionsByType[T],
): ComponentByType[T] {
  if (type === 'card_fields') {
    return this.createCardFieldsComponent(
      options as CardFieldsOptions,
    ) as ComponentByType[T];
  }
  throw new AppError({ errorCode: ErrorKeyEnum.INVALID_COMPONENT_TYPE });
}
```

`ComponentByType` is this design's addition — plan §5.3 specifies only the options map, but
"returns the handle for `T`" needs a handle map to look up. Like `ComponentOptionsByType` it
is module-exported for `src/tonder.ts` and **not** added to the barrel.

**Alternatives rejected.** (a) One overload per component — grows linearly and duplicates the
map. (b) A mapped type `{ [K in TonderComponentType]: … }` — cannot give per-key distinct
value types without conditionals, which is the thing being removed. (c) Keep `Record` and cast
at call sites — pushes the defect onto merchants.

**Why it is safe today.** `TonderComponentType` is a single-member union, so `T` can only be
`'card_fields'` and `ComponentByType['card_fields']` is `CardFieldsComponent`. The previous
return type `TonderComponent` is `CardFieldsComponent`. **Identical for every existing
caller.** `TonderComponent` is now derived from the map, so
`expectTypeOf<TonderComponent>().toEqualTypeOf<CardFieldsComponent>()`
(`src/types/card.test.ts:123`) holds unchanged.

**Why it belongs in this phase, given that it prevents nothing here.** Under DD2 the union
does not widen in this change, so the original "the narrowing prevents a break" argument does
not apply to this diff. Two reasons that do:

1. **It is a pure type-level change, and this is the only phase with zero behavior.** Landing
   it later means landing it inside a diff that also changes runtime — the single thing this
   phase exists to prevent.
2. **It is a precondition.** Without it, the phase that adds `apple_pay_button` to
   `TonderComponentType` widens `TonderComponent` to a two-member union and breaks every
   existing `create('card_fields')` call site on `.mount()` — a type-level regression buried
   in a behavioral diff.

**The interface-over-`Record` guardrail — stronger under DD2, not weaker.** Indexing
`ComponentOptionsByType[T]` only compiles when _every_ member of `TonderComponentType` is a
key. Now that the union deliberately stays single-member, this is the mechanism that **forces**
the later phase to update both maps when it widens the union: forgetting is a compile error on
the `create` signature. The old `Record` silently accepted the wrong value type instead. This
guardrail is what makes deferring the union member safe.

**Unavoidable cast.** TypeScript cannot narrow a generic return type from a value-level
`type === 'card_fields'` check, so the dispatch branch carries one documented
`as ComponentByType[T]`. The later phase adds a second branch with the same shape — not a new
pattern.

### DD2 — Unreachable by construction: declare, do not wire

**Choice.** Apply proposal D3 / plan §3.3 literally. _A type may be declared before its
behavior exists. It may not be wired into a reachable public surface before its behavior
exists._

| Type                                                                       | Declared here | Wired here                                                     | Exported here  | Wired + exported by                         |
| -------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- | -------------- | ------------------------------------------- |
| `TonderMountableComponent`                                                 | yes           | **yes** — `CardFieldsComponent` extends it today               | **yes**        | — real on arrival                           |
| `PaymentEvents`                                                            | yes           | no — `TonderEvents` gains **no** `payment` key                 | no             | the phase that fires them (5)               |
| `ApplePayButtonCustomization`                                              | yes           | no — `TonderCustomization` gains **no** `apple_pay_button` key | no             | the phase whose adapter applies them (3)    |
| `ApplePayButtonOptions`, `ApplePayPaymentInput`, `ApplePayButtonComponent` | yes           | no — `TonderComponentType` stays `'card_fields'`               | no             | the phase that implements the component (5) |
| `BackendPaymentMethod.configuration?`                                      | yes           | no — nothing reads it                                          | n/a (internal) | the catalog phase (2)                       |

**Rationale.** All four wirings fail the same way: the type system promises what the runtime
cannot deliver. `create('apple_pay_button')` would type-check and throw; `events.payment`
callbacks would be accepted and never fire; `apple_pay_button` styles would be accepted and
silently ignored. **A silent no-op is worse than a throw**, because nothing tells the merchant
they are holding it wrong. Rejecting the dead union entry while accepting dead callbacks would
make the principle arbitrary, so it generalizes.

**Consequence for this design.** The proposal's earlier "declared-but-dead surface" risk is not
mitigated here — it is _eliminated_. Nothing declared in this change is reachable, so a stall
in Phases 2–5 costs nothing merchant-visible.

**This decision is verifiable by absence**, which is how `sdd-verify` should check it: no
`payment` key on `TonderEvents`, no `apple_pay_button` key on `TonderCustomization`,
`TonderComponentType` still exactly `'card_fields'`, and no `ApplePayConfig` identifier
anywhere under `src/`.

### DD3 — `TonderMountableComponent` lives in a new `src/types/component.ts`

```ts
// src/types/component.ts
/** Base contract for every handle returned by `tonder.create()`. */
export interface TonderMountableComponent {
  /** Mount this component into its container(s). Requires `init()` to have completed. */
  mount(): Promise<void>;
  /** Unmount this component and release its resources. */
  unmount(): void;
}
```

```ts
// src/types/card.ts
export interface CardFieldsComponent extends TonderMountableComponent {
  reveal(request: RevealCardFieldsInput): Promise<void>;
}

// src/types/apple-pay.ts
export type ApplePayButtonComponent = TonderMountableComponent;
```

**Alternative rejected: keep the base in `src/types/card.ts`.** Works now, but the phase that
implements the component makes `card.ts` import `ApplePayButtonOptions`/`ApplePayButtonComponent`
for the maps while `apple-pay.ts` already imports the base from `card.ts` — **a `card.ts` ↔
`apple-pay.ts` module cycle**. Type-only and erased, but the repo treats cycle avoidance as a
standing rule (`src/models/business.model.ts:10`). Avoiding it later would mean doing this
extraction _then_, i.e. a structural refactor riding along with feature logic. Plan §5 now
records the same conclusion. Unaffected by proposal D3 or D5.

**Resulting graph — acyclic now and after the component phase:**

```
                    component.ts  (TonderMountableComponent)
                      ↑        ↑
             card.ts ─┘        └─ apple-pay.ts ──→ shared/types (PayInput)
                │                       ↑
                └───────────────────────┘  (later phase only)
```

**No signature drift.** The base declares exactly the `mount(): Promise<void>` /
`unmount(): void` that `CardFieldsComponent` declares today (`src/types/card.ts:180-182`).
Card-specific prose on those methods moves to the `CardFieldsComponent` interface doc block
rather than being redeclared — redeclaring identical signatures would reintroduce the
duplication plan §3.2 removes.

### DD4 — `PaymentEvents` declared in `src/shared/types/index.ts`, `TonderEvents` untouched

```ts
// src/shared/types/index.ts
import type { RawTransaction } from '../../models/transaction.model';
import type { AppError } from '../errors/AppError';

/**
 * Payment lifecycle callbacks. Instance-level, a sibling of PresentationEvents —
 * NOT wired onto TonderEvents until the phase that fires them (plan §3.3).
 */
export interface PaymentEvents {
  on_success?(transaction: RawTransaction): void;
  on_error?(error: AppError): void;
  on_cancel?(): void;
}
```

`TonderEvents` and the `TonderConfig.events` JSDoc are **unchanged by this phase** — the doc
cannot describe a key that does not exist.

**Placement rationale, preserved for the phase that wires it (plan §3.1).** When it lands, it
lands on `TonderEvents` as a sibling of `presentation`, never as a per-component event map.
Apple Pay is the first method where the SDK owns the trigger and will not be the last; a
per-method map forces N near-identical contracts for N wallets and makes a merchant with three
wallet buttons write the same three handlers three times. `config.events` is already the
namespaced event surface. `on_cancel` is separate from `on_error` because cancelling is a
shopper decision, not a failure, and carries no error code.

**"Read at fire time" extends naturally, but only if three properties hold.** Two are
type-level and are satisfied by this declaration: every callback is optional, and every
callback returns `void`, so the SDK never depends on a merchant return value. The third —
never snapshotting `config.events` at construction — cannot be expressed in a type. It is a
**forward constraint**: read `getConfig().events?.payment?.…` at emit time, exactly as
`presentation` does, and extend the `TonderConfig.events` JSDoc to name `payment` under the
same rule _in that same change_.

**Cycle check.** `AppError.ts` imports only `./ErrorKeyEnum` and `./messages`;
`transaction.model.ts` imports nothing. Both new imports are `import type` and erased under
`verbatimModuleSyntax`. No cycle.

### DD5 — Availability is not a business-config concern; only two optional transport fields land

**Choice (proposal D5).** There is **no `ApplePayConfig` interface and no `apple_pay` field on
`BusinessConfig`** — that interface does not exist in this design. Availability, networks and
capabilities derive from the payment-method catalog. This phase declares two optional fields
and nothing reads either.

```ts
// src/models/business.model.ts — pure type module, no imports added
export interface BusinessProfile {
  /* …existing… */ country_code?: string;
}
```

```ts
// src/core/services/direct-api.service.ts:17-30 — internal transport type
interface BackendPaymentMethod {
  // …existing fields
  /** Per-method backend configuration. Declared for the catalog phase; unread here. */
  configuration?: { supported_networks?: string[] };
}
```

`BackendPaymentMethod` is module-private, so this addition is invisible outside
`direct-api.service.ts` and adds no import — `core/` purity is untouched.

**How absence flows.** Adding optional members to an interface cannot invalidate an existing
object literal, so a `BusinessConfig` with no `country_code` and a `BackendPaymentMethod` with
no `configuration` both type-check and parse unchanged, with zero fixture churn.
`getPaymentMethods()` output is byte-identical: the mapping layer never touches the new field.

`country_code?` is optional **permanently**, differing from the older plan §4.1 wording that
declared it required. Missing or empty `country_code` means the business is not configured for
Apple Pay — a runtime state the SDK already handles. A required field would turn absence into a
compile error and misdescribe the wire until the backend deploys. **The SDK degrades; it does
not fail to compile.**

**DECLARED here, ENFORCED later.** This phase adds the six `ErrorKeyEnum` members
(`APPLE_PAY_NOT_ENABLED`, `_UNSUPPORTED_BROWSER`, `_CONTAINER_NOT_FOUND`, `_SESSION_ERROR`,
`_VALIDATION_ERROR`, `_UNSUPPORTED_ACTION`) and throws none of them. `APPLE_PAY_NOT_ENABLED`
**keeps its identifier**; only its doc comment changes to plan §5.2's meaning — _no active
`apple*pay*_`method in the catalog, or no`country_code` on the business\*. Never rename the
identifier.

### DD6 — `@types/applepayjs` containment

**Choice.** devDependency only, referenced as an **ambient global namespace** — never imported.

| Mechanism                                                                        | Why it holds                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package ships declarations only, zero runtime JS                                 | Rollup has nothing to emit even if a module referenced it                                                                                                                              |
| `tsconfig.json` sets no `types` array                                            | Every `@types/*` is globally ambient, so later phases write `ApplePayJS.ApplePayPaymentRequest` with **no import statement** — no module edge, no cycle, nothing for Rollup to resolve |
| Nothing in this phase references `ApplePayJS.*`                                  | `ApplePayButtonOptions` uses only `container_id` and a `PayInput`-derived payload                                                                                                      |
| `src/types/apple-pay.ts` is unexported and unreachable from `src/index.ts` (DD2) | `rollup-plugin-dts` walks from the entry, so the module cannot reach `dist/index.d.ts`                                                                                                 |

**The real leak vector is the published `.d.ts`, not the JS bundle.** If a type reachable from
`src/index.ts` ever exposes an `ApplePayJS.*` member, `dist/index.d.ts` gains a
`/// <reference types="applepayjs" />` or inlined Apple types and consumers must install the
package. **Forward constraint:** keep `ApplePayJS.*` inside adapter and port modules; never
re-export it from a publicly reachable type.

**Verification (unit 1 acceptance):** `@types/applepayjs` appears only under `devDependencies`;
after `npm run build`, `rg -c applepayjs dist/index.d.ts` is 0 and
`rg -c 'ApplePayJS|applepayjs' dist/tonder-web-sdk.js dist/index.mjs dist/index.cjs` is 0.

### DD7 — `src/index.ts` gains exactly one export

**Choice.** `TonderMountableComponent`, and nothing else.

**Superseded reasoning, stated so it is not re-proposed.** An earlier draft of this design
argued for three exports, adding `PaymentEvents` and `ApplePayButtonCustomization` on the
grounds that `PresentationEvents` is already exported and omitting its sibling leaves the event
surface asymmetric. **That argument dies under DD2**: the symmetry it appealed to does not
exist yet, because the sibling _wiring_ (`payment?` on `TonderEvents`) is itself deferred.
Exporting a type whose only purpose is to annotate a config key that does not exist would be
the same promise-without-runtime DD2 rejects, one level removed.

`TonderMountableComponent` is the sole exception because it is wired on arrival —
`CardFieldsComponent` extends it in this same change, so it already appears structurally in
`dist/index.d.ts` via the `extends` clause. Naming it costs nothing and describes something
real.

**Verification:** a `.d.ts` public-surface diff shows exactly one addition.

## Interfaces added

```ts
// src/types/apple-pay.ts (new — declared, unexported, unreachable until the component phase)
import type { PayInput } from '../shared/types';
import type { TonderMountableComponent } from './component';

/** Everything pay() accepts except the method, which this component implies. */
export type ApplePayPaymentInput = Omit<PayInput, 'payment_method'>;

export interface ApplePayButtonOptions {
  /** Container id. Defaults to '#tonder-apple-pay-button'. */
  container_id?: string;
  /**
   * Payment data for the charge. Object for a fixed amount, function for a cart
   * that can change after mount. Called SYNCHRONOUSLY inside the click handler.
   */
  payment: ApplePayPaymentInput | (() => ApplePayPaymentInput);
}

export type ApplePayButtonComponent = TonderMountableComponent;
```

`ApplePayButtonCustomization` is declared in `src/types/customization.ts` with its full shape
(proposal D4, verbatim: `type?`, `style?`, `locale?`, `height?`, `border_radius?`) and is **not**
added to `TonderCustomization`. Declaring the full shape costs nothing precisely because the
interface is unreachable. No image or icon option: Apple's HIG forbids custom artwork, which is
why the adapter phase renders via `-webkit-appearance: -apple-pay-button`.

**Naming.** Every new merchant-facing key is snake_case (`country_code`, `supported_networks`,
`configuration`, `border_radius`, `on_success`). Apple's own tokens keep Apple's casing
(`ApplePayJS.*`, `masterCard`, `check-out`, `white-outline`) — that is Apple's contract, not ours.

**No duplication (plan §3.2 audit satisfied).** Payment input derives from `PayInput`; callbacks
reuse `RawTransaction` and `AppError`; the handle extends the shared base; availability reuses
the catalog the SDK already fetches, so no `ApplePayConfig` is introduced. No new error class.

## File changes

| File                                      | Action | Unit                                                                        |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `package.json`                            | Modify | 1 — `@types/applepayjs` in `devDependencies`                                |
| `src/models/business.model.ts`            | Modify | 1 — `country_code?` on `BusinessProfile`                                    |
| `src/core/services/direct-api.service.ts` | Modify | 1 — `configuration?` on `BackendPaymentMethod` (~L17-30), unread            |
| `src/shared/errors/ErrorKeyEnum.ts`       | Modify | 1 — six codes; `APPLE_PAY_NOT_ENABLED` doc per §5.2                         |
| `src/shared/types/index.ts`               | Modify | 1 — `PaymentEvents` declared; `TonderEvents` untouched                      |
| `src/types/customization.ts`              | Modify | 1 — `ApplePayButtonCustomization` declared; `TonderCustomization` untouched |
| `src/types/component.ts`                  | Create | 2 — `TonderMountableComponent`                                              |
| `src/types/card.ts`                       | Modify | 2 — extend base, explicit maps, derived `TonderComponent`                   |
| `src/tonder.ts`                           | Modify | 2 — `create<T>()` signature and imports                                     |
| `src/types/apple-pay.ts`                  | Create | 2 — declared, unexported                                                    |
| `src/index.ts`                            | Modify | 2 — one export: `TonderMountableComponent`                                  |

## Testing strategy

**Finding that shapes this section (independently confirmed by the coordinator).**
`tsc --noEmit` excludes `**/*.test.ts` (`tsconfig.json:20`) and `npm run test` is `vitest run`
with no `--typecheck` and no `test.typecheck` block. **`expectTypeOf` assertions in `*.test.ts`
prove nothing** — erased at runtime, never type-checked. The comment at
`src/types/card.test.ts:22` claiming the object literal is a compile-time exactness check does
not hold under this configuration.

| Layer                                   | What it proves                                                                                                                                                         | Enforced by                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `tsc --noEmit` over `src/**` (non-test) | The refactor's real blast radius compiles: the `create<T>()` body, the barrel, every `BusinessConfig` and `BackendPaymentMethod` consumer                              | `npm run typecheck` pass 1 — **enforced** |
| `tsc --noEmit -p e2e/tsconfig.json`     | A real `create('card_fields', {…})` followed by `component.mount()` at `e2e/support/fixtures.ts:123-135` still compiles untouched — **the acceptance gate** for unit 2 | `npm run typecheck` pass 2 — **enforced** |
| `vitest run`                            | No behavioral regression; `getPaymentMethods()` output unchanged; no existing test edited beyond type-signature updates                                                | `npm run test` — **enforced**             |
| `npm run build` + `rg`                  | `@types/applepayjs` absent from every artifact (DD6); `.d.ts` public-surface diff shows exactly one addition (DD7)                                                     | `npm run build` — **enforced**            |
| Absence checks (DD2)                    | No `payment` key on `TonderEvents`, no `apple_pay_button` key on `TonderCustomization`, `TonderComponentType` still `'card_fields'`, no `ApplePayConfig` under `src/`  | `rg` — **enforced**, cheap and exact      |
| `expectTypeOf` in `*.test.ts`           | Shape documentation and intent only                                                                                                                                    | **Not enforced**                          |

**Do NOT change the test tooling in this phase.** Enabling `vitest --typecheck` or a third
`tsc --noEmit -p tsconfig.test.json` would type-check every existing test file for the first
time — an unbounded diff inside a phase whose value is being small and reviewable. Dave
approved fixing the root cause as its own separate change; it is out of scope here and is not
an open question for this design.

**Test doubles live in `*.test.ts`. Nothing under `src/` exists only for testing** — the reason
the compile-time assertions are not moved into a `src/` fixture module.

## Work units

Two units, confirmed. The split line is **inert versus signature-touching**, which is the
distinction a reviewer actually acts on — sharper than grouping by feature.

| #   | Commit                                                     | Contents                                                                                                                                     | Risk                                                      |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `feat: declare Apple Pay foundation types and error codes` | `@types/applepayjs`, `country_code?`, `BackendPaymentMethod.configuration?`, six error codes, `PaymentEvents`, `ApplePayButtonCustomization` | **None** — nothing references, reads or exports any of it |
| 2   | `refactor: narrow create() return type per component`      | `src/types/component.ts`, `CardFieldsComponent extends`, both maps, `create<T>()`, `src/types/apple-pay.ts`, the single barrel export        | The only unit that touches existing type signatures       |

**Green after unit 1:** `npm run test`, `npm run typecheck` (both passes), `npm run build` all
pass; `getPaymentMethods()` output byte-identical; `rg` finds no reference to any newly
declared name outside its declaring file; `@types/applepayjs` absent from `dist/`.

**Green after unit 2:** all of the above, plus `e2e/support/fixtures.ts:123-135` compiles
untouched (the acceptance gate), the `.d.ts` public-surface diff shows exactly one addition,
and every DD2 absence check holds.

**Ordering is forced, not stylistic.** `src/types/apple-pay.ts` must sit in unit 2 because
`ApplePayButtonComponent` aliasing `TonderMountableComponent` cannot compile before
`src/types/component.ts` exists. Unit 2 last also makes rollback surgical: reverting it alone
restores the previous `create()` typing and removes the only new public export, while unit 1 is
unreachable by construction and breaks nothing if left in place.

## Forward constraints (record, do not implement)

**General wiring rule (proposal D3).** Every later phase wires and exports its own types in the
same change that gives them behavior. A phase adding a runtime capability owns attaching the
corresponding type to the public surface and adding its `src/index.ts` export — never earlier.

**Phase 2 — catalog gate** (new phase; former Phases 2–6 are now 3–7):

| Constraint             | Rule                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init()`               | Business + catalog fetched in parallel via `Promise.all`; the catalog request is **non-fatal** — `init()` still reaches `ready` on failure                                                 |
| Caching                | Cache the catalog **raw** in core state; filtering before caching destroys the data the gate depends on                                                                                    |
| Public boundary        | `getPaymentMethods()` filters out every `apple_pay_*` entry, in the same mapping layer that already projects to `PaymentMethodInfo`, so there is exactly one place an entry can be dropped |
| Availability gate      | At least one active `apple_pay_*` method **and** a non-empty `country_code`                                                                                                                |
| `supportedNetworks`    | Deduplicated **union** of `configuration.supported_networks` across active `apple_pay_*` entries; falls back to `DEFAULT_APPLE_PAY_NETWORKS = ['visa','masterCard']`                       |
| `merchantCapabilities` | `'supports3DS'` is a constant that is never replaced; `'supportsDebit'` / `'supportsCredit'` are _added_ per active method                                                                 |

**Later phases:**

- The phase adding `apple_pay_button` to `TonderComponentType` must add the key to **both**
  `ComponentOptionsByType` and `ComponentByType` in the same change — DD1's interface guardrail
  makes forgetting a compile error — and export `ApplePayButtonOptions`,
  `ApplePayPaymentInput` and `ApplePayButtonComponent` at that point.
- The phase that fires payment events adds `payment?: PaymentEvents` to `TonderEvents`, exports
  `PaymentEvents`, updates the `TonderConfig.events` JSDoc, and reads
  `getConfig().events?.payment?.…` at emit time — never snapshotting it (DD4).
- The adapter phase adds `apple_pay_button?` to `TonderCustomization` and exports
  `ApplePayButtonCustomization`, alongside the `-webkit-appearance` render.
- `ApplePayJS.*` stays confined to adapter and port modules (DD6).
- **Phase 7 (Safari e2e):** `e2e/tsconfig.json` sets `"types": ["node"]`, so `ApplePaySession`
  is not ambient in the e2e project — it will need `"types": ["node", "applepayjs"]`.
- **When a third component lands**, move the component registry
  (`TonderComponentType`/`ComponentOptionsByType`/`ComponentByType`) out of `src/types/card.ts`
  into `src/types/component.ts`; card should not own the registry.

## Open questions

None.

## Next step

`sdd-tasks` — break these two units into ordered, checkable steps.
