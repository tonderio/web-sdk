# Tasks: threeds-presentation (STRICT TDD — test before impl per unit)

## 1. Types + config
- [x] 1.1 `src/shared/types/index.ts` — `TonderConfig`: add `threeDsMode?: 'redirect' | 'embedded'`
  (default 'redirect') + `threeDsContainerId?: string` (default '#tonder-3ds'). `PayResult`
  `requires_action` branch: add `transactionId: string`.

## 2. Transaction mapper (TDD)
- [x] 2.1 `src/models/transaction.model.test.ts` (extend, FIRST): `mapPayResult` requires_action includes
  `transactionId: raw.id`; new `payResultFromTransaction(tx)` → success for authorized/approved/success/
  paid/paid_full, declined for declined/failed/rejected/expired/cancelled/canceled.
- [x] 2.2 `src/models/transaction.model.ts` — add `transactionId` to requires_action; add
  `payResultFromTransaction(tx: Transaction): PayResult`. Make 2.1 pass.

## 3. ThreeDsHostPort + Browser adapter (TDD)
- [x] 3.1 `src/ports/redirect-host.port.ts` → `ThreeDsHostPort`: `redirect(url): void`,
  `mountIframe(url, containerId): void`, `unmount(): void`. (Rename the interface; keep or rename file.)
- [x] 3.2 `src/adapters/browser/browser-3ds-host.adapter.test.ts` (FIRST, jsdom): `redirect` sets
  `window.location.href` (spy/stub); `mountIframe` creates an `<iframe src=url>` in the container element;
  `unmount` removes it; missing container → throws a clear AppError (or no-op + warn — pick one and test).
- [x] 3.3 `src/adapters/browser/browser-3ds-host.adapter.ts` — `Browser3dsHost implements ThreeDsHostPort`.
  Make 3.2 pass. (DOM/window ONLY here.)

## 4. pay() auto-handle (TDD)
- [x] 4.1 `src/tonder.pay.test.ts` (extend, FIRST; inject fake host via `_createTonderWithDeps`):
  - redirect mode (default): requires_action → `host.redirect(nextAction.url)` called; returns the
    requires_action result with `transactionId`; `host.mountIframe` NOT called.
  - embedded mode (config `threeDsMode:'embedded'`): requires_action → `host.mountIframe(url,
    containerId)` called → poll drives to final (mock getTransaction/http to return a final status) →
    `host.unmount()` called → resolves `{status:'success', transaction}` (and a declined variant).
  - success/declined (no action) → no host call (regression).
  - savedCard + requires_action → same handling.
- [x] 4.2 `src/tonder.ts` — in `pay()`, after `mapPayResult`, if `requires_action`: branch on
  `config.threeDsMode` (default 'redirect'): redirect → `host.redirect(url)`, return the result; embedded
  → `host.mountIframe(url, containerId)` + `pollTransaction(transactionId)` + `host.unmount()` →
  `payResultFromTransaction(finalTx)` (unmount in a finally so it runs on poll error too). Wire
  `Browser3dsHost` in constructor; add `host?: ThreeDsHostPort` to `_createTonderWithDeps`. Make 4.1 pass.

## 5. Exports + README
- [x] 5.1 `src/index.ts` — export `ThreeDsHostPort` type if useful (optional; the field is on TonderConfig
  which is already exported).
- [x] 5.2 Root `README.md` — document `threeDsMode` in the payment/quick-start: `'redirect'` (default,
  navigates to the 3DS page, recover status via `getTransaction` on `returnUrl`) vs `'embedded'`
  (set `threeDsContainerId`, the SDK mounts an iframe and resolves when the transaction is final).

## 6. Verify
- [x] 6.1 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts has `threeDsMode`),
  `vitest run` (all pass), `npm audit` (0). `core/` pure (grep: no window/document/fetch in core/ +
  models/; DOM only under adapters/browser/). Public camelCase / no I-prefix / no vendor leak.
- [x] 6.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: threeDsMode config + browser 3ds host`,
  `feat: pay() presents 3ds via redirect or embedded iframe`, `docs: README threeDsMode`).
