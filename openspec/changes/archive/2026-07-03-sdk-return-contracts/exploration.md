# Exploration: SDK Public Return Contracts

> Recovered from Engram `sdd/sdk-return-contracts/explore` (#3281). The explore
> agent lacked a Write tool, so this file was reconstructed from that memory.

## What

Exploration of the SDK's public return-contract design for the pre-release
public surface: `pay()`, `getTransaction()`, `pollTransaction()`, `enrollCard()`,
`getCustomerCards()`, `removeCustomerCard()`, `getPaymentMethods()`,
`getApmBanks()`. Covers 5 decision points the maintainer flagged:
`nextAction` placement, root-level redundant fields, status/outcome modeling,
APM instruction fields, and camelCase-vs-raw-passthrough policy.

## Why

The SDK has no external users yet — near-zero cost to fix the shape now. The
maintainer flagged `pay()`'s return as leaking internal plumbing: the SDK itself
drives the 3DS redirect/iframe, so a merchant never touches `nextAction.url`.

## Where (public surface + backend serializers)

- `src/models/transaction.model.ts` — `PayResult`, `Transaction`,
  `BackendTransactionResponse`, and mappers (`mapToTransaction`, `mapPayResult`,
  `mapPendingResult`, `payResultFromTransaction`).
- `src/tonder.ts` — `pay`, `handleRequiresAction`, `handleApmResult`,
  `pollTransaction`, `getTransaction`, `enrollCard`, `getCustomerCards`,
  `removeCustomerCard`, `getPaymentMethods`, `getApmBanks`.
- `src/shared/types/index.ts`, `src/core/services/direct-api.service.ts`,
  `src/index.ts` (public export barrel).
- Backend: `zplit_back/apps/payments/api/direct_serializers.py`
  `DirectPaymentSuccessResponseSerializer.from_direct_transaction` (~L346-415)
  and `DirectTransactionDetailSerializer` (~L754-820).

## Learned

1. **Amount type (contested).** The static DRF serializer read says `amount` uses
   `DecimalField(max_digits=19, decimal_places=4)` with no
   `coerce_to_string=False` and no `COERCE_DECIMAL_TO_STRING` override, so DRF's
   default `coerce_to_string=True` would serialize amount as a STRING on BOTH
   `/process` and `/transactions/{id}`. The SDK's own fixtures already assume a
   string (`amount: '150.00'`). **This exploration flagged it needed live
   verification** — and live capture (see proposal, decision #2) subsequently
   showed `/process` returns a JSON number. Live evidence wins.
2. **APM/SPEI promoted fields.** `payment_instructions`, `voucher_pdf`, `clabe`,
   `bank_name` are NOT bypassing `psp_response` — the backend explicitly extracts
   them FROM `psp_response` (and a nested `psp_response.psp_response` for SPEI)
   into top-level response fields (`direct_serializers.py` L391-405). Dropping
   these SDK wrapper fields is a real change vs. today.
3. **Method inventory.** `pay`, `getTransaction`, `pollTransaction`,
   `getPaymentMethods`, `getApmBanks` hit Direct API endpoints (`/process`,
   `/transactions/{id}`, `/payment_methods`, `/safetypay/banks/{apiKey}`).
   `enrollCard`, `getCustomerCards`, `removeCustomerCard` hit COF/vault endpoints
   via `CardService`/`CofService` — NOT the Direct API. Raw-passthrough applies
   only to the first group; the COF group can stay camelCase.
4. **Blast radius.** `src/models/transaction.model.test.ts` (45 occurrences),
   `src/tonder.pay.test.ts` (10), `src/tonder.handleRequiresAction.test.ts`,
   `src/tonder.getTransaction.test.ts` all need rewriting on shape change.
5. **Comparative research.**
   - **Stripe**: documents `next_action` as "subject to change, intended only for
     Stripe.js" — internal plumbing once Stripe.js owns presentation.
   - **Adyen**: splits `resultCode` (outcome: Authorised/Pending/RedirectShopper/
     Refused) from `action` (present only when shopper action is needed) — an
     outcome+action split, not an action embedded in a monolithic status enum.
   - **MercadoPago**: splits `status` (coarse: approved/pending/rejected) from
     `status_detail` (fine reason). Maps to the existing
     `transaction.status` / decline-code split.
   - No major gateway collides "did the operation need an action" with "what is
     the transaction's backend status" in one flat enum — supporting a separate
     operation-outcome axis from `transaction.status`.
