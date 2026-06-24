# embedded-threeds-completion Specification

## Purpose

Defines how the SDK detects embedded 3DS completion: a postMessage-based primary
signal (CheckoutMessengerPort) races against the existing poll fallback. When no
message arrives the behavior is IDENTICAL to today's poll-only path — this is a
pure optimization, not a behavior change.

---

## Requirements

### Requirement: CheckoutMessengerPort Contract

The system MUST expose a `CheckoutMessengerPort` interface in `src/ports/` with a
single method `waitForCompletion(signal: AbortSignal): Promise<void>`. Core code
MUST depend only on this port; no DOM types MAY appear in `src/core/` or
`src/ports/`.

#### Scenario: Port is a pure TypeScript interface

- GIVEN the file `src/ports/checkout-messenger.port.ts` exists
- WHEN compiled with `tsc --strict`
- THEN no DOM-specific types are imported and the file contains no implementation

---

### Requirement: BrowserCheckoutMessenger — Resolves on Allowed-Origin Completion

The `BrowserCheckoutMessenger` adapter MUST resolve `waitForCompletion` when a
`MessageEvent` arrives whose `origin` is in the allowed-origins set AND whose
`data.event` is `"checkout.completed"` OR `"checkout.failed"`.

#### Scenario: Resolves on checkout.completed from allowed origin

- GIVEN a `BrowserCheckoutMessenger` with `allowedOrigins = { "https://payflow.tonder.io" }`
- AND a live `AbortSignal` (not yet aborted)
- WHEN `window` receives a `MessageEvent` with `origin = "https://payflow.tonder.io"` and `data.event = "checkout.completed"`
- THEN the promise returned by `waitForCompletion` resolves

#### Scenario: Resolves on checkout.failed from allowed origin

- GIVEN a `BrowserCheckoutMessenger` with `allowedOrigins = { "https://payflow.tonder.io" }`
- AND a live `AbortSignal`
- WHEN `window` receives a `MessageEvent` with `origin = "https://payflow.tonder.io"` and `data.event = "checkout.failed"`
- THEN the promise resolves

---

### Requirement: BrowserCheckoutMessenger — Silently Ignores Non-Allowed Origins

The adapter MUST silently ignore (leave the promise pending) any `MessageEvent`
whose `origin` is NOT in the allowed-origins set. No error MUST be thrown or
emitted publicly.

#### Scenario: Message from disallowed origin is ignored

- GIVEN a `BrowserCheckoutMessenger` with `allowedOrigins = { "https://payflow.tonder.io" }`
- AND a live `AbortSignal`
- WHEN `window` receives a `MessageEvent` with `origin = "https://evil.example.com"` and `data.event = "checkout.completed"`
- THEN the promise remains pending
- AND no exception is thrown

---

### Requirement: BrowserCheckoutMessenger — Silently Ignores Unrecognized Event Types

The adapter MUST silently ignore (leave the promise pending) any `MessageEvent`
whose `data.event` is not `"checkout.completed"` or `"checkout.failed"`, even if
the origin is allowed.

#### Scenario: Message with unrecognized event type is ignored

- GIVEN a `BrowserCheckoutMessenger` with `allowedOrigins = { "https://payflow.tonder.io" }`
- AND a live `AbortSignal`
- WHEN `window` receives a `MessageEvent` with `origin = "https://payflow.tonder.io"` and `data.event = "checkout.redirected"`
- THEN the promise remains pending

---

### Requirement: BrowserCheckoutMessenger — Rejects REQUEST_ABORTED on Pre-Aborted Signal

If the `AbortSignal` passed to `waitForCompletion` is already aborted before the
method attaches any listener, the adapter MUST synchronously reject with
`AppError(REQUEST_ABORTED)` and MUST NOT attach a `window` message listener.

#### Scenario: Pre-aborted signal causes immediate rejection

- GIVEN an `AbortController` whose `signal` is already aborted
- WHEN `waitForCompletion(signal)` is called
- THEN the returned promise rejects with `AppError` where `errorCode === "REQUEST_ABORTED"`
- AND no `"message"` listener is added to `window`

---

### Requirement: BrowserCheckoutMessenger — Rejects REQUEST_ABORTED on Post-Attach Abort

If the `AbortSignal` aborts AFTER the listener is attached, the adapter MUST
reject the promise with `AppError(REQUEST_ABORTED)` and MUST remove the `window`
message listener before rejecting.

#### Scenario: Signal aborts after listener is attached

- GIVEN a `BrowserCheckoutMessenger` with an allowed origin
- AND `waitForCompletion(signal)` has been called (listener attached, promise pending)
- WHEN the `AbortController.abort()` is called
- THEN the promise rejects with `AppError` where `errorCode === "REQUEST_ABORTED"`
- AND the `"message"` listener is removed from `window`

---

### Requirement: BrowserCheckoutMessenger — Removes Listener After Resolution

After the promise resolves, the adapter MUST remove the `window` `"message"`
listener. A subsequent `MessageEvent` from an allowed origin MUST NOT cause a
second resolution attempt.

#### Scenario: Listener is removed after first resolution

- GIVEN `waitForCompletion` has resolved due to a `checkout.completed` message
- WHEN a second `MessageEvent` with `data.event = "checkout.completed"` is dispatched on `window`
- THEN no additional resolution or error occurs (the listener is gone)

---

### Requirement: handleRequiresAction — Messenger-Primary, Poll-Fallback Race

The embedded branch of `handleRequiresAction` in `Tonder` MUST race a
`messenger.waitForCompletion(raceController.signal)` promise against the existing
`pollUntilFinal` promise over a shared `AbortController`. The winner MUST abort
the loser. The loser's `REQUEST_ABORTED` rejection MUST be suppressed (`.catch(()
=> {})`). The iframe MUST be unmounted in a `finally` block that runs in all exit
paths.

#### Scenario: Messenger fires before first poll tick

- GIVEN a `FakeCheckoutMessenger` that resolves immediately on `waitForCompletion`
- AND a `FakePoll` with a tick interval long enough not to fire first
- AND `handleRequiresAction` is called with embedded mode
- WHEN the race starts
- THEN the result is obtained via `getTransaction(transactionId)` (one call after messenger resolves)
- AND the poll `AbortSignal` is aborted
- AND the iframe is unmounted

#### Scenario: Poll resolves before messenger

- GIVEN a `FakeCheckoutMessenger` that never resolves
- AND a `FakePoll` that resolves on the first tick
- AND `handleRequiresAction` is called with embedded mode
- WHEN the race starts
- THEN the result comes from the poll
- AND the messenger listener is cleaned up (signal aborted)
- AND the iframe is unmounted

#### Scenario: Messenger never fires — poll resolves normally (regression guard)

- GIVEN a `FakeCheckoutMessenger` that never resolves or rejects (permanently pending)
- AND the standard poll completes after N ticks
- WHEN `handleRequiresAction` is called with embedded mode
- THEN `pay()` returns a `PayResult` identical to the current poll-only path
- AND no error is thrown
- AND the iframe is unmounted

#### Scenario: External abort — REQUEST_ABORTED propagates

- GIVEN the `pay()` caller holds an `AbortController` and aborts it during the race
- WHEN the shared `raceController.signal` fires
- THEN `waitForCompletion` rejects with `REQUEST_ABORTED`
- AND the poll rejects with `REQUEST_ABORTED`
- AND `Promise.race` rejects with `REQUEST_ABORTED`
- AND the iframe is unmounted in `finally`

#### Scenario: Messenger fires but getTransaction fails

- GIVEN a `FakeCheckoutMessenger` that resolves immediately
- AND `getTransaction` throws a non-abort error
- WHEN the race resolves via the messenger path
- THEN that error propagates from `handleRequiresAction`
- AND the aborted poll's `REQUEST_ABORTED` rejection is suppressed (no unhandled rejection)
- AND the iframe is unmounted in `finally`

---

### Requirement: Redirect-Mode 3DS Path Unchanged (Regression Guard)

The redirect-mode branch of `handleRequiresAction` MUST NOT involve the
`CheckoutMessengerPort` in any way. No messenger MUST be constructed or
referenced for redirect flows.

#### Scenario: Redirect mode — no messenger involved

- GIVEN `handleRequiresAction` is called with redirect mode (non-embedded)
- WHEN the redirect flow completes
- THEN `waitForCompletion` is never called
- AND behavior is identical to the pre-change implementation

---

### Requirement: APM Embedded Path Unchanged (Regression Guard)

`handleApmResult` MUST NOT use `CheckoutMessengerPort`. APM embedded flows
continue to mount the voucher iframe and return `pending` immediately. No
messenger race MUST be introduced for APM paths.

#### Scenario: APM embedded flow — messenger not involved

- GIVEN `handleApmResult` is called in embedded mode (OXXO or SPEI)
- WHEN the iframe is mounted
- THEN `waitForCompletion` is never called
- AND the return value is `{ status: "pending" }` as today

---

### Requirement: Origin Allowlist Source

The allowed-origins set for `BrowserCheckoutMessenger` MUST be derived from
`resolveEnv(mode).payflow` (production = `https://payflow.tonder.io`; stage/sandbox
= `https://stage-payflow.tonder.io`). No additional public error codes MUST be
introduced for origin or parse failures — these failures are silently filtered.

#### Scenario: Allowlist matches resolveEnv

- GIVEN a `Tonder` instance constructed in `"production"` mode
- WHEN `BrowserCheckoutMessenger` is instantiated with its default allowedOrigins
- THEN `allowedOrigins` contains only `"https://payflow.tonder.io"`

---

### Requirement: No Listener Leak After Signal Abort

After `waitForCompletion` rejects due to signal abort, the adapter MUST have
removed both the `window "message"` listener and the signal `"abort"` listener.

#### Scenario: No window listener leak after abort

- GIVEN `waitForCompletion` has been called and the signal is then aborted
- WHEN the promise rejects
- THEN `window.removeEventListener("message", ...)` has been called exactly once
- AND the signal `"abort"` event listener has been removed
