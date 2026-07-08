# Tasks: cof-enrollment (STRICT TDD — test before impl per unit)

## 1. Errors + types + state
- [x] 1.1 `src/shared/errors/ErrorKeyEnum.ts` + `messages.ts` — add `ACQUIRER_LOAD_ERROR`
  ('Failed to load the acquirer library.'). Confirm SAVE_CARD_ERROR, SAVE_CARD_PROCESS_ERROR,
  CARD_ON_FILE_DECLINED, INVALID_CARD_DATA exist.
- [x] 1.2 `src/shared/types/index.ts` — `EnrollResult { cardId: string; subscriptionId?: string }`.
- [x] 1.3 `src/core/TonderCore.ts` — add `customerInput: CustomerInput | null` to state (init null).
- [x] 1.4 `src/models/card.model.ts` — `SaveCardRequest { skyflow_id; subscription_id? }`,
  `SaveCardBackendResponse { skyflow_id; user_id; card_bin? }`.

## 2. CardService.saveCard (TDD)
- [x] 2.1 `src/core/services/card.service.test.ts` (add, FIRST): `saveCard` POSTs
  `/api/v1/business/{pk}/cards/` with Bearer secureToken + User-Token (+ optional signature) and body
  `{skyflow_id, subscription_id?}`; returns the response; transport → `AppError(SAVE_CARD_ERROR)`.
- [x] 2.2 `src/core/services/card.service.ts` — `saveCard(businessPk, body, secureToken, userToken,
  signature?)`. Make 2.1 pass.

## 3. Kushki loader + adapter (TDD)
- [x] 3.1 `src/adapters/kushki/kushki-loader.ts` — `KushkiSdkLoader`, `KushkiStatic`/`KushkiInstance`,
  `createKushkiLoader()` (lazy `cdn.kushkipagos.com/kushki.min.js`, `typeof window.Kushki` guard,
  single-load, fail → `ACQUIRER_LOAD_ERROR`). (Production loader integration-only.)
- [x] 3.2 `src/ports/acquirer.port.ts` — `AcquirerPort.createCofSubscription(input)`; `CofSubscriptionInput`
  per proposal; `{ subscriptionId }` result.
- [x] 3.3 `src/adapters/kushki/kushki.adapter.test.ts` (FIRST, fake loader + fake Kushki + mock HttpPort,
  `vi.useFakeTimers()` for timeouts): `createCofSubscription` happy → calls requestSecureInit(cardBin) →
  POST /subscription/token → requestValidate3DS → POST /subscription/create → `{subscriptionId}`;
  secureInit `code`/no-jwt → `CARD_ON_FILE_DECLINED`; validate3DS non-3DS000 → `CARD_ON_FILE_DECLINED`;
  token response under `details` nested also parsed; 15s timeout (callback never fires) →
  `CARD_ON_FILE_DECLINED`.
- [x] 3.4 `src/adapters/kushki/kushki.adapter.ts` — `KushkiAdapter implements AcquirerPort`
  (constructor deps: loader, http, acquirerBaseUrl, apiKey, isTestEnvironment). promisifyWithTimeout
  (15s). Make 3.3 pass.

## 4. CofService (TDD)
- [x] 4.1 `src/core/services/cof.service.test.ts` (FIRST; fake TokenizerPort.collect, fake AcquirerPort,
  mock CardService or mock HttpPort): COF happy (collect → save#1 → createCofSubscription with correct
  cardBin/tokens/contact → save#2 with subscription_id → `{cardId, subscriptionId}`); non-COF plain
  (collect → save#1 → `{cardId}`); rollback when acquirer rejects → `removeCard(cardId)` called +
  `CARD_ON_FILE_DECLINED`; rollback when save#2 rejects → removeCard called; `card_bin` absent in COF →
  `CARD_ON_FILE_DECLINED` (no acquirer call); rollback DELETE error swallowed (original error surfaced).
- [x] 4.2 `src/core/services/cof.service.ts` — `CofService` with `enrollCard(params)` (COF + rollback) +
  `saveCardPlain(params)` (non-COF). Pure (ports injected). Make 4.1 pass.

## 5. Facade enrollCard() (TDD)
- [x] 5.1 `src/tonder.registerCustomer.test.ts` (extend) — `registerCustomer` stores the input in
  `getState().customerInput`.
- [x] 5.2 `src/tonder.enrollCard.test.ts` (FIRST, via `_createTonderWithDeps` with mock http + fake
  tokenizer + fake acquirer): guards (NOT_INITIALIZED / CUSTOMER_NOT_REGISTERED / SECURE_TOKEN_REQUIRED);
  COF business (cardonfile_keys.public_key set) → routes to COF path → `{cardId, subscriptionId}`; non-COF
  business → plain → `{cardId}`; contact taken from stored customerInput.
- [x] 5.3 `src/tonder.ts` — store customerInput in `registerCustomer`; add `enrollCard()` (guards +
  resolveCardAuth + COF gate → cofService.enrollCard / saveCardPlain); wire `CofService` + `KushkiAdapter`
  (from env.acquirer) in constructor; add `acquirer?` to `_createTonderWithDeps`. Make 5.1/5.2 pass.

## 6. Exports + README
- [x] 6.1 `src/index.ts` — export `EnrollResult`.
- [x] 6.2 Root `README.md` — add an **Enroll a card** section (registerCustomer → mountCardFields →
  enrollCard → returns `{cardId, subscriptionId?}`; COF vs plain note; needs getSecureToken).

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts has `EnrollResult`), `vitest
  run` (all pass), `npm audit` (0). `core/` pure (grep: no `kushki`/`window`/`document`/fetch in core/ or
  models/; Kushki/DOM only under adapters/kushki/). Public camelCase / no I-prefix / no vendor leak in
  returned values.
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: card service saveCard`, `feat: kushki
  loader + adapter (COF subscription)`, `feat: cof enrollment service with rollback`, `feat: enrollCard
  on facade`, `docs: README enroll`).
