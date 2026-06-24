# Proposal: COF payment flow

## Summary
For COF-active businesses, `Tonder.pay({ paymentMethod: { type: 'card' } })` should automatically enroll the mounted new card before charging. The public API stays unchanged: merchants do not pass a save-card flag, COF flag, `subscription_id`, or `enable_card_on_file`.

## Problem
The new SDK supports standalone `enrollCard()`, but new-card `pay()` currently collects raw field tokens and sends them directly to `/api/v1/process/`. Legacy Ionic Lite enrolled new cards inline when COF keys were active. Current Direct API behavior expects saved-card token payments as `payment_method: { type: 'CARD', token: cardId }`; COF subscription resolution remains server-side from `ClientCard.subscription_id`.

## Proposed Change
When `paymentMethod.type === 'card'` and business COF config is active (`business.cardonfile_keys.public_key` present), compose the flow as:

1. Enroll the mounted card through the existing COF enrollment path.
2. Use the returned saved card id/skyflow id as `payment_method.token`.
3. Call `/api/v1/process/` with `payment_method: { type: 'CARD', token }`.
4. Keep non-COF new-card payments and explicit `savedCard` payments behaviorally unchanged.

The implementation should reuse `CofService.enrollCard()` or extract a small shared helper if needed to avoid duplicated collection/rollback logic. Keep `core/` pure and preserve named, tree-shakeable exports.

## Capabilities
- Automatic new-card COF enrollment before payment for COF-active businesses.
- Token-only Direct API charge after enrollment.
- Existing standalone `enrollCard()` remains available.
- Explicit saved-card payment remains unchanged.
- No client-provided `enable_card_on_file` or `subscription_id`.

## Rollback Plan
`CofService.enrollCard()` already removes partially saved cards when enrollment fails before process. Add one extra best-effort removal window: if enrollment succeeds but `/process/` throws before returning any transaction body, remove the newly enrolled card and surface the original process error. Do not remove on declined transaction bodies, pending/created 3DS transactions, polling errors, presentation errors, or any failure after a transaction body exists.

## Success Criteria
- COF-active `pay(card)` enrolls first, then processes with `{ type: 'CARD', token }`.
- Process payload excludes raw card fields, `enable_card_on_file`, and `subscription_id` after enrollment.
- Process transport/system failure after enrollment triggers best-effort card removal.
- Declined transaction body and 3DS/polling outcomes do not remove the card.
- Non-COF `pay(card)`, `pay(savedCard)`, and standalone `enrollCard()` continue to pass existing tests.
