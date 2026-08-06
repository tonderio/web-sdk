# Design: Apple Pay Checkout — Orchestration and Public API (Phase 5)

Phases 1–4 shipped four disconnected pieces. This change assembles them into a payment and
opens the public surface that reaches it.

The whole design answers one question the proposal poses and does not resolve: **what stops
an `await` from entering the click path, and what stops the two `/process` bodies from
drifting?** §2 and §4 are those two answers. Everything else follows.

Decisions here are `DD1…DD14`. The proposal's are `D1…D11` and stay binding; every
cross-reference is explicit. Phase 3's design decisions are `DD1…DD10` in _its_ file and are
cited as `P3-DDn` to avoid a collision.

---

## Quick path

1. `src/core/strategies/process-body.strategy.ts` — the extracted pure `/process` primitives.
   `pay()` delegates, zero behavior change, own commit (D3).
2. `src/core/services/apple-pay-checkout.service.ts` — session lifecycle, validation round
   trip, response mapping. Pure; drivable end-to-end by fakes (D10).
3. `src/tonder.ts` — `create('apple_pay_button')`, the four-code `mount()` gate,
   `isApplePayAvailable()`, `unmount()`'s abort, `pay()`'s guard, event emission.
4. `src/types/card.ts`, `src/types/customization.ts`, `src/shared/types/index.ts`,
   `src/shared/errors/messages.ts`, `src/index.ts` — the four deferred wirings and the copy.

Verify: `npm run test` · `npm run typecheck` · `npm run build`, with the lint error set
identical to `main`.

---

## 1. Architecture

```
tonder.ts (facade)                       DOM-free itself; owns gate order, snake→camel,
   │   create/mount/unmount/pay/isApplePayAvailable      event emission entry points
   │
   ├── ports/apple-pay.port.ts ◄── adapters/browser/apple-pay.adapter.ts   [DOM + globals]
   │
   └── core/services/apple-pay-checkout.service.ts       PURE. one instance per component
             │
             ├── core/strategies/apple-pay.strategy.ts       [P3, pure]
             ├── core/strategies/process-body.strategy.ts    [NEW, pure]
             ├── core/services/apple-pay.service.ts          [P4, HttpPort]
             └── core/services/direct-api.service.ts         [existing, HttpPort]
```

`core/` imports from `ports/` with `import type` only, exactly as phase 3 established. No new
DOM or `fetch` import enters `core/`.

---

## 2. The `/process` body extraction — DD1, DD2 (realizes D3)

**DD1 — `buildProcessBody` becomes a pure function taking the three values it reads off
`this`, and `pay()` delegates with zero behavior change.**

```ts
// src/core/strategies/process-body.strategy.ts
export const DEFAULT_CURRENCY = 'MXN';
export const DEFAULT_PRESENTATION_MODE = 'redirect' as const;

export interface BuildProcessBodyInput {
  /** Everything the merchant supplied EXCEPT the method. */
  payment: Omit<PayInput, 'payment_method'>;
  paymentMethod: ProcessPaymentBody['payment_method'];
  /** From `config.session.customer`. Throws MISSING_CUSTOMER when absent — moved verbatim. */
  customer: Customer | undefined;
  /** ALREADY RESOLVED by the caller. Required — see below. */
  currency: string;
  presentationMode: 'redirect' | 'embedded';
}

export function buildProcessBody(
  input: BuildProcessBodyInput,
): ProcessPaymentBody;
```

Three shaping choices:

| Choice                                       | Why                                                                                                                                                                                                                                           | Rejected                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `payment: Omit<PayInput, 'payment_method'>`  | `ApplePayPaymentInput` **is** that type, and `PayInput` is assignable to it. Makes "the builder never reads `payment_method`" structural rather than documentary                                                                              | `PayInput`, which would force the Apple Pay caller to synthesize a method field the builder ignores |
| `currency` required and pre-resolved         | Phase 3 (`P3-§6.2`) requires the sheet and the charge to share **one** resolved currency. If the builder defaulted internally, the Apple Pay path would have to default again for `buildApplePayPaymentRequest` — two defaults that can drift | defaulting inside the builder                                                                       |
| The `MISSING_CUSTOMER` throw moves unchanged | WU1 is a refactor. Relocating a throw is a behavior change                                                                                                                                                                                    | dropping it because `pay()` already pre-flights                                                     |

`DEFAULT_CURRENCY` / `DEFAULT_PRESENTATION_MODE` move into this module and `tonder.ts`
imports them, so there is one definition rather than a copy.

`pay()` after the refactor — the private method is deleted, not kept as a shim:

```ts
const config = this.core.getConfig();
const body = buildProcessBody({
  payment: input,
  paymentMethod: resolved.paymentMethod,
  customer: config.session?.customer,
  currency: input.currency ?? DEFAULT_CURRENCY,
  presentationMode: config.presentation_mode ?? DEFAULT_PRESENTATION_MODE,
});
```

**DD2 — `buildProcessRequestId` moves with it, as `scopeRequestId(idempotencyKey, businessPk)`.**

Not in the proposal's WU1 list; added because `ApplePayPaymentInput` inherits
`idempotency_key` from `PayInput` (that inheritance is the point of the alias). Leaving the
scoper private means the button accepts `idempotency_key` and silently ignores it — the
precise failure inherited D3 exists to prevent, arriving through the back door. It is the
same shape of extraction, still pure, still zero behavior change.

**Why extraction and not a copy (D3):** two bodies drift the first time a field joins
`PayInput` — `billing_address` was added three commits ago — and the SDK would then charge
Apple Pay differently from cards with nothing reporting it. Enforced by construction (one
module) _and_ by a test: feed `pay()` and the checkout service equivalent input against a
fake `HttpPort`, then compare the two captured bodies with **exact `toEqual`** after
substituting only `payment_method`. See DD12 on why `objectContaining` is banned there.

---

## 3. The orchestration service (D10)

One class, `ApplePayCheckoutService`, constructed with a deps object:

```ts
export interface ApplePayCheckoutDeps {
  applePay: ApplePayPort;
  validation: ApplePayService; // P4
  directApi: DirectApiService;
  /** Live reads at click/fire time. Never snapshotted. */
  getContext(): ApplePayCheckoutContext;
  /**
   * The ONE emit surface (DD7). Reads `config.events.payment` at fire time,
   * isolates the merchant's callback, and cannot throw back into this service.
   * Owned by the facade because `core/` may not touch `console`.
   */
  emit: PaymentEventSink;
}

export interface ApplePayCheckoutContext {
  catalog: readonly BackendPaymentMethod[] | null;
  customer: Customer | undefined;
  presentationMode: 'redirect' | 'embedded';
  businessPk: number | undefined;
}
```

**DD3 — one service instance per button component, not one per `Tonder`.**

The service holds exactly one mutable field, `session: ApplePaySessionHandle | null`. With a
single shared instance, a second button's `unmount()` would abort the first button's live
sheet. Per-component instances make that impossible and cost nothing — the service is a plain
object over injected deps. The accepted "two buttons share one callback set" tradeoff (D4)
concerns `config.events.payment`, which is genuinely instance-level; session ownership is not.

**DD4 — `start()` is not `async`; arguments carry what the gate proved, deps carry what is
read live.**

```ts
/** SYNCHRONOUS. Everything awaitable was resolved by init() and read from state. */
public start(input: ApplePayCheckoutStartInput): void {
  try {
    const ctx = this.deps.getContext();
    const payment = typeof input.payment === 'function' ? input.payment() : input.payment;
    const currency = payment.currency ?? DEFAULT_CURRENCY;

    const request = buildApplePayPaymentRequest({
      amount: payment.amount,
      currencyCode: currency,
      countryCode: input.countryCode,   // narrowed by the mount() gate — see DD9
      merchantName: input.merchantName,
      catalog: ctx.catalog,
    });

    this.session = this.deps.applePay.createSession(request, {
      onValidateMerchant: () => this.onValidateMerchant(),
      onPaymentAuthorized: (token) => this.onPaymentAuthorized(token, payment, currency),
      onCancel: () => this.onCancel(),
    });
    this.session.begin();
  } catch (error) {
    // D1: no promise a merchant is holding. The only report channel is the event.
    this.emitError(error);
  }
}
```

Why an `await` in front of `createSession` is a **visible** mistake and not a subtle one:

| Guard                                                           | What it catches                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `start()` has no `async` keyword                                | adding `await` is TS2705 — a compile error, before any test runs |
| `start(): void`, `createSession` returns a handle not a promise | there is nothing to await; the value is already there            |
| Handlers close over `this.session`, not over an awaited local   | no reason to introduce an intermediate promise                   |
| T1/T2 (DD5)                                                     | a deferral that survives all of the above                        |

`countryCode` and `merchantName` are **arguments** because `mount()`'s gate is what proved
them present — that is how phase 3's `countryCode: string` (not `string | undefined`) pushes
the narrowing to the gate as a compile error instead of a re-validation. `catalog`,
`customer`, `presentationMode` and `businessPk` are **deps reads** because they may be
consulted long after mount. One rule, no exceptions.

Non-`AppError` throws are wrapped as `AppError(PAYMENT_PROCESS_ERROR)` with `originalError`
preserved — reusing `pay()`'s existing normalization (`src/tonder.ts:364-368`) rather than
inventing a rule. An incoming `AppError` is re-emitted **as-is**, never re-wrapped: D6, and
`ApplePayService`'s recorded consumer contract.

### 3.1 Handlers

```ts
private async onValidateMerchant(): Promise<void> {
  const session = this.session;
  if (!session) return;              // aborted between begin() and the callback — DD8
  try {
    session.completeMerchantValidation(await this.deps.validation.validateMerchant());
  } catch (error) {
    session.abort();
    this.session = null;
    this.emitError(error);           // APPLE_PAY_VALIDATION_ERROR, re-thrown as-is
  }
}

private async onPaymentAuthorized(token, payment, currency): Promise<void> {
  const session = this.session;
  if (!session) return;
  this.session = null;
  try {
    const ctx = this.deps.getContext();
    const raw = await this.deps.directApi.processPayment(
      buildProcessBody({
        payment,
        paymentMethod: buildApplePayPaymentMethod(token),   // token BY REFERENCE
        customer: ctx.customer,
        currency,
        presentationMode: ctx.presentationMode,
      }),
      scopeRequestId(payment.idempotency_key, ctx.businessPk),
    );

    if (raw.next_action?.redirect_to_url?.url) {            // D6 row 4
      session.completePayment({ status: 'failure' });
      this.emitError(new AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_ACTION }));
      return;
    }

    const tx = toRawTransaction(raw);
    session.completePayment({ status: isSuccessfulStatus(tx.status) ? 'success' : 'failure' });
    this.deps.emit.onSuccess(tx);                           // D6 rows 1 AND 2
  } catch (error) {
    session.completePayment({ status: 'failure' });         // D2 — ALWAYS first
    this.emitError(error);
  }
}
```

**DD5 — `completePayment` precedes every merchant callback on every path, including the
throw path.** `session` is captured into a local _before_ `this.session` is nulled, so the
sheet can still be settled after ownership is released. Enforced by comparing
`completePayment.mock.invocationCallOrder[0]` against the callback's (D2).

**DD6 — the success set is a single exported predicate.** `pay()` currently inlines
`status !== 'Success' && status !== 'Authorized'` (`src/tonder.ts:393`). `isSuccessfulStatus`
lands in `src/models/transaction.model.ts` and both callers use it; otherwise D6 row 1's
definition of success lives in two places and one of them is in a file about card fields.

`emitError` normalizes to `AppError` and calls `this.deps.emit.onError(err)`. It is the only
`on_error` site in the service, and per DD7 it cannot throw.

---

## 4. Events at fire time — DD7, DD8 (realizes D4/D5)

**DD7 — one emit surface, `PaymentEventSink`. It reads `config.events.payment` at fire time,
and a throwing merchant callback cannot alter the payment result or the promise `pay()`
returns.**

```ts
// src/tonder.ts — the ONE place a merchant callback is invoked in this change.
private readonly paymentEvents: PaymentEventSink = {
  onSuccess: (tx) => this.emitPayment('on_success', (h) => h.on_success?.(tx)),
  onError:   (e)  => this.emitPayment('on_error',   (h) => h.on_error?.(e)),
  onCancel:  ()   => this.emitPayment('on_cancel',  (h) => h.on_cancel?.()),
};

private emitPayment(name: string, invoke: (handlers: PaymentEvents) => void): void {
  // FIRE-TIME read, mirroring `events.presentation` (src/tonder.ts:462,519-520):
  // a config mutated after createTonder is honored.
  const handlers = this.core.getConfig().events?.payment;
  if (!handlers) return;
  try {
    invoke(handlers);
  } catch (error) {
    // The callback is FOREIGN code. A throw here must not change what happened
    // to the payment — see the walk-through below. Not swallowed: `console.warn`
    // is this codebase's existing non-fatal channel (skyflow.adapter.ts:386-710).
    console.warn(`[events.payment.${name}] merchant callback threw:`, error);
  }
}
```

Two properties, both load-bearing:

**Fire-time read.** The getter _and_ the optional call run at emit time; nothing is captured
at construction. The wrong-reason trap is specific: a test that keeps the same
`events.payment` object and swaps only `on_success` would pass even against an implementation
that snapshotted `events.payment` once. **The fire-time test must replace `config.events`
wholesale** — `config.events = { payment: { on_success: second } }` — so only a fully
fire-time read is green.

**Isolation.** Walk the failure without it: `/process` returns `Authorized`, the SDK calls
`on_success`, the merchant's handler throws on something unrelated — a null field in their
analytics call — and that throw propagates out of `pay()`. The merchant now holds a rejected
promise for a payment that went through. The obvious next move is to retry, and there are two
charges. The asymmetry settles it: the wrap costs a `try`/`catch`; omitting it lets the SDK
convert a merchant-side bug into a double-charge path.

The Apple Pay path has the same exposure in a different shape. There the emit runs _after_
`completePayment` has settled the sheet (DD5), so a throw corrupts nothing — but it escapes
into the adapter's fire-and-forget `void handlers.onPaymentAuthorized(…)` and is simply lost.
Same wrap, same reasoning, and it is the same code because there is one sink.

Placing the sink in the facade rather than in the service is what keeps `core/` pure:
`console` is the only non-fatal channel this codebase has, and no `core/` module touches it.
The service receives `emit` and never learns how a callback is invoked.

> **Deliberate divergence from `events.presentation` — do not "align" it.**
> `events.presentation`'s callbacks are invoked unwrapped today
> (`src/tonder.ts:462,519-520`, and through `ThreeDsHostOptions.onOpen` / `onUserClose`), so
> it carries the identical exposure. It is **not** fixed here — that is a separate change with
> its own regression surface across the 3DS and APM presentation paths. Recorded as a forward
> finding in §14 so it gets its own ticket. The two patterns now differ **on purpose**: the
> neighbouring code is the wrong model to copy, exactly as it was when phase 4's neighbours
> made `expect.objectContaining` look normal.

Tests: a callback that throws must leave `pay()` **resolved with the transaction** (not
rejected) and must leave `completePayment` already called on the Apple Pay path — assert the
outcome, not the `console.warn`, so the test does not go green on the warning alone.

**DD8 — `pay()` becomes a thin wrapper over the existing body, renamed `runPay()`.**

```ts
public async pay(input: PayInput): Promise<RawTransaction> {
  try {
    const tx = await this.runPay(input);
    this.paymentEvents.onSuccess(tx);   // cannot throw — DD7
    return tx;
  } catch (error) {
    if (error instanceof AppError) {
      this.paymentEvents.onError(error);
    }
    throw error;
  }
}
```

The `catch` block is reached only by `runPay()`, never by the emit: `onSuccess` cannot throw,
so a successful payment can never fall through into `onError` and report itself as a failure.
That is DD7 doing its work, and it is why the wrap has to live inside the sink rather than
around the `await`.

Chosen over threading emits through `runPay()`'s four return points: one emit site per
outcome, and `runPay()`'s body is byte-identical to today's, so the whole existing `pay()`
suite is the regression test (D5).

One consequence, recorded rather than defended against:

- **Only `AppError` produces `on_error`.** Q4 fixed `on_error(error: AppError)`; widening it
  is a public-contract change. A non-`AppError` escape still rejects the promise, so nothing
  is lost — it is only not duplicated onto the callback.

---

## 5. The facade surface

### 5.1 `create('apple_pay_button')` — DD9

```ts
if (type === 'apple_pay_button') {
  return this.createApplePayButtonComponent(
    options as ApplePayButtonOptions,
  ) as ComponentByType[T];
}
```

`create<T>()`'s `options?` parameter is optional for every `T`, so
`create('apple_pay_button')` with no options type-checks even though `payment` is required by
`ApplePayButtonOptions`. Tightening that would require a conditional type on the public
signature — out of scope. Instead `create` guards it with `INVALID_PAYMENT_REQUEST` and
`details.system_error: "create('apple_pay_button') requires options.payment."`, the shape
`assertValidPayInput` already uses (`src/tonder.ts:1037-1055`). No new code, and the failure
lands at `create()` rather than as a `TypeError` reading `.amount` at click time.

**DD9 — `mount()` runs D7's four checks in order and captures the narrowed values.**

```ts
mount: async (): Promise<void> => {
  this.assertReady(); // 1 NOT_INITIALIZED
  if (!this.applePay.canUseApplePay()) {
    // 2
    throw new AppError({
      errorCode: ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER,
    });
  }
  const state = this.core.getState();
  const countryCode = state.business?.business.country_code;
  if (!hasActiveApplePayMethod(state.paymentMethodCatalog) || !countryCode) {
    // 3
    throw new AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_NOT_ENABLED });
  }
  const merchantName = state.business.business.name;

  dispose?.(); // Q3: idempotent-by-disposal
  dispose = this.applePay.render({
    // 4 CONTAINER_NOT_FOUND
    containerId: options.container_id ?? DEFAULT_APPLE_PAY_CONTAINER_ID,
    customization: this.core.getConfig().customization?.apple_pay_button,
    onClick: () =>
      checkout.start({ payment: options.payment, countryCode, merchantName }),
  });
};
```

`mount()` is `async` only because `TonderMountableComponent.mount(): Promise<void>` says so.
It contains no `await`, and it is **not** part of the click path — the click path begins at
`onClick`. `container_id → containerId` is the single snake→camel translation, at the single
boundary, exactly where phase 3 said it belongs.

`dispose` and `checkout` are closure variables inside `createApplePayButtonComponent`, per
DD3. A second `mount()` disposes and re-renders; it does **not** abort a live session (Q3).

### 5.2 `unmount()` (D8)

```ts
unmount: (): void => {
  checkout.abort(); // idempotent — no-op when no session is live
  dispose?.(); // phase 3's idempotent disposer
  dispose = undefined;
};
```

Abort first: the sheet must be dismissed before its container disappears. `abort()` nulls
`this.session`, which is what makes a late `onPaymentAuthorized` drop the charge (the `if
(!session) return` guards in §3.1 are that behavior, not defensive padding).

### 5.3 `isApplePayAvailable()` (D7)

```ts
public isApplePayAvailable(): boolean {
  const state = this.core.getState();
  return (
    this.applePay.canUseApplePay() &&
    hasActiveApplePayMethod(state.paymentMethodCatalog) &&
    Boolean(state.business?.business.country_code)
  );
}
```

No `assertReady`, no network, no throw. Before `init()` the catalog is `null` and
`business` is `null`, so it returns `false` — the honest answer. `mount()` deliberately does
not call it: a merchant debugging at 2 AM needs to know _which_ check failed, which is the
whole reason for four codes instead of one `CREATE_ERROR`.

### 5.4 `pay()` rejection (D9)

Inside `assertValidPayInput`, before any network call:

```ts
if (input?.payment_method?.type === 'apple_pay') {
  invalid(
    "Apple Pay is not a pay() method. Use create('apple_pay_button', { payment }).",
  );
}
```

It still **type-checks** — `PaymentMethod`'s third member accepts any string. No design
statement here claims otherwise.

---

## 6. Widening the three component maps

```ts
export type TonderComponentType = 'card_fields' | 'apple_pay_button';

export interface ComponentOptionsByType {
  card_fields: CardFieldsOptions | undefined;
  apple_pay_button: ApplePayButtonOptions; // required — see §5.1
}

export interface ComponentByType {
  card_fields: CardFieldsComponent;
  apple_pay_button: ApplePayButtonComponent;
}
```

**The phase 1 guardrail fires as intended — verified, not assumed.** `create<T extends
TonderComponentType>(…): ComponentByType[T]` indexes both interfaces with `T`. Widen the
union without adding a key and TypeScript reports **TS2536 — `Type 'T' cannot be used to
index type 'ComponentOptionsByType'`** on the `create` _declaration_. Two precise notes so no
criterion overclaims:

- It fires at the **declaration**, not at merchant call sites. A merchant's
  `create('card_fields')` compiles either way.
- It fires under `npm run typecheck`. `tsconfig.json` excludes `**/*.test.ts`, so a
  `@ts-expect-error` in a test file proves nothing (the canonical spec says so explicitly).
  The one compiled call site that genuinely exercises narrowing is
  `e2e/support/fixtures.ts:123`, under `e2e/tsconfig.json` — the acceptance gate for
  `create('card_fields', …)` still returning `CardFieldsComponent` and not a union.

No import cycle: `card.ts` imports from `apple-pay.ts`, which imports from `component.ts` and
`shared/types` and never from `card.ts`. That acyclic graph is exactly why phase 1 extracted
`component.ts`.

`ApplePayButtonComponent` gains no member, so it stays a type alias (spec-mandated —
converting it to an empty interface would trip `no-empty-object-type`).

---

## 7. Adapter injection — DD10 (confirms Q6 against the real signatures)

The constructor takes `config` plus five optional ports today (`src/tonder.ts:138-145`). A
**seventh positional parameter** is consistent, not novel:

```ts
// src/ports/apple-pay.port.ts — a type alias, not a new interface. Adds no members.
export type ApplePayAdapter = ApplePayPort & ApplePayButtonPort;

// src/tonder.ts
constructor(config, http?, tokenizer?, acquirer?, host?, messenger?, applePay?: ApplePayAdapter) {
  …
  this.applePay = applePay ?? new BrowserApplePay();
}
```

One parameter, not two: `BrowserApplePay implements ApplePayPort, ApplePayButtonPort` already
— the intersection describes the object that exists. `_createTonderWithDeps`
(`src/tonder.ts:1071`) gains one key, `applePay?: ApplePayAdapter`, and needs no migration
because it already accepts an options object.

`new BrowserApplePay()` in the constructor is SSR-safe: the module's only DOM and
`globalThis` reads are inside method bodies (verified in
`src/adapters/browser/apple-pay.adapter.ts` — `getApplePaySessionCtor()` and
`document.querySelector` are both call-time).

---

## 8. Verification: can T1–T14 actually be written?

Phase 3's port was cut backwards from this list. Re-checked row by row against the code that
now exists. **All fourteen are writable.** Four need a note.

| #   | Writable | Note                                                                                                                                                                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | yes      | see DD11 — the naive form is a wrong-reason test                                                                                                                          |
| T2  | yes      | same sentinel array                                                                                                                                                       |
| T3  | yes      | four codes; `assertReady` reached by leaving `init()` uncalled                                                                                                            |
| T4  | yes      | `toHaveBeenCalledWith({ status: 'success' })`                                                                                                                             |
| T5  | yes      | **phase 3's row says `{ status: 'failure', errors: … }`. Superseded** — the proposal keeps `errors` unpopulated (S9), so the assertion is `{ status: 'failure' }` exactly |
| T6  | yes      | rejecting fake `HttpPort`                                                                                                                                                 |
| T7  | yes      | fake `/process` 200 carrying `next_action.redirect_to_url.url`                                                                                                            |
| T8  | yes      | `invocationCallOrder`                                                                                                                                                     |
| T9  | yes      | `abort()` via the component's `unmount()`                                                                                                                                 |
| T10 | yes      | `on_cancel` fires, `on_error` asserted `not.toHaveBeenCalled()`                                                                                                           |
| T11 | yes      | P3-DD2's promise return is the join point                                                                                                                                 |
| T12 | yes      | `abort()` + `on_error` carrying `APPLE_PAY_VALIDATION_ERROR`, asserted on `errorCode` — a re-wrap would show `PAYMENT_PROCESS_ERROR`                                      |
| T13 | yes      | `expect(body.payment_method.token).toBe(TOKEN_FIXTURE)` — `toBe`, so a `JSON.stringify` or a spread fails                                                                 |
| T14 | yes      | fake disposer                                                                                                                                                             |

**DD11 — T1 asserts against a microtask sentinel queued _before_ the click, not merely that
`createSession` was called.**

```ts
const order: string[] = [];
queueMicrotask(() => order.push('microtask')); // queued FIRST
button.click(); // synchronous
expect(order).toEqual(['createSession', 'begin']); // exact: the microtask has NOT run
await Promise.resolve();
expect(order).toEqual(['createSession', 'begin', 'microtask']);
```

The naive form (`click(); expect(createSession).toHaveBeenCalled()`) is green today and stays
green the day someone adds `await flushPromises()` before the assertion to "fix a flake" —
at which point it proves nothing. The pre-queued sentinel cannot be defeated that way: any
deferral, however small, reorders the array. This is the single most valuable test in the
change, and T2 rides on the same array.

### What this change cannot prove

**S1–S10 remain Phase 7's and none of them is recorded as covered here.** In particular:

- **T1 and T2 are proxies for S3, not evidence of it.** jsdom models no user activation, so
  no assertion in this change touches Safari's real gesture rule. The proxy is a good one —
  it fails for every implementation that defers — and it is still a proxy.
- `errors` on `completePayment` stays unpopulated (S9). Whether Apple requires real
  `ApplePayError` instances is untested and untestable here.
- Nothing asserts that Safari accepts the request (S1), renders the mark (S2), or enforces
  HTTPS/domain (S4).

---

## 9. Traps this project has hit — the analogues here

| Precedent                                                                                               | Analogue in this phase                                                                                                                                                                        | Guard                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 nearly shipped a CSS assertion green against `''`                                               | T1 green against a deferred `createSession`                                                                                                                                                   | **DD11** — pre-queued microtask sentinel, exact `toEqual` on the order array                                                                      |
| Phase 3, same class                                                                                     | `isApplePayAvailable()` returning `false` before `init()` — trivially true when all three checks are false                                                                                    | Three tests, each with the **other two forced true**, so a `false` is attributable to exactly one cause                                           |
| Phase 4: `objectContaining` passed with extra keys; the empty-body assertion needed exact deep equality | `completePayment({ status: 'failure' })` would pass `objectContaining` even with a stray `errors` key; the two-bodies comparison (DD1) would pass while Apple Pay silently dropped `metadata` | **DD12 — no `expect.objectContaining` anywhere in this change's assertions.** Whole-argument `toHaveBeenCalledWith` and whole-body `toEqual` only |
| Phase 3's criterion claimed a compile-time error that could not exist                                   | Two candidates here: `pay({ type: 'apple_pay' })` "not type-checking", and the map guardrail "protecting call sites"                                                                          | §5.4 and §6 state both limits explicitly; no criterion asserts either                                                                             |
| Copy drift across phases                                                                                | Three new `MESSAGES_EN` entries could be present but duplicated                                                                                                                               | Assert all six resolve to strings that are **distinct from `UNKNOWN_ERROR`'s copy and from each other** — presence alone is a wrong-reason test   |
| Two pre-existing lint errors could hide a new one                                                       | unchanged                                                                                                                                                                                     | Compare the lint error set before and after; do not fix the two                                                                                   |

---

## 10. Copy owed (D11)

| Code                              | Copy                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_PAY_NOT_ENABLED`           | Apple Pay is not enabled for this business. Contact Tonder to enable it and to confirm the business country.                                      |
| `APPLE_PAY_UNSUPPORTED_BROWSER`   | This browser cannot run Apple Pay. Call `isApplePayAvailable()` before rendering the button.                                                      |
| `APPLE_PAY_UNSUPPORTED_ACTION`    | This payment needs an additional step that cannot be shown inside the Apple Pay sheet. The payment was not completed; try another payment method. |
| `INVALID_COMPONENT_TYPE` (update) | Unknown component type. Supported: `'card_fields'`, `'apple_pay_button'`.                                                                         |

Style follows the existing actionable entries: state the failure, then what to do. All six
Apple Pay codes are reviewed together here, as phases 3 and 4 both promised.

---

## 11. File changes

| File                                              | Action | What                                                                                                                                                    |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/strategies/process-body.strategy.ts`    | Create | `buildProcessBody`, `scopeRequestId`, the two defaults (DD1, DD2)                                                                                       |
| `src/core/services/apple-pay-checkout.service.ts` | Create | Session lifecycle, validation round trip, D6 mapping (DD3–DD6)                                                                                          |
| `src/core/services/direct-api.service.ts`         | Modify | `ApplePayPaymentMethod` joins `ProcessPaymentBody['payment_method']` explicitly                                                                         |
| `src/models/transaction.model.ts`                 | Modify | `isSuccessfulStatus` (DD6)                                                                                                                              |
| `src/ports/apple-pay.port.ts`                     | Modify | `ApplePayAdapter` alias (DD10)                                                                                                                          |
| `src/tonder.ts`                                   | Modify | `create` branch, `mount`/`unmount`, `isApplePayAvailable`, `pay()` wrapper + guard, DI, delegation                                                      |
| `src/types/card.ts`                               | Modify | Three maps widened                                                                                                                                      |
| `src/types/customization.ts`                      | Modify | `apple_pay_button?` on `TonderCustomization`                                                                                                            |
| `src/shared/types/index.ts`                       | Modify | `payment?: PaymentEvents` on `TonderEvents`; `events` JSDoc; `PaymentEventSink` (internal — the DD7 emit surface, **not** exported from `src/index.ts`) |
| `src/shared/errors/messages.ts`                   | Modify | Three entries + `INVALID_COMPONENT_TYPE`                                                                                                                |
| `src/index.ts`                                    | Modify | Five exports                                                                                                                                            |
| `README.md`                                       | Modify | Plan §6 Phase 5 table                                                                                                                                   |

---

## 12. Work units — DD13

**Commits only. No pull requests.** Each unit is independently green on `npm run test`,
`npm run typecheck` and `npm run build`, with the lint error set identical to `main`. Strict
TDD applies throughout and genuinely bites: every unit but WU7 is runtime behavior over
injected ports.

**DD13 — seven units, refining the proposal's six.** The proposal's WU4 carried the
component, three maps, the customization key, three messages, the barrel exports _and_ the
adapter injection. Splitting the DI + `isApplePayAvailable()` out keeps every unit's diff
reviewable and gives a clean green state where availability is answerable but nothing is
mountable. That is not a D3 violation: `isApplePayAvailable()` ships with the complete runtime
it depends on.

| #   | Commit                                                                | Green state at the end                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `refactor: extract the /process body builder as a pure function`      | `pay()` delegates. **Zero behavior change** — the existing `pay()` suite is the regression test and is green before anything Apple Pay exists                                                                                                                                                        |
| 2   | `feat: fire instance-level payment events from pay()`                 | `events.payment` wired, `PaymentEvents` exported, the `PaymentEventSink` with its fire-time read and DD7 isolation, `pay()` as the wrapper over `runPay()`. Opt-in; the whole `pay()` suite passes unchanged with callbacks undefined. A throwing callback leaves `pay()` **resolved** (D4, D5, DD7) |
| 3   | `feat: add the Apple Pay checkout orchestration service`              | Service + local fakes. T1, T2, T4–T14 green. `ApplePayPaymentMethod` in the `/process` union. No facade importer                                                                                                                                                                                     |
| 4   | `feat: inject the Apple Pay adapter and expose isApplePayAvailable()` | Seventh positional param, `_createTonderWithDeps` key, the three-way composition. No component yet                                                                                                                                                                                                   |
| 5   | `feat: add the Apple Pay button component`                            | Three maps, `create`/`mount`/`unmount`, customization key, three messages, `INVALID_COMPONENT_TYPE` copy, barrel exports. T3 green; `e2e/support/fixtures.ts` compiles untouched                                                                                                                     |
| 6   | `feat: reject apple_pay as a pay() payment method`                    | D9's runtime guard                                                                                                                                                                                                                                                                                   |
| 7   | `docs: document Apple Pay in the README`                              | Plan §6 Phase 5 table                                                                                                                                                                                                                                                                                |

Rollback: reverse order. 7 and 6 are independent. 5 removes the only new public surface and
restores the old copy. 4 leaves an unused constructor parameter, harmless. 3's service has no
importer once 5 is gone. 2 is additive and opt-in. 1 is a pure refactor and can be left in.

---

## 13. Decision index

| ID   | Decision                                                                                                               | Realizes                       | Rejected alternative                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DD1  | `buildProcessBody` as a pure function over `payment`/`paymentMethod`/`customer`/resolved `currency`/`presentationMode` | D3                             | copy it (two bodies drift on the next `PayInput` field); default `currency` inside (two defaults, sheet and charge disagree)                                                                                                                                       |
| DD2  | `buildProcessRequestId` moves too, as `scopeRequestId`                                                                 | D3                             | leave it private — the button would accept `idempotency_key` and ignore it                                                                                                                                                                                         |
| DD3  | One checkout service per button component                                                                              | D8, D10, Q3                    | one per `Tonder` — button B's `unmount()` aborts button A's sheet                                                                                                                                                                                                  |
| DD4  | `start()` is non-async; gate-proved values are arguments, live values are deps                                         | D1                             | `async start()` (an `await` becomes legal); reading `countryCode` live (re-narrowing, i.e. re-validation)                                                                                                                                                          |
| DD5  | `completePayment` before every emit, on every path including the throw path                                            | D2                             | callback first — the merchant navigates with the sheet open                                                                                                                                                                                                        |
| DD6  | One exported `isSuccessfulStatus` predicate                                                                            | D6                             | inline the two literals twice                                                                                                                                                                                                                                      |
| DD7  | One `PaymentEventSink` in the facade: fire-time read, callback isolated by `try`/`catch`, reported via `console.warn`  | D4, D5                         | snapshot at construction (a config mutated later is ignored); **invoke unwrapped like `events.presentation`** — a throwing `on_success` rejects a `pay()` that succeeded, and the merchant's retry is a second charge; swallow silently (hides the merchant's bug) |
| DD8  | `pay()` is a thin wrapper over `runPay()`                                                                              | D5                             | emits at each of the four return points                                                                                                                                                                                                                            |
| DD9  | `mount()` gate in D7's order, capturing the narrowed `countryCode`/`merchantName`                                      | D7                             | `mount()` calls `isApplePayAvailable()` — one code instead of four                                                                                                                                                                                                 |
| DD10 | Seventh positional param typed `ApplePayPort & ApplePayButtonPort`                                                     | Q6                             | two params for one adapter; an options-object migration                                                                                                                                                                                                            |
| DD11 | T1/T2 assert against a microtask sentinel queued before the click                                                      | D1                             | `expect(createSession).toHaveBeenCalled()` — green after any later `await` is added                                                                                                                                                                                |
| DD12 | No `expect.objectContaining` in this change                                                                            | phase-4 precedent              | it passes with extra keys, exactly how the empty-body assertion nearly shipped wrong                                                                                                                                                                               |
| DD13 | Seven work units                                                                                                       | proposal §Work units           | the proposal's six — WU4 was three reviewable diffs in one                                                                                                                                                                                                         |
| DD14 | S1–S10 restated as open; T1 named a proxy                                                                              | proposal §Verification reality | letting a synchrony assertion read as gesture coverage                                                                                                                                                                                                             |

## 14. Forward findings — out of scope here, owed a ticket

| Finding                                                                                                                                                                                                                                                                                               | Why not fixed here                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`events.presentation` callbacks are invoked unwrapped** (`src/tonder.ts:462,519-520`, and via `ThreeDsHostOptions.onOpen` / `onUserClose`). It carries the identical exposure DD7 closes for `events.payment`: a throwing `on_open` / `on_close` propagates into the 3DS and APM presentation paths | Fixing it means touching embedded 3DS, APM/SPEI modal and redirect presentation — a regression surface with nothing to do with Apple Pay. Its own change, its own tests. **Until then the two patterns differ deliberately**: §4 says so at the point of divergence so nobody aligns the new one back to the old one |
| `console.warn` is this codebase's only non-fatal channel, and it exists in exactly one adapter (`skyflow.adapter.ts`). DD7 makes the facade its second user                                                                                                                                           | A real diagnostics surface (a `logger` port, an `on_warning` event) is a design question with a public-API dimension. This change reuses what exists rather than inventing a mechanism inside a feature commit                                                                                                       |

## Open questions

None. The proposal's six-question round resolved all of them, and every ruling is realized
above.

## Next step

`sdd-tasks` — decompose WU1–WU7 into TDD steps once the spec delta is written.
