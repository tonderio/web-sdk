# Design: Apple Pay Catalog Gate (Phase 2)

The first phase with runtime behavior. It restructures `init()` into two concurrent requests
where only one is fatal, caches the **raw** payment-method catalog in core state, and closes
the public boundary so `getPaymentMethods()` can never return an `apple_pay_*` entry.

Aligned to `proposal.md` revision 2 (decisions `D1…D4` are binding), plan §§2, 4.1, 6 (Phase 2),
and the archived phase-1 design (`DD1…DD7` there are inherited constraints).

> **Label namespace.** This document numbers its own decisions `DD1…DD8`. They are a **new
> series scoped to this change** and do not continue phase 1's `DD1…DD7`; phase-1 decisions are
> always written `phase 1 DD5`, and proposal decisions `proposal D3`.

## Quick path

| #   | Commit                                                                   | Merchant-visible | Depends on        |
| --- | ------------------------------------------------------------------------ | ---------------- | ----------------- |
| 1   | Transport + state: raw catalog fetch, parallel non-fatal `init()`, cache | No               | —                 |
| 2   | Pure derivation helpers (predicate, gate, networks, capabilities)        | No               | —                 |
| 3   | `getPaymentMethods()` filter + README note                               | **Yes**          | 2 (the predicate) |

Green between every unit: `npm run test`, `npm run typecheck`, `npm run build`.
Delivery is **commits only — no pull requests**.

## The invariant this design exists to protect

```
init()  ──►  getPaymentMethodCatalog()  ──►  BackendPaymentMethod[]  ──►  core state (RAW)
                        ▲                             │
                        │                             ├──► hasActiveApplePayMethod()
                        │                             ├──► resolveApplePayNetworks()
     getPaymentMethods() (own request, D3)            └──► resolveApplePayMerchantCapabilities()
                        │
                        └──► toPublicPaymentMethods()  ──►  PaymentMethodInfo[]   [FILTER HERE]
```

**`PaymentMethodInfo[]` is produced by exactly one function, and that function filters.**
Everything else in the SDK handles `BackendPaymentMethod[]`, which never crosses the merchant
boundary. That is the structural form of "cannot be bypassed or duplicated" (DD4).

## Architecture decisions

### DD1 — `init()` uses `Promise.all` over a **pre-caught** catalog promise, not `Promise.allSettled`

**Choice.** Start both requests before awaiting either. Attach the catalog leg's `.catch` at
creation time, then `Promise.all`.

```ts
// src/tonder.ts — init(), replacing the single await at ~L271
public async init(): Promise<void> {
  if (this.core.getState().lifecycle === 'ready') return;
  try {
    this.core.setState({ lifecycle: 'initializing' });
    const config = this.core.getConfig();

    // BOTH requests are issued here, before the first await — that is what makes
    // them concurrent (D2). Promise.all only joins them; it does not start them.
    const businessRequest = this.businessService.fetchBusinessConfig(config.api_key);
    // The catalog leg absorbs its OWN failure (D1). The catch is attached at
    // creation, so a rejection can neither abort the business leg nor surface as
    // an unhandled rejection when the business leg rejects first.
    const catalogRequest = this.directApiService
      .getPaymentMethodCatalog()
      .catch(() => null);

    const [business, paymentMethodCatalog] = await Promise.all([
      businessRequest,
      catalogRequest,
    ]);

    this.core.setState({ lifecycle: 'ready', business, paymentMethodCatalog });
  } catch (error) {
    // Reachable ONLY via the business leg. The catalog leg cannot reject.
    this.core.setState({
      lifecycle: 'error',
      lastErrorCode: ErrorKeyEnum.INIT_ERROR,
    });
    throw new AppError({ errorCode: ErrorKeyEnum.INIT_ERROR, originalError: error });
  }
}
```

**Why not `Promise.allSettled`.** It is the wrong tool for _asymmetric_ failure semantics. It
never rejects, so the business leg's fatal path would have to be hand-rebuilt:
`if (results[0].status === 'rejected') throw results[0].reason`. That costs three things —
(a) the existing `catch` block stops being the single place `INIT_ERROR` is produced, (b) the
value reaching `originalError` becomes whatever we reconstruct instead of the original
`AppError(FETCH_BUSINESS_ERROR)` the service already threw, changing an observable error shape
for a reason unrelated to this change, and (c) a reviewer can no longer tell which leg is fatal
by reading the code — both look identical, and the asymmetry hides in an `if`. With
`Promise.all` + a pre-caught leg, **the code says which leg degrades**: the one with the
`.catch` on it.

**Why the catch must be attached at creation, not after the await.** `Promise.all` rejects on
the _first_ rejection. If the business leg rejects while the catalog leg is still in flight and
later rejects too, an unattached catalog rejection becomes an unhandled rejection — noisy in
Node, and in some bundler/host configurations fatal. Attaching at creation makes that
unreachable. This is a **required test** (DD7), not a comment.

**What the failure does and does not do.** A catalog failure is swallowed: `paymentMethodCatalog`
stays `null`, `lifecycle` still becomes `'ready'`, `lastErrorCode` is **not** set, and nothing is
logged. Setting `lastErrorCode` would report a non-error through the field the fatal path uses,
and console output from a degradation path pollutes a merchant's console for a condition they
cannot act on. Apple Pay is simply unavailable — the same observable state as a business with no
Apple Pay configured, which is exactly the state phase 3/5 already has to handle.

**Rejected alternatives.**

| Alternative                             | Why not                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `await business; await catalog`         | Two sequential round trips at every `init()` (D2 forbids)                                                                                              |
| bare `Promise.all([business, catalog])` | A catalog outage rejects `init()` — the new failure mode D1 exists to prevent                                                                          |
| `Promise.allSettled`                    | Rebuilds the fatal path by hand; hides the asymmetry (above)                                                                                           |
| Fire-and-forget catalog, no await       | `init()` could resolve before the catalog lands, making availability racy for a merchant who calls `isApplePayAvailable()` on the next line in phase 5 |

### DD2 — The raw catalog lives at `TonderState.paymentMethodCatalog`, typed from a **model module**

**Choice.** New state slot, mirroring `business` exactly:

```ts
// src/core/TonderCore.ts
import type { BusinessConfig } from '../models/business.model';
import type { BackendPaymentMethod } from '../models/payment-method.model';

export interface TonderState {
  lifecycle: TonderLifecycle;
  business: BusinessConfig | null;
  /**
   * RAW payment-method catalog fetched during `init()`. Unmapped and UNFILTERED —
   * it deliberately still contains the `apple_pay_*` entries that
   * `getPaymentMethods()` removes, because the availability gate reads them.
   * `null` means "not available": the request failed (non-fatal, D1) or `init()`
   * has not run. An empty array means "fetched, business has no methods".
   */
  paymentMethodCatalog: BackendPaymentMethod[] | null;
  customerAuthToken: string | null;
  customerInput: Customer | null;
  lastErrorCode: string | null;
}
```

Constructor initializer gains `paymentMethodCatalog: null`.

**Why the type moves to `src/models/payment-method.model.ts`.** `BackendPaymentMethod` and
`BackendPaymentMethodsPage` are module-private in `direct-api.service.ts` today (phase 1 DD5
relied on that privacy). Core state now needs the type, and `TonderCore` importing a type out of
a _service_ inverts the layering — core would depend on the transport layer that depends on it
conceptually. The codebase already has the right home and the exact precedent:
`TonderState.business: BusinessConfig | null` imports from `src/models/business.model.ts`, and
`BackendTransactionResponse` lives in `src/models/transaction.model.ts`. **Wire shapes belong to
`models/`.** So: move both interfaces verbatim into a new pure type module
`src/models/payment-method.model.ts` (no imports, matching `business.model.ts`'s
"no imports from `core/`" rule), and have `direct-api.service.ts` import them back.

Mechanical move, no shape change. `direct-api.service.ts` keeps identical behavior; the
interfaces become module-exported instead of module-private, which is required for the state
slot to be typeable at all.

**Why raw, not mapped.** `PaymentMethodInfo` has five fields — `id`, `payment_method`, `label`,
`logo`, `category`. It carries **no** `configuration`, so caching the mapped shape would destroy
`supported_networks` before the network union could read it, and the mapper is also where the
`apple_pay_*` entries get dropped (DD4). Caching mapped data would leave the gate with nothing
to gate on. This is the load-bearing point of proposal's approach diagram and plan §4.1.

**Why the flattened array, not the page envelope.** `getPaymentMethods()` already normalizes
`BackendPaymentMethod[] | BackendPaymentMethodsPage` into a flat array. Storing the envelope
would force every reader to repeat `Array.isArray(raw) ? raw : raw.results`. The pagination
fields are transport metadata the SDK ignores.

**Why not a cache abstraction.** Plan §4.1: an SDK instance lives for one checkout, so a TTL
would never elapse and nothing would re-fetch if it did. **Core state is the cache.**

### DD3 — One transport method, one projection function

**Choice.** `DirectApiService` gets a raw-catalog method; `getPaymentMethods()` is redefined in
terms of it plus a pure projection.

```ts
// src/core/services/direct-api.service.ts

/**
 * Fetch the RAW active payment-method catalog via
 * `GET /api/v1/payment_methods?status=active`.
 *
 * Unmapped and UNFILTERED — it still contains the `apple_pay_*` entries.
 * INTERNAL: this is the SDK-side catalog, cached by `init()` for the Apple Pay
 * availability gate. Never hand the result to a merchant; only
 * `toPublicPaymentMethods()` produces a merchant-facing shape.
 */
public async getPaymentMethodCatalog(): Promise<BackendPaymentMethod[]> {
  try {
    const raw = await this.http.request<
      BackendPaymentMethod[] | BackendPaymentMethodsPage
    >({ method: 'GET', path: '/api/v1/payment_methods?status=active' });
    return Array.isArray(raw) ? raw : raw.results;
  } catch (error) {
    throw new AppError({
      errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR,
      originalError: error,
    });
  }
}

```

The service ends there — transport only. The facade composes fetch and
projection, exactly as `getTransaction()` already pairs the service with
`toRawTransaction`:

```ts
// src/tonder.ts
public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
  try {
    return toPublicPaymentMethods(
      await this.directApiService.getPaymentMethodCatalog(),
    );
  } catch (error) {
    /* normalized to AppError(FETCH_PAYMENT_METHODS_ERROR) */
  }
}
```

The service moves bytes, the model converts shapes, the facade puts them
together. `getPaymentMethodBanks` still projects inside the service; aligning
it is a separate concern.

**Consequences that matter.**

- **Proposal D3 holds unchanged.** `getPaymentMethods()` still issues its own
  `GET /api/v1/payment_methods?status=active` on every call and never reads core state, so the
  `payment-method-discovery` spec requirement is satisfied verbatim and the D1/cache tension
  (an empty cache silently returning `[]`) never arises.
- **The error contract is unchanged and undivided.** `FETCH_PAYMENT_METHODS_ERROR` is produced in
  exactly one place. `getPaymentMethods()` needs no `try`/`catch` of its own because the
  projection is pure and total. The facade's existing re-wrap at `src/tonder.ts:675-685` is
  untouched.
- The `init()` leg reuses the same transport and the same error code — the wrapped `AppError` is
  then discarded by the `.catch(() => null)` in DD1.

### DD4 — The filter lives inside the single function that produces `PaymentMethodInfo[]`

**This is the subtlest requirement in the change**, because two paths read catalog data: the
cached raw one at `init()` and the live fetch on the public call. The filter must apply to the
second and must **not** apply to the first, and it must be impossible to add a third path that
forgets it.

**Choice.** Pair the filter and the map into one module-private projection, and keep
`mapPaymentMethod` private so nothing else can build a `PaymentMethodInfo`.

```ts
// src/models/payment-method.model.ts
import { isApplePayCatalogMethod } from '../shared/payment-method-catalog';

/**
 * Project the raw catalog into the merchant-facing shape.
 *
 * THE APPLE PAY FILTER LIVES HERE AND NOWHERE ELSE. This is the only function in
 * the SDK that produces `PaymentMethodInfo[]`, so an `apple_pay_*` entry cannot
 * reach a merchant without passing through it.
 *
 * Apple Pay is a mountable component, not a `pay()` method: it needs the button
 * and the user gesture. A leaked `apple_pay_debit_card` row would be rendered as
 * a generic selectable APM and then charged via `pay()`, which cannot work.
 */
function toPublicPaymentMethods(
  raw: readonly BackendPaymentMethod[],
): PaymentMethodInfo[] {
  return raw
    .filter((method) => !isApplePayCatalogMethod(method.payment_method))
    .map(mapPaymentMethod);
}
```

**Why this cannot be bypassed.** `mapPaymentMethod` is module-private and stays private; after
this change it has exactly **one** call site, inside `toPublicPaymentMethods`. So no module
outside `models/payment-method.model.ts` can turn a `BackendPaymentMethod` into a `PaymentMethodInfo`, and
inside it there is one way. Verifiable mechanically: `rg -n 'mapPaymentMethod' src/` returns its
declaration plus one use.

**Why this cannot be duplicated.** The predicate `isApplePayCatalogMethod` is declared once
(DD5) and imported here. A second filter would need a second predicate, and `rg` finds it.

**Why the cached path is safe by construction.** `getPaymentMethodCatalog()` never calls
`toPublicPaymentMethods`. There is no code path from the state slot to the projection — the split
is enforced by the call graph, not by a convention. Both directions are asserted by the same test
pair (DD7).

**Rejected alternatives.**

| Alternative                                                                           | Why not                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter inside `mapPaymentMethod`                                                      | A 1:1 `raw → PaymentMethodInfo` mapper cannot drop an element; it would have to return `undefined` and force a `.filter(Boolean)` at every call site — reintroducing the duplication this decision removes                   |
| Filter in the facade `Tonder.getPaymentMethods()`                                     | Leaves the service able to emit unfiltered `PaymentMethodInfo[]`, so "one place an entry can be dropped" becomes a convention instead of a structure. Contradicts plan §4.1 ("the filter belongs in the same mapping layer") |
| Filter in `getPaymentMethodCatalog()` and keep a second unfiltered fetch for `init()` | Two transports for one endpoint, and the filtered one is the default — the accident-prone direction                                                                                                                          |
| Filter at `init()` before caching                                                     | Destroys the data the gate depends on. Explicitly forbidden by proposal and plan §4.1                                                                                                                                        |

### DD5 — An Apple Pay entry is matched by the `apple_pay_` **prefix**, not an allow-list

**Choice.**

```ts
/** Backend namespace prefix for every Apple Pay catalog entry. */
const APPLE_PAY_METHOD_PREFIX = 'apple_pay_';

/**
 * True when a catalog `payment_method` is an Apple Pay entry
 * (`apple_pay_debit_card`, `apple_pay_credit_card`, and any future variant).
 *
 * Prefix rather than an allow-list on purpose: the two failure directions are not
 * symmetric. Missing a new variant LEAKS a dead-end method to merchants — the
 * exact bug this filter exists to prevent — while over-matching would require the
 * backend to ship a non-Apple-Pay method inside the `apple_pay_` namespace.
 */
export function isApplePayCatalogMethod(paymentMethod: string): boolean {
  return paymentMethod.startsWith(APPLE_PAY_METHOD_PREFIX);
}
```

**Rationale.** The prompt states the tradeoff correctly: a prefix is permissive and will silently
swallow an unrelated future method beginning with `apple_pay`. Three reasons it still wins.

1. **Asymmetric failure cost.** The allow-list fails **open** — a third backend variant leaks and
   merchants hit the dead end this change exists to close. The prefix fails **closed** — a
   hypothetical unrelated method is hidden, which is recoverable and loudly visible (a merchant
   asks why their method is missing) rather than silently broken (a merchant ships a button that
   always errors).
2. **The allow-list couples backend catalog config to SDK releases.** Enabling a new Apple Pay
   variant is a backend configuration change today. Under an allow-list it becomes a backend
   change _plus_ an SDK release _plus_ every merchant upgrading — with the leak live in
   production the whole time. The rest of the catalog deliberately avoids this coupling:
   `getPaymentMethodCatalogDetails` already falls back gracefully for unknown methods.
3. **`apple_pay_*` is the written contract.** Plan §4.1, the proposal, the modified
   `payment-method-discovery` capability and the phase-1 forward table all state the rule as
   `apple_pay_*`. An allow-list would silently narrow it, and the divergence would only surface
   as a production leak.

**Known non-match, recorded on purpose.** A bare `apple_pay` catalog entry (no trailing
underscore) does **not** match. No such entry exists in the backend contract — plan §4.1 lists
exactly two, both suffixed — and widening the prefix to `apple_pay` would start matching an
unrelated `apple_payment_*` namespace. Forward constraint: if the backend ever ships a bare
`apple_pay` entry, extend the predicate here; it is the one place to change.

**Status is not re-checked.** The endpoint is `?status=active`, so everything returned is active
by contract, and `BackendPaymentMethod.status` is optional. Re-filtering on `status === 'active'`
would (a) defend against the backend ignoring its own query parameter and (b) newly drop entries
that omit `status` — a regression for no gain. "No unnecessary validation" (plan §7) applies.

### DD6 — Derivation helpers are pure named-export functions in `src/core/strategies/apple-pay-catalog.strategy.ts`

**Choice.** A new module under `core/strategies/`, alongside `card.strategy.ts` and
`apm.strategy.ts`, holding pure functions with a co-located `apple-pay-catalog.strategy.test.ts`.

```ts
// src/core/strategies/apple-pay-catalog.strategy.ts
import type { BackendPaymentMethod } from '../../models/payment-method.model';

/** Networks assumed when the backend sends no `configuration.supported_networks`. */
export const DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard'] as const;

const APPLE_PAY_DEBIT_METHOD = 'apple_pay_debit_card';
const APPLE_PAY_CREDIT_METHOD = 'apple_pay_credit_card';

export function isApplePayCatalogMethod(paymentMethod: string): boolean;

/** True when the catalog contains at least one Apple Pay entry (D4: catalog-only). */
export function hasActiveApplePayMethod(
  catalog: readonly BackendPaymentMethod[] | null,
): boolean;

/** Deduplicated union of `configuration.supported_networks`, or the fallback. */
export function resolveApplePayNetworks(
  catalog: readonly BackendPaymentMethod[] | null,
): string[];

/** `supports3DS` always, plus `supportsDebit` / `supportsCredit` per active entry. */
export function resolveApplePayMerchantCapabilities(
  catalog: readonly BackendPaymentMethod[] | null,
): string[];
```

**Placement rationale.** `core/strategies/` already holds pure, per-method, dependency-free
builders with named exports and co-located tests. These are pure per-method derivations over
catalog records — the same shape. `core/` purity is preserved: the module's only import is a
type from `models/`, so no DOM and no HTTP.

**Why a separate file from the phase-3 `apple-pay.strategy.ts`.** Plan §5 reserves
`src/core/strategies/apple-pay.strategy.ts` for `buildApplePayPaymentRequest()` /
`buildApplePayPaymentMethod()`. Different input domain (backend catalog records vs. a payment
input plus business config) and different moment (init/availability time vs. inside the click
handler). Splitting also keeps this phase's diff off the file phase 3 creates.

**Rejected alternatives.**

| Alternative                        | Why not                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Methods on `DirectApiService`      | Couples pure derivation to a transport class; every unit test would need an `HttpPort` double to reach a function that touches no network            |
| Methods on `TonderCore`            | Core is a state container; adding domain derivation to it grows the class every phase and makes the helpers untestable without constructing a config |
| `src/shared/`                      | `shared/` is cross-cutting infrastructure (`poll`, `env`, catalog labels). This is Apple Pay domain logic                                            |
| Private helpers in `src/tonder.ts` | The facade is already 1041 lines (plan §5); and private methods cannot be unit-tested without an SDK instance                                        |

**Signature details, each with a reason.**

- **Every helper accepts `| null`.** The null catalog is the exact state D1's non-fatal rule
  creates. Handling it once inside the helpers is the opposite of unnecessary validation — the
  alternative is a guard at every call site, in the phases that consume them.
- **`readonly` inputs.** The helpers never mutate the cached state array.
- **Return `string[]`, not Apple's typed literals.** Phase 1 DD6 confines `ApplePayJS.*` to
  adapter and port modules, and `supported_networks` arrives off the wire as `string[]`.
  Narrowing here would need either a cast or runtime validation with no better failure mode — an
  unknown network string is rejected by the `ApplePaySession` constructor and the SDK cannot fix
  it. Forward constraint: the phase-3 request builder, which already owns Apple's types, does the
  narrowing.
- **Apple's tokens keep Apple's casing.** `masterCard`, `supports3DS`, `supportsDebit`,
  `supportsCredit` are Apple's contract, not ours; plan §7's snake_case rule does not apply.

**Behavior contracts.**

| Helper                                | Rule                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hasActiveApplePayMethod`             | `catalog === null` → `false`. Otherwise `catalog.some(m => isApplePayCatalogMethod(m.payment_method))`. Catalog-only per **proposal D4** — no `country_code`, no browser check                                                                                           |
| `resolveApplePayNetworks`             | Union of `configuration?.supported_networks` across Apple Pay entries only, in first-seen order, deduplicated by exact string via `Set`. Empty result (null catalog, no entries, no `configuration`, or empty arrays) → a **fresh copy** of `DEFAULT_APPLE_PAY_NETWORKS` |
| `resolveApplePayMerchantCapabilities` | Always `['supports3DS']`, then `'supportsDebit'` if `apple_pay_debit_card` is present, then `'supportsCredit'` if `apple_pay_credit_card` is present. Fixed order, independent of catalog order                                                                          |

Three gotchas worth their comments in code:

1. **`supports3DS` means EMV cryptogram support, not 3-D Secure**, and `merchantCapabilities` is
   mandatory — omitting it makes the payment request invalid and the `ApplePaySession`
   constructor throws. Without the comment someone deletes it as contradictory with "Apple Pay
   bypasses 3DS" (plan §4.1). **This phase writes the derivation, so this phase owns the comment.**
2. **Dedup is exact-string, deliberately not case-insensitive.** Apple's network tokens are
   case-sensitive (`masterCard`). Normalizing case would corrupt valid tokens; if the backend
   ever sends both `visa` and `Visa`, both survive, and that is a backend contract bug the SDK
   must not paper over by guessing.
3. **The fallback returns a fresh array**, so a caller cannot mutate the shared constant.

**Why capabilities return `['supports3DS']` even for a null catalog.** The constant is mandatory
on every Apple Pay request, and callers only reach this function after the gate passed. Returning
it unconditionally keeps the function total and matches the success criterion that `supports3DS`
is present in every case.

**Why debit/credit derivation matters at all** (it looks like a no-op when both are active):
Apple does not filter by card type when it receives neither capability, so a business with both
methods produces a list equivalent to the bare constant. The asymmetric case is where it earns
its keep — a debit-only business would otherwise let the shopper authorize with a credit card,
Face ID and all, and only then have the acquirer decline. Deriving the capability makes Apple
grey the card out first (plan §4.1).

### DD7 — Testability: every property in this change is observable through an injected `HttpPort`

Strict TDD is active and genuinely enforced here (proposal D5): this is runtime behavior, so
`vitest run` actually checks it. RED before GREEN for each item below.

| Property                                       | Observation mechanism                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Concurrency, not chaining** (D2)             | Fake `HttpPort` pushes each `path` into an array at call time and returns a promise held open by an external deferred. Call `init()` without awaiting, flush one microtask, assert **both** paths were requested while **neither** had resolved. A chained implementation records only one |
| **Catalog failure is non-fatal** (D1)          | Business resolves, catalog rejects → `init()` resolves; `lifecycle === 'ready'`; `paymentMethodCatalog === null`; `lastErrorCode === null`; a subsequent `pay()` succeeds unchanged                                                                                                        |
| **Business failure is still fatal**            | Business rejects, catalog resolves → `init()` rejects `AppError(INIT_ERROR)`; `lifecycle === 'error'`; `lastErrorCode === INIT_ERROR`; `originalError` is the `AppError(FETCH_BUSINESS_ERROR)` the service threw                                                                           |
| **No unhandled rejection when both legs fail** | Both reject → `INIT_ERROR`, and an `unhandledrejection` / `process.on('unhandledRejection')` spy records nothing. This is the specific hazard the pre-attached `.catch` in DD1 removes                                                                                                     |
| **Cache is raw**                               | Catalog fixture with both `apple_pay_*` entries (carrying `configuration`), one card, one APM → after `init()`, the state slot contains all four **including** `configuration`                                                                                                             |
| **Public call is filtered**                    | Same fixture → `getPaymentMethods()` returns exactly the two non-Apple entries, field-for-field identical to today's output                                                                                                                                                                |
| **Filter is not bypassable**                   | `rg -n 'mapPaymentMethod' src/` yields the declaration plus exactly one call site; `rg -n 'isApplePayCatalogMethod' src/` yields one declaration                                                                                                                                           |
| **Helpers**                                    | Plain fixture arrays, direct function calls, **no SDK instance and no `HttpPort`** — the payoff for DD6's placement                                                                                                                                                                        |

**Reading core state from a test.** `Tonder.core` is `private` and there is no public state getter
(adding one would be a public-surface change this phase does not own). Tests reach it with a
test-local cast:

```ts
const state = (tonder as unknown as { core: TonderCore }).core.getState();
```

This is confined to `*.test.ts`, adds nothing under `src/`, and disappears in phase 5 when
`isApplePayAvailable()` gives the cache a public consumer. Recorded as the accepted mechanism so
nobody "fixes" it by exposing state.

**Helper test matrix** (mirrors the success criteria):

| Helper                                | Cases                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasActiveApplePayMethod`             | null · empty · no Apple entries · debit only · credit only · both                                                                                                                                                         |
| `resolveApplePayNetworks`             | both with identical networks (dedup) · both with disjoint networks (union) · one entry only · entry without `configuration` · `supported_networks: []` · null catalog · non-Apple entries' `configuration` is **ignored** |
| `resolveApplePayMerchantCapabilities` | both · debit only · credit only · neither — `supports3DS` present in all four, order fixed                                                                                                                                |
| `isApplePayCatalogMethod`             | both known variants · a hypothetical third `apple_pay_*` variant · `'card'`/`'oxxo'`/`'spei'` · bare `'apple_pay'` (documented non-match, DD5)                                                                            |

**Non-regression.** `src/tonder.getPaymentMethods.test.ts` and
`src/core/services/direct-api.service.test.ts` must pass with **no assertion edits** for any
non-Apple method. Fixtures may gain Apple Pay entries only in the new tests.

### DD8 — Three work units, reordered so the merchant-visible commit lands last

**Choice.** Confirm three units, swap units 2 and 3 relative to the proposal.

| #   | Commit                                                           | Contents                                                                                                                                                                     | Merchant-visible |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | `feat: cache the raw payment-method catalog during init`         | `src/models/payment-method.model.ts` (move both interfaces), `DirectApiService.getPaymentMethodCatalog()`, `TonderState.paymentMethodCatalog`, `init()` parallel + non-fatal | No               |
| 2   | `feat: derive Apple Pay availability, networks and capabilities` | `src/core/strategies/apple-pay-catalog.strategy.ts` + its test. Pure, no I/O, referenced by nothing                                                                          | No               |
| 3   | `feat: hide Apple Pay entries from getPaymentMethods`            | `toPublicPaymentMethods()` + the `getPaymentMethods()` rewrite + README note                                                                                                 | **Yes**          |

**Why the reorder.** The proposal's order is `init/caching → filter + README → helpers`, but the
filter needs `isApplePayCatalogMethod`, which lives in the helpers module (DD5/DD6). Two ways to
resolve it:

- Put the predicate with the filter, keep the proposal's order. Then unit 3 (helpers) imports
  from unit 2 (the filter's module) — and reverting the merchant-visible commit alone breaks the
  helpers.
- Land the helpers first. Unit 2 is pure and referenced by nothing; unit 3 consumes the predicate.
  **Reverting unit 3 alone restores the previous `getPaymentMethods()` output cleanly**, which is
  exactly what the proposal's rollback plan promises.

The second is strictly better on rollback surgery and does not change scope. The proposal's
"revert the three commits in reverse order" still holds verbatim.

**Green state between units.**

- **After unit 1:** `npm run test`, `npm run typecheck`, `npm run build` pass.
  `getPaymentMethods()` output is byte-identical (nothing filters yet). `init()` issues two
  concurrent requests; catalog failure leaves `ready`; business failure still throws `INIT_ERROR`.
  Every existing `init()` test passes with fixtures that must now answer a second path — a fake
  `HttpPort` that throws on an unknown path proves the non-fatal rule by accident, which is fine
  and worth keeping.
- **After unit 2:** all three commands pass; `rg` finds no reference to any exported helper
  outside its own module and test. Unreachable by construction, in the phase-1 DD2 sense.
- **After unit 3:** all three commands pass; both directions of the cache-raw / filter-at-the-
  boundary split are asserted; no non-Apple regression; README states the filter and why, with no
  other README change.

**Delivery is COMMITS ONLY — no pull requests**, per the proposal.

## File changes

| File                                                                                                           | Action | Unit                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `src/models/payment-method.model.ts`                                                                           | Create | 1 — `BackendPaymentMethod`, `BackendPaymentMethodsPage` moved verbatim |
| `src/core/services/direct-api.service.ts`                                                                      | Modify | 1 — import the moved types; add `getPaymentMethodCatalog()`            |
| `src/core/TonderCore.ts`                                                                                       | Modify | 1 — `paymentMethodCatalog` on `TonderState` + initializer              |
| `src/tonder.ts`                                                                                                | Modify | 1 — `init()` parallel + pre-caught catalog leg (~L264-285)             |
| `src/core/strategies/apple-pay-catalog.strategy.ts`                                                            | Create | 2 — the four pure helpers + `DEFAULT_APPLE_PAY_NETWORKS`               |
| `src/core/strategies/apple-pay-catalog.strategy.test.ts`                                                       | Create | 2 — pure unit tests, no SDK instance                                   |
| `src/core/services/direct-api.service.ts`                                                                      | Modify | 3 — `toPublicPaymentMethods()`; `getPaymentMethods()` delegates        |
| `README.md`                                                                                                    | Modify | 3 — one note on the filter                                             |
| `src/tonder.test.ts` / `src/tonder.getPaymentMethods.test.ts` / `src/core/services/direct-api.service.test.ts` | Modify | 1 and 3 — new cases; **no assertion edits for non-Apple methods**      |

`src/index.ts` is **not** touched. No new public export, no new public method.

## Conventions compliance

| Constraint                                      | How it holds                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/` stays pure                              | The new strategy module imports one type from `models/`. `TonderCore` imports two types from `models/`. No DOM, no HTTP, no `fetch`                                  |
| Named exports, tree-shakeable, no heavy barrels | Four named function exports plus one constant; nothing added to any barrel                                                                                           |
| snake_case on public surfaces                   | No new public surface. Internal state keys follow the existing camelCase of `TonderState` (`customerAuthToken`, `lastErrorCode`); Apple's tokens keep Apple's casing |
| No duplicated interfaces                        | Reuses `PaymentMethodInfo`, `HttpPort`, `AppError`, `ErrorKeyEnum`. `BackendPaymentMethod` is **moved**, not redeclared. No new error code                           |
| No unnecessary validation                       | `status` is not re-checked (DD5); no shape validation of `configuration`; optional chaining only                                                                     |
| Test doubles in `*.test.ts`                     | Every fake `HttpPort` and every catalog fixture lives in a test file. Nothing under `src/` exists only for testing                                                   |
| Ports & Adapters                                | No new port and no new adapter — this phase touches only the domain and transport-service layers, both already behind the injected `HttpPort`                        |

## Forward constraints (record, do not implement)

| #   | Constraint                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **`isApplePayAvailable()` is phase 3/5's**, composed as `browserSupportsApplePay() && hasActiveApplePayMethod(state.paymentMethodCatalog) && Boolean(state.business?.business.country_code)`. Proposal **D4** splits the responsibilities; it supersedes the combined form in the phase-1 forward table. Wiring it here would violate inherited phase 1 DD2 (declare, do not wire) |
| F2  | **`null` vs `[]` on `paymentMethodCatalog` must not be collapsed.** `null` = unavailable (failed or not fetched); `[]` = fetched, business has no methods. Any future cache-served `getPaymentMethods()` needs exactly that discriminator to avoid the correctness bug proposal D3 rejects                                                                                         |
| F3  | **The helpers return `string[]`.** The phase that owns `ApplePayJS.*` (phase 3, per phase 1 DD6) narrows to `ApplePayJS.ApplePayMerchantCapability[]` inside the adapter/strategy that builds the request — never by widening this module's imports                                                                                                                                |
| F4  | **`APPLE_PAY_NOT_ENABLED` still has no `MESSAGES_EN` entry** (phase 1 DD5). This phase throws no Apple Pay error, so the debt stays with the phase that first throws one                                                                                                                                                                                                           |
| F5  | **A bare `apple_pay` catalog entry is not matched** (DD5). If the backend ever ships one, extend `isApplePayCatalogMethod` — the single place the rule lives                                                                                                                                                                                                                       |
| F6  | **The state-reading test cast** `(tonder as unknown as { core: TonderCore }).core` is the accepted mechanism until phase 5 gives the cache a public consumer. Do not "fix" it by exposing core state                                                                                                                                                                               |
| F7  | **Phase 3's `apple-pay.strategy.ts` is a different module** from `apple-pay-catalog.strategy.ts` and consumes it, rather than absorbing it                                                                                                                                                                                                                                         |

## Open questions

None. `D1…D4` are binding and every derived decision above is settled.

## Next step

`sdd-tasks` — break these three units into ordered, checkable RED/GREEN steps.
