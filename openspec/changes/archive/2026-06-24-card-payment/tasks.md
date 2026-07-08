# Tasks: card-payment (STRICT TDD — test before impl per unit)

## 0. Confirm collect() keys
- [x] 0.1 Read `src/adapters/skyflow/skyflow.adapter.ts` — confirm the exact keys `collect()` returns
  (Skyflow column names, snake: `card_number, cvv, expiration_month, expiration_year, cardholder_name,
  skyflow_id`). `card.strategy` reads THESE keys.

## 1. Errors + types
- [x] 1.1 `src/shared/errors/ErrorKeyEnum.ts` + `messages.ts` — add `INVALID_PAYMENT_REQUEST_CARD_PM`
  ('Payment method must be a card for this operation.'). Confirm `PAYMENT_PROCESS_ERROR`,
  `INVALID_PAYMENT_REQUEST` exist.
- [x] 1.2 `src/shared/types/index.ts` — add `PayInput { amount:number; currency?:string; customer:{
  name:string; email:string; phone?:string }; paymentMethod:PaymentMethod; metadata?:Record<string,
  unknown>; clientReference?:string }`; replace `PayResult` stub with
  `{status:'success';transaction:Transaction} | {status:'requires_action';nextAction:{url:string;
  verifyTransactionStatusUrl?:string}} | {status:'declined';transaction:Transaction;declineCode?:string;
  declineReason?:string}` (NO AppError member); import `Transaction`.

## 2. transaction.model (TDD)
- [x] 2.1 `src/models/transaction.model.test.ts` (FIRST): `mapToTransaction` snake→camel for all fields
  (amount stays string); `mapPayResult` → success (status authorized/approved/pending/success), declined
  (declined/failed, with declineCode/declineReason), requires_action (next_action.redirect_to_url.url
  present takes precedence).
- [x] 2.2 `src/models/transaction.model.ts` — internal `BackendTransactionResponse` (snake), public
  `Transaction` (camelCase), `mapToTransaction`, `mapPayResult`. Make 2.1 pass.

## 3. card.strategy (TDD)
- [x] 3.1 `src/core/strategies/card.strategy.test.ts` (FIRST): maps the snake collect keys →
  `{type:'CARD', card_number, cvv, expiration_month, expiration_year, cardholder_name}`.
- [x] 3.2 `src/core/strategies/card.strategy.ts` — pure `buildCardPaymentMethod(tokens)`. Make 3.1 pass.

## 4. DirectApiService (TDD)
- [x] 4.1 `src/core/services/direct-api.service.test.ts` (FIRST, mock HttpPort): POSTs `/api/v1/process/`
  with the body + `X-Request-Id` header; returns raw response on success; HttpPort throws →
  `AppError(PAYMENT_PROCESS_ERROR)`.
- [x] 4.2 `src/core/services/direct-api.service.ts` — `DirectApiService.processPayment(body, requestId)`.
  Pure (injected HttpPort). Make 4.1 pass.

## 5. pay() facade (TDD)
- [x] 5.1 `src/tonder.pay.test.ts` (FIRST, mock http + tokenizer via `_createTonderWithDeps`): success →
  `{status:'success', transaction camelCase}`; decline → `{status:'declined', declineCode, declineReason}`;
  next_action → `{status:'requires_action', nextAction}`; http error → throws
  `AppError(PAYMENT_PROCESS_ERROR)`; before ready → throws AppError; missing amount/customer.email →
  `INVALID_PAYMENT_REQUEST`; non-card type → `INVALID_PAYMENT_REQUEST_CARD_PM`; tokenizer rejects →
  `PAYMENT_PROCESS_ERROR`. (~9 cases.) Mock collect() returns snake keys.
- [x] 5.2 `src/tonder.ts` — `async pay(input):Promise<PayResult>` (guard ready, validate input, card-only,
  collect → card.strategy → DirectApiService(X-Request-Id=crypto.randomUUID()) → mapPayResult; throw
  AppError(PAYMENT_PROCESS_ERROR) on tokenizer/transport, re-throw AppError as-is). Wire DirectApiService.
  Make 5.1 pass.

## 6. Exports + README
- [x] 6.1 `src/index.ts` — export `Transaction`, `PayInput`.
- [x] 6.2 Root `README.md` — add the first real **Quick start** (install npm + CDN; createTonder → init
  → mountCardFields (with the kebab `<div>` ids) → pay → handle success/declined/requires_action), per
  docs/06-readme-guidelines.md. Keep it concise; note 3DS/getTransaction are coming.

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (assert dist mjs/cjs/global/d.ts + new
  public types Transaction/PayInput present, PayResult updated), `vitest run` (all pass), `npm audit`
  (0). Confirm `core/` has no DOM/fetch imports; public surface stays camelCase / no I-prefix.
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: transaction model + mapper`,
  `feat: card strategy`, `feat: direct api service`, `feat: pay() one-shot card`, `docs: README quick start`).
