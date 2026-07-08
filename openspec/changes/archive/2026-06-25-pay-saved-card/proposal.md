# Change: pay-saved-card — charge a saved card via /process (COF Slice 3)

## Intent
Let `pay()` charge a previously saved card by its id: `pay({ paymentMethod: { type: 'savedCard',
cardId } })`. The SDK sends `payment_method: { type: 'CARD', token: <cardId> }`; the backend (B1, now
merged on `release/DEV-2245`) resolves the token → vault tokens (+ COF subscription auto-detect). No
card fields are mounted/collected — the stored card is charged.

## Why now
B1 (the backend token bridge) is implemented and verified. The SDK already has `getCustomerCards`
(returns `Card.cardId`); this closes the loop so a listed card can be charged.

## Scope (in)
- `shared/types/index.ts` — rename `PaymentMethod` `{ type:'savedCard'; id: string }` →
  `{ type:'savedCard'; cardId: string }` (consistency with `Card.cardId`,
  `MountCardFieldsRequest.cardId`, `removeCustomerCard(cardId)`).
- `core/strategies/card.strategy.ts` — add `SavedCardPaymentMethod { type:'CARD'; token: string }` and
  `buildSavedCardPaymentMethod(cardId): SavedCardPaymentMethod` (pure → `{ type:'CARD', token: cardId }`).
- `tonder.ts` `pay()` — branch on `paymentMethod.type`:
  - `'card'` → existing flow (collect tokens → `buildCardPaymentMethod` → process).
  - `'savedCard'` → validate `cardId` present (else `INVALID_PAYMENT_REQUEST`); **no `tokenizer.collect()`**;
    `buildSavedCardPaymentMethod(cardId)` → process. Same `mapPayResult` (success / declined /
    requires_action — a saved card can still trigger 3DS).
  - `'apm'` / `'spei'` → still `INVALID_PAYMENT_REQUEST_CARD_PM` (not in this slice; message: card/saved
    card only).
- README — add saved-card payment to the Saved cards section (`getCustomerCards` → `pay({ paymentMethod:
  { type:'savedCard', cardId } })`).

## Scope (out)
- Fresh-CVV-on-saved-card (the stored CVV token / COF subscription is used; not needed now). APM/SPEI
  payment. Enrollment (separate slice). 3DS embed (separate change, B2).

## Approach
Small extension of `pay()`. Saved-card payment is browser-only (public apiKey) — the customer goes
inline in `/process`, no `secureToken` for the charge itself (that was only for listing/managing cards).
`core/` stays pure; the strategy is a pure function. STRICT TDD: test before impl; mock HttpPort +
TokenizerPort via `_createTonderWithDeps`.

## Acceptance criteria
- `pay({ paymentMethod: { type:'savedCard', cardId } })` → does NOT call `tokenizer.collect()`; the
  `/process` body `payment_method` is `{ type:'CARD', token: cardId }` (customer inline, return_url,
  X-Request-Id as today); returns `success` / `declined` / `requires_action` via `mapPayResult`.
- Missing `cardId` for `savedCard` → throws `AppError(INVALID_PAYMENT_REQUEST)`.
- `'apm'`/`'spei'` → still `AppError(INVALID_PAYMENT_REQUEST_CARD_PM)`.
- `'card'` one-shot flow unchanged (regression: existing pay tests stay green).
- Gates green: typecheck, lint, build (4 artifacts; `PaymentMethod.cardId` in d.ts), `vitest run` (all
  pass), `npm audit` 0. `core/` pure; public camelCase / no I-prefix / no vendor leak.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
