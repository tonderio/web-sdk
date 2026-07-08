# Tasks: saved-cards (STRICT TDD — test before impl per unit)

## 1. Errors + state + types
- [x] 1.1 `src/shared/errors/ErrorKeyEnum.ts` + `messages.ts` — add `SECURE_TOKEN_REQUIRED`
  ('A secure token is required for this operation. Provide getSecureToken in the SDK config.'),
  `CUSTOMER_NOT_REGISTERED` ('No customer registered. Call registerCustomer() first.'),
  `INVALID_EMAIL` ('A valid customer email is required.').
- [x] 1.2 `src/core/TonderCore.ts` — add `customerAuthToken: string | null` to `TonderState` (init null).
- [x] 1.3 `src/shared/types/index.ts` — `CustomerInput { email: string; firstName?: string;
  lastName?: string; phone?: string }`; public `Card { skyflowId; cardNumber; expirationMonth;
  expirationYear; cardScheme; subscriptionId: string | null }`.

## 2. card.model (TDD)
- [x] 2.1 `src/models/card.model.test.ts` (FIRST): `mapToCard` snake→camel for all fields; handles
  `subscription_id: null`; passes `card_scheme` through.
- [x] 2.2 `src/models/card.model.ts` — internal `BackendCard`/`BackendCardsResponse` (snake), `mapToCard`.

## 3. CustomerService (TDD)
- [x] 3.1 `src/core/services/customer.service.test.ts` (FIRST, mock HttpPort): POSTs `/api/v1/customer/`
  with `Authorization: Token {apiKey}` + body `{ email, ... }`; returns `{ id, authToken }` (from
  `auth_token`); transport → `CUSTOMER_OPERATION_ERROR`; existing AppError re-thrown.
- [x] 3.2 `src/core/services/customer.service.ts` — `registerOrFetch(apiKey, input)`. Pure. Make 3.1 pass.

## 4. CardService (TDD)
- [x] 4.1 `src/core/services/card.service.test.ts` (FIRST, mock HttpPort): `getCards` GETs
  `/api/v1/business/{pk}/cards/` with Authorization Bearer secureToken + `User-Token` + (optional)
  `X-Signature-Transaction`; omits signature header when absent; maps → `Card[]`; transport →
  `FETCH_CARDS_ERROR`. `removeCard` DELETEs `/api/v1/business/{pk}/cards/{skyflowId}/`, resolves void on
  2xx; transport → `REMOVE_CARD_ERROR`.
- [x] 4.2 `src/core/services/card.service.ts` — `getCards`/`removeCard` (integer `businessPk` in path).
  Pure. Make 4.1 pass.

## 5. Facade (TDD)
- [x] 5.1 `src/tonder.registerCustomer.test.ts` (FIRST): not-ready → `NOT_INITIALIZED`; missing email →
  `INVALID_EMAIL`; happy → caches `customerAuthToken` (verify via `getState()`); transport →
  `CUSTOMER_OPERATION_ERROR`.
- [x] 5.2 `src/tonder.getCustomerCards.test.ts` (FIRST): not-ready → `NOT_INITIALIZED`; no customer →
  `CUSTOMER_NOT_REGISTERED`; no `getSecureToken` → `SECURE_TOKEN_REQUIRED`; getSecureToken throws →
  `SECURE_TOKEN_ERROR`; happy → `Card[]` + calls getSignature when present (header included), omitted when
  absent; transport → `FETCH_CARDS_ERROR`.
- [x] 5.3 `src/tonder.removeCustomerCard.test.ts` (FIRST): same guards; happy → void; transport →
  `REMOVE_CARD_ERROR`.
- [x] 5.4 `src/tonder.ts` — implement `registerCustomer`, `getCustomerCards`, `removeCustomerCard`; wire
  `CustomerService` + `CardService` from `this.http`; getSignature ctx `{ apiType, userToken }`. Make
  5.1–5.3 pass.

## 6. Exports + README
- [x] 6.1 `src/index.ts` — export `Card`, `CustomerInput`.
- [x] 6.2 Root `README.md` — short **Saved cards** section (registerCustomer → getCustomerCards/
  removeCustomerCard; note needs `getSecureToken` from the merchant backend; cards never expose secrets).

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts has `Card`, `CustomerInput`),
  `vitest run` (all pass), `npm audit` (0). `core/` pure; public camelCase / no I-prefix / no "skyflow"
  in returned values.
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: customer service`, `feat: card service +
  model`, `feat: registerCustomer + saved cards on facade`, `docs: README saved cards`).
