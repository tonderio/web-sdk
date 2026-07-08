# Proposal: Embedded 3DS CheckoutMessenger (Slice 1, SDK)

## Intent

Embedded 3DS completion is detected today ONLY by polling `getTransaction` until a
final state appears, adding latency (poll-interval delay) after the user finishes the
challenge. The embedded payflow iframe can `postMessage` the moment 3DS reaches a final
state. This change lets the SDK resolve immediately on that message while keeping the
poll as a fallback — a pure optimization with ZERO behavior change when no message arrives.

## Scope

### In Scope
- New `CheckoutMessengerPort` (`src/ports`) + `BrowserCheckoutMessenger` adapter (`src/adapters/browser`): listens to window `message`, validates `event.origin` against the `resolveEnv(mode).payflow` allowlist, accepts only `checkout.completed` / `checkout.failed`, cleans up the listener in all exit paths, rejects `REQUEST_ABORTED` on signal abort.
- `handleRequiresAction` embedded branch: `Promise.race([messenger (primary), poll (fallback)])` sharing one `AbortController`; the winner aborts the loser. Messenger path does ONE `getTransaction(transactionId)` then `payResultFromTransaction`. Loser rejection suppressed via `.catch(() => {})`.
- `Tonder` constructor: optional `messenger?: CheckoutMessengerPort` (defaults to `BrowserCheckoutMessenger` with the payflow allowlist); keep the `_createTonderWithDeps` test seam.

### Out of Scope (Non-Goals)
- **Slice 2** — hosted-checkout `ThreeDSPayment.tsx` postMessage emit. Separate change, gated on `post_message_enabled` being present in the `/process` JWT and `true` for SDK flows.
- No change to redirect-mode 3DS, APM flows, or `handleApmResult` (APMs settle async; no in-session final state to signal — documented).
- No new public error codes; origin/parse failures are silently ignored.

## Capabilities

### New Capabilities
- `embedded-threeds-completion`: how the SDK detects embedded 3DS completion — messenger-primary, poll-fallback, single-resolution guarantee, origin security.

### Modified Capabilities
None.

## Approach

Approach A from exploration: messenger primary + poll fallback via `Promise.race` over a
shared `AbortController`. The messenger is a DOM-touching ADAPTER behind a port, so
`tonder.ts` (core) stays pure and testable with a fake. **No-double-resolve guarantee:**
`pollUntilFinal`'s `resolved` guard makes its settle functions no-ops once settled; if the
messenger wins and aborts, the poll's abort path is a no-op. If the poll wins, the
messenger's abort listener cleans up and its `.then()` never runs. Exactly one resolution.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/ports/checkout-messenger.port.ts` | New | `CheckoutMessengerPort` interface |
| `src/adapters/browser/browser-checkout-messenger.adapter.ts` | New | `BrowserCheckoutMessenger` window-message listener |
| `src/tonder.ts` | Modified | `handleRequiresAction` embedded branch → race; constructor accepts `messenger` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `post_message_enabled` not set in JWT → message never fires | Med | Poll fallback resolves normally; optimization is inert, not broken |
| Race-loser unhandled rejection warning | Med | `.catch(() => {})` on both racers |
| Message from unexpected origin | Low | Allowlist per mode; non-matching origins silently ignored |
| Double resolution | Low | `resolved` guard + shared abort (proven) |

## Rollback Plan

Revert the `handleRequiresAction` embedded branch to poll-only and drop the new port/adapter.
Constructor default is internal, so no public API breakage. Behavior returns to current poll path.

## Dependencies

- Slice 2 (hosted-checkout postMessage emit) + backend `post_message_enabled` in the `/process` JWT — required for the messenger to actually fire, but NOT required to ship Slice 1 safely.

## Success Criteria

- [ ] Messenger fires before first poll tick → resolves from messenger, poll aborted, single resolution.
- [ ] Messenger never fires → poll resolves normally (regression-safe).
- [ ] Listener cleaned up and iframe unmounted in all exit paths.
- [ ] No new public error codes; public surface camelCase, no `I` prefix; backend snake mapped at adapters.
- [ ] All existing `tonder` tests pass.
