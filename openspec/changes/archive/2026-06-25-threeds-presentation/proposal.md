# Change: threeds-presentation — integrator chooses 3DS/redirect mode (redirect | embedded)

## Intent
Let the SDK consumer choose how a `requires_action` (3DS / redirect) flow is presented, via a config
field `threeDsMode: 'redirect' | 'embedded'`. `pay()` auto-handles the action per the mode. **No backend
dependency** — works with what Direct API returns today; CheckoutMessenger/B2 is a future enhancement
of embedded mode, not a requirement.

## Why now
`pay()` returns `requires_action` with a URL but the SDK doesn't yet act on it. This closes the card
payment flow (3DS) for both presentation styles, without waiting on B2.

## Two modes (both work with the current backend)
- **`redirect`** (default): `window.location.href = nextAction.url`. The browser navigates to the 3DS
  page; the shopper returns to `returnUrl`; the merchant calls `getTransaction(id)` on return. No
  container, no iframe, no X-Frame risk. The raw self-contained Kushki URL completes the charge +
  redirects back on its own.
- **`embedded`**: mount `nextAction.url` in an iframe inside a merchant container, then
  `pollTransaction(transactionId)` until a final status → resolve the final `PayResult`. No navigation.
  (Future B2: CheckoutMessenger gives a faster completion signal than polling + a payflow-wrapped URL.)

## Scope (in)
- `shared/types/index.ts` —
  - `TonderConfig`: add `threeDsMode?: 'redirect' | 'embedded'` (default `'redirect'`) and
    `threeDsContainerId?: string` (default `'#tonder-3ds'`, used only by embedded).
  - `PayResult` `requires_action`: add `transactionId: string` (needed so embedded can poll). Keep
    `nextAction { url, verifyTransactionStatusUrl? }`.
- `models/transaction.model.ts` — `mapPayResult` includes `transactionId: raw.id` on the
  `requires_action` branch. Add `payResultFromTransaction(tx: Transaction): PayResult` (success when
  status ∈ success/authorized/approved/paid/paid_full; declined when ∈ declined/failed/rejected/
  expired/cancelled/canceled).
- `ports/redirect-host.port.ts` → repurpose as **`ThreeDsHostPort`** (rename interface; keep file or
  rename to `threeds-host.port.ts`): `redirect(url: string): void`, `mountIframe(url: string,
  containerId: string): void`, `unmount(): void`. (Drop the messenger `onComplete` for now; B2 adds it.)
- `adapters/browser/browser-3ds-host.adapter.ts` — `Browser3dsHost implements ThreeDsHostPort`: `redirect`
  → `window.location.href = url`; `mountIframe` → create an `<iframe src=url>` into the container element
  (querySelector), full-size; `unmount` → remove it. DOM lives here only (injectable → tests pass a fake).
- `tonder.ts` — `pay()` auto-handles a `requires_action` result:
  - `redirect` mode → `host.redirect(nextAction.url)` then return the `requires_action` result (page
    navigates; the merchant recovers status on `returnUrl` via `getTransaction`).
  - `embedded` mode → `host.mountIframe(nextAction.url, threeDsContainerId)` →
    `pollTransaction(transactionId)` → `host.unmount()` → resolve `payResultFromTransaction(finalTx)`
    (success/declined). On poll timeout/abort the AppError propagates (after unmount).
  - Wire `Browser3dsHost` in the constructor; add `host?: ThreeDsHostPort` to `_createTonderWithDeps`.
  This applies to BOTH `card` and `savedCard` payments (a saved card can also trigger 3DS).

## Scope (out)
- CheckoutMessenger / payflow-wrapped URL / B2 (future embedded enhancement). APM/SPEI redirect (later;
  the same host can serve them). Auto-recovery of the pending txn id across the redirect (the merchant
  holds the id from the `requires_action` result before navigation).

## Approach
Browser/DOM only in `adapters/browser/` behind `ThreeDsHostPort` (injectable → jsdom tests pass a fake
host: `redirect`/`mountIframe`/`unmount` spies). Embedded completion = `pollTransaction` (already built,
cancelable). STRICT TDD. `core/` stays pure.

## Acceptance criteria
- `redirect` mode (default): `pay()` on `requires_action` → `host.redirect(url)` called with the
  `nextAction.url`; returns the `requires_action` result (incl. `transactionId`).
- `embedded` mode: `pay()` on `requires_action` → `host.mountIframe(url, containerId)` called →
  `pollTransaction(transactionId)` drives to final → `host.unmount()` → resolves
  `{status:'success'|'declined', transaction}`.
- A non-action payment (success/declined) is unchanged (no host call). Works for both `card` and
  `savedCard`.
- `mapPayResult` requires_action carries `transactionId`.
- Gates green: typecheck, lint, build (4 artifacts; `threeDsMode` in `TonderConfig` d.ts), `vitest run`
  (all pass), `npm audit` 0. `core/` pure (DOM only under adapters/browser/); public camelCase / no
  I-prefix / no vendor leak.
- README: document `threeDsMode` (redirect default vs embedded + container) in the payment section.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
