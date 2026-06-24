# Design: Embedded 3DS CheckoutMessenger (Slice 1, SDK)

## Context

Embedded 3DS completion is detected today ONLY by polling `getTransaction`
until a final status appears (`handleRequiresAction` embedded branch,
`src/tonder.ts:333-343`). The poll-interval latency (first tick at 2000ms,
backing off to 5000ms) is added AFTER the challenge already finished. The
embedded payflow iframe can `postMessage` the instant 3DS reaches a final
state. This change makes the SDK resolve immediately on that message while
keeping the poll as a fallback — a PURE optimization with ZERO behavior change
when no message arrives.

The composition seam already exists and is documented in `pollTransaction`
(`src/tonder.ts:532-567`): `pollUntilFinal` is cancelable via `AbortSignal`,
single-resolution via its `resolved` guard. We add the messenger as a second
racer over a SHARED `AbortController`.

Hexagonal boundary (mandatory): all DOM/`window` access lives in the adapter
(`src/adapters/browser/`). The core/facade (`tonder.ts`) stays DOM-free and
tests inject a fake messenger — identical to how `ThreeDsHostPort` /
`Browser3dsHost` already separate concerns.

## Goals / Non-Goals

### Goals
- New `CheckoutMessengerPort` driven port + `BrowserCheckoutMessenger` adapter.
- `handleRequiresAction` embedded branch: `Promise.race([messenger, poll])`
  over one shared `AbortController`; winner aborts loser; single resolution.
- Constructor accepts optional `messenger?: CheckoutMessengerPort` (defaults to
  the browser adapter at the composition root). Test seam injects a fake.
- Regression-safety invariant: a never-firing messenger leaves the embedded
  branch behaviorally identical to today.

### Non-Goals
- Slice 2 (hosted-checkout `ThreeDSPayment.tsx` postMessage emit) — separate PR.
- No change to redirect-mode 3DS.
- No change to `handleApmResult` — APMs settle async; no in-session final state.
- No new public error codes. Origin/parse mismatches are silently ignored.

## Decisions

### D1 — `CheckoutMessengerPort.waitForCompletion` resolves `void`

```ts
// src/ports/checkout-messenger.port.ts
/**
 * Driven port: signals that the embedded payflow iframe reported 3DS
 * completion via `window.postMessage`. Implemented by a browser adapter so the
 * core/facade stays free of DOM/`window` access (tests inject a fake).
 *
 * The messenger ONLY signals completion — it owns NO http and NEVER fetches a
 * transaction. The authoritative status read (`getTransaction`) is the facade's
 * job (`tonder.ts`), keeping this port a thin, pure DOM listener.
 */
export interface CheckoutMessengerPort {
  /**
   * Resolve when a valid `checkout.completed` / `checkout.failed` message
   * arrives from an allowed origin. Reject `AppError(REQUEST_ABORTED)` when
   * `signal` aborts (including a pre-aborted signal). The listener is removed in
   * EVERY exit path (resolve, reject, abort).
   */
  waitForCompletion(signal: AbortSignal): Promise<void>;
}
```

**Decision: resolve `void`, NOT `{ transactionStatus }`.**

The exploration floated resolving with `{ transactionStatus }` and mapping it
in the adapter. REJECTED. Rationale:

1. **The messenger must not depend on http and must not own status semantics.**
   The payflow message carries `transaction_status` as a loosely-typed string
   (`"Success"`, `"Declined"`, `"Failed"`, capitalized, PSP-flavored). Mapping
   that into a `PayResult` would duplicate the status classification that
   `payResultFromTransaction` already owns over the canonical `Transaction`. Two
   sources of truth for "is this a decline?" is exactly the kind of drift we
   avoid.
2. **`getTransaction` is the single authoritative read.** When the messenger
   fires, the facade does ONE `getTransaction(transactionId)` and runs the SAME
   `payResultFromTransaction` mapper the poll path already uses. The message is a
   "wake up now" signal, not a data carrier. Identical output shape on both
   racer paths → one code path for classification.
3. **Cleanest seam.** `void` means the adapter never touches `Transaction`,
   `mapToTransaction`, or any model — it is a pure `window 'message'` listener.
   The facade owns the fetch+map. This is the tightest possible port surface.

Trade-off accepted: one extra `getTransaction` call on the messenger-win path
(the message says "done", we confirm by reading). This is correctness over a
saved round-trip and matches the exploration's "prefer getTransaction" note.

### D2 — `BrowserCheckoutMessenger` adapter: origin allowlist + full teardown

```ts
// src/adapters/browser/browser-checkout-messenger.adapter.ts
import type { CheckoutMessengerPort } from '../../ports/checkout-messenger.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Payflow completion events the SDK accepts. Any other event is ignored. */
const COMPLETION_EVENTS: ReadonlySet<string> = new Set([
  'checkout.completed',
  'checkout.failed',
]);

/**
 * Browser implementation of {@link CheckoutMessengerPort}. This is the ONLY
 * place in the SDK that touches `window` for the messenger flow — the core and
 * facade stay DOM-free and tests inject a fake.
 *
 * Security: the payflow currently posts to `targetOrigin: "*"`, so the SDK is
 * the trust boundary. Every inbound message is filtered against
 * `allowedOrigins` (computed once from `resolveEnv(mode).payflow`); a mismatch
 * is SILENTLY ignored (standard cross-origin hygiene — no error thrown).
 */
export class BrowserCheckoutMessenger implements CheckoutMessengerPort {
  constructor(private readonly allowedOrigins: ReadonlySet<string>) {}

  public waitForCompletion(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Single teardown used by ALL exit paths — no listener survives settle.
      const cleanup = (): void => {
        window.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };

      const onMessage = (event: MessageEvent): void => {
        // 1. Origin gate — silently ignore anything not from a known payflow.
        if (!this.allowedOrigins.has(event.origin)) return;
        // 2. Shape gate — silently ignore malformed / unrelated messages.
        const data = event.data as { event?: unknown } | null;
        if (
          typeof data !== 'object' ||
          data === null ||
          typeof data.event !== 'string' ||
          !COMPLETION_EVENTS.has(data.event)
        ) {
          return;
        }
        // Valid completion signal: tear down, then resolve. The facade reads
        // the authoritative transaction — this port carries no status.
        cleanup();
        resolve();
      };

      const onAbort = (): void => {
        cleanup();
        reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
      };

      // Pre-aborted signal: reject immediately, attach NOTHING.
      if (signal.aborted) {
        reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
        return;
      }

      window.addEventListener('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
```

Teardown structure mirrors `pollUntilFinal`'s `cleanup()` (`poll.ts:110-114`):
one function, called before every `resolve`/`reject`, removing BOTH the
`message` listener and the `abort` listener. The `abort` listener uses
`{ once: true }` for defense in depth; `cleanup` still removes it explicitly so
a resolve-before-abort path leaves nothing attached.

**Pre-aborted handling**: `signal.aborted` is checked at the TOP of the executor
body, before any `addEventListener`. On a pre-aborted signal we reject and
return without attaching either listener — there is nothing to clean up.
Identical to `pollUntilFinal`'s pre-abort guard (`poll.ts:96-99`).

**jsdom testability**: the adapter only uses `window.addEventListener('message')`
and reads `event.origin` / `event.data`. Tests drive it with
`window.dispatchEvent(new MessageEvent('message', { origin, data }))`, exactly
the real-DOM style of `browser-3ds-host.adapter.test.ts`. Note: jsdom does NOT
enforce origin on synthetic `MessageEvent`, so `origin` is whatever the test
passes — which is precisely what lets us test the allowlist gate.

### D3 — `Promise.race` composition in `handleRequiresAction` embedded branch

Current poll-only branch (`tonder.ts:333-343`):

```ts
if (mode === 'embedded') {
  const containerId = config.threeDsContainerId ?? DEFAULT_THREEDS_CONTAINER_ID;
  this.host.mountIframe(result.nextAction.url, containerId);
  try {
    const finalTx = await this.pollTransaction(result.transactionId);
    return payResultFromTransaction(finalTx);
  } finally {
    this.host.unmount();
  }
}
```

New branch (minimal diff — mount/unmount and `payResultFromTransaction` are
unchanged; only the "how we get `finalTx`" line set changes):

```ts
if (mode === 'embedded') {
  const containerId = config.threeDsContainerId ?? DEFAULT_THREEDS_CONTAINER_ID;
  this.host.mountIframe(result.nextAction.url, containerId);

  // One shared controller: the FIRST racer to settle aborts the other.
  const controller = new AbortController();

  // PRIMARY: messenger fires → abort the background poll → ONE authoritative
  // read. The messenger carries no status; getTransaction is the source of truth.
  const messengerPromise = this.messenger
    .waitForCompletion(controller.signal)
    .then(() => {
      controller.abort();
      return this.getTransaction(result.transactionId);
    });

  // FALLBACK: poll until final (today's sole signal). Cancelable via the signal.
  const pollPromise = this.pollTransaction(result.transactionId, {
    signal: controller.signal,
  });

  // Suppress BOTH losers' rejections: once the winner settles, Promise.race
  // ignores the loser, but its rejection is still live (REQUEST_ABORTED) and
  // would surface as an unhandled rejection. Attach no-op catches.
  messengerPromise.catch(() => {});
  pollPromise.catch(() => {});

  try {
    const finalTx = await Promise.race([messengerPromise, pollPromise]);
    return payResultFromTransaction(finalTx);
  } finally {
    controller.abort(); // idempotent: ensures the loser is canceled on any exit
    this.host.unmount();
  }
}
```

**Diff summary vs. today**: mount, the `try/finally`, `unmount`, and
`payResultFromTransaction(finalTx)` are IDENTICAL. The only additions are the
shared `controller`, the two racer promises, the two no-op `.catch()` suppressors,
`Promise.race`, and `controller.abort()` in `finally`. Nothing about the
redirect branch, the APM branch, or any model changes.

#### No-double-resolve + no-leak proof (all four branches)

The single-resolution backbone is `Promise.race`: it adopts the first settled
input and ignores the rest. Layered on top, both `pollUntilFinal` (its `resolved`
guard, `poll.ts:90/117-119`) and the messenger (its `cleanup` + the fact a
Promise settles once) are individually single-resolution. We prove each branch:

1. **Messenger wins** (message arrives before the first poll tick settles):
   - `messengerPromise` resolves: its `.then` runs `controller.abort()` then
     `getTransaction` → resolves `finalTx`. `Promise.race` adopts it.
   - `controller.abort()` fires the signal. `pollTransaction`'s internal
     controller aborts (`tonder.ts:557`); `pollUntilFinal`'s `onAbort` calls
     `settleReject(REQUEST_ABORTED)` (`poll.ts:150-151`) which runs `cleanup`
     (clears `deadlineTimer`/`tickTimer`, removes its abort listener,
     `poll.ts:110-114`). NO leaked timer.
   - `pollPromise` rejects REQUEST_ABORTED → swallowed by its `.catch(()=>{})`.
   - Messenger listener already removed by its own `cleanup` on resolve.
   - `finally` re-aborts (idempotent no-op) and unmounts. **One resolution.**

2. **Poll wins** (poll reaches a final status before any message):
   - `pollUntilFinal` `settleResolve` runs `cleanup` and resolves the final
     `Transaction`. `pollPromise` resolves; `Promise.race` adopts it.
   - `finally` runs `controller.abort()`. The messenger's `onAbort` fires →
     `cleanup` removes the `message` + `abort` listeners → rejects
     REQUEST_ABORTED. That rejection is swallowed by `messengerPromise.catch`.
     The messenger's `.then(getTransaction)` NEVER runs (the promise rejected,
     not resolved). NO stray fetch, NO leaked listener.
   - `finally` unmounts. **One resolution.**

3. **External abort** (a future caller aborts a signal threaded into the poll —
   note Slice 1 passes no external signal, so this is the timeout/error case):
   - The deadline timer fires `settleReject(POLL_TIMEOUT_ERROR)` OR a real fetch
     error → `settleRejectError`. `pollUntilFinal`'s `cleanup` runs; `pollPromise`
     rejects with the genuine code. `Promise.race` adopts that rejection.
   - The rejection propagates out of `await Promise.race`. `finally` STILL runs:
     `controller.abort()` tears down the messenger (its `onAbort` → `cleanup`,
     rejection swallowed by `.catch`), then `unmount()`. The poll error
     propagates to the caller. NO leaked messenger listener even on the error
     path. **One settlement (a rejection).**

4. **Messenger fires, then `getTransaction` fails**:
   - `messengerPromise`'s `.then` runs `controller.abort()` (poll torn down as in
     branch 1, its rejection swallowed) then `getTransaction` REJECTS (e.g.
     FETCH_TRANSACTION_ERROR). `messengerPromise` rejects.
   - Here `Promise.race` may have already adopted whichever settled first. Two
     sub-cases:
     - The poll was aborted by `controller.abort()` BEFORE it could resolve, so
       `pollPromise` rejects REQUEST_ABORTED (swallowed). `messengerPromise` is
       the first to settle → `Promise.race` adopts its rejection →
       `getTransaction`'s error propagates. Correct: a real fetch failure after
       the message is a genuine error, surfaced (not masked).
     - Edge timing: poll happens to resolve a final tx in the same microtask
       window before the abort lands. Then `pollPromise` is the winner and the
       messenger's later rejection is swallowed by `messengerPromise.catch`. We
       resolve from the poll. Also correct — single resolution.
   - In every sub-case: `finally` aborts + unmounts; no leaked listener or timer.
     **One settlement.**

The `controller.abort()` in `finally` is the belt-and-suspenders guarantee: on
ANY exit (resolve or throw), the loser's signal is aborted, so neither the poll
timer nor the messenger listener can outlive the branch.

### D4 — Constructor wiring (composition root only)

Thread `messenger?: CheckoutMessengerPort` through the same three seams that
already carry `host?: ThreeDsHostPort`:

```ts
// field
private readonly messenger: CheckoutMessengerPort;

// constructor signature (append after host)
constructor(
  config: TonderConfig,
  http?: HttpPort,
  tokenizer?: TokenizerPort,
  acquirer?: AcquirerPort,
  host?: ThreeDsHostPort,
  messenger?: CheckoutMessengerPort,
) {
  // ...existing wiring...
  this.host = host ?? new Browser3dsHost();
  // Default adapter constructed ONLY here (composition root). Allowlist is the
  // single payflow origin for this mode — core stays pure, tests inject a fake.
  this.messenger =
    messenger ??
    new BrowserCheckoutMessenger(new Set([this.env.payflow]));
}
```

`this.env` is already `resolveEnv(config.mode)` (`tonder.ts:139`), so
`this.env.payflow` is the per-mode payflow origin (`env.ts:22`) with no extra
resolution. The default `BrowserCheckoutMessenger` is the ONLY `new` of a
DOM-touching messenger and it lives at the composition root — exactly like
`Browser3dsHost`.

`_createTonderWithDeps` gains an optional `messenger?` and forwards it as the
6th constructor arg:

```ts
export function _createTonderWithDeps(deps: {
  config: TonderConfig;
  http: HttpPort;
  tokenizer?: TokenizerPort;
  acquirer?: AcquirerPort;
  host?: ThreeDsHostPort;
  messenger?: CheckoutMessengerPort;
}): Tonder {
  return new Tonder(
    deps.config,
    deps.http,
    deps.tokenizer,
    deps.acquirer,
    deps.host,
    deps.messenger,
  );
}
```

`createTonder(config)` (`tonder.ts:831-833`) is UNCHANGED — it constructs with
no overrides, so production gets the real `BrowserCheckoutMessenger` by default.

### D5 — APM untouched + regression-safety invariant

**`handleApmResult` stays messenger-free.** No edit to `tonder.ts:364-387`.
APM/SPEI settle asynchronously via webhook; there is NO in-session final state
for the SDK to race a messenger against. The existing `checkout.returned` event
(user taps "back to merchant") is dismissal, not completion — racing it would be
semantically wrong. The embedded APM branch keeps mounting the voucher iframe and
returning `pending` in its `finally`-unmounted block.

**Redirect mode untouched.** `handleRequiresAction`'s redirect branch
(`tonder.ts:345-346`) is unchanged: it navigates and returns `requires_action`.

**Regression-safety invariant (the load-bearing guarantee):**

> With a messenger whose `waitForCompletion` NEVER resolves and NEVER rejects
> (until aborted), the embedded `handleRequiresAction` branch is behaviorally
> identical to today's poll-only branch.

Proof: if the messenger never settles, `Promise.race` is decided solely by
`pollPromise`. The poll resolves on a final status (→ `payResultFromTransaction`,
same as today) or rejects on timeout/error (→ propagates, same as today). On
either exit, `finally` calls `controller.abort()` — which finally settles the
dormant messenger (REQUEST_ABORTED, swallowed) and removes its listener — then
`unmount()`. The observable output (`PayResult` or thrown `AppError`) and side
effects (mount → unmount) are exactly today's. This is the regression test
contract: inject a never-firing fake messenger and assert the existing
embedded-3DS suite passes unchanged.

## Architecture / Component Map

```
                  composition root (Tonder constructor)
                  └─ this.messenger = messenger ?? new BrowserCheckoutMessenger(
                                          new Set([this.env.payflow]))   [DOM]
                  └─ this.host      = host      ?? new Browser3dsHost()  [DOM]

  pay() → handleRequiresAction(embedded)             [CORE — DOM-free]
      ├─ host.mountIframe(url, containerId)
      ├─ controller = new AbortController()
      ├─ messengerPromise = messenger.waitForCompletion(signal)         (port)
      │                       .then(abort + getTransaction)             (http via facade)
      ├─ pollPromise      = pollTransaction(id, { signal })             (pure poll util)
      ├─ Promise.race([messengerPromise, pollPromise])
      │     → payResultFromTransaction(finalTx)                         (pure mapper)
      └─ finally: controller.abort() + host.unmount()

  CheckoutMessengerPort (src/ports)        ← driven port, void resolve
      └─ BrowserCheckoutMessenger (src/adapters/browser)  ← window 'message' [DOM only]
```

Data flow on the messenger-win path: `window 'message'` (origin+shape gated) →
`waitForCompletion` resolves `void` → facade aborts poll → `getTransaction`
(http) → `Transaction` → `payResultFromTransaction` → `PayResult`. The messenger
never sees a `Transaction`; the facade never sees a `MessageEvent`.

## Affected Areas

- `src/ports/checkout-messenger.port.ts` — NEW — `CheckoutMessengerPort`.
- `src/adapters/browser/browser-checkout-messenger.adapter.ts` — NEW — adapter.
- `src/tonder.ts` — MODIFIED — constructor field + 6th arg; `handleRequiresAction`
  embedded branch → race; `_createTonderWithDeps` 6th dep. APM + redirect
  branches untouched.

## Risks / Open Questions

- **Backend `post_message_enabled` gate** (Med): if the JWT never sets it true
  for SDK-embedded flows, the message never fires. SAFE — poll fallback resolves
  normally; the optimization is inert, not broken. Verified by the regression
  invariant (D5).
- **Race-loser unhandled rejection** (Med): both losers reject REQUEST_ABORTED.
  Mitigated by the two no-op `.catch(()=>{})` suppressors (D3).
- **Non-payflow origin message** (Low): allowlist per mode; silent ignore (D2).
- **Double resolution** (Low): proven impossible across all four branches (D3).
- **No new public error codes**: origin/shape mismatches are silently ignored —
  no `CHECKOUT_MESSENGER_*` codes added (kept out of the public surface).
