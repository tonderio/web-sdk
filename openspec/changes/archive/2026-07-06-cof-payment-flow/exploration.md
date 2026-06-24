## Exploration: COF payment flow

### Current State

Legacy Ionic Lite has two related Card-on-File flows:

1. `saveCustomerCard()` collects Skyflow tokens, saves `{ skyflow_id }`, creates the acquirer COF subscription through Kushki, re-saves `{ skyflow_id, subscription_id }`, and removes the saved card if any post-save step fails.
2. `_checkout()` does the same enrollment inline for a **new-card payment** when COF keys are active. After enrollment, it sends checkout with `card: { skyflow_id }` and `enable_card_on_file: true`.

The new `@tonder.io/web-sdk` already has standalone enrollment through `Tonder.enrollCard()` and `CofService.enrollCard()`:

- `CofService.enrollCard()` does collect → save#1 `{ skyflow_id }` → `AcquirerPort.createCofSubscription()` → save#2 `{ skyflow_id, subscription_id }` → rollback on failures after save#1.
- `Tonder.enrollCard()` chooses COF enrollment when `state.business?.cardonfile_keys?.public_key` exists; otherwise it performs plain save.
- `Tonder.pay({ paymentMethod: { type: 'card' } })` currently only collects card tokens, builds raw-card `payment_method`, and calls `/api/v1/process/`.

So the missing behavior is **not standalone card enrollment**. The missing behavior is inline COF enrollment inside `pay({ paymentMethod: { type: 'card' } })` when COF is active.

Backend evidence changes the legacy payload conclusion: current Direct API/backend tests explicitly say saved-card Direct API payments should send only `payment_method: { type: 'CARD', token }`. Direct API maps that to `checkout_data["card"] = { "skyflow_id": token }` and carries neither `enable_card_on_file` nor `subscription_id`. Kushki resolves COF server-side from `ClientCard.subscription_id` and active business COF config. Therefore the new SDK should **not** add `enable_card_on_file` or `subscription_id` to `/process/`.

### Answers to Investigation Questions

1. **What is missing from `pay({ paymentMethod: { type: 'card' } })` when COF is active?**

   It does not save/enroll the newly collected card before charging. Today it sends raw field-token references as:

   ```ts
   payment_method: {
     type: 'CARD',
     card_number,
     cvv,
     expiration_month,
     expiration_year,
     cardholder_name,
   }
   ```

   When COF is active, it should first create a saved card with `subscription_id`, then charge through saved-card token semantics:

   ```ts
   payment_method: { type: 'CARD', token: cardId }
   ```

2. **Should payment-with-new-card enroll COF before `/process/` and then pay using saved-card token (`skyflow_id`) instead of raw field tokens?**

   Yes. That is the safe composition with the current backend. Once enrollment succeeds, `/process/` should receive `payment_method.token = skyflow_id`; backend resolves the card tokens and COF subscription server-side.

   Do **not** send `enable_card_on_file` or `subscription_id` from the SDK. Legacy sent `enable_card_on_file`, but backend evidence says that is now intentionally server-derived to avoid trusting client-injected subscription IDs.

3. **What rollback is required, and on which failures should the SDK remove the saved card?**

   Existing `CofService.enrollCard()` already rolls back failures after save#1 and before enrollment completes:

   - missing `card_bin` after save#1 → remove card
   - acquirer subscription failure/decline → remove card
   - save#2 with `subscription_id` failure → remove card
   - rollback DELETE failure is swallowed so the original error surfaces
   - save#1 failure does not rollback because no card exists yet

   New-card `pay()` adds one more rollback window: after COF enrollment succeeds, if `/process/` fails as a transport/system error, the SDK should remove the just-enrolled card as best effort. If `/process/` returns a normal declined `RawTransaction` (`status: 'Declined'`) or a successful/pending 3DS transaction body, that is not a thrown process failure and should not remove the card.

   For embedded 3DS after `/process/` returns `next_action`, rollback is risky: a transaction exists and may still settle. Do not remove the card merely because polling/messenger later fails or times out unless product explicitly wants “save only on final payment success”. Legacy did not clearly rollback after checkout-router success; it only rolled back enrollment failures before checkout.

4. **How should this compose with the existing public API without adding confusing options yet?**

   Keep the public API unchanged:

   - `pay({ paymentMethod: { type: 'card' } })` means “pay with the mounted new-card fields”. If business COF is active, enrollment is automatic before charge.
   - `pay({ paymentMethod: { type: 'savedCard', cardId } })` remains explicit saved-card charge and does not collect.
   - `enrollCard()` remains explicit save-without-payment.

   No `saveCard`, `cardOnFile`, `enableCardOnFile`, or `subscriptionId` option should be exposed yet. Public options would imply merchant control over a server-owned routing/security decision.

5. **What files/tests will be affected?**

   Likely code:

   - `src/tonder.ts` — `pay()`/payment-method resolution needs a COF-active new-card path before `buildProcessBody`; may need a helper to create enrollment params from config/state and reuse `CofService`.
   - `src/core/services/cof.service.ts` — either reuse `enrollCard()` as-is or add a method that enrolls from already-collected tokens to avoid duplicate collection. Current `pay()` and `enrollCard()` both collect through the same `TokenizerPort`; blindly calling `enrollCard()` from `pay()` is simplest but changes `pay()` collection flow to “enroll collects, then pay uses token”.
   - `src/core/strategies/card.strategy.ts` — no public shape change; saved-card token builder already exists.
   - `src/core/services/direct-api.service.ts` / `src/shared/types/index.ts` — likely no public type additions. `ProcessPaymentBody` already accepts `SavedCardPaymentMethod`.
   - `src/core/services/card.service.ts` — no API change; rollback already available via `removeCard()`.

   Likely tests:

   - `src/tonder.pay.test.ts` — add COF-active new-card payment tests: enrolls before process, sends `{ type: 'CARD', token: 'sky_new' }`, does not include raw card fields, does not include `enable_card_on_file`/`subscription_id`, rolls back on process transport error after enrollment, does not rollback on declined transaction body.
   - `src/core/services/cof.service.test.ts` — existing rollback tests likely remain; add only if a new helper is introduced.
   - `src/tonder.enrollCard.test.ts` — regression guard that standalone `enrollCard()` behavior remains unchanged.
   - `src/core/services/direct-api.service.test.ts` — probably no change unless adding explicit absence assertions for COF fields.
   - `e2e/tests/cof.spec.ts` — add/adjust flow for new-card payment under COF-enabled merchant if environment supports it.

### Affected Areas

- `/Volumes/MacDev/Tonder/SDKs/ionic/ionic-lite/src/classes/liteCheckout.ts` — source of legacy behavior; confirms inline new-card COF enrollment before checkout.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/tonder.ts` — facade currently routes new-card pay directly to raw-card `/process/`; this is where automatic COF-active path should be composed.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/core/services/cof.service.ts` — already owns collect/save/subscription/resave rollback; should remain the core orchestration point.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/core/services/card.service.ts` — already supports save/remove with secure token and user token; rollback dependency.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/core/services/direct-api.service.ts` — `/process/` body type already supports raw card or saved-card token.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/core/strategies/card.strategy.ts` — already has raw-card and saved-card builders; no need to leak COF flags.
- `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/adapters/kushki/kushki.adapter.ts` and `/Volumes/MacDev/Tonder/SDKs/tonder-js/src/ports/acquirer.port.ts` — subscription creation path exists and should be reused.
- `/Volumes/MacDev/Tonder/zplit-back/zplit_back/apps/payments/tests/direct_api/unit/test_services.py` — backend proof that Direct API expects token-only saved-card payment and no client COF fields.
- `/Volumes/MacDev/Tonder/zplit-back/zplit_back/apps/payments/processors/kushki/kushki.py` — backend proof that Kushki resolves `subscription_id` server-side from `ClientCard`.

### Approaches

1. **Reuse `CofService.enrollCard()` inside `pay()` when COF is active** — `pay(type: 'card')` checks business COF key, calls `cofService.enrollCard(params)`, then builds saved-card payment method with `cardId`.
   - Pros: least new core logic; reuses tested rollback; clean public API.
   - Cons: `resolvePaymentMethod()` currently owns collection; needs refactor so new-card COF path does not also collect raw tokens.
   - Effort: Medium.

2. **Add `CofService.enrollCollectedCard(tokens, params)` and let `pay()` collect once** — `pay()` collects tokens, then passes them to COF service for save/subscription/resave.
   - Pros: explicit single collection; easier to keep non-COF raw-card path unchanged.
   - Cons: expands service API; must duplicate/centralize existing rollback logic carefully.
   - Effort: Medium.

3. **Add client COF fields to `/process/` (`enable_card_on_file`, `subscription_id`)** — mirror legacy router payload.
   - Pros: superficially closest to legacy Ionic.
   - Cons: conflicts with current backend security direction; Direct API tests explicitly reject this shape; leaks server-owned decision into SDK.
   - Effort: Low technically, wrong architecturally.

### Recommendation

Implement approach 1 or 2, but keep the Direct API payload as saved-card token only. The best design is: when `paymentMethod.type === 'card'` and `business.cardonfile_keys.public_key` exists, enroll first, then process with `buildSavedCardPaymentMethod(cardId)`. Keep `core/` pure and keep public API unchanged.

For rollback, reuse existing enrollment rollback and add best-effort removal only if `/process/` throws before returning a transaction. Do not remove on a normal declined transaction body, and do not remove after a created transaction enters 3DS/polling unless a later product requirement explicitly changes save semantics.

### Risks

- If `pay()` calls `CofService.enrollCard()` naively from inside the current `resolvePaymentMethod()` flow, tokens may be collected twice or the control flow may become hard to reason about.
- Removing an enrolled card after a transaction has already been created could break later backend settlement or customer expectations; rollback boundaries must be precise.
- COF-active detection currently uses presence of `cardonfile_keys.public_key`; if backend returns empty string or stale config, behavior may silently fall back to raw-card charge.
- E2E coverage depends on having a COF-enabled merchant and valid `secureToken`/customer setup.

### Ready for Proposal

Yes. Proposal should specify automatic inline COF enrollment for new-card `pay()` under COF-active business config, token-only Direct API charge after enrollment, no new public options, and explicit rollback boundaries.
