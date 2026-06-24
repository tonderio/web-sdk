# Tasks: get-transaction (STRICT TDD — test before impl per unit)

## 1. Errors
- [x] 1.1 `src/shared/errors/ErrorKeyEnum.ts` + `messages.ts` — add `POLL_TIMEOUT_ERROR`
  ('Transaction polling timed out.'). Confirm `FETCH_TRANSACTION_ERROR` + `REQUEST_ABORTED` exist.

## 2. DirectApiService.getTransaction (TDD)
- [x] 2.1 `src/core/services/direct-api.service.test.ts` (add, FIRST, mock HttpPort): GETs
  `/api/v1/transactions/{id}/`; returns raw response; passes `signal` to `HttpPort.request`; transport
  404/400/error → `AppError(FETCH_TRANSACTION_ERROR)` (statusCode preserved).
- [x] 2.2 `src/core/services/direct-api.service.ts` — `getTransaction(id, signal?)`. Pure. Make 2.1 pass.

## 3. Poll util (TDD, fake timers)
- [x] 3.1 `src/shared/utils/poll.test.ts` (FIRST, `vi.useFakeTimers()`): resolves on final status;
  polls N times before final (assert call count + backoff schedule start 2s ×1.5 cap 5s); times out →
  `AppError(POLL_TIMEOUT_ERROR)`; abort via signal → `AppError(REQUEST_ABORTED)` + no further fetchFn
  calls; pre-aborted signal → immediate reject, fetchFn never called; single-resolution when timeout +
  final coincide. Use `advanceTimersByTimeAsync` to flush async between ticks.
- [x] 3.2 `src/shared/utils/poll.ts` — `FINAL_STATUSES` (success, authorized, approved, paid, paid_full,
  declined, failed, rejected, expired, cancelled, canceled, refunded — case-insensitive), `PollOptions`,
  `pollUntilFinal(fetchFn, id, options?)`: recursive setTimeout, `resolved` flag, abort listener, timeout
  guard. Pure (no DOM/fetch/core imports). Make 3.1 pass.

## 4. Facade getTransaction (TDD)
- [x] 4.1 `src/tonder.getTransaction.test.ts` (FIRST): delegates to service → `mapToTransaction` → public
  Transaction; AppError(FETCH_TRANSACTION_ERROR) propagated; unknown error wrapped as
  `FETCH_TRANSACTION_ERROR`. No ready guard (works without init's Skyflow state — only needs apiKey).
- [x] 4.2 `src/tonder.ts` — `getTransaction(id)`. Make 4.1 pass.

## 5. Facade pollTransaction (TDD, fake timers)
- [x] 5.1 `src/tonder.pollTransaction.test.ts` (FIRST): resolves when getTransaction returns a final tx
  after N polls; forwards options (intervalMs/timeoutMs); passes signal to internal getTransaction
  (abort → REQUEST_ABORTED, no further calls).
- [x] 5.2 `src/tonder.ts` — `pollTransaction(id, options?)`: internal `AbortController` merged with
  `options.signal`; `pollUntilFinal((id, signal) => this.getTransactionRaw(id, signal) → map, id,
  options)`. Add the future-messenger seam as a doc comment (PRIMARY messenger + FALLBACK poll via shared
  AbortController + Promise.race). Make 5.1 pass.

## 6. Exports + README
- [x] 6.1 `src/index.ts` — export `PollOptions` type + `FINAL_STATUSES`.
- [x] 6.2 Root `README.md` — short note: `getTransaction(id)` / `pollTransaction(id, options?)` for
  status reconciliation (used after redirects; async APMs rely on webhooks).

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts has `PollOptions`,
  `FINAL_STATUSES`), `vitest run` (all pass), `npm audit` (0). `core/` pure; public camelCase / no I-prefix.
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: getTransaction service+facade`,
  `feat: cancelable transaction poll util`, `feat: pollTransaction facade`, `docs: README status note`).
