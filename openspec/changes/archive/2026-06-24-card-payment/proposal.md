# Change: card-payment — one-shot card payment via Direct API (Slice 3a)

## Intent
Implement `pay()` for a one-shot CARD payment over the Direct API: collect Skyflow tokens → `POST
/api/v1/process/` → return a standardized, camelCase result. Completes the core of M1 (no 3DS embed,
no getTransaction — those are separate changes).

## Why now
Slices 1–2 give init + business config + secure inputs (Skyflow Collect). This ties them into the
first real charge.

## Key facts (verified in backend code)
- **Customer is INLINE** — `direct_payment_service._create_payment` calls
  `Client.objects.get_or_create_customer(email)`. No separate `POST /customer/` for a one-shot payment.
  No `CustomerService` in this slice.
- `POST /api/v1/process/` body: `{ operation_type:'payment', amount, currency, client_reference?,
  metadata?, return_url, customer:{name,email}, payment_method:{ type:'CARD', card_number, cvv,
  expiration_month, expiration_year, cardholder_name } }` (card fields are Skyflow tokens). Headers:
  `Authorization: Token <apiKey>`, `Content-Type` (already on FetchHttpClient) + per-call
  `X-Request-Id` (idempotency).
- Response (HTTP 200 for success AND decline): `{ id, operation_type, status, amount(string), currency,
  client_reference, metadata, provider, created_at, status_code, next_action?{redirect_to_url{url,
  verify_transaction_status_url}}, decline_code?, decline_reason? }`. **Decline detection is the body
  `status`, NOT the HTTP code** (FetchHttpClient only throws on non-2xx).

## ⚠️ Correction to the exploration
- **`collect()` returns SNAKE keys** (Skyflow column names): `{ card_number, cvv, expiration_month,
  expiration_year, cardholder_name, skyflow_id }` — NOT camelCase. `card.strategy` must read those
  snake column keys. The apply MUST confirm the exact keys by reading
  `src/adapters/skyflow/skyflow.adapter.ts` (`CARD_FIELD_META` columns + what `collect()` returns).
- **`PayResult` does NOT include `AppError`.** Errors are THROWN (AppError); only processed outcomes are
  returned: `success | requires_action | declined`.

## Scope (in)
- `core/services/direct-api.service.ts` — `DirectApiService.processPayment(body, requestId)` →
  `POST /api/v1/process/` with `X-Request-Id`; transport failure → `AppError(PAYMENT_PROCESS_ERROR)`.
  Pure (injected HttpPort).
- `core/strategies/card.strategy.ts` — pure `buildCardPaymentMethod(tokens)` → `{ type:'CARD',
  card_number, cvv, expiration_month, expiration_year, cardholder_name }` read from the snake collect
  keys.
- `models/transaction.model.ts` — internal `BackendTransactionResponse` (snake), public camelCase
  `Transaction` (id, operationType, status, amount:string, currency, clientReference?, metadata?,
  provider?, createdAt, statusCode?, declineCode?, declineReason?), `mapToTransaction`, and
  `mapPayResult(raw)` (next_action → requires_action; status in {declined,failed} → declined; else
  success). `amount` stays a string (financial precision).
- `shared/types/index.ts` — `PayInput { amount, currency?, customer{name,email,phone?}, paymentMethod,
  metadata?, clientReference? }`; replace `PayResult` stub with `success | requires_action | declined`
  (no AppError member); import `Transaction`.
- `shared/errors` — add `INVALID_PAYMENT_REQUEST_CARD_PM` (+ message). (`PAYMENT_PROCESS_ERROR`,
  `INVALID_PAYMENT_REQUEST` already exist.)
- `tonder.ts` — `async pay(input): Promise<PayResult>`: guard ready (else `INVALID_PAYMENT_REQUEST`/
  not-ready); validate amount + customer.name/email (`INVALID_PAYMENT_REQUEST`); only `type:'card'` in
  this slice (else `INVALID_PAYMENT_REQUEST_CARD_PM`); `tokenizer.collect()` → `card.strategy` →
  `DirectApiService.processPayment` (X-Request-Id = `crypto.randomUUID()`) → `mapPayResult`. Throw
  `AppError(PAYMENT_PROCESS_ERROR)` on tokenizer/transport failure; re-throw existing AppError as-is.
  Wire `DirectApiService` from `this.http` (like businessService).
- `index.ts` — export `Transaction`, `PayInput` (PayResult already exported).

## Scope (out)
- `getTransaction` + polling (Slice 3b). 3DS embed-payflow (separate change — when next_action present,
  just return `requires_action` with the url). APM/SPEI/savedCard payment methods. COF/save.

## Approach
Ports & Adapters: `DirectApiService` (core/services, injected HttpPort, pure) + `card.strategy`
(core/strategies, pure function) + `transaction.model` mapper (pure). `pay()` orchestrates in the
facade. Errors thrown as `AppError`; outcomes returned as `PayResult`. STRICT TDD: test before impl per
unit; mock HttpPort + TokenizerPort via `_createTonderWithDeps`.

## Acceptance criteria
- `pay()` success → `{ status:'success', transaction }` with camelCase fields mapped from snake.
- decline (body status 'Declined'/'Failed') → `{ status:'declined', transaction, declineCode?,
  declineReason? }` (NOT thrown).
- `next_action` present → `{ status:'requires_action', nextAction:{ url, verifyTransactionStatusUrl? } }`.
- transport/tokenizer failure → throws `AppError(PAYMENT_PROCESS_ERROR)`; invalid input → throws
  `AppError(INVALID_PAYMENT_REQUEST)`; non-card type → `AppError(INVALID_PAYMENT_REQUEST_CARD_PM)`; before
  ready → throws AppError.
- `DirectApiService` POSTs the exact body to `/api/v1/process/` with `X-Request-Id`.
- `card.strategy` reads the actual snake collect() keys (verified against the adapter).
- Gates green: typecheck, lint, build (4 artifacts + new public types Transaction/PayInput in d.ts),
  `vitest run` (all pass), `npm audit` 0. `core/` pure. Public surface stays camelCase / no I-prefix.
- **README**: add the first real Quick start (createTonder → init → mountCardFields → pay) per
  docs/06-readme-guidelines.md.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
