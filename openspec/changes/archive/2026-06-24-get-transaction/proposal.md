# Change: get-transaction — getTransaction + cancelable polling (Slice 3b)

## Intent
Let integrators read a transaction's current status (`getTransaction(id)`) and poll it to a final
status with backoff (`pollTransaction(id, options?)`). Closes M1's status loop. The poll is built to
**compose cleanly with the future payflow CheckoutMessenger** (Q2) without clashing.

## Why now
After a redirect (3DS/APM) or for async reconciliation, the merchant needs the final status. The
mapper + service from Slice 3a are reused.

## ⚠️ No-clash requirement (user-flagged)
The embed-payflow CheckoutMessenger (Q2) is NOT built here, but the poll MUST be designed so it never
double-resolves or races the messenger later:
- **Cancelable** via `AbortSignal`.
- **Single-resolution** — resolves exactly once (first of: final status, timeout, abort).
- **Never auto-started** — `getTransaction`/`pollTransaction` are explicit methods; the SDK starts no
  polling on its own anywhere in this slice.
- **Composition seam** (documented, not implemented): the future messenger is PRIMARY, the poll is
  FALLBACK, wired at call-site with a shared `AbortController` + `Promise.race` — messenger completion
  `controller.abort()`s the poll (→ `REQUEST_ABORTED`), so exactly one result wins.

## Scope (in)
- `core/services/direct-api.service.ts` — `getTransaction(id, signal?)` → `GET /api/v1/transactions/{id}/`;
  pass `signal` to `HttpPort.request`; transport/404/400 → `AppError(FETCH_TRANSACTION_ERROR)` (exists).
  Reuse `BackendTransactionResponse`/`mapToTransaction` (GET shape is a superset; `updated_at` ignored).
- `shared/utils/poll.ts` — pure cancelable poll: `PollOptions { intervalMs?=2000, maxIntervalMs?=5000,
  factor?=1.5, timeoutMs?=180000, signal? }`; `pollUntilFinal(fetchFn, id, options?)` using **recursive
  setTimeout** (not setInterval — no overlap), a `resolved` single-resolution flag, abort listener
  (→ `AppError(REQUEST_ABORTED)`), timeout (→ `AppError(POLL_TIMEOUT_ERROR)`). Pure: injected `fetchFn`,
  no DOM/fetch/core imports. `FINAL_STATUSES` exported constant.
- `shared/errors` — add `POLL_TIMEOUT_ERROR` (+ message). (`FETCH_TRANSACTION_ERROR`, `REQUEST_ABORTED`
  already exist.)
- `tonder.ts` — `getTransaction(id): Promise<Transaction>` (NO ready guard — read-only, needs only the
  apiKey; service → `mapToTransaction`; AppError bubbles, unknown → `FETCH_TRANSACTION_ERROR`);
  `pollTransaction(id, options?): Promise<Transaction>` (internal `AbortController` merged with
  `options.signal`; calls `pollUntilFinal((id, signal) => mapToTransaction(await
  directApiService.getTransaction(id, signal)), id, options)`). Document the messenger seam as a comment.
- `index.ts` — export `PollOptions` type + `FINAL_STATUSES`.
- README — short note that `getTransaction`/`pollTransaction` exist (status reconciliation).

## FINAL_STATUSES (SDK "outcome known" set)
Terminal: `success, authorized, approved, paid, paid_full, declined, failed, rejected, expired,
cancelled, canceled, refunded` (case-insensitive). **Includes `authorized`/`approved`** so the poll
stops at an approved card outcome (consistent with `pay()` mapping authorized→success) instead of
spinning. Non-final (keep polling): `pending`, `in review`, `needs response`, `waiting`. Note: async
methods (SPEI/OXXO) rest at `pending` → they rely on webhooks, not in-session polling (poll would time
out, by design).

## Scope (out)
- The CheckoutMessenger itself + embed-payflow (Q2 — separate change). 3DS handling. Auto-poll.

## Approach
Ports & Adapters: `getTransaction` on the existing pure service; the poll is a pure util (injected
`fetchFn`, `AbortSignal`); the facade composes them. STRICT TDD with `vi.useFakeTimers()` /
`advanceTimersByTimeAsync` (vitest 4 supports it) — no real waiting.

## Acceptance criteria
- `getTransaction(id)` → mapped camelCase `Transaction`; 404/400/transport → `AppError(FETCH_TRANSACTION_ERROR)`
  (with original `statusCode` preserved); no ready guard.
- `pollUntilFinal`: resolves with the tx when status becomes final; respects backoff (start 2s, ×1.5,
  cap 5s); times out → `AppError(POLL_TIMEOUT_ERROR)`; aborts via signal → `AppError(REQUEST_ABORTED)`,
  makes NO further `fetchFn` calls after abort; **single-resolution** (timeout + final on the same tick
  settle exactly once); pre-aborted signal → rejects immediately, never calls `fetchFn`.
- `pollTransaction` forwards options + signal; aborting cancels in-flight requests.
- Gates green: typecheck, lint, build (4 artifacts + `PollOptions`/`FINAL_STATUSES` in d.ts),
  `vitest run` (all pass), `npm audit` 0. `core/` pure; public surface camelCase / no I-prefix.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
