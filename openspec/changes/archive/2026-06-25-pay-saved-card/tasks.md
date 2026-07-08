# Tasks: pay-saved-card (STRICT TDD — test before impl per unit)

## 1. Types
- [x] 1.1 `src/shared/types/index.ts` — rename `PaymentMethod` member
  `{ type:'savedCard'; id: string }` → `{ type:'savedCard'; cardId: string }`. Update any usage.

## 2. Strategy (TDD)
- [x] 2.1 `src/core/strategies/card.strategy.test.ts` (add, FIRST): `buildSavedCardPaymentMethod(cardId)`
  → `{ type:'CARD', token: cardId }`.
- [x] 2.2 `src/core/strategies/card.strategy.ts` — add `SavedCardPaymentMethod { type:'CARD'; token:
  string }` + pure `buildSavedCardPaymentMethod(cardId)`. Make 2.1 pass.

## 3. pay() facade (TDD)
- [x] 3.1 `src/tonder.pay.test.ts` (add): `pay({paymentMethod:{type:'savedCard', cardId}})` →
  `tokenizer.collect` NOT called; process body `payment_method == {type:'CARD', token: cardId}`; success
  → `{status:'success'}`; declined → `{status:'declined'}`; next_action → `{status:'requires_action'}`;
  missing `cardId` → `INVALID_PAYMENT_REQUEST`; `apm`/`spei` → `INVALID_PAYMENT_REQUEST_CARD_PM`. Confirm
  the existing `card` one-shot tests still pass.
- [x] 3.2 `src/tonder.ts` `pay()` — branch on `paymentMethod.type`: `'card'` (unchanged: collect +
  `buildCardPaymentMethod`), `'savedCard'` (validate `cardId` → `INVALID_PAYMENT_REQUEST`; no collect;
  `buildSavedCardPaymentMethod` ), else → `INVALID_PAYMENT_REQUEST_CARD_PM`. Same request envelope +
  `mapPayResult`. Make 3.1 pass.

## 4. README
- [x] 4.1 Root `README.md` — extend the Saved cards section: after `getCustomerCards`, show
  `pay({ amount, currency, customer, paymentMethod: { type: 'savedCard', cardId: cards[0].cardId } })`.

## 5. Verify
- [x] 5.1 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts shows
  `PaymentMethod ... cardId`), `vitest run` (all pass), `npm audit` (0). `core/` pure; public camelCase /
  no I-prefix / no "skyflow" in returned values.
- [x] 5.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: pay with a saved card via token`,
  `docs: README saved-card payment`).
