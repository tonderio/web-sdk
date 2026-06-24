# Change: cof-enrollment — save a card (plain + Kushki COF) (COF Slice 2)

## Intent
Expose `enrollCard()` to save a customer's card. Two paths, gated by business config:
- **COF active** (`cardonfile_keys.public_key` present): full Kushki Card-on-File flow (save → Kushki
  subscription → save with `subscription_id`), with rollback on failure.
- **COF inactive**: plain save (`skyflow_id` only), no Kushki.

## Why now
Saved-cards read/manage + pay-with-saved are done; enrollment is the remaining COF write path. Uses
EXISTING backend endpoints (cards + `/acq-kushki/subscription/*`) — no backend change.

## Architecture (Ports & Adapters)
- **Kushki stays behind `AcquirerPort`** (high-level: one `createCofSubscription(input)` call). The
  `KushkiAdapter` (adapters/kushki/) absorbs ALL Kushki-JS detail (script load, `new Kushki`,
  `requestSecureInit`, `requestValidate3DS`, the two `/acq-kushki/*` HTTP calls, promisified callbacks +
  15s timeouts). Testability unlock: an injectable **`KushkiSdkLoader`** (mirror `skyflow-loader.ts`) →
  tests pass a fake Kushki. `core/` stays pure (no Kushki/DOM).
- `CofService` (core/services) orchestrates via injected `CardService` + `TokenizerPort` + `AcquirerPort`.

## Scope (in)
- `ports/acquirer.port.ts` — `AcquirerPort.createCofSubscription(input: CofSubscriptionInput): Promise<{ subscriptionId: string }>`; `CofSubscriptionInput { merchantId, cardBin, skyflowTokens{name,number,expiryMonth,expiryYear,cvv}, contact{firstName,lastName,email}, customerId, currency }`.
- `adapters/kushki/kushki-loader.ts` — `KushkiSdkLoader = () => Promise<KushkiStatic>`; `createKushkiLoader()` (lazy `cdn.kushkipagos.com/kushki.min.js`, guard, single-load promise, fail → `AppError(ACQUIRER_LOAD_ERROR)`); typed `KushkiStatic`/`KushkiInstance`.
- `adapters/kushki/kushki.adapter.ts` — `KushkiAdapter implements AcquirerPort`: `ensureInstance(merchantId)`; promisify `requestSecureInit({card:{number:cardBin}})` → jwt (reject `CARD_ON_FILE_DECLINED` on `code`/no jwt; 15s timeout); `POST {acquirer}/acq-kushki/subscription/token` (Authorization Token apiKey; body `{card{name,number,expiryMonth,expiryYear,cvv}, currency, jwt}`) → `{token, secureId, security}` (**handle both root and `details`-nested shapes**); promisify `requestValidate3DS({secureId,security})` (ok if `code==='3DS000'` or absent + `isValid!==false`, else `CARD_ON_FILE_DECLINED`; 15s); `POST {acquirer}/acq-kushki/subscription/create` (body `{token, contactDetails{firstName,lastName,email}, metadata{customerId}, currency}`) → `{subscriptionId}`.
- `models/card.model.ts` — `SaveCardRequest { skyflow_id; subscription_id? }`, `SaveCardBackendResponse { skyflow_id; user_id; card_bin? }`.
- `core/services/card.service.ts` — `saveCard(businessPk, body, secureToken, userToken)` → `POST /api/v1/business/{pk}/cards/` (Bearer secureToken + User-Token + optional X-Signature-Transaction); failure → `AppError(SAVE_CARD_ERROR)`.
- `core/services/cof.service.ts` — NEW. `enrollCard(params)` COF path (collect → save#1(skyflow_id) → `acquirer.createCofSubscription` → save#2(skyflow_id+subscription_id) → return `{cardId, subscriptionId}`; **rollback**: any failure after save#1 → `cardService.removeCard(cardId)` best-effort, rethrow existing AppError or wrap as `CARD_ON_FILE_DECLINED`). `saveCardPlain(params)` non-COF (collect → save#1 → `{cardId}`; failure → `SAVE_CARD_ERROR`). If `card_bin` absent from save#1 in the COF path → `AppError(CARD_ON_FILE_DECLINED)` (can't proceed). Pure (ports injected).
- `core/TonderCore.ts` — store `customerInput: CustomerInput | null` in state (set by `registerCustomer`) so the COF subscription has `contact`.
- `tonder.ts` — `registerCustomer` also stores the input in state; `enrollCard(): Promise<EnrollResult>` — guards (ready→NOT_INITIALIZED, customer registered→CUSTOMER_NOT_REGISTERED, getSecureToken→SECURE_TOKEN_REQUIRED); resolve auth via `resolveCardAuth()`; COF gate on `business.cardonfile_keys?.public_key` → `cofService.enrollCard` (contact from stored customerInput) else `cofService.saveCardPlain`. Wire `KushkiAdapter` from `env.acquirer` in the constructor; add `acquirer?: AcquirerPort` to `_createTonderWithDeps`.
- `shared/types/index.ts` — `EnrollResult { cardId: string; subscriptionId?: string }` (exported).
- `shared/errors` — add `ACQUIRER_LOAD_ERROR` (+ message). (`SAVE_CARD_ERROR`, `SAVE_CARD_PROCESS_ERROR`, `CARD_ON_FILE_DECLINED`, `INVALID_CARD_DATA` exist.)
- `index.ts` — export `EnrollResult`. README — add an Enroll section.

## Scope (out)
- Re-fetching the full masked `Card` after save (return `{cardId, subscriptionId?}`; merchant uses
  `getCustomerCards` for display). APM/SPEI. 3DS embed.

## Approach
STRICT TDD. Kushki + DOM ONLY in `adapters/kushki/` behind `AcquirerPort` + injectable
`KushkiSdkLoader`. Unit tests inject a fake loader/Kushki (callbacks resolve canned jwt/3DS) + mock
HttpPort (routes `/cards/` + `/acq-kushki/*` by path) + mock `TokenizerPort.collect`. Cover: COF happy
path; non-COF plain; rollback on acquirer failure (removeCard called); rollback on save#2 failure; 3DS
failure → `CARD_ON_FILE_DECLINED` + rollback; adapter timeout (fake timers). `core/` pure.

## Acceptance criteria
- COF business: `enrollCard()` → collect → save#1 → `createCofSubscription` (correct cardBin + tokens +
  contact) → save#2 with `subscription_id` → returns `{cardId, subscriptionId}`.
- Non-COF business: `enrollCard()` → save#1 only → `{cardId}` (no subscriptionId).
- Rollback: any failure after save#1 (COF) → `removeCard(cardId)` called; error surfaced as
  `CARD_ON_FILE_DECLINED` (existing AppError re-thrown).
- Guards: not-ready→NOT_INITIALIZED, no customer→CUSTOMER_NOT_REGISTERED, no getSecureToken→SECURE_TOKEN_REQUIRED.
- KushkiAdapter: promisified callbacks, 15s timeout → CARD_ON_FILE_DECLINED; script-load fail →
  ACQUIRER_LOAD_ERROR; handles token response root/`details` shapes.
- Gates green: typecheck, lint, build (4 artifacts + `EnrollResult` in d.ts), `vitest run` (all pass),
  `npm audit` 0. `core/` pure (Kushki/DOM only under adapters/kushki); public camelCase / no I-prefix /
  no vendor leak in returned values (Kushki/Skyflow strings only internal).

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active.
