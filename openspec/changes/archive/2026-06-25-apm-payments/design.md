# Design: apm-payments

Technical design for adding Alternative Payment Method (APM) and SPEI support to
the headless `@tonder.io/web-sdk` v1. Grounds the proposal
(`sdd/apm-payments/proposal`) and exploration (`sdd/apm-payments/explore`) in the
real code at `src/tonder.ts`, `src/models/transaction.model.ts`,
`src/core/strategies/card.strategy.ts`, `src/core/services/direct-api.service.ts`,
`src/ports/threeds-host.port.ts`, and `src/shared/types/index.ts`.

## Architecture Approach

The codebase is a **hexagonal / ports-and-adapters** SDK with a clear layering:

- **Facade / composition root** — `Tonder` (`src/tonder.ts`). Orchestrates flows,
  owns the only impure side effects allowed at this layer (host presentation,
  `crypto.randomUUID`), and translates between public input and internal bodies.
- **Core (pure)** — `core/strategies/*` (pure builders), `core/services/*`
  (domain services depending only on `HttpPort`), `models/*` (pure type + mapper
  modules with NO `core/` imports). No DOM, no `fetch`, no external SDK.
- **Ports** — `HttpPort`, `ThreeDsHostPort`, etc. Abstractions the core depends on.
- **Adapters (impure)** — `FetchHttpClient` (the only `fetch`), `Browser3dsHost`
  (the only DOM/`window`).

APM support is added **along the existing card seam**, not as a parallel stack.
The same `/process` endpoint, the same `DirectApiService`, the same
`ThreeDsHostPort`, and the same `mapPayResult` model are reused. The only NEW
module is the pure `apm.strategy.ts`. The design's central tension — card 3DS and
SPEI both return `next_action.redirect_to_url` — is resolved by a
**facade-level reclassification seam** rather than by teaching the pure model
about payment-method types (see Decision 2).

The guiding constraint from the proposal: **APMs settle asynchronously (webhook,
hours/days) and the SDK must NEVER poll an APM to a final status in-session.** The
whole design exists to make that async contract explicit and to isolate the
card-only poll path from the APM path.

## Component Map

```
                         Tonder.pay(input)
                               |
                  resolvePaymentMethod(input.paymentMethod)
            ┌──────────────┬──────────────┬───────────────┐
         'card'       'savedCard'       'apm'           'spei'
            │              │              │                │
  buildCardPaymentMethod   │     buildApmPaymentMethod  buildSpeiPaymentMethod
            │   buildSavedCardPaymentMethod  (validates SafetyPay apm_config)
            └──────────────┴──────────────┴───────────────┘
                               │
                    buildProcessBody(input, pm)
                               │
                DirectApiService.processPayment(body, X-Request-Id)
                               │
                          mapPayResult(raw)   ← PURE, type-agnostic
                               │
        ┌──────────────────────────────────────────────┐
        │  result.status === 'requires_action'          │   (raw had next_action.url)
        │  AND input.paymentMethod.type ∈ {card,savedCard}│ → handleRequiresAction (POLLS in embedded)
        ├──────────────────────────────────────────────┤
        │  input.paymentMethod.type ∈ {apm,spei}        │ → reclassify to 'pending'
        │                                                │ → handleApmResult (NEVER polls)
        └──────────────────────────────────────────────┘
                               │
                          PayResult (returned)

Read-only (Slice A, independent of pay()):
  Tonder.getPaymentMethods() → DirectApiService.getPaymentMethods() → PaymentMethodInfo[]
  Tonder.getApmBanks()       → DirectApiService.getApmBanks(apiKey)  → { cash, transfer }
```

## Data Flow / Integration Points

- `POST /api/v1/process/` — shared with card. Body gains an APM/SPEI
  `payment_method` union member; response gains APM extras
  (`payment_instructions`, `voucher_pdf`, `clabe`, `bank_name`, plus the existing
  `next_action`).
- `GET /api/v1/payment_methods?status=active` — Token apiKey header (standard
  `FetchHttpClient` auth). Returns the method catalog.
- `GET /api/v1/safetypay/banks/{apiKey}/` — apiKey in the URL **path** (the view
  resolves the business from the path token, NOT the header). Returns
  `{ cash: [...], transfer: [...] }`.
- `ThreeDsHostPort` — reused to PRESENT `nextAction.url` for APMs (redirect or
  iframe). It is presentation-only; nothing about it is card-specific.

---

## Decision 1 — The `pending` PayResult variant

**Decision.** Add a fourth `PayResult` variant `pending` in
`src/models/transaction.model.ts`, alongside the existing
`success | requires_action | declined`. Extend `BackendTransactionResponse` with
the four APM snake_case fields and add a PURE mapper `mapPendingResult(raw)` that
the facade calls (see Decision 2 for why the facade, not `mapPayResult`, calls it).

### Exact TypeScript shape (lives in `transaction.model.ts`)

```typescript
export type PayResult =
  | { status: 'success'; transaction: Transaction }
  | {
      status: 'requires_action';
      transactionId: string;
      nextAction: { url: string; verifyTransactionStatusUrl?: string };
    }
  | {
      status: 'pending';
      transaction: Transaction;
      nextAction?: { url: string; verifyTransactionStatusUrl?: string };
      paymentInstructions?: Record<string, unknown>;
      voucher?: string;
      clabe?: string;
      bankName?: string;
    }
  | {
      status: 'declined';
      transaction: Transaction;
      declineCode?: string;
      declineReason?: string;
    };
```

Notes on the shape:

- `transaction` (the full mapped `Transaction`) is carried — unlike
  `requires_action`, which carries only `transactionId`. The merchant needs the
  transaction body to show OXXO/SPEI instructions and later reconcile via
  `getTransaction`. APMs report `status: 'Pending'` from the backend, which is a
  normal non-final status the public `Transaction.status` already carries.
- `nextAction` is OPTIONAL here (a pure-instructions OXXO voucher may arrive with
  no redirect URL), whereas on `requires_action` it is REQUIRED (a 3DS challenge
  with no URL is meaningless). This asymmetry is intentional and load-bearing for
  `handleApmResult` (no-url → return pending unchanged).

### Backend response extension

```typescript
export interface BackendTransactionResponse {
  // ...existing fields...
  next_action?: BackendNextAction;
  // APM extras (present only for APM/SPEI outcomes):
  payment_instructions?: Record<string, unknown>;
  voucher_pdf?: string;
  clabe?: string;
  bank_name?: string;
}
```

### Snake → camel mapping

| Public (`pending`)    | Backend source                                  |
| --------------------- | ----------------------------------------------- |
| `nextAction.url`      | `next_action.redirect_to_url.url`               |
| `nextAction.verify…`  | `next_action.redirect_to_url.verify_transaction_status_url` |
| `paymentInstructions` | `payment_instructions`                          |
| `voucher`             | `voucher_pdf`                                    |
| `clabe`               | `clabe`                                          |
| `bankName`            | `bank_name`                                      |

### `clabe` / `bank_name` nesting — DECISION

Exploration flagged that for SPEI these MAY arrive nested under
`psp_response.psp_response` inside `response_data`, double-nested. The backend
serializer (`DirectPaymentSuccessResponseSerializer`) is responsible for lifting
SPEI fields to TOP LEVEL of the `/process` response — the SDK reads `raw.clabe`
and `raw.bank_name` at top level. We **do NOT make the SDK model walk a
`psp_response.psp_response` path.**

**Justification.** Reaching into `psp_response.psp_response.clabe` from the SDK
would (1) couple the public model to an internal PSP envelope shape that is a
vendor/processor implementation detail (the proposal's hard constraint forbids
leaking vendor-shaped internals), (2) be fragile to PSP-routing changes (STP vs
Bitso may nest differently), and (3) violate the "model reads a stable contract"
principle the existing `next_action` mapping already follows. The clean seam is:
backend serializer flattens → SDK reads the flat field. If, at apply time, an
integration test proves the serializer does NOT flatten, the fallback is a single
private helper in the **service adapter** (`DirectApiService`) that normalizes the
response BEFORE it reaches the pure model — keeping `transaction.model.ts` free of
PSP-envelope knowledge either way. The model never learns the nested path.

### Pure mapper

```typescript
export function mapPendingResult(raw: BackendTransactionResponse): PayResult {
  const transaction = mapToTransaction(raw);
  const result: Extract<PayResult, { status: 'pending' }> = {
    status: 'pending',
    transaction,
  };
  const url = raw.next_action?.redirect_to_url?.url;
  if (url) {
    const nextAction: { url: string; verifyTransactionStatusUrl?: string } = { url };
    const verify = raw.next_action?.redirect_to_url?.verify_transaction_status_url;
    if (verify !== undefined) nextAction.verifyTransactionStatusUrl = verify;
    result.nextAction = nextAction;
  }
  if (raw.payment_instructions !== undefined) result.paymentInstructions = raw.payment_instructions;
  if (raw.voucher_pdf !== undefined) result.voucher = raw.voucher_pdf;
  if (raw.clabe !== undefined) result.clabe = raw.clabe;
  if (raw.bank_name !== undefined) result.bankName = raw.bank_name;
  return result;
}
```

`mapPendingResult` stays PURE and type-agnostic — it does not know whether the
caller is APM or SPEI; it only knows how to shape a backend body into a `pending`
result. The DECISION of *when* to call it lives in the facade (Decision 2).

---

## Decision 2 — The discrimination problem (the central seam)

**Problem.** Card 3DS returns `next_action.redirect_to_url`. SPEI ALSO returns
`next_action.redirect_to_url` (to the payflow `/spei` page). `mapPayResult`
currently classifies ANY `next_action.redirect_to_url.url` as `requires_action`,
whose embedded handler POLLS. If an APM/SPEI body flows through that path in
embedded mode, the SDK would **auto-poll an async APM** — exactly what the
proposal forbids. The two outcomes share a wire shape but have incompatible
lifecycles (3DS = act-then-poll-to-final in-session; APM = act-then-wait-for-webhook).

**Decision.** Keep `mapPayResult` **PURE and unchanged in spirit** — it stays the
card/3DS classifier and continues to map `next_action.url → requires_action`. The
APM/SPEI reclassification happens in the **facade `pay()`**, which is the only
layer that knows `input.paymentMethod.type`. The seam is: *the request type, known
only at the facade, decides which result family the SAME backend shape belongs to.*

### Exactly how `pay()` branches

```typescript
public async pay(input: PayInput): Promise<PayResult> {
  if (this.core.getState().lifecycle !== 'ready') {
    throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
  }
  Tonder.assertValidPayInput(input);

  const type = input.paymentMethod.type;
  const paymentMethod = await this.resolvePaymentMethod(input.paymentMethod);

  try {
    const body = this.buildProcessBody(input, paymentMethod);
    const raw = await this.directApiService.processPayment(body, crypto.randomUUID());

    // APM / SPEI: async settlement — reclassify to 'pending', present-only, NEVER poll.
    if (type === 'apm' || type === 'spei') {
      const pending = mapPendingResult(raw) as Extract<PayResult, { status: 'pending' }>;
      return await this.handleApmResult(pending);
    }

    // CARD / SAVED-CARD: existing 3DS path, unchanged.
    const result = mapPayResult(raw);
    if (result.status === 'requires_action') {
      return await this.handleRequiresAction(result);
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ errorCode: ErrorKeyEnum.PAYMENT_PROCESS_ERROR, originalError: error });
  }
}
```

The branch is taken on `type` captured BEFORE `resolvePaymentMethod` (so the
single source of truth is `input.paymentMethod.type`, not the resolved body's
`type` field — APM bodies carry a lowercased provider type, SPEI carries `'spei'`,
both distinct from `'CARD'`, but reading the input is clearer and avoids coupling
the branch to strategy output).

### Why this seam (and what it rejects)

- **Rejected: teach `mapPayResult` the payment type.** Would require threading
  `paymentMethod.type` into a pure model function, polluting a type/mapper module
  (which by its own docblock imports nothing from `core/` and knows nothing about
  requests) with request-routing knowledge. It would also make the model
  responsible for a lifecycle decision (poll vs no-poll) that is fundamentally a
  facade-orchestration concern. **Rejected** — wrong layer, breaks purity intent.
- **Rejected: discriminate on the backend `status` string (`'Pending'`).** APMs
  report `Pending`, but so could a slow card path in some processors; relying on a
  free-text status to gate the no-poll behavior is exactly the kind of fragile
  inference the proposal warns against. The REQUEST type is the authoritative,
  caller-controlled signal. **Rejected** — unreliable discriminator.
- **Rejected: a separate `payApm()` public method.** Splits the public surface and
  duplicates `buildProcessBody`/validation/error-wrapping. The proposal models APM
  as `paymentMethod.type` inside the existing `pay()` union, so one entry point is
  the documented contract. **Rejected** — API duplication.
- **Chosen: facade reclassification by input type.** The facade ALREADY owns the
  card-vs-savedCard branch in `resolvePaymentMethod`; extending the same
  type-driven branching to result handling is consistent, keeps the pure model
  untouched, and makes the no-poll isolation a single readable line. Payment-type
  knowledge never leaks below the facade.

---

## Decision 3 — `handleApmResult` (present-only, NEVER poll)

**Decision.** Add a private `handleApmResult(result)` on `Tonder`, parallel in
shape to `handleRequiresAction` but with the poll surgically removed. It PRESENTS
`nextAction.url` (when present) via `ThreeDsHostPort` and returns the `pending`
result. It NEVER calls `pollTransaction`.

```typescript
/**
 * Present an APM/SPEI `pending` result. APMs settle asynchronously (webhook,
 * hours/days), so the SDK NEVER polls them to a final status — contrast
 * `handleRequiresAction`, which DOES poll in embedded mode for card 3DS.
 *
 * - no `nextAction.url`  → return the `pending` result unchanged (e.g. an OXXO
 *   voucher with only `paymentInstructions`/`voucher`).
 * - `'redirect'`         → `host.redirect(url)`; the page navigates away; return
 *   `pending` unchanged.
 * - `'embedded'`         → `host.mountIframe(url, containerId)`; return `pending`
 *   unchanged. The iframe is unmounted in `finally`. THERE IS NO POLL.
 */
private async handleApmResult(
  result: Extract<PayResult, { status: 'pending' }>,
): Promise<PayResult> {
  if (!result.nextAction?.url) {
    return result; // instructions-only APM (OXXO voucher) — nothing to present.
  }

  const config = this.core.getConfig();
  const mode = config.threeDsMode ?? DEFAULT_THREEDS_MODE;

  if (mode === 'embedded') {
    const containerId = config.threeDsContainerId ?? DEFAULT_THREEDS_CONTAINER_ID;
    this.host.mountIframe(result.nextAction.url, containerId);
    try {
      return result;           // <-- NO pollTransaction. Return immediately.
    } finally {
      this.host.unmount();
    }
  }

  this.host.redirect(result.nextAction.url);
  return result;
}
```

### Explicit contrast with `handleRequiresAction`

| Aspect            | `handleRequiresAction` (card 3DS)             | `handleApmResult` (APM/SPEI)            |
| ----------------- | --------------------------------------------- | --------------------------------------- |
| no-url case       | impossible (`nextAction` required)            | return `pending` unchanged              |
| redirect mode     | `host.redirect(url)` → return result          | `host.redirect(url)` → return result    |
| embedded mode     | `mountIframe` → **`pollTransaction` to final** → `payResultFromTransaction` | `mountIframe` → **return `pending`** |
| embedded `finally`| `host.unmount()` after poll settles/fails     | `host.unmount()` after immediate return |
| polls?            | **YES** (in embedded)                         | **NEVER**                               |
| returns           | final `success`/`declined` (embedded)         | always `pending`                        |

The one-line difference inside the embedded branch — `return result;` instead of
`await this.pollTransaction(...)` — IS the entire async-isolation contract. It is
deliberately the only structural divergence so a reviewer can see at a glance that
APMs do not poll. The `finally { unmount() }` is kept identical so the iframe
lifecycle (mount on entry, tear down on exit) is uniform across both handlers;
because there is no awaited poll, the iframe in the APM embedded case is mounted
and unmounted synchronously around the return — which for the headless v1 is a
present-then-yield placeholder (B2 payflow CheckoutMessenger, a NON-GOAL here,
would later keep it mounted; that is explicitly out of scope).

---

## Decision 4 — `apm.strategy.ts` (new pure module)

**Decision.** New file `src/core/strategies/apm.strategy.ts`. PURE (no DOM/HTTP/
external SDK), mirroring `card.strategy.ts`. Two builders + two body interfaces.
SafetyPay `apm_config` VALIDATION lives in the facade (`resolvePaymentMethod`),
NOT the strategy — the strategy stays a pure shaper; the facade owns throwing
`AppError`. (Builders can defensively shape config, but the throw-on-invalid is a
facade concern, consistent with how `resolvePaymentMethod` validates `cardId`.)

```typescript
/** The `payment_method` block sent to the Direct API for an APM charge. */
export interface ApmPaymentMethod {
  /** Provider slug, lowercased: 'oxxopay' | 'mercadopago' | 'safetypaycash' | … */
  type: string;
  /** Provider-specific config (e.g. SafetyPay country/channel/bank_ids). */
  apm_config?: Record<string, unknown>;
}

/** The `payment_method` block sent to the Direct API for a SPEI charge. */
export interface SpeiPaymentMethod {
  type: 'spei';
}

/**
 * Build the APM `payment_method`. `apm` is lowercased to the backend slug;
 * `apm_config` is forwarded only when present. PURE.
 */
export function buildApmPaymentMethod(input: {
  apm: string;
  config?: Record<string, unknown>;
}): ApmPaymentMethod {
  const pm: ApmPaymentMethod = { type: input.apm.toLowerCase() };
  if (input.config !== undefined) pm.apm_config = input.config;
  return pm;
}

/** Build the SPEI `payment_method`. PURE — no config. */
export function buildSpeiPaymentMethod(): SpeiPaymentMethod {
  return { type: 'spei' };
}
```

### `ProcessPaymentBody` union extension

In `src/core/services/direct-api.service.ts`:

```typescript
import type { ApmPaymentMethod, SpeiPaymentMethod } from '../strategies/apm.strategy';

export interface ProcessPaymentBody {
  // ...
  payment_method:
    | CardPaymentMethod
    | SavedCardPaymentMethod
    | ApmPaymentMethod
    | SpeiPaymentMethod;
  // ...
}
```

### `resolvePaymentMethod` new branches (facade)

```typescript
if (method.type === 'apm') {
  if (!method.apm || method.apm.trim() === '') {
    throw new AppError({
      errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
      details: { systemError: 'paymentMethod.apm is required.' },
    });
  }
  // SafetyPay requires country + channel + bank_ids in config.
  if (Tonder.isSafetyPay(method.apm)) {
    Tonder.assertSafetyPayConfig(method.config); // throws INVALID_APM_CONFIG
  }
  return buildApmPaymentMethod({ apm: method.apm, config: method.config });
}

if (method.type === 'spei') {
  return buildSpeiPaymentMethod();
}

throw new AppError({ errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST_CARD_PM });
```

`assertSafetyPayConfig` throws `AppError(INVALID_APM_CONFIG)` when `country`,
`channel`, or `bank_ids` is missing/empty. `INVALID_APM_CONFIG` and
`FETCH_APM_BANKS_ERROR` are NEW codes added to `ErrorKeyEnum`
(`FETCH_PAYMENT_METHODS_ERROR` already exists — reuse, do not add).

---

## Decision 5 — `getPaymentMethods` / `getApmBanks` (DirectApiService + facade)

**Decision.** Add both read-only methods to `DirectApiService` (Slice A,
independent of `pay()`), and thin facade wrappers on `Tonder`. They map snake →
camel and wrap transport errors.

```typescript
// DirectApiService

/** GET /api/v1/payment_methods?status=active — Token apiKey header (standard auth). */
public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
  const raw = await this.http.request<BackendPaymentMethod[]>({
    method: 'GET',
    path: '/api/v1/payment_methods?status=active',
  });
  return raw.map(mapPaymentMethodInfo);
}

/**
 * GET /api/v1/safetypay/banks/{apiKey}/ — apiKey in the URL PATH.
 * The backend resolves the business from the path token, NOT the Authorization
 * header. Returns banks split by settlement type.
 */
public async getApmBanks(apiKey: string): Promise<{ cash: ApmBank[]; transfer: ApmBank[] }> {
  const raw = await this.http.request<BackendApmBanks>({
    method: 'GET',
    path: `/api/v1/safetypay/banks/${encodeURIComponent(apiKey)}/`,
  });
  return {
    cash: (raw.cash ?? []).map(mapApmBank),
    transfer: (raw.transfer ?? []).map(mapApmBank),
  };
}
```

### Path-auth divergence and how `FetchHttpClient` handles it

`getApmBanks` puts the apiKey in the URL **path**, diverging from every other SDK
call (which authenticate via the `Authorization: Token <apiKey>` header). This is
fine with the EXISTING transport — **no client change is required**:

- `FetchHttpClient.request` builds `url = ${baseUrl}${path}`, so the path-embedded
  apiKey lands in the URL exactly as the backend expects.
- It still attaches `Authorization: Token <apiKey>` by default. The SafetyPay view
  resolves the business from the path token and **ignores the header**, so the
  extra header is HARMLESS (not an error, not a conflict) — confirmed against the
  client at `src/adapters/http/fetch-http.client.ts:34-39`. We do NOT add a
  "no-auth" mode to the port; the base client works as-is for a path-auth GET.
- The facade passes the apiKey from config: `this.core.getConfig().apiKey`. The
  service takes `apiKey` as an explicit parameter (rather than reading it itself)
  to keep `DirectApiService` free of config/state — it depends only on `HttpPort`.

### Facade wrappers

```typescript
// Tonder — both are READ-ONLY: no `ready` guard (like getTransaction), only the apiKey.
public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
  try {
    return await this.directApiService.getPaymentMethods();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR, originalError: error });
  }
}

public async getApmBanks(): Promise<{ cash: ApmBank[]; transfer: ApmBank[] }> {
  try {
    return await this.directApiService.getApmBanks(this.core.getConfig().apiKey);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ errorCode: ErrorKeyEnum.FETCH_APM_BANKS_ERROR, originalError: error });
  }
}
```

No `assertReady()` — consistent with `getTransaction`, these need only the apiKey
carried by the `HttpPort` and never touch vault/init state, so they work before
`init()`.

---

## Decision 6 — Public types (`PaymentMethodInfo`, `ApmBank`)

**Decision.** Define the PUBLIC camelCase types in `src/shared/types/index.ts`
(where `PaymentMethod`, `PayInput`, etc. already live) and re-export from
`src/index.ts`. The INTERNAL snake_case backend shapes + mappers
(`BackendPaymentMethod`, `BackendApmBanks`, `mapPaymentMethodInfo`, `mapApmBank`)
live in `direct-api.service.ts` (or a sibling internal module) — never exported.

```typescript
// src/shared/types/index.ts — PUBLIC

/** A payment method available to the business (from GET /payment_methods). */
export interface PaymentMethodInfo {
  /** Stable id (`pk`). */
  id: number;
  /** Method slug, e.g. 'oxxopay' | 'spei' | 'mercadopago'. */
  paymentMethod: string;
  acquirer: string;
  status: string;
  priority: number;
  category: string;
  /** ISO country codes where this method is NOT available. */
  unavailableCountries: string[];
}

/** A SafetyPay bank (from GET /safetypay/banks/{apiKey}/). */
export interface ApmBank {
  /** Business-bank link id (uuid). */
  id: string;
  /** Bank id (uuid). */
  bankId: string;
  name: string;
  bankCode: string;
  logo?: string;
  country: string;
  countryName: string;
  isActive: boolean;
  /** 'cash' | 'transfer'. */
  paymentType: string;
  isEnabled: boolean;
  priority: number;
}
```

Internal mappers shape the backend bodies:

| `PaymentMethodInfo`    | `BackendPaymentMethod`     |
| ---------------------- | -------------------------- |
| `id`                   | `pk`                       |
| `paymentMethod`        | `payment_method`           |
| `unavailableCountries` | `unavailable_countries`    |
| (rest)                 | same names                 |

| `ApmBank`     | `BackendApmBank` (`SafetyPayBusinessBankSerializer`) |
| ------------- | ---------------------------------------------------- |
| `id`          | `id`                                                 |
| `bankId`      | `bank.id`                                            |
| `name`        | `bank.name`                                          |
| `bankCode`    | `bank.bank_code`                                     |
| `logo`        | `bank.logo`                                          |
| `country`     | `bank.country`                                       |
| `countryName` | `bank.country_name`                                  |
| `isActive`    | `bank.is_active`                                     |
| `paymentType` | `payment_type`                                       |
| `isEnabled`   | `is_enabled`                                         |
| `priority`    | `priority`                                           |

### Export points

`src/index.ts` adds `PaymentMethodInfo` and `ApmBank` to the existing
`export type { ... } from './shared/types'` block. The `PaymentMethod` union in
`shared/types` already includes `{ type: 'apm'; … }` and `{ type: 'spei' }`
(present in the current code) — no change needed there. `PayResult` gains the
`pending` variant transitively (already re-exported via `shared/types`).

---

## Layering / Purity Audit

- `core/` stays pure: `apm.strategy.ts` is pure functions; `DirectApiService`
  depends only on `HttpPort`; `transaction.model.ts` gains a `pending` variant +
  `mapPendingResult` with NO `core/` import and NO payment-type/DOM knowledge.
- DOM/HTTP only in adapters: `FetchHttpClient` (HTTP), `Browser3dsHost` (DOM via
  `ThreeDsHostPort`). `handleApmResult` touches the DOM only through the `host`
  port — the facade never reaches `window`/`document`.
- Payment-type knowledge is confined to the facade (`pay`, `resolvePaymentMethod`).
  The pure model and strategy never branch on "is this APM".

## Risks / Unresolved

- **`clabe`/`bank_name` flattening (medium).** The design assumes the backend
  serializer surfaces these at top level. If apply-time integration shows
  `psp_response.psp_response` nesting, the fallback is a normalization helper in
  the SERVICE adapter (not the pure model). Validate with a real SPEI `/process`
  response fixture before implementing the mapper.
- **APM embedded mount lifecycle (low).** In v1, embedded APM mounts then
  immediately unmounts around the return (no poll to keep it alive). This is a
  placeholder until B2 payflow CheckoutMessenger (explicit NON-GOAL). Confirm with
  product that a mount-then-yield is acceptable for the headless slice, or restrict
  APM to `redirect` mode in v1 if not.
- **SafetyPay-only validation scope (low).** `assertSafetyPayConfig` gates only
  SafetyPay variants. Other APMs (oxxopay, mercadopago, neosurf) send no required
  config; if a future APM needs config, the validation map must be extended.
- **`getApmBanks` header tolerance (low).** Relies on the SafetyPay view ignoring
  the `Authorization` header. Confirmed by exploration against the view code;
  re-verify if the gateway enforces header auth uniformly.

## Spec Dependency

This design pairs with the spec capabilities `payment-method-discovery` (Slice A)
and `apm-payments` (Slice B). Tasks should be derived only after both spec and
this design are ready.
