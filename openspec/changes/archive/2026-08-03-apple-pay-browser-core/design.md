# Design: Apple Pay Browser Core (Phase 3)

Three new files and one modified map. A type-only port, a pure strategy module, and the
one adapter allowed to touch `window.ApplePaySession` and button DOM. Nothing is exported,
nothing is wired, no merchant can reach any of it.

The whole design is driven by one question: **can Phase 5's required test list be written
against a fake?** Section 3 answers it row by row. Everything else follows from that answer.

Decisions here are labelled `DD1…DD10`. The proposal's decisions are `D1…D5` and stay
binding; every cross-reference is explicit.

---

## Quick path

1. `src/ports/apple-pay.port.ts` — type-only. Two port interfaces, one session handle, one
   handler bag, four type aliases that confine `ApplePayJS.*` to this single module.
2. `src/core/strategies/apple-pay.strategy.ts` — `buildApplePayPaymentRequest`,
   `buildApplePayPaymentMethod`. Pure. No DOM, no globals, no network.
3. `src/adapters/browser/apple-pay.adapter.ts` — implements both ports. The only DOM/global
   consumer. Throws `AppError(APPLE_PAY_SESSION_ERROR)` and
   `AppError(APPLE_PAY_CONTAINER_NOT_FOUND)`.
4. `src/shared/errors/messages.ts` — exactly two new `MESSAGES_EN` entries, each shipping in
   the commit that first throws its code.

Verify: `npm run test` · `npm run typecheck` · `npm run build`, plus an unchanged lint error
set.

---

## 1. Architecture

### Layering

```
core/strategies/apple-pay.strategy.ts   PURE. imports: models/, shared/, ports/ (type-only)
        │
        │ produces ApplePayPaymentRequest
        ▼
ports/apple-pay.port.ts                 TYPE-ONLY. The ONLY module naming ApplePayJS.*
        ▲
        │ implements
        │
adapters/browser/apple-pay.adapter.ts   window.* + DOM + AppError. Nothing else imports it.
```

`core/` importing from `ports/` is the standard hexagonal direction and is already how
`direct-api.service.ts` consumes `HttpPort`. The imports are `import type` and erase at
build, so `core/` stays runtime-pure.

### What Phase 3 deliberately does not build

No component, no facade branch, no service, no DI wiring. The adapter is instantiated by
nothing but its own test. That is the point: this change ships the pieces, Phase 5 assembles
them.

---

## 2. The port

### 2.1 Type aliases — DD1

`@types/applepayjs` declares an ambient global `ApplePayJS` namespace (plus the global
classes `ApplePaySession` and `ApplePayError`). Ambient means any module can name it with no
import, which makes "keep Apple's types confined" unenforceable by the module graph alone.

**DD1 — `apple-pay.port.ts` is the only module in `src/` allowed to write the identifier
`ApplePayJS`. Everything else consumes re-exported aliases from it.**

```ts
/** Apple's request object. Alias so `ApplePayJS` is named in exactly one module. */
export type ApplePayPaymentRequest = ApplePayJS.ApplePayPaymentRequest;

/** Apple's `merchantCapabilities` literal union. Needed for the phase-2 narrowing. */
export type ApplePayMerchantCapability = ApplePayJS.ApplePayMerchantCapability;

/** The opaque `PKPaymentToken`. Forwarded to `/process` verbatim; never inspected. */
export type ApplePayPaymentToken = ApplePayJS.ApplePayPaymentToken;
```

Why aliases rather than hand-rolled mirrors: the request object is Apple's contract, not
ours. Re-declaring it would be a duplicated interface (an explicit binding constraint) and
would silently drift from the `.d.ts` that the constructor is actually type-checked against.

This makes proposal **D5** mechanical instead of aspirational: an eslint `no-restricted-syntax`
rule or a plain grep for `ApplePayJS` outside `apple-pay.port.ts` is now a complete check.
Phase 5 inherits it as the guard against exporting an Apple-typed surface.

`ApplePayPaymentAuthorizationResult` is deliberately **not** aliased — see DD3.

### 2.2 The handler bag — DD2

Handlers are constructor arguments to `createSession`, per proposal D-question 3. Apple's
event objects never cross the boundary.

```ts
/**
 * Normalized session callbacks. Handed to `createSession` so the gesture chain
 * (plan §1.2) is a type-level guarantee, not a convention a future author must
 * remember. Apple's event objects are unwrapped by the adapter and never reach core.
 *
 * camelCase: internal port, matching `ThreeDsHostOptions.onOpen` / `onUserClose`.
 * The snake_case rule binds merchant-facing surfaces; none of this is one.
 */
export interface ApplePaySessionHandlers {
  /**
   * Apple is showing the sheet and wants a merchant session.
   *
   * NO ARGUMENT. `event.validationURL` is deliberately unread (plan §4.2 — letting
   * the browser choose where a certificate-bearing backend connects is an SSRF
   * surface, and Apple's current guidance is a static hostname). A port that passed
   * it through would invite Phase 5 to forward it.
   */
  onValidateMerchant(): void | Promise<void>;

  /** The shopper authenticated. Receives ONLY the opaque token. */
  onPaymentAuthorized(token: ApplePayPaymentToken): void | Promise<void>;

  /** The sheet was dismissed without authorizing. Carries no data. */
  onCancel(): void | Promise<void>;
}
```

**DD2 — handlers return `void | Promise<void>`, and the adapter discards the return value
with the `void` operator.**

The adapter cannot await them — Apple's callbacks are fire-and-forget, and awaiting would
buy nothing. But Phase 5's implementations _are_ async (they call `validate-merchant` and
`/process`), and a test that drives the flow needs a join point. Returning the promise gives
the fake one:

```ts
await fake.validateMerchant(); // resolves when Phase 5's handler settles
expect(handle.completeMerchantValidation).toHaveBeenCalledWith(
  MERCHANT_SESSION,
);
```

The alternative — `void`-returning handlers plus `await Promise.resolve()` microtask
flushing in every test — is the brittleness this design exists to avoid. Two flushes today,
three after someone adds an `await`, and the test fails for a reason unrelated to the
behavior under test.

Inside the adapter: `session.onvalidatemerchant = () => { void handlers.onValidateMerchant(); };`
The explicit `void` operator satisfies `no-floating-promises` and records the intent.

### 2.3 The session handle — DD3, DD4

```ts
/** Result the SDK reports back to the sheet. See DD3. */
export interface ApplePayCompletion {
  /** OUR token, not Apple's numeric constant. The adapter maps it. */
  status: 'success' | 'failure';
  /**
   * Custom sheet errors. Declared here so the §4.4 mapping has somewhere to put
   * them; NOTHING in this change populates it. Phase 5 decides — see §7.
   */
  errors?: readonly ApplePayCompletionError[];
}

export interface ApplePayCompletionError {
  /** Apple `ApplePayErrorCode`. */
  code: 'unknown';
  message: string;
}

/** What the caller can do once the session exists. */
export interface ApplePaySessionHandle {
  /** Present the sheet and start merchant validation. Apple: `begin()`. */
  begin(): void;
  /** Hand Apple the opaque merchant session. Apple: `completeMerchantValidation()`. */
  completeMerchantValidation(merchantSession: unknown): void;
  /** Settle the authorization. Apple: `completePayment({ status, errors })`. */
  completePayment(completion: ApplePayCompletion): void;
  /** Dismiss the sheet without completing. Apple: `abort()`. */
  abort(): void;
}
```

**DD3 — `completePayment` takes `'success' | 'failure'`, not Apple's numeric status.**

`STATUS_SUCCESS` and `STATUS_FAILURE` are `static readonly ... : number` on the global
`ApplePaySession` class. Reading them is touching the global — which `core/` may not do. So
the choice is: leak the global into the orchestration service, hardcode Apple's numeric
values (fragile, undocumented), or normalize at the port.

Normalizing wins on all three counts:

|                | Numeric constants in core                   | `'success' \| 'failure'` at the port          |
| -------------- | ------------------------------------------- | --------------------------------------------- |
| `core/` purity | broken — reads `globalThis.ApplePaySession` | intact                                        |
| Phase 5 fake   | must invent `STATUS_SUCCESS = 0`            | none needed                                   |
| §4.4 assertion | `toHaveBeenCalledWith({ status: 0 })`       | `toHaveBeenCalledWith({ status: 'failure' })` |

The adapter reads the real statics off the same constructor it used to build the session and
calls `session.completePayment({ status: Ctor.STATUS_SUCCESS, errors })` — the v3 object
form, never the bare number, per the binding constraint. This is not an unnecessary
abstraction; it is the only way `core/` can express the outcome without importing a browser
global.

`merchantSession: unknown` — the SDK is a courier (plan §2). It never parses Apple's opaque
blob, so `unknown` is the honest type. `any` would let a future author read a field off it.

**DD4 — `begin()` stays on the handle; `createSession` does not call it.**

The proposal's port sketch lists `begin` explicitly, so this is binding. It also earns its
place: the §2 flow is construct → wire → `begin()`, and a test that cannot observe `begin`
cannot prove the sheet was presented, nor that it was presented _after_ wiring.

The rejected alternative (auto-`begin` inside `createSession`) would remove one way Phase 5
can break the flow, but at the cost of making "the sheet opened" unassertable. The
protection is moved to a Phase 5 test instead: `begin` must be called in the same tick as
`createSession`, no `await` between them.

### 2.4 The two ports

```ts
export interface ApplePayPort {
  /**
   * Whether this browser can run an Apple Pay session at all.
   *
   * BROWSER-ONLY (proposal D2): `globalThis.ApplePaySession` present,
   * `supportsVersion(3)`, `canMakePayments()`. No catalog, no country_code —
   * those are the other half of the composition, and this half must stay
   * testable without a business fixture.
   *
   * Returns a plain boolean and NEVER throws. Apple Pay being absent is a state.
   */
  canUseApplePay(): boolean;

  /**
   * Create and wire an Apple Pay session. SYNCHRONOUS — it must be reachable
   * from a click listener with no `await` before it (plan §1.2).
   *
   * @throws AppError(APPLE_PAY_SESSION_ERROR) when Apple's constructor rejects.
   */
  createSession(
    request: ApplePayPaymentRequest,
    handlers: ApplePaySessionHandlers,
  ): ApplePaySessionHandle;
}
```

The Apple Pay JS **version is not a parameter**. It is a constant inside the adapter
(`APPLE_PAY_JS_VERSION = 3`), because which version of Apple's API we speak is a property of
our Apple integration, not a decision core is entitled to make. `canUseApplePay` and
`createSession` therefore cannot disagree about it.

```ts
export type ApplePayButtonDisposer = () => void;

export interface ApplePayButtonRenderOptions {
  /** CSS selector for the merchant container, e.g. '#tonder-apple-pay-button'. */
  containerId: string;
  /**
   * Styles to apply. Phase 5 sources this from `customization.apple_pay_button`;
   * in this change only tests pass it. See DD6.
   */
  customization?: ApplePayButtonCustomization;
  /**
   * Invoked on click. The listener is owned by the adapter so the gesture chain
   * never crosses a merchant-visible callback layer.
   */
  onClick(): void;
}

export interface ApplePayButtonPort {
  /**
   * Render the button into the container and attach the click listener.
   *
   * @returns a disposer removing BOTH the nodes and the listener. Idempotent.
   * @throws AppError(APPLE_PAY_CONTAINER_NOT_FOUND) when the selector matches nothing.
   */
  render(options: ApplePayButtonRenderOptions): ApplePayButtonDisposer;
}
```

`containerId` is camelCase while the merchant-facing `ApplePayButtonOptions.container_id`
(phase 1) is snake_case. That is the convention working, not a slip: snake_case binds the
merchant surface, and Phase 5's facade performs the one translation at the one boundary
where translation belongs.

### 2.5 What the port deliberately omits

`onpaymentmethodselected`, `onshippingcontactselected`, `onshippingmethodselected`,
`oncouponcodechanged`, `openPaymentSetup`, `applePayCapabilities`. The SDK charges a fixed
total with no shipping, no coupons and no line items; every one of these would be a surface
with no consumer. They are additive later — none of them changes the shape of what is here.

---

## 3. Designed backwards from Phase 5 — the load-bearing check

Plan §6 Phase 5 lists the required tests. Each row below names the port affordance it
depends on and the exact fake observation. **A row with no affordance is a port defect.**

| #   | Phase 5 test (plan §6)                                                                    | Port affordance                                                                                                                                                                                                    | Fake observation                                                                                                             |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| T1  | `createSession` invoked **synchronously** inside the click listener, before any microtask | `ApplePayButtonPort.render({ onClick })` exposes the listener; `createSession` returns a handle, not a promise                                                                                                     | call `fake_button.click()` (sync), then assert `port.createSession` was called **before** the first `await` in the test body |
| T2  | `begin()` runs in the same tick as `createSession` (DD4's replacement guard)              | `handle.begin`                                                                                                                                                                                                     | `handle.begin.mock.invocationCallOrder[0]` immediately follows `createSession`'s, with no intervening tick                   |
| T3  | Four `mount()` failures, each with its own code                                           | `canUseApplePay(): boolean` → `APPLE_PAY_UNSUPPORTED_BROWSER`; catalog gate (phase 2) → `APPLE_PAY_NOT_ENABLED`; `render()` throwing → `APPLE_PAY_CONTAINER_NOT_FOUND`; facade `assertReady()` → `NOT_INITIALIZED` | fake returns `false` / fake `render` throws the `AppError`                                                                   |
| T4  | §4.4 row 1 — success                                                                      | `handle.completePayment`                                                                                                                                                                                           | `toHaveBeenCalledWith({ status: 'success' })`                                                                                |
| T5  | §4.4 row 2 — decline (HTTP 200)                                                           | same                                                                                                                                                                                                               | `toHaveBeenCalledWith({ status: 'failure', errors: … })` **and** `on_success(transaction)` still fires                       |
| T6  | §4.4 row 3 — throw / network failure                                                      | same                                                                                                                                                                                                               | `{ status: 'failure' }` + `on_error(AppError)`                                                                               |
| T7  | §4.4 row 4 — unexpected `next_action`                                                     | same                                                                                                                                                                                                               | `{ status: 'failure' }` + `on_error(APPLE_PAY_UNSUPPORTED_ACTION)`                                                           |
| T8  | `completePayment` runs **before** the merchant callback                                   | both are `vi.fn()`                                                                                                                                                                                                 | compare `mock.invocationCallOrder`                                                                                           |
| T9  | `unmount()` during a live session aborts it                                               | `handle.abort`                                                                                                                                                                                                     | `expect(handle.abort).toHaveBeenCalled()`                                                                                    |
| T10 | `oncancel` fires `on_cancel` and never `on_error`                                         | `handlers.onCancel` captured by the fake                                                                                                                                                                           | `await fake.cancel()`, then assert both callbacks                                                                            |
| T11 | Merchant validation success round trip                                                    | `handlers.onValidateMerchant()` returns a promise (DD2); `handle.completeMerchantValidation`                                                                                                                       | `await fake.validateMerchant()`, then assert the handle call carries the backend's opaque blob                               |
| T12 | Merchant validation failure → `abort()` + `on_error(APPLE_PAY_VALIDATION_ERROR)`          | `handle.abort` + the same promise                                                                                                                                                                                  | same, with a rejecting fake `HttpPort`                                                                                       |
| T13 | Authorization forwards the token verbatim to `/process`                                   | `handlers.onPaymentAuthorized(token)` — token only                                                                                                                                                                 | `await fake.authorize(TOKEN_FIXTURE)`, assert the `/process` body's `payment_method.token` is reference-equal to the fixture |
| T14 | `unmount()` removes the button and its listener                                           | `render` returns a disposer                                                                                                                                                                                        | `expect(fake.dispose).toHaveBeenCalled()`                                                                                    |
| T15 | `events.payment` read at fire time                                                        | —                                                                                                                                                                                                                  | not a port concern (facade config reading)                                                                                   |
| T16 | `pay()` also fires `events.payment`; unchanged when undefined                             | —                                                                                                                                                                                                                  | not a port concern                                                                                                           |
| T17 | No regression across card / saved_card / APM / SPEI / 3DS                                 | —                                                                                                                                                                                                                  | not a port concern                                                                                                           |

**Every behavioral row resolves.** Rows T15–T17 are facade concerns the port has no business
in. No Phase 5 assertion requires an affordance this port lacks, and no affordance in the
port lacks a Phase 5 consumer — the port is neither short nor speculative.

Two affordances exist _only_ because of this table: DD2's promise return (T11, T12, T13) and
DD4's `begin` (T2). Both would have looked like over-design without it.

---

## 4. The fake, as it appears in a test file — DD5

**DD5 — the fake is a local factory inside `*.test.ts`. Nothing under `src/` exists only for
testing.**

The original backend docs proposed a `MockApplePaySessionAdapter` under `src/adapters/`.
That module would be compiled, bundled and shipped to every merchant, and would appear in
the public `.d.ts` if anything ever re-exported it. Plan §5.1 already forbids it. This design
records the concrete shape so nobody reaches for the shipped-module version.

```ts
// src/core/services/apple-pay-checkout.service.test.ts  — Phase 5
// A LOCAL factory. Never a module under src/. Never imported by shipped code.

function createFakeApplePayPort(options: { available?: boolean } = {}) {
  const handle: ApplePaySessionHandle = {
    begin: vi.fn(),
    completeMerchantValidation: vi.fn(),
    completePayment: vi.fn(),
    abort: vi.fn(),
  };

  let handlers: ApplePaySessionHandlers | undefined;
  let request: ApplePayPaymentRequest | undefined;

  const port: ApplePayPort = {
    canUseApplePay: () => options.available ?? true,
    createSession: vi.fn((req, h) => {
      request = req;
      handlers = h;
      return handle;
    }),
  };

  return {
    port,
    handle,
    /** The request Phase 5 built. Assert countryCode / total.amount / capabilities here. */
    get request() {
      return request;
    },
    // Drive the flow exactly as Apple would. Each returns a promise that settles
    // when Phase 5's handler settles — that is DD2 paying for itself.
    validateMerchant: () => Promise.resolve(handlers?.onValidateMerchant()),
    authorize: (token: ApplePayPaymentToken) =>
      Promise.resolve(handlers?.onPaymentAuthorized(token)),
    cancel: () => Promise.resolve(handlers?.onCancel()),
  };
}

function createFakeApplePayButtonPort() {
  const dispose = vi.fn();
  let onClick: (() => void) | undefined;

  const port: ApplePayButtonPort = {
    render: vi.fn((opts) => {
      onClick = opts.onClick;
      return dispose;
    }),
  };

  // SYNCHRONOUS on purpose: T1 asserts createSession happened before any microtask,
  // so the click must not be wrapped in a promise.
  return { port, dispose, click: () => onClick?.() };
}
```

`Promise.resolve(x)` accepts both branches of `void | Promise<void>`, so the fake awaits
correctly whether Phase 5's handler is sync or async.

### Phase 3's own adapter test needs a different fake

The adapter test fakes the **global**, not the port:

```ts
// src/adapters/browser/apple-pay.adapter.test.ts — Phase 3, also local to the file
class FakeApplePaySession {
  static readonly STATUS_SUCCESS = 0; // required by DD3's mapping
  static readonly STATUS_FAILURE = 1;
  static supportsVersion = vi.fn(() => true);
  static canMakePayments = vi.fn(() => true);
  onvalidatemerchant?: (e: unknown) => void;
  onpaymentauthorized?: (e: { payment: { token: unknown } }) => void;
  oncancel?: () => void;
  begin = vi.fn();
  completeMerchantValidation = vi.fn();
  completePayment = vi.fn();
  abort = vi.fn();
  constructor(
    readonly version: number,
    readonly request: unknown,
  ) {}
}
// installed/removed per test via `vi.stubGlobal('ApplePaySession', FakeApplePaySession)`
```

The static `STATUS_*` members are the visible cost of DD3, paid once, in one file.

---

## 5. The adapter

### 5.1 Global access — DD6

**DD6 — the adapter reaches the global through `globalThis`, never the bare `ApplePaySession`
identifier and never `window`.**

`@types/applepayjs` declares `ApplePaySession` as a `declare class`, so writing
`ApplePaySession.canMakePayments()` type-checks and then throws `ReferenceError` in Node.
`window` fails the same way under SSR. `globalThis` is defined everywhere.

```ts
const APPLE_PAY_JS_VERSION = 3;

type ApplePaySessionCtor = typeof ApplePaySession;

function getApplePaySessionCtor(): ApplePaySessionCtor | undefined {
  return (globalThis as { ApplePaySession?: ApplePaySessionCtor })
    .ApplePaySession;
}
```

### 5.2 `canUseApplePay()`

```ts
public canUseApplePay(): boolean {
  const Ctor = getApplePaySessionCtor();
  if (!Ctor) return false;
  try {
    return Ctor.supportsVersion(APPLE_PAY_JS_VERSION) && Ctor.canMakePayments();
  } catch {
    // Not defensive coding against our own inputs: `globalThis.ApplePaySession`
    // is FOREIGN code — an extension or polyfill can define a broken one. The
    // contract is "returns a boolean, never throws"; absence is a state.
    return false;
  }
}
```

The `try/catch` is not dead code — it has its own test (a fake whose `supportsVersion`
throws returns `false`). The "no unnecessary validation" constraint targets re-validating
our own data; this is a boundary against a global we do not own.

`APPLE_PAY_UNSUPPORTED_BROWSER` is **not** thrown here (proposal D2). It belongs to Phase 5's
`mount()` gate, which raises it when this boolean is `false`.

### 5.3 `createSession()`

```ts
public createSession(
  request: ApplePayPaymentRequest,
  handlers: ApplePaySessionHandlers,
): ApplePaySessionHandle {
  const Ctor = getApplePaySessionCtor();
  let session: ApplePaySession;
  try {
    if (!Ctor) throw new Error('ApplePaySession is not available in this browser');
    session = new Ctor(APPLE_PAY_JS_VERSION, request);
  } catch (error) {
    // Apple throws for: insecure page, invalid request, outside a gesture handler
    // (ApplePaySession.md:257-261). All three are one code to the merchant, with
    // the original preserved for debugging.
    throw new AppError({
      errorCode: ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
      originalError: error,
    });
  }

  // Same tick as the constructor. No await anywhere in this method — plan §1.2.
  session.onvalidatemerchant = () => {
    void handlers.onValidateMerchant();
  };
  session.onpaymentauthorized = (event) => {
    void handlers.onPaymentAuthorized(event.payment.token);
  };
  session.oncancel = () => {
    void handlers.onCancel();
  };

  return {
    begin: () => session.begin(),
    completeMerchantValidation: (merchantSession) =>
      session.completeMerchantValidation(merchantSession),
    completePayment: (completion) =>
      session.completePayment({
        status:
          completion.status === 'success' ? Ctor.STATUS_SUCCESS : Ctor.STATUS_FAILURE,
        ...(completion.errors ? { errors: [...completion.errors] } : {}),
      }),
    abort: () => session.abort(),
  };
}
```

The missing-constructor branch is unreachable behind Phase 5's `mount()` gate (proposal D2)
but is still handled, because letting a raw `TypeError: Ctor is not a constructor` escape a
port method is strictly worse than reporting the code the merchant can look up.

`errors` is spread only when present — the object form always carries `status`, per the
v3 constraint. Nothing in this change populates `errors`; see §7.

### 5.4 `render()` — DD7, DD8

**DD7 — styles are applied through an injected `<style>` element and a class, not inline
`style.setProperty`.**

This is not a preference. jsdom's CSS engine drops declarations whose property it does not
recognize, and `-apple-pay-button-type` / `-apple-pay-button-style` are exactly that. An
inline-style implementation would produce a button whose customization test asserts
`getPropertyValue('-apple-pay-button-type') === ''` — a green test proving nothing, which is
the failure mode the proposal's risk table names.

A `<style>` element's `textContent` is a string. jsdom cannot drop a string. The test asserts
the CSS text the adapter emitted, and can state honestly that it proves _what we wrote_, not
_what WebKit renders_.

It also follows the existing in-repo precedent: `Browser3dsHost.buildStyle()` builds its CSS
the same way.

No shadow root. `Browser3dsHost` uses one to isolate a modal from merchant CSS, but whether
`-webkit-appearance: -apple-pay-button` renders inside a shadow tree is an unverified WebKit
behavior — adopting it here would add a Safari-only unknown for no benefit at this stage.

**DD8 — the button element is a `<button type="button">`, not Apple's `<div>`.**

Apple's sample markup uses a `<div>`. A `<button>` is keyboard-activatable, and a keyboard
activation dispatches a real `click` that still counts as a user gesture — so the gesture
chain is preserved while the button stops being invisible to assistive technology. WebKit's
`-apple-pay-button` appearance applies to either.

```ts
const BUTTON_CLASS = 'tonder-apple-pay-button';
const DEFAULT_TYPE = 'buy';
const DEFAULT_STYLE = 'black';

public render(options: ApplePayButtonRenderOptions): ApplePayButtonDisposer {
  const container = document.querySelector(options.containerId);
  if (!container) {
    throw new AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND });
  }

  const style = document.createElement('style');
  style.textContent = buildButtonCss(options.customization);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.setAttribute('aria-label', 'Apple Pay');

  const onClick = (): void => options.onClick();
  button.addEventListener('click', onClick);

  container.append(style, button);

  let disposed = false;
  return () => {
    if (disposed) return;   // second call is a no-op
    disposed = true;
    button.removeEventListener('click', onClick);
    button.remove();
    style.remove();
  };
}
```

`buildButtonCss` is a private pure function mapping `ApplePayButtonCustomization` onto the
WebKit properties phase 1 already documented:

| Customization field | CSS property               | Default when absent |
| ------------------- | -------------------------- | ------------------- |
| `type`              | `-apple-pay-button-type`   | `buy`               |
| `style`             | `-apple-pay-button-style`  | `black`             |
| `locale`            | `-apple-pay-button-locale` | omitted             |
| `height`            | `height`                   | omitted             |
| `border_radius`     | `border-radius`            | omitted             |

`-webkit-appearance: -apple-pay-button` is emitted unconditionally, along with
`display: inline-block; cursor: pointer; border: 0;`.

**One button per container is assumed.** Two `render()` calls into the same container would
produce two identical style nodes and two buttons; nothing in the SDK does that, and the
disposer removes only its own nodes. Recorded rather than defended against.

### 5.5 How customization actually arrives — DD9

**DD9 — customization is a `render()` argument that exists today; only its source is
deferred.**

This answers the question proposal **D1** leaves open. D1 says `TonderCustomization` gains no
`apple_pay_button` key in this change, because a key accepted and silently ignored is exactly
the failure inherited D3 exists to prevent. So where does the adapter get styles?

|                                             | Phase 3 (this change)              | Phase 5                                   |
| ------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `ApplePayButtonRenderOptions.customization` | exists, typed, consumed            | unchanged                                 |
| Who passes it                               | the adapter's own test, explicitly | the facade                                |
| Source of the value                         | none — no production caller exists | `config.customization.apple_pay_button`   |
| `TonderCustomization.apple_pay_button`      | absent                             | added, exported, wired in the same commit |

The parameter is not a placeholder for a future parameter — it is the real parameter, fully
implemented and fully tested, wired to nothing. When it is `undefined`, the adapter emits the
documented defaults (`buy` / `black`), which is also what Phase 5 will get from a merchant who
sets no customization. There is no behavioral gap to close later, only a config read to add.

Plan §3.3 assigned this wiring to "the phase whose adapter applies them". Proposal D1
corrects that wording to "the phase where the styles actually reach the DOM", which is
Phase 5. DD9 is what that correction looks like in code.

### 5.6 Error handling summary

| Situation                                    | Behavior                                                     | Code                            |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `globalThis.ApplePaySession` undefined       | `canUseApplePay()` → `false`                                 | none — a state, not a failure   |
| `supportsVersion` / `canMakePayments` throws | `canUseApplePay()` → `false`                                 | none                            |
| Apple's constructor throws                   | `createSession` throws `AppError`, `originalError` preserved | `APPLE_PAY_SESSION_ERROR`       |
| Constructor absent at `createSession`        | same                                                         | `APPLE_PAY_SESSION_ERROR`       |
| `containerId` matches nothing                | `render` throws `AppError`                                   | `APPLE_PAY_CONTAINER_NOT_FOUND` |

This follows the majority convention (proposal D3): six of seven adapters import
`ErrorKeyEnum` and throw. `browser-3ds-host.adapter.ts` is the outlier precisely because it
is pure DOM manipulation with no failure mode worth reporting. This adapter has two.

### 5.7 The two `MESSAGES_EN` entries

Plan §5.2's forward constraint: the phase that first throws a code owns its message. This
change throws two, so it adds two — and only two. The other four keep falling back to the
`UNKNOWN_ERROR` copy until Phase 4 and Phase 5 throw them.

```ts
[ErrorKeyEnum.APPLE_PAY_SESSION_ERROR]:
  'Could not start the Apple Pay session. The page must be served over HTTPS from a domain registered with Apple, and the amount must be greater than zero.',
[ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND]:
  'Apple Pay button container not found. Add an element matching `container_id` to the page before mounting.',
```

Style matches the existing actionable entries (`SECURE_TOKEN_REQUIRED`, `MISSING_CUSTOMER`,
`MOUNT_COLLECT_ERROR`): state the failure, then what to do. Phase 5 reviews all six together
when it adds the remaining four.

---

## 6. The strategy — DD10

Two pure functions, no mocks in their tests, no DOM, no globals, no network.

### 6.1 `buildApplePayPaymentMethod`

```ts
/**
 * The `/process` `payment_method` block for an Apple Pay charge.
 *
 * NOT `ApplePayJS.ApplePayPaymentMethod` — Apple's type of that name is the card
 * DISPLAY info (`displayName` / `network` / `type`) nested inside the token. This
 * is our wire block, sibling to `CardPaymentMethod` and `ApmPaymentMethod`.
 *
 * LOCAL: it is not a member of the public `PayInput` / `PaymentMethod` union.
 * Phase 5 adds it to `ProcessPaymentBody['payment_method']`.
 */
export interface ApplePayPaymentMethod {
  /** Uppercase, matching `CardPaymentMethod.type = 'CARD'`. */
  type: 'APPLE_PAY';
  /** `event.payment.token` VERBATIM — the whole PKPaymentToken as an object,
   *  never `JSON.stringify`. The SDK does not decide which parts the backend needs
   *  (plan §4.3). */
  token: ApplePayPaymentToken;
}

export function buildApplePayPaymentMethod(
  token: ApplePayPaymentToken,
): ApplePayPaymentMethod {
  return { type: 'APPLE_PAY', token };
}
```

Note that `ProcessPaymentBody['payment_method']` already includes `ApmPaymentMethod`, whose
`type: string` makes this shape structurally assignable _today_. Phase 5 must still add the
member explicitly — relying on the accidental structural match would make the union a lie.

#### The public `PaymentMethod` union is deliberately unchanged — and that is not the guard

`PayInput.payment_method` is `PaymentMethod` (`src/shared/types/index.ts:121-124`), whose
third member is a catch-all:

```ts
| { type: string; config?: Record<string, unknown> };
```

That member swallows any string literal, so **`pay({ payment_method: { type: 'apple_pay' } })`
type-checks today** and will continue to. This change adds nothing to the union and removes
nothing from it.

The consequence is worse than a missing compile error. Without a runtime guard, that call is
not merely uncaught — it is treated as a **generic APM** and sent to `/process` as
`{ type: 'apple_pay' }`. The merchant gets a confusing backend rejection instead of "Apple Pay
is a component, not a `pay()` method".

**So the rejection is a runtime `AppError`, and it belongs to Phase 5** (plan §1.2), not to a
type. It is not DX polish — it is what stops a malformed charge attempt from reaching the API.
Phase 3 must not attempt it: `pay()` is a facade method, and this change touches no facade.

Recorded here because the proposal's success criteria previously asserted the opposite
("still does not type-check"); that criterion is being corrected in the proposal.

### 6.2 `buildApplePayPaymentRequest`

```ts
export interface BuildApplePayPaymentRequestInput {
  /** Same NUMBER `/process` and `PayInput.amount` carry. See DD10. */
  amount: number;
  /** ISO 4217, ALREADY RESOLVED by the caller. Required, not defaulted here. */
  currencyCode: string;
  /** `business.country_code`. REQUIRED — see below. */
  countryCode: string;
  /** Sheet label. `business.name`. */
  merchantName: string;
  /** The raw cached catalog. Networks and capabilities are derived HERE. */
  catalog: readonly BackendPaymentMethod[] | null;
}

export function buildApplePayPaymentRequest(
  input: BuildApplePayPaymentRequestInput,
): ApplePayPaymentRequest;
```

Four shaping decisions, each with a reason:

**Derivation happens inside, not at the call site.** The builder calls phase 2's
`resolveApplePayNetworks` and `resolveApplePayMerchantCapabilities` itself, giving them their
first consumer. A caller cannot forget them and cannot recompute them differently — which is
the success criterion "come from Phase 2's helpers, not recomputed", enforced by construction
rather than by review.

**`countryCode` and `merchantName` are required, not optional.** `BusinessProfile.country_code`
is `string | undefined`, but Phase 5's `mount()` gate already rejects a business without one
as `APPLE_PAY_NOT_ENABLED` (plan §5.2). Typing it `string` here pushes the narrowing to that
gate as a compile error and keeps the builder free of a re-validation the constraint list
forbids.

**`currencyCode` is required, not defaulted.** The facade already resolves
`input.currency ?? DEFAULT_CURRENCY` for the `/process` body. Defaulting again here would
create two independent defaults that can drift, so the sheet and the charge could disagree
about the currency. Passing the same resolved value makes that impossible.

**`merchantCapabilities` needs a narrowing assertion.** Phase 2's helper returns `string[]`
(deliberately — `supported_networks` arrives off the wire untyped), while Apple's type is
`ApplePayMerchantCapability[]`. This module owns the narrowing, as phase 2's own doc comment
anticipated. `supportedNetworks` is already `string[]` in Apple's `.d.ts` and needs nothing.

```ts
const capabilities = resolveApplePayMerchantCapabilities(input.catalog);

return {
  countryCode: input.countryCode,
  currencyCode: input.currencyCode,
  supportedNetworks: resolveApplePayNetworks(input.catalog),
  // `supports3DS` means EMV CRYPTOGRAM support, NOT 3-D Secure. The names collide,
  // the meanings do not. It is MANDATORY on every Apple Pay request — omit it and
  // the ApplePaySession constructor throws. Do NOT delete it as contradictory with
  // "Apple Pay bypasses 3DS"; that statement is about 3-D Secure, this token is not.
  // Produced by resolveApplePayMerchantCapabilities (apple-pay-catalog.strategy.ts),
  // which is the single producer and emits only Apple's three known tokens — the
  // assertion below narrows, it does not validate.
  merchantCapabilities: capabilities as ApplePayMerchantCapability[],
  total: {
    label: input.merchantName,
    // Apple requires a 2-DECIMAL STRING and throws on a total of zero or less
    // (ApplePaySession.md:260). `/process` carries the SAME money as a NUMBER
    // (plan §4.3). Two representations of one amount, both correct. Do not
    // "fix" either one to match the other.
    amount: input.amount.toFixed(2),
    type: 'final',
  },
};
```

**DD10 — the builder rejects two classes of amount, both with `AppError(INVALID_PAYMENT_REQUEST)`: a non-positive total, and a total that cannot be represented exactly in the currency's minor units.**

```ts
// (a) One expression covering 0, negatives, NaN and Infinity.
if (!Number.isFinite(input.amount) || input.amount <= 0) {
  throw new AppError({ errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST });
}

// (b) The sheet must not display an amount different from the one charged.
// `total.amount` is `toFixed(2)`; `/process` carries the raw number. If those
// two disagree, the shopper authorizes one price with Face ID and is charged
// another. See the currency assumption below.
if (Number(input.amount.toFixed(2)) !== input.amount) {
  throw new AppError({ errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST });
}
```

Is a `core/` strategy throwing an exception justified, given "no unnecessary validation"? That
rule bars re-checking what is **already guaranteed**. Neither of these is guaranteed by
anything, and each has a failure mode worth a throw.

**(a) protects D3's error distinction.** Without it, a zero total reaches Apple's constructor,
which throws an untyped `TypeError`, which §5.3 catches and reports as
`APPLE_PAY_SESSION_ERROR` — telling a merchant "the session failed" when the truth is "your
amount is zero". The whole point of having four `mount()` codes instead of one `CREATE_ERROR`
is that the merchant at 2 AM can tell those apart. It also satisfies the explicit success
criterion "rejects a zero or negative total before Apple's constructor ever sees it".

**(b) prevents a silent money bug.** `toFixed(2)` rounds: `10.005` renders `"10.01"` on the
sheet while `/process` is charged `10.005`. The shopper authorizes one price and is charged
another, and nothing in either system reports an error. The builder is the only place this is
detectable, so it is the only place it can be refused. The two alternatives are both
unacceptable:

| Option                          | Why not                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| Charge the rounded value        | the SDK silently alters the merchant's amount                 |
| Do nothing                      | the sheet lies to the shopper about what they are authorizing |
| **Refuse to build the request** | **neither lies nor alters — the only honest option**          |

Both reuse `INVALID_PAYMENT_REQUEST`, which already exists and already has a `MESSAGES_EN`
entry, so this change still adds **exactly two** new entries.

> **Forward constraint — `toFixed(2)` assumes a two-decimal currency.**
> Apple's `total.amount` format follows the currency's minor units. JPY has **zero**, KWD has
> **three**. The assumption holds today — MXN has two, `DEFAULT_CURRENCY` is MXN, and Tonder
> operates in Mexico — so generalizing now would be speculative. But it is written down here
> rather than left as a hidden default, because the day a zero- or three-decimal currency
> appears, **both** the check in (b) and the string it produces are wrong, and nothing else in
> the code says so. Whoever adds that currency must revisit this function, not just the
> currency list.

**Deliberately omitted from the request:** `requiredBillingContactFields`,
`requiredShippingContactFields`, `lineItems`, `supportsCouponCode`. The SDK asks Apple for
nothing it does not forward. `/process` accepts an optional `billing_address`, so requesting
billing contact is a plausible Phase 5 addition — it is a product decision, not a Phase 3 one,
and adding it here would ship a field with no consumer.

---

## 7. The Safari-only boundary — what a fake cannot prove

Named as forward constraints for Phase 7, **not** recorded as covered. A fake constructor
accepts anything; every item below is a statement about **Apple's** behavior, not ours.

| #   | Claim a fake CANNOT establish                                                                       | What Phase 3 asserts instead                                                                              | Owner         |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| S1  | Safari **accepts** our `ApplePayPaymentRequest`                                                     | that each field matches Apple's documented rules (`ApplePaySession.md:257-261`) — not that Apple agrees   | Phase 7       |
| S2  | `-webkit-appearance: -apple-pay-button` **renders** the Apple mark                                  | that we emitted the declaration into a `<style>` node (DD7). jsdom has no WebKit                          | Phase 7       |
| S3  | The **real** user-gesture requirement                                                               | T1's synchrony assertion. jsdom models no user activation, so this is a proxy — a good one, still a proxy | Phase 7       |
| S4  | HTTPS enforcement and Apple domain registration                                                     | nothing. Not modelable off-device                                                                         | Phase 7 + ops |
| S5  | The merchant-validation round trip against Apple's servers                                          | nothing. Phase 4 fakes the `HttpPort`, which proves our request, not Apple's acceptance                   | Phase 7       |
| S6  | Face ID / Touch ID and the sheet's own lifecycle                                                    | nothing                                                                                                   | Phase 7       |
| S7  | What `supportsVersion(3)` and `canMakePayments()` **actually return** on real hardware              | that we call both and combine them with `&&`                                                              | Phase 7       |
| S8  | That a keyboard activation of the `<button>` (DD8) counts as a gesture in Safari                    | nothing. The `<div>` fallback is the mitigation if it does not                                            | Phase 7       |
| S9  | Whether `completePayment` requires real `ApplePayError` **instances** rather than plain objects     | nothing — `errors` is declared (DD3) and populated by no code in this change                              | Phase 5 + 7   |
| S10 | That a `<style>` node inside the merchant's container is not overridden by merchant CSS specificity | nothing. No shadow root by choice (DD7)                                                                   | Phase 7       |

The port does not eliminate this list. It reduces it to ten statements about Apple, none
about our orchestration — which is the entire value of drawing the boundary here rather than
in Phase 5.

---

## 8. Work units

**Commits only — no pull requests.** Each unit is independently green on `npm run test`,
`npm run typecheck` and `npm run build`, with the lint error set identical to `main`
(the two pre-existing failures at `tonder.handleRequiresAction.test.ts:184` and
`tonder.pay.test.ts:483` are not fixed here).

Strict TDD applies to all three: this is runtime behavior, not phase 1's erased type
assertions.

### WU1 — port module + pure strategy

- `src/ports/apple-pay.port.ts` (complete, type-only, zero runtime output)
- `src/core/strategies/apple-pay.strategy.ts`
- `src/core/strategies/apple-pay.strategy.test.ts` — **no mocks**: pure input, pure output

Covers: 2-decimal string total; non-positive/NaN rejection; **rejection of an amount that
`toFixed(2)` would round** (`10.005` → `INVALID_PAYMENT_REQUEST`, and `10.5` / `10` accepted);
capabilities and networks coming from phase 2's helpers for both-active / debit-only /
credit-only / empty catalog; `buildApplePayPaymentMethod` returning the token by reference.

The rounding test carries a comment naming the two-decimal-currency assumption (DD10), so the
next author reads it before adding JPY or KWD.

**Green state:** the strategy is fully specified and callable. Nothing imports it. `src/index.ts`
untouched.

> **Refinement of the proposal's unit list.** The proposal paired the port with unit 2. It
> must land in unit 1 instead, because the strategy's return type _is_ the port's
> `ApplePayPaymentRequest` alias (DD1). Same three commits, one type-only file moved earlier.

### WU2 — session half of the adapter

- `createSession` + `canUseApplePay` in `src/adapters/browser/apple-pay.adapter.ts`
- `MESSAGES_EN[APPLE_PAY_SESSION_ERROR]`
- `apple-pay.adapter.test.ts` with the local fake global from §4

Covers: `canUseApplePay()` false with no throw when the global is absent and when it throws;
version 3 passed to the constructor; handlers wired and unwrapped (token only, no
`validationURL`); DD3's status mapping in both directions; a throwing constructor surfacing as
`AppError(APPLE_PAY_SESSION_ERROR)` with `originalError` preserved; `begin` / `abort` /
`completeMerchantValidation` delegating.

**Green state:** a session can be created and driven against a fake global. No button exists.

### WU3 — button half of the adapter

- `render` + `buildButtonCss` in the same adapter file
- `MESSAGES_EN[APPLE_PAY_CONTAINER_NOT_FOUND]`
- jsdom tests in the same test file

Covers: the button and style nodes appended to a matched container; unmatched selector →
`AppError(APPLE_PAY_CONTAINER_NOT_FOUND)`; the CSS text for defaults and for each
customization field; the click listener invoking `onClick`; the disposer removing node,
style and listener; a second disposer call being a no-op.

Each style test states in its own name or a comment what it does and does not prove (S2).

**Green state:** both ports are fully implemented and unreachable. Feature complete for
Phase 3.

### Rollback

Revert in reverse order. Every file is new with no importer outside its own test; WU2 and WU3
drop independently, WU1 is a pure module plus a type-only file. No public surface, no
persisted data, no backend contract, no migration.

---

## 9. Decision index

| ID   | Decision                                                                                                                     | Rejected alternative                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DD1  | `apple-pay.port.ts` is the only module naming `ApplePayJS`; everything else uses its aliases                                 | hand-rolled mirror types (duplicated interface, silent drift)                                                                                                                                                                           |
| DD2  | Handlers return `void \| Promise<void>`; adapter discards with `void`                                                        | `void` return + microtask flushing in every Phase 5 test                                                                                                                                                                                |
| DD3  | `completePayment` takes `'success' \| 'failure'`; the adapter maps to `STATUS_*`                                             | numeric constants in core (breaks purity) or hardcoded literals (fragile)                                                                                                                                                               |
| DD4  | `begin()` stays on the handle                                                                                                | auto-`begin` inside `createSession` (sheet presentation unassertable)                                                                                                                                                                   |
| DD5  | Fakes are local factories in `*.test.ts`                                                                                     | `MockApplePaySessionAdapter` under `src/adapters/` (ships to merchants)                                                                                                                                                                 |
| DD6  | Global reached via `globalThis`, never `window` or the bare identifier                                                       | `window.ApplePaySession` (ReferenceError under SSR/Node)                                                                                                                                                                                |
| DD7  | Styles applied via an injected `<style>` element and a class                                                                 | inline `style.setProperty` (jsdom drops `-apple-pay-*`, test proves nothing)                                                                                                                                                            |
| DD8  | The button is `<button type="button">`                                                                                       | Apple's `<div>` sample markup (not keyboard-accessible)                                                                                                                                                                                 |
| DD9  | Customization is a real `render()` argument today; only its source is deferred                                               | `apple_pay_button` on `TonderCustomization` now (proposal D1 / inherited D3)                                                                                                                                                            |
| DD10 | The builder throws `AppError(INVALID_PAYMENT_REQUEST)` on a non-positive total **and on an amount `toFixed(2)` would round** | (a) let Apple's constructor throw — collapses into `APPLE_PAY_SESSION_ERROR`, destroying D3's distinction; (b) charge the rounded value — the SDK silently alters the merchant's amount; (c) do nothing — the sheet lies to the shopper |

### Proposal cross-references

| Proposal                                                  | Realized by                                     |
| --------------------------------------------------------- | ----------------------------------------------- |
| **D1** — customization consumed but not wired             | DD9                                             |
| **D2** — `canUseApplePay()` is browser-only, never throws | §5.2                                            |
| **D3** — the adapter throws `AppError`                    | §5.6, and DD10 protects the distinction it buys |
| **D4** — string total vs number amount                    | §6.2, both comments                             |
| **D5** — Apple's types confined                           | DD1, which makes it grep-checkable              |

---

## 10. Risks and open items for Phase 5

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                           | Impact    | Disposition                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `toFixed(2)` rounds — the sheet would display up to half a cent more than `/process` charges. A silent money bug: the shopper authorizes one price with Face ID and is charged another                                                                                                                                                                                                         | ~~Med~~   | **RESOLVED — the builder refuses the request** (DD10b, `AppError(INVALID_PAYMENT_REQUEST)`). Landed in this phase, not deferred, because the builder is the only place the divergence is detectable                                                                               |
| R1b | `toFixed(2)` assumes a **two-decimal currency**. JPY has zero minor units, KWD has three; Apple's amount format follows the currency                                                                                                                                                                                                                                                           | Low today | Assumption holds — MXN has two, `DEFAULT_CURRENCY` is MXN, Tonder operates in Mexico. Written down in DD10 as a forward constraint rather than left as a hidden default: adding a zero- or three-decimal currency invalidates **both** the DD10b check and the string it produces |
| R2  | The proposal's success criterion says `pay({ payment_method: { type: 'apple_pay' } })` "still does not type-check". **It does type-check today** — `PaymentMethod` includes `{ type: string; config? }` (`src/shared/types/index.ts:121-124`), so the literal matches. Worse: with no runtime guard the call is treated as a **generic APM** and sent to `/process` as `{ type: 'apple_pay' }` | Med       | Correction in flight with the proposal agent. Design records the ruling in §6.1: the public union is **deliberately unchanged**, and rejection is a **runtime** `AppError` owned by Phase 5 (plan §1.2) — the guard that stops a malformed charge reaching the API, not DX polish |
| R3  | `ApplePayPaymentMethod` (ours) vs `ApplePayJS.ApplePayPaymentMethod` (card display info)                                                                                                                                                                                                                                                                                                       | Low       | Sibling naming kept for consistency with `CardPaymentMethod` / `ApmPaymentMethod`; disambiguated in the doc comment (§6.1)                                                                                                                                                        |
| R4  | Apple may require real `ApplePayError` instances in `completePayment.errors`                                                                                                                                                                                                                                                                                                                   | Low       | S9. Nothing populates `errors` in this change                                                                                                                                                                                                                                     |
| R5  | DD3's status mapping forces the Phase 3 adapter fake to declare `STATUS_SUCCESS` / `STATUS_FAILURE` statics                                                                                                                                                                                                                                                                                    | Low       | Two lines, one file. The alternative leaks a global into `core/`                                                                                                                                                                                                                  |
| R6  | Someone "finishes the job" by wiring `apple_pay_button` onto `TonderCustomization` or adding an `src/index.ts` export                                                                                                                                                                                                                                                                          | Med       | DD9 states it; the success criteria verify absence in both places                                                                                                                                                                                                                 |
| R7  | The two new `MESSAGES_EN` entries drift from the four Phase 5 writes                                                                                                                                                                                                                                                                                                                           | Low       | Existing actionable style followed; Phase 5 reviews all six together                                                                                                                                                                                                              |
| R8  | Two `render()` calls into one container produce duplicate nodes                                                                                                                                                                                                                                                                                                                                | Low       | Documented assumption (§5.4). No SDK path does it                                                                                                                                                                                                                                 |

## Next step

`sdd-tasks` — break WU1–WU3 into TDD steps once the spec delta is written.
