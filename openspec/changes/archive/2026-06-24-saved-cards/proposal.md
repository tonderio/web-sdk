# Change: saved-cards — customer registration + read/manage saved cards (COF Slice 1)

## Intent
Let integrators register a customer and list/remove their saved cards. First slice of COF — uses
**existing** backend endpoints (no backend change needed). Enrollment (Kushki COF) and pay-with-saved
are later slices.

## Why now
Saved-card UX is a core COF capability and the foundation for enrollment + pay-with-saved. It also
introduces the customer-auth plumbing (secureToken + User-Token) the rest of COF needs.

## Key facts (verified in backend code)
- **Customer**: `POST /api/v1/customer/` (Auth `Token {apiKey}`, body `{ email, first_name?, last_name?,
  phone? }`) → `{ id, auth_token, ... }`. `get_or_create_customer(email)` — idempotent.
- **List**: `GET /api/v1/business/{business_pk}/cards/` → `{ user_id, cards: [{ fields: { card_number
  (masked "XXXX-XXXX-XXXX-1234"), expiration_month, expiration_year, skyflow_id, subscription_id|null,
  card_scheme } }] }`.
- **Delete**: `DELETE /api/v1/business/{business_pk}/cards/{skyflow_id}/` → **HTTP 200** `{ message }`
  (NOT 204 — ionic reference checks 204, that's a bug; treat any 2xx as success).
- **Card endpoints auth** (3 headers): `Authorization: Bearer {secureToken}` (from
  `config.getSecureToken()`), `User-Token: {customer auth_token}`, optional `X-Signature-Transaction`
  (from `config.getSignature(ctx)` — HMAC opt-in per business; SDK sends it only if the callback is
  provided; backend skips when inactive). `business_pk` is the **integer** `business.pk` (not apiKey).
- The SDK does NOT call `/api/secure-token/` — the merchant backend mints the secureToken.

## Scope (in)
- `core/services/customer.service.ts` — `registerOrFetch(apiKey, input)` → `POST /customer/`; transport
  failure → `AppError(CUSTOMER_OPERATION_ERROR)`. Pure.
- `core/services/card.service.ts` — `getCards(businessPk, secureToken, userToken, signature?)` (GET →
  `Card[]`), `removeCard(businessPk, skyflowId, secureToken, userToken, signature?)` (DELETE → void).
  Headers per above; transport failure → `FETCH_CARDS_ERROR` / `REMOVE_CARD_ERROR`. Pure.
- `models/card.model.ts` — internal `BackendCard*` (snake), public `Card` (camelCase: skyflowId,
  cardNumber, expirationMonth, expirationYear, cardScheme, subscriptionId), `mapToCard`.
- `core/TonderCore.ts` — add `customerAuthToken: string | null` to state (init null).
- `shared/types/index.ts` — `CustomerInput { email; firstName?; lastName?; phone? }`, public `Card`.
- `shared/errors` — add `SECURE_TOKEN_REQUIRED`, `CUSTOMER_NOT_REGISTERED`, `INVALID_EMAIL`
  (+ messages). (`FETCH_CARDS_ERROR`, `REMOVE_CARD_ERROR`, `CUSTOMER_OPERATION_ERROR`, `SECURE_TOKEN_ERROR`,
  `NOT_INITIALIZED` already exist.)
- `tonder.ts` — facade:
  - `registerCustomer(input)`: guard ready (`NOT_INITIALIZED`); validate `email` (`INVALID_EMAIL`);
    `CustomerService.registerOrFetch` → cache `authToken` in core state.
  - `getCustomerCards()`: guards ready + `customerAuthToken` set (`CUSTOMER_NOT_REGISTERED`) +
    `config.getSecureToken` present (`SECURE_TOKEN_REQUIRED`); resolve secureToken (callback throws →
    `SECURE_TOKEN_ERROR`); optional signature via `config.getSignature({ apiType:'listCards', userToken })`;
    `CardService.getCards` → `Card[]`.
  - `removeCustomerCard(skyflowId)`: same guards; `getSignature({ apiType:'deleteCard', userToken })`;
    `CardService.removeCard` → void.
  - Wire `CustomerService` + `CardService` from `this.http`; extend `_createTonderWithDeps` if needed.
- `index.ts` — export `Card`, `CustomerInput`.
- README — a short **Saved cards** section (registerCustomer → getCustomerCards/removeCustomerCard;
  note: needs `getSecureToken` from the merchant backend).

## Scope (out)
- Enrollment / Kushki COF / saveCard (next slice). Pay-with-saved (needs backend B1). Card summary.

## Approach
Ports & Adapters: pure `CustomerService` + `CardService` (injected HttpPort); facade orchestrates +
holds the customer-auth-token in core state. `core/` pure. STRICT TDD: test before impl per unit; mock
HttpPort + `getSecureToken`/`getSignature` callbacks. No network.

## Acceptance criteria
- `registerCustomer({email})` → `POST /customer/` (Token apiKey), caches `authToken`; missing email →
  `INVALID_EMAIL`; before ready → `NOT_INITIALIZED`; transport → `CUSTOMER_OPERATION_ERROR`.
- `getCustomerCards()` → `Card[]` (camelCase, masked number); guards: not-ready → `NOT_INITIALIZED`,
  no customer → `CUSTOMER_NOT_REGISTERED`, no `getSecureToken` → `SECURE_TOKEN_REQUIRED`,
  getSecureToken throws → `SECURE_TOKEN_ERROR`, transport → `FETCH_CARDS_ERROR`. Sends Bearer
  secureToken + User-Token + (optional) X-Signature-Transaction.
- `removeCustomerCard(skyflowId)` → void on 2xx (200, not 204); same guards; transport →
  `REMOVE_CARD_ERROR`.
- `CardService` uses the integer `business.pk` in the path.
- Gates green: typecheck, lint, build (4 artifacts + `Card`/`CustomerInput` in d.ts), `vitest run`
  (all pass), `npm audit` 0. `core/` pure; public camelCase / no I-prefix / no vendor leak.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
