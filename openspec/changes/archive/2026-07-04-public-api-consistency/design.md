# Design: public-api-consistency

Architecture-level HOW for the pre-release public-API consistency pass of
`@tonder.io/web-sdk` (v3, UNRELEASED). Composes with the shipped
`presentation-mode`, `card-field-events`, and `sdk-return-contracts` specs. All
LOCKED decisions from the proposal are treated as fixed inputs; this document
resolves the six deferred design decisions (a)-(f) and specifies the exact TS
surface, facade wiring, adapter mapping, export delta, test surface, and
migration notes.

## Architectural approach

- **Pattern continuity.** Keep the shipped backbone: Facade (`Tonder`) + Factory
  Method (`createTonder`) + Strategy (payment methods) + Adapter (Skyflow/Kushki)
  + Service Locator (`ServiceManager`). This change adds ONE new GoF role at the
  public edge: a **Factory Method for UI components** (`tonder.create(type,
  options)`) returning a lightweight **component handle** (a thin facade view over
  the existing `TokenizerPort` contexts). No new subsystem, no new port.
- **Hexagonal boundary preserved.** `core/` stays pure. The component handle is a
  facade-layer object; it delegates to `this.tokenizer` (the `TokenizerPort`) and
  holds NO DOM or Skyflow reference of its own. The context-key mechanism inside
  `SkyflowAdapter` (`'create'` / `'update:<cardId>'`) is the single source of
  truth for mounted state — the handle never duplicates it.
- **Zero back-compat.** Unreleased package: hard-break the old verbs and flat
  callbacks. No aliases, no shims (consistent with the `remove-register-customer`
  and `presentation-modal-events` precedents).
- **Minimal-churn type policy.** Rename only what the suffix policy forces; do NOT
  gratuitously rename types that already comply (`PayInput`, `EnrollResult`,
  `Card`, `RawTransaction`, `ApmBank`, `CardFieldState`, `CardFieldEvents`).

## Decision resolution (a)-(f)

### (a) Component type set — RESOLVED: `'cardFields'` only; reveal stays internal

Evidence from code:
- `revealCardFields` is public today but is exercised ONLY by one e2e smoke test
  (`e2e/tests/card-pay.spec.ts:65`) and is referenced in NO demo
  (`demos/web-sdk-v3` has zero `revealCardFields` matches). It reveals the
  `lastCollectedTokens` from the most recent `collect()` — a display utility over
  the `create` context, never a standalone mounted "component" with its own
  lifecycle.
- Reveal has no `mount()/unmount()` lifecycle symmetry with collect: it creates
  reveal elements and calls `container.reveal()` in one shot; there is no
  "unmount reveal" verb and no persistent reveal context in the adapter.

Decision: the component type set is exactly **`'cardFields'`** for this change.
Reveal is NOT promoted to a component type and NOT a mode on `'cardFields'`.
Instead reveal becomes a **method on the `'cardFields'` handle** (`reveal(request)`)
because reveal is semantically "show me what THIS collected form last tokenized" —
it is scoped to the collect component, not an independent surface. This keeps the
public top-level surface to a single `create` verb, drops the standalone
`revealCardFields` facade method (LOCKED item 3), and preserves the smoke-test
capability through `create('cardFields').reveal(...)`.

`TonderComponentType` is declared as a union with one member NOW
(`'cardFields'`) so the future `'savedCards' | 'checkout' | 'apmSelector'`
members (PRD §13 roadmap) are additive with zero breaking change — this is the
scalability yardstick the exploration demanded.

Rejected: separate `'cardReveal'` type (no lifecycle, no demo usage — would add a
public type nobody mounts); reveal-as-mode on `'cardFields'` (conflates collect
config with a one-shot display call).

### (b) Handle interface + the pay()-collects-from-which-component rule — RESOLVED

Container model. Today `SkyflowAdapter.mount` reads PER-FIELD container ids from
`CARD_FIELD_META` (`#collect-card-number`, etc.) or per-entry `containerId`
overrides, NOT a single parent container. A single `mount('#one-div')` argument
CANNOT express five separate secure iframes. Therefore:

- `mount(container?)` for `'cardFields'` is **container-optional**. The per-field
  container ids come from `options.fields` entries (same mechanism as today). The
  optional `container` argument is accepted for forward-compat / single-surface
  future components but is **ignored by the multi-field `'cardFields'` component**
  (documented explicitly). This reconciles the industry `create().mount(container)`
  shape with the reality of multi-iframe card fields HONESTLY, rather than
  pretending a single container works.

Handle does NOT expose `on()` — events live in `options.events` (LOCKED item 4).

Validation/collect state. `pay()` and `enrollCard()` reach the mounted fields via
the SHARED `TokenizerPort` today (`this.tokenizer.collect()`), NOT via any handle.
Decision: **keep implicit shared-context resolution.** The component handle is
SUGAR over the same adapter contexts — creating/mounting a `'cardFields'`
component populates the adapter's `'create'` context exactly as `mountCardFields`
does today. `pay()` and `enrollCard()` signatures are UNCHANGED and continue to
call `this.tokenizer.collect()`, which reads the `'create'` context. The merchant
does NOT pass the component to `pay()`.

The pay()-collects-from-which-component rule (multi-context):
- A `'cardFields'` component created WITHOUT `cardId` maps to the adapter
  `'create'` context. `pay({ paymentMethod: { type: 'card' } })` and
  `enrollCard()` collect from `'create'` — exactly as today (`collect()` hardcodes
  `CONTEXT_CREATE`).
- A `'cardFields'` component created WITH `cardId` (saved-card CVV) maps to the
  `'update:<cardId>'` context. It is used for the saved-card CVV UI; `pay({
  paymentMethod: { type: 'savedCard', cardId } })` does NOT call `collect()` at all
  (saved cards charge by stored token — see `resolvePaymentMethod`), so there is no
  ambiguity about which context it reads.
- Rule statement (documented in README): "The new-card `'cardFields'` component
  (no `cardId`) is THE collect source for `pay({type:'card'})` and `enrollCard()`.
  Mounting multiple new-card components is unsupported — the last-mounted
  `'create'` context wins (identical to today's single-`create` semantics)." This
  is not a regression: today two `mountCardFields()` calls without `cardId` already
  overwrite the same `'create'` context.

Handle TS shape (final):

```ts
export interface CardFieldsComponent {
  /**
   * Mount the secure card fields into their per-field containers (from
   * `options.fields`). The optional `container` argument is reserved for future
   * single-surface components and is IGNORED by `'cardFields'` (multi-iframe).
   * Requires `init()` to have completed.
   */
  mount(container?: string | HTMLElement): Promise<void>;
  /** Unmount this component's fields (its own adapter context only). */
  unmount(): void;
  /**
   * Reveal the last-collected tokens into merchant reveal containers. Replaces
   * the removed top-level `revealCardFields`. Scoped to this component's collect.
   */
  reveal(request: RevealCardFieldsRequest): Promise<void>;
}
```

`create()` returns the union `TonderComponent` (today just `CardFieldsComponent`).

Rejected: making the merchant pass the component to `pay(component, input)` (would
break the shipped `pay(input)` signature and the `sdk-return-contracts` shape for
zero benefit — the adapter already resolves the context); `destroy()` naming
(`unmount()` mirrors `mount()` and the shipped `unmountCardFields`).

### (c) MISSING_CUSTOMER throw-point — RESOLVED: pre-flight at pay()

- `createTonder(config)` WITHOUT `customer` stays LEGAL — read-only usage
  (`getTransaction`, `getPaymentMethods`, `getApmBanks`, `pollTransaction`) needs
  no customer and must keep working (these have no ready guard today).
- `pay()` throws `MISSING_CUSTOMER` PRE-FLIGHT (before resolving the payment
  method / touching the tokenizer) when `config.customer` is absent, for EVERY
  payment path (card, savedCard, apm, spei) — backend requires customer for all
  `/process` ops (`direct_serializers.py:213-217`, cited in proposal).
- Reuse the EXISTING error: `ErrorKeyEnum.MISSING_CUSTOMER` with the shipped
  message ("No customer set. Provide `customer` in createTonder() config.",
  `messages.ts:42`). This is the SAME code `enrollCard`/`getCustomerCards` already
  throw via `ensureCustomerRegistered` (`tonder.ts:776`) — fully aligned, no new
  code, no new copy.
- Precedence in `pay()`: `NOT_INITIALIZED` (ready guard) → `MISSING_CUSTOMER`
  (customer pre-flight) → `INVALID_PAYMENT_REQUEST` (amount/shape) → method
  resolution. Placing MISSING_CUSTOMER before input validation makes "no customer"
  a distinct, actionable failure rather than being masked by an amount error.

Rejected: throwing at `createTonder` time (breaks read-only init); a new
`PAY_MISSING_CUSTOMER` code (needless divergence from the aligned COF code).

### (d) Suffix policy — RESOLVED (final rename table)

Policy: **requests → `<X>Input`; responses → named nouns or `<X>Result`.** Apply
with MINIMAL churn — rename only non-compliant public types.

| Current type | Kind | Action | Final name |
|---|---|---|---|
| `PayInput` | request | keep (compliant) | `PayInput` (minus `customer`) |
| `MountCardFieldsRequest` | component options | rename | `CardFieldsOptions` |
| `RevealCardFieldsRequest` | request | rename | `RevealCardFieldsInput` |
| `MountCardFieldEntry` | request part | rename | `CardFieldEntry` |
| `RevealCardField` | request part | keep (descriptive noun) | `RevealCardField` |
| `EnrollResult` | response | keep (compliant) | `EnrollResult` |
| `PaymentMethodInfo` | response | rename | `PaymentMethod`? NO — collides with the payment-method union. Keep `PaymentMethodInfo` (established noun; `Info` reads as a listing projection, and renaming collides). Documented exception. |
| `ApmBank` | response noun | keep | `ApmBank` |
| (anonymous getApmBanks return) | response | add named type | `ApmBanks` |
| `CustomerInput` | config/request | rename | `Customer` (unified, LOCKED item 1) |
| `PublicSuccess<T>` | dead | DELETE | — |
| `PublicError` | dead | DELETE | — |

Notes:
- `CardFieldsOptions` (not `CardFieldsInput`): these are component construction
  OPTIONS in the `create(type, options)` factory, matching Stripe/Adyen/MP
  `options` naming for `elements.create('card', options)`. Requests that hit the
  backend keep `Input` (`PayInput`); UI-component construction args are `Options`.
  This is a deliberate, documented two-bucket policy: `<X>Input` = data sent to the
  backend; `<X>Options` = UI component construction config.
- `PaymentMethodInfo` keeps its name: renaming to `PaymentMethod` collides with the
  existing `PaymentMethod` tagged union (the pay input discriminator). Documented
  exception to the "responses = named noun" rule — `Info` is an acceptable listing
  suffix and the churn/collision cost is not justified pre-release.

### (e) Events merge rules — RESOLVED: per-component only; presentation read at fire time

- Input-field events: **per-component only** (LOCKED). No `config.events.inputs`
  default, no merge layer. `CardFieldsOptions.events` is the single source, keyed
  by `CardField` — context-aware because each component carries its own `cardId`
  (solves the saved-card-CVV multi-context problem the exploration flagged). This
  is exactly what `SkyflowAdapter.wireFieldEvents` already consumes
  (`request.events?.[field]`).
- Presentation events: `config.events.presentation.{onOpen,onClose,onComplete}`.
  Object-identity rule: read at FIRE TIME from `this.core.getConfig()`, NOT
  captured at construction — matches today's `config.onOpen`/`config.onClose`
  reads inside `handleRequiresAction`/`handleApmResult` (`tonder.ts:358,393,442`).
  The facade reads `config.events?.presentation?.onOpen` at the moment it opens the
  host, so a config mutated after `createTonder` is still honored (parity with
  today).
- `CardFieldState` and `CardFieldEvents` are UNCHANGED (this change only relocates
  where the `events` map is declared, from `MountCardFieldsRequest` to
  `CardFieldsOptions`). This AMENDS `card-field-events` spec wording only in event
  PLACEMENT (from `mountCardFields({events})` to `create('cardFields',{events})`);
  the payload contract and error-label behavior are untouched.

### (f) ApmBanks shape — RESOLVED

```ts
/** Result of `getApmBanks()`: bank options grouped by settlement channel. */
export interface ApmBanks {
  cash: ApmBank[];
  transfer: ApmBank[];
}
```

Named `ApmBanks` (not `ApmBanksResult`): it is a named noun for a grouped
collection, consistent with `ApmBank`/`Card` noun naming and the "responses =
named nouns OR `<X>Result`" policy. `getApmBanks(): Promise<ApmBanks>` replaces the
anonymous inline `{ cash; transfer }`.

## Final TS declarations (public surface)

```ts
// src/shared/types/index.ts

/** Unified customer identity, set once via `config.customer`. */
export interface Customer {
  /** Required — used to get-or-create the customer and as /process charge metadata. */
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/** Presentation lifecycle callbacks (instance-scoped; one modal at a time). */
export interface PresentationEvents {
  onOpen?(): void;
  onClose?(): void;   // fired when the shopper closes an embedded APM/SPEI modal
  onComplete?(): void; // fired on embedded card-3DS FINAL success only
}

/** Namespaced event callbacks on config. Input-field events live per-component. */
export interface TonderEvents {
  presentation?: PresentationEvents;
}

export interface TonderConfig {
  apiKey: string;
  mode: TonderMode;
  returnUrl: string;
  customization?: CardCustomization;
  secureToken?: string;
  getSignature?: (ctx: SignatureContext) => Promise<string>;
  customer?: Customer;                       // was CustomerInput
  presentationMode?: 'redirect' | 'embedded';
  events?: TonderEvents;                      // NEW namespace; flat onOpen/onClose/onComplete REMOVED
  errorMessages?: FieldErrorMessages;         // stays
}

export type PaymentMethod =
  | { type: 'card' }
  | { type: 'savedCard'; cardId: string }
  | { type: 'apm'; apm: string; config?: Record<string, unknown> }
  | { type: 'spei' };

export interface PayInput {
  amount: number;
  currency?: string;
  // customer REMOVED — read from config.customer
  paymentMethod: PaymentMethod;
  metadata?: Record<string, unknown>;
  clientReference?: string;
}

export interface PaymentMethodInfo { /* unchanged */ }
export interface ApmBank { /* unchanged */ }
export interface ApmBanks { cash: ApmBank[]; transfer: ApmBank[]; }  // NEW named type
export interface EnrollResult { cardId: string; subscriptionId?: string; } // unchanged
// PublicError, PublicSuccess<T> — DELETED
```

```ts
// src/types/card.ts

export type TonderComponentType = 'cardFields';   // additive union for the roadmap

export interface CardFieldsOptions {              // was MountCardFieldsRequest
  fields: CardFieldEntry[];                        // was MountCardFieldEntry[]
  cardId?: string;                                 // saved-card CVV → 'update:<cardId>' context
  unmountContext?: 'all' | 'none' | 'current' | 'create' | string;
  events?: Partial<Record<CardField, CardFieldEvents>>; // per-component (context-aware)
}

export type CardFieldEntry =                        // was MountCardFieldEntry
  | CardField
  | { field: CardField; containerId?: string };

export interface RevealCardFieldsInput {            // was RevealCardFieldsRequest
  fields: (RevealableCardField | RevealCardField)[];
  styles?: CardCustomization['styles'];
}

export interface CardFieldsComponent {
  mount(container?: string | HTMLElement): Promise<void>;
  unmount(): void;
  reveal(request: RevealCardFieldsInput): Promise<void>;
}
export type TonderComponent = CardFieldsComponent;  // union grows with the roadmap

// CardField, RevealableCardField, CardFieldState, CardFieldEvents,
// FieldErrorMessages, RevealCardField — UNCHANGED
```

```ts
// component options per type (extensible mapping for the factory)
export interface ComponentOptionsByType {
  cardFields: CardFieldsOptions;
}
// create<T extends TonderComponentType>(type: T, options: ComponentOptionsByType[T]): TonderComponent
```

## Facade changes (`src/tonder.ts`)

1. **`create(type, options)` factory + component registry.**
   ```ts
   public create<T extends TonderComponentType>(
     type: T,
     options: ComponentOptionsByType[T],
   ): TonderComponent {
     if (type === 'cardFields') return this.createCardFieldsComponent(options);
     throw new AppError({ errorCode: ErrorKeyEnum.INVALID_COMPONENT_TYPE }); // NEW code
   }
   ```
   `createCardFieldsComponent(options)` returns a `CardFieldsComponent` whose:
   - `mount()` → `this.assertReady(); await this.tokenizer.mount(options)` (maps
     `CardFieldsOptions` to the existing `TokenizerPort.mount` request; the
     `container` arg is accepted and ignored for `'cardFields'`).
   - `unmount()` → `this.tokenizer.unmount(contextKeyFor(options))` where the
     context key is `options.cardId ? 'update:'+cardId : 'create'` (mirrors adapter
     logic — the handle scopes to ITS OWN context, not all contexts).
   - `reveal(req)` → `this.assertReady(); await this.tokenizer.reveal(req)`.
   The handle closes over `this` (the facade) and `options`; it holds no adapter
   state. The `TokenizerPort` request type stays `CardFieldsOptions` (renamed from
   `MountCardFieldsRequest`).

2. **`pay()` customer resolution + MISSING_CUSTOMER.** Insert after the ready guard,
   before `assertValidPayInput`:
   ```ts
   const customer = this.core.getConfig().customer;
   if (!customer) throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
   ```
   `assertValidPayInput` no longer validates `input.customer` (removed); it keeps
   the amount check only. `buildProcessBody` reads `config.customer` (not
   `input.customer`).

3. **`buildProcessBody` name derivation.**
   ```ts
   const c = this.core.getConfig().customer!; // guaranteed by pay() pre-flight
   const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
   body.customer = { name, email: c.email };  // phone intentionally NOT sent (backend drops it)
   ```
   Fixes the silent-phone-drop inconsistency by NOT accepting phone as a
   pay-charge field at all (phone still forwarded to `/customer/` via
   `customer.service` for COF, unchanged).

4. **Presentation callbacks re-home.** Replace `config.onOpen` →
   `config.events?.presentation?.onOpen`, `config.onClose` →
   `config.events?.presentation?.onClose`, `config.onComplete` →
   `config.events?.presentation?.onComplete` at all three read sites
   (`handleRequiresAction` embedded branch, `handleApmResult` embedded branch,
   `onComplete` on race resolution). Read at fire time (decision e).

5. **`getApmBanks()` return type** → `Promise<ApmBanks>` (named type; body
   unchanged).

6. **Deletion list (public facade methods):**
   - `mountCardFields(request)` — DELETE (→ `create('cardFields', opts).mount()`).
   - `unmountCardFields(context?)` — DELETE (→ component `unmount()`).
   - `revealCardFields(request)` — DELETE (→ component `reveal()`).
   - Flat `config.onOpen/onClose/onComplete` reads — DELETE (→ `events.presentation`).
   `TokenizerPort` itself is UNCHANGED in shape (still `mount/unmount/collect/reveal`);
   only its request type name changes (`MountCardFieldsRequest` → `CardFieldsOptions`,
   `RevealCardFieldsRequest` → `RevealCardFieldsInput`). The adapter and port keep
   the four methods — the facade just stops exposing them as top-level verbs.

7. **New error code:** `ErrorKeyEnum.INVALID_COMPONENT_TYPE` + message ("Unknown
   component type. Supported: 'cardFields'.") for `create()` with an unknown type.

## SkyflowAdapter impact

Minimal. The adapter's context-key mechanism is the load-bearing invariant and is
KEPT verbatim:

| Public action | Handle method | Adapter call | Context key |
|---|---|---|---|
| new-card form | `create('cardFields', {fields}).mount()` | `tokenizer.mount(options)` | `'create'` |
| saved-card CVV | `create('cardFields', {fields:['cvv'], cardId}).mount()` | `tokenizer.mount(options)` | `'update:<cardId>'` |
| unmount one component | component `.unmount()` | `tokenizer.unmount(ctxKey)` | that component's key |
| collect for pay/enroll | (implicit) | `tokenizer.collect()` | `'create'` (hardcoded) |
| reveal | component `.reveal(req)` | `tokenizer.reveal(req)` | reads `lastCollectedTokens` |

Only mechanical rename inside the adapter/port: `MountCardFieldsRequest` →
`CardFieldsOptions`, `MountCardFieldEntry` → `CardFieldEntry`,
`RevealCardFieldsRequest` → `RevealCardFieldsInput`. NO behavioral change to
`mount`, `collect`, `unmount`, `reveal`, `wireFieldEvents`, or the context map.
`wireFieldEvents` already reads `request.events?.[field]` — unchanged since
`CardFieldsOptions.events` has the identical shape.

## index.ts export delta

```
ADD:    Customer, ApmBanks, TonderComponentType, TonderComponent,
        CardFieldsComponent, CardFieldsOptions, CardFieldEntry,
        RevealCardFieldsInput, TonderEvents, PresentationEvents
RENAME: CustomerInput            -> Customer
        MountCardFieldsRequest   -> CardFieldsOptions
        MountCardFieldEntry      -> CardFieldEntry
        RevealCardFieldsRequest  -> RevealCardFieldsInput
DELETE: PublicError, PublicSuccess
KEEP:   TonderConfig, PaymentMethod, PayInput, RawTransaction, SignatureContext,
        Card, EnrollResult, PaymentMethodInfo, ApmBank, CardField,
        RevealableCardField, RevealCardField, CardCustomization (+ style types),
        AppError, ErrorKeyEnum, FINAL_STATUSES, PollOptions, ThreeDsHostPort, etc.
```

`Tonder`/`createTonder` exports unchanged. `create` is a method on the `Tonder`
instance (not a standalone export).

## Test-surface map

Rewrite (RED-first under strict TDD):
- `src/tonder.pay.test.ts` — LARGEST churn. Remove all `input.customer`; add
  `config.customer`. RED tests to pin:
  - pay WITHOUT `config.customer` throws `MISSING_CUSTOMER` (all 4 method types).
  - pay derives `/process` `customer.name` from `firstName`+`lastName`; sends only
    `{name, email}`; phone NOT sent.
  - MISSING_CUSTOMER precedes INVALID_PAYMENT_REQUEST (amount) in precedence.
  - presentation callbacks fire from `config.events.presentation.*`
    (onOpen/onClose/onComplete), flat callbacks no longer read.
- `src/types/card.test.ts` — type-shape tests for `CardFieldsOptions`,
  `RevealCardFieldsInput`, `TonderComponentType`, `CardFieldsComponent`.
- NEW `src/tonder.create.test.ts` — component lifecycle:
  - `create('cardFields', opts).mount()` populates the `'create'` context (spy on
    `tokenizer.mount`).
  - `.unmount()` unmounts only its own context key.
  - `create('cardFields', {cardId}).mount()` → `'update:<cardId>'` context.
  - `.reveal()` delegates to `tokenizer.reveal`.
  - `create('unknown')` throws `INVALID_COMPONENT_TYPE`.
  - mount before `init()` throws `NOT_INITIALIZED`.
- `src/tonder.handleRequiresAction.test.ts` — rewire presentation callback reads to
  `events.presentation`.
- `src/adapters/skyflow/skyflow.adapter.test.ts` — mechanical type-name renames
  only (behavior unchanged); assert context keys still `'create'`/`'update:<id>'`.
- `src/tonder.enrollCard.test.ts` — assert still collects from `'create'` context
  and still throws `MISSING_CUSTOMER` via the aligned code (no signature change).
- `src/tonder.getApmBanks.test.ts` — assert `ApmBanks` named return shape.
- `src/tonder.customer.test.ts` — `Customer` rename (from `CustomerInput`).
- DELETE any test asserting `mountCardFields`/`unmountCardFields`/`revealCardFields`
  top-level facade methods, `PayInput.customer`, or `PublicSuccess`/`PublicError`.

e2e (`e2e/`):
- `e2e/types/global.d.ts` — replace `revealCardFields`/`mountCardFields` decls with
  `create(...)` handle decls.
- `e2e/tests/card-pay.spec.ts` — rewrite the `revealCardFields after a collect`
  test to `create('cardFields').reveal(...)`; rewrite mount/pay flows to
  `create('cardFields', opts).mount()` + `pay({...})` with `config.customer`.

Estimated test-surface size: ~7 rewritten unit files + 1 new file + 2 e2e files.
HIGH churn concentrated in `tonder.pay.test.ts`. Likely exceeds a single 400-line
PR budget — tasks phase must plan chained/sliced delivery (slices align to the 5
proposal AC groups: customer-unify+config-only, component factory, events re-home,
suffix/dead-export hygiene, docs/e2e/demos).

## Migration notes (README + sibling demos)

- README `pay()` section: remove `customer` from the `pay()` example; show
  `createTonder({ ..., customer: { email, firstName, lastName } })` as the single
  place customer is set. Add a "no guest pay without customer" note (throws
  MISSING_CUSTOMER).
- README mount section: replace `mountCardFields`/`unmountCardFields`/
  `revealCardFields` with `tonder.create('cardFields', { fields, events }).mount()`
  / `.unmount()` / `.reveal()`. Document that per-field container ids come from
  `fields` (the `container` arg is ignored for `'cardFields'`).
- README events section: replace flat `onOpen/onClose/onComplete` with
  `events.presentation.*`; document that input-field events live on the component
  options.
- README type names: `CustomerInput`→`Customer`, `MountCardFieldsRequest`→
  `CardFieldsOptions`, etc.; note `ApmBanks` return type; remove
  `PublicSuccess`/`PublicError` references; note `threeDsMode`→`presentationMode`
  doc-drift fix.
- Sibling demos (`/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3`,
  e.g. `pay.html`/`apms.html`): set `config.customer`, drop inline pay customer,
  switch mount calls to `create('cardFields').mount()`. No demo uses
  `revealCardFields` today, so no reveal migration needed there.

## ADR-style decisions (rationale + rejected alternatives)

- **ADR-1: Component handle is a facade view over shared adapter contexts, not an
  owner of mounted state.** Rationale: preserves the pure-core hexagonal boundary,
  keeps `pay()`/`enrollCard()` signatures stable, and reuses the battle-tested
  context-key mechanism. Rejected: handle owns its Skyflow container (would
  duplicate adapter state and force `pay()` to accept a component argument).
- **ADR-2: `mount()` container arg is optional and ignored for multi-field
  `'cardFields'`.** Rationale: honest reconciliation of the industry
  `create().mount(container)` shape with five separate secure iframes. Rejected:
  forcing a single parent container (impossible for isolated per-field iframes) or
  dropping the arg entirely (breaks forward-compat with future single-surface
  components).
- **ADR-3: Reveal is a handle method, not a component type.** Rationale: reveal has
  no independent lifecycle and is scoped to a collect's last tokens; zero demo
  usage. Rejected: `'cardReveal'` type (adds a public type nobody mounts).
- **ADR-4: MISSING_CUSTOMER pre-flight at pay(), reusing the COF code.** Rationale:
  keeps read-only init legal, aligns the error with `enrollCard`/`getCustomerCards`.
  Rejected: throw at createTonder (breaks read-only) or a new pay-specific code
  (needless divergence).
- **ADR-5: Two-bucket suffix policy — `<X>Input` (backend requests) vs `<X>Options`
  (UI component construction).** Rationale: matches Stripe/Adyen/MP `create(type,
  options)` naming while keeping backend request types as `Input`. `PaymentMethodInfo`
  keeps its name (rename collides with the `PaymentMethod` union). Rejected:
  forcing every response to `<X>Result` (collision + churn).

## Risks / open assumptions

- **R1 (multi new-card component):** the rule "last-mounted `'create'` wins" for
  multiple new-card components is inherited from today's single-context semantics;
  if the future checkout widget needs concurrent new-card forms, `collect()` will
  need a context argument. Out of scope now; flagged for the roadmap.
- **R2 (container arg ergonomics):** an ignored `mount(container)` arg for
  `'cardFields'` may confuse merchants who expect it to work. Mitigated by explicit
  README docs; a future single-surface `'checkout'` component will use it.
- **R3 (test budget):** `tonder.pay.test.ts` churn plus e2e rewrites almost
  certainly exceed one 400-line PR — chained/sliced delivery is REQUIRED, not
  optional; tasks phase must slice by AC group.
- **R4 (spec amendment):** `card-field-events` spec wording references
  `mountCardFields({events})`; this change amends the PLACEMENT to
  `create('cardFields', {events})` only — the payload/error-label contract is
  unchanged. Tasks/spec phase must update that spec's prose, not its scenarios'
  behavior.
- **A1 (backend):** assumes `/process` still requires `{name, email}` for all
  payment types (including APM/SPEI) per the cited serializer; if APM ever allows
  customerless pay, the pre-flight would over-restrict. Confirmed against proposal
  citation; no backend change in scope.
