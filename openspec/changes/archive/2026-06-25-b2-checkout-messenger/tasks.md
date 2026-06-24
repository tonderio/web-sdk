# Tasks: Embedded 3DS CheckoutMessenger (Slice 1, SDK)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180–260 (port ~15, adapter ~80, tonder.ts ~60, tests ~80, README ~10) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | N/A |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Port + adapter + race + wiring + README + final gate | PR 1 | All tasks sequential in one slice; diff well under 400 lines |

---

## Phase 1: Foundation — CheckoutMessengerPort

- [x] 1.1 Create `src/ports/checkout-messenger.port.ts` — export interface `CheckoutMessengerPort` with a single method `waitForCompletion(signal: AbortSignal): Promise<void>`. No DOM imports, no implementation. Satisfies: *Requirement: CheckoutMessengerPort Contract*.

---

## Phase 2: Adapter — RED → GREEN (BrowserCheckoutMessenger)

- [x] 2.1 **RED** — Create `src/adapters/browser/browser-checkout-messenger.adapter.test.ts` with 8 failing test cases (jsdom `window.dispatchEvent(new MessageEvent('message', { origin, data }))`):
  1. Resolves on `checkout.completed` from allowed origin.
  2. Resolves on `checkout.failed` from allowed origin.
  3. Promise remains pending on disallowed origin (no throw).
  4. Promise remains pending on unrecognized `data.event` from allowed origin.
  5. Pre-aborted signal → immediate reject with `AppError(REQUEST_ABORTED)`, no listener attached.
  6. Post-attach abort → reject with `AppError(REQUEST_ABORTED)`, listener removed.
  7. After resolve, second `MessageEvent` from allowed origin causes no double-resolve.
  8. After abort reject, no `window "message"` listener or `"abort"` signal listener remains.
  Satisfies: *Requirements: BrowserCheckoutMessenger — Resolves / Ignores / Pre-Aborted / Post-Attach / Removes Listener / No Listener Leak*.

- [x] 2.2 **GREEN** — Create `src/adapters/browser/browser-checkout-messenger.adapter.ts` implementing `CheckoutMessengerPort`:
  - Constructor: `constructor(private readonly allowedOrigins: ReadonlySet<string>)`.
  - `COMPLETION_EVENTS = new Set(['checkout.completed', 'checkout.failed'])`.
  - `waitForCompletion`: check `signal.aborted` first → reject + return (attach nothing). Else attach `window "message"` listener + `signal "abort"` listener (`{ once: true }`). Single `cleanup()` removes both before every resolve/reject.
  - All 8 tests green. Satisfies: same requirements as 2.1.

---

## Phase 3: Core — RED → GREEN (handleRequiresAction race + constructor wiring)

- [x] 3.1 **RED** — Extend `src/tonder.pay.test.ts` or create `src/tonder.handleRequiresAction.test.ts` using `_createTonderWithDeps` with a `FakeCheckoutMessenger` (manually controllable resolve/never-resolve), fake host, and controllable `getTransaction`/`pollTransaction`. Write 7 failing cases:
  1. Messenger wins → `getTransaction` called once, `payResultFromTransaction` used, poll signal aborted, iframe unmounted.
  2. Poll wins → messenger cleaned up (signal aborted), iframe unmounted.
  3. Messenger never fires → poll resolves normally (regression guard: behavior identical to today).
  4. External abort → `REQUEST_ABORTED` propagates, iframe unmounted in `finally`.
  5. Messenger fires but `getTransaction` throws non-abort error → error propagates, aborted poll rejection suppressed, iframe unmounted.
  6. Redirect mode unchanged — `waitForCompletion` never called.
  7. APM embedded unchanged — `waitForCompletion` never called, returns `{ status: "pending" }`.
  Satisfies: *Requirements: handleRequiresAction race, redirect regression, APM regression*.

- [x] 3.2 **GREEN** — Modify `src/tonder.ts`:
  - Add `private readonly messenger: CheckoutMessengerPort` field.
  - Add 6th constructor arg `messenger?: CheckoutMessengerPort`; default `new BrowserCheckoutMessenger(new Set([this.env.payflow]))`.
  - `_createTonderWithDeps`: accept and forward optional `messenger?` as 6th dependency.
  - `handleRequiresAction` embedded branch: replace bare `pollUntilFinal` with `Promise.race`:
    ```
    controller = new AbortController();
    messengerPromise = messenger.waitForCompletion(controller.signal)
      .then(() => { controller.abort(); return getTransaction(result.transactionId); });
    pollPromise = pollTransaction(result.transactionId, { signal: controller.signal });
    messengerPromise.catch(() => {});
    pollPromise.catch(() => {});
    try { finalTx = await Promise.race([messengerPromise, pollPromise]); }
    finally { controller.abort(); host.unmount(); }
    ```
  - APM + redirect branches: untouched.
  - All 7 tests green. Satisfies: same requirements as 3.1.

---

## Phase 4: Documentation

- [x] 4.1 Edit `README.md` (or the relevant embedded 3DS section in docs): add a short note that embedded 3DS completion is now signaled instantly by the payflow iframe when available, falling back to polling otherwise. Remove/replace any prior "Coming next: CheckoutMessenger" placeholder line. Keep copy accurate: optimization is active only when the embedded page emits the message; polling remains the fallback.
  Satisfies: *No spec requirement — documentation hygiene*.

---

## Phase 5: Final Gate

- [x] 5.1 Run `npm run typecheck` — zero errors.
- [x] 5.2 Run `npm run lint` — zero warnings.
- [x] 5.3 Run `npx vitest run` — all suites green (adapter test, race tests, existing regressions).
- [x] 5.4 Commit: `feat(3ds): embedded completion via CheckoutMessenger with poll fallback`. No "Co-Authored-By", no AI attribution.
  Satisfies: *Final integration gate across all spec requirements*.

---

## Implementation Order

Tasks are strictly sequential within each phase; no parallelism needed for a single-developer slice:

```
1.1 (port) → 2.1 RED → 2.2 GREEN → 3.1 RED → 3.2 GREEN → 4.1 (docs) → 5.1–5.4 (gate + commit)
```

Phase 1 is a prerequisite for Phase 2 (adapter imports port); Phase 2 is a prerequisite for Phase 3 (constructor uses adapter); Phases 4 and 5 are independent of each other but both depend on Phases 2–3 being green.
