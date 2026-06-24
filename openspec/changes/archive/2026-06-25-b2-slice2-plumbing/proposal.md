# Proposal: B2 Slice 2 — Embedded 3DS postMessage plumbing (full-stack)

## Why

In embedded 3DS mode the SDK already ships a `CheckoutMessenger` (Slice 1) that mounts the
challenge in an iframe and waits for a `postMessage` completion signal. Nothing emits that
signal yet. Today the `/process` landing page only does a hard `window.location.href` redirect
to the merchant return URL, which breaks the embedded experience (the iframe navigates away
instead of resolving the parent SDK promise). As a result, embedded 3DS completion currently
relies entirely on the SDK's slow `pollTransaction` fallback.

This change wires the missing end-to-end plumbing so that, when the integrator selects
`threeDsMode: 'embedded'`, the 3DS landing page emits `window.parent.postMessage` on completion,
the SDK's `BrowserCheckoutMessenger` resolves instantly, and the poll becomes a fallback rather
than the primary path. Success means: embedded 3DS resolves on the postMessage (fast path),
redirect mode is completely unaffected, and the integrator changes nothing — the new wire
signal is derived internally from the public `threeDsMode` option they already set.

## What Changes

A single new field — `embedded_completion` (boolean) — is threaded end to end across three
repos. It is INTERNAL (SDK → backend → page); the integrator never sets it. The SDK DERIVES it
from the existing public `threeDsMode` option: it is sent as `true` only when
`config.threeDsMode === 'embedded'`, and omitted entirely in redirect mode. It is DISTINCT from
hosted-checkout's `post_message_enabled` (a different, session-level flow on a different object).

1. **web-sdk** (`tonder-js`, `feature/DEV-2245`, strict TDD, solo commit):
   - `ProcessPaymentBody` gains `embedded_completion?: boolean`.
   - `buildProcessBody()` sets `embedded_completion: true` when `threeDsMode === 'embedded'`;
     omits it otherwise (redirect path emits no flag).

2. **zplit-back** (`release/DEV-2245`, Standard mode + pytest, solo commits, NO push):
   - `DirectProcessRequestSerializer` gains `embedded_completion =
     BooleanField(required=False, default=False)`.
   - `_prepare_checkout_data` carries `embedded_completion` into `checkout_data`.
   - `generate_checkout_token(extra_data={'embedded_completion': True})` is passed at BOTH
     call sites: `checkout.py` (Kushki native 3DS, ~L229) and `threeds_service.py`
     (Tonder usrv-3ds, ~L83). `generate_checkout_token` already accepts `extra_data`, so there
     is no signature change and it stays backward compatible.

3. **spa-midd-checkout** (currently on `develop` — needs a new `DEV-2245` branch):
   - `CheckoutTokenInterface` gains `embedded_completion?: boolean`.
   - `ProcessCheckout.tsx` (the container) decodes the JWT, reads
     `extra_data.embedded_completion`, and on completion emits
     `window.parent.postMessage({ event: 'checkout.completed' | 'checkout.failed' }, '*')`.
     The emit is guarded by the flag and lives at the container level so it covers BOTH the
     `ThreeDSPayment.tsx` (tonder) and `KushkiPayment.tsx` (kushki) branches.

## Data Flow

```
SDK (threeDsMode: 'embedded')
  → POST /process { embedded_completion: true }
  → DirectProcessRequestSerializer accepts
  → _prepare_checkout_data carries it into checkout_data
  → generate_checkout_token(extra_data={ embedded_completion: true })   [2 call sites]
  → /process?token=JWT  (JWT.extra_data.embedded_completion === true)
  → ProcessCheckout.tsx decodes JWT, reads extra_data.embedded_completion
  → on completion: window.parent.postMessage({ event: 'checkout.completed' | 'checkout.failed' }, '*')
  → SDK BrowserCheckoutMessenger receives (origin-gated against payflow allowlist)
  → messenger resolves → getTransaction() → final PayResult
```

The SDK adapter validates `event.origin` against its payflow allowlist and reads only the
`event` string; the final status is fetched separately via `getTransaction()`. The targetOrigin
`'*'` is acceptable because the message carries no secrets and the page cannot know the parent
merchant origin.

## Impact

- **web-sdk**
  - `src/core/services/direct-api.service.ts` — `ProcessPaymentBody` field
  - `src/tonder.ts` — `buildProcessBody()` conditional set
- **zplit-back**
  - `zplit_back/apps/payments/api/direct_serializers.py` — serializer field
  - `zplit_back/apps/payments/services/direct_payment_service.py` — `_prepare_checkout_data`
  - `zplit_back/apps/payments/models/checkout.py` — `extra_data` at Kushki native 3DS call site (~L229)
  - `zplit_back/apps/payments/services/threeds_service.py` — `extra_data` at Tonder usrv-3ds call site (~L83)
- **spa-midd-checkout**
  - `src/lib/interfaces/CheckoutTokenInterface.ts` — interface field
  - `src/app/process/ProcessCheckout.tsx` — guarded postMessage emit (covers tonder + kushki branches)

Deploy order is recommended (backend → front → SDK) but not required: DRF strips unknown fields
by default, so the SDK can ship before or with the backend; if the front lags, the page simply
omits the postMessage and the SDK poll fallback still produces the correct result.

## Non-goals

- **No polling work in spa-midd-checkout.** The `/process` page is a post-challenge landing
  that reads final status from URL params; it does not poll and does not need to. The SDK's
  existing `pollTransaction` is the fallback layer.
- **No external `AbortSignal` / cancel plumbing.** Cancellation is out of scope for this slice.
- **Hosted-checkout untouched.** `app/checkout` and `post_message_enabled` (session-level) are
  a separate flow and are not modified.
- **No dedicated JWT claim.** The flag rides in the existing `extra_data` map, avoiding any
  `generate_checkout_token` signature change.

## Risks

1. **Two backend call sites, both required.** The token is minted in two places
   (`checkout.py` Kushki native 3DS and `threeds_service.py` Tonder usrv-3ds). Missing either
   leaves one provider path without the flag, silently degrading it to poll-only. Both must
   pass `extra_data`.
2. **KushkiPayment coverage.** Kushki native 3DS lands on the same `/process` page via the
   `KushkiPayment.tsx` branch. The emit is placed at the `ProcessCheckout.tsx` container level
   precisely so both branches are covered; if it were placed inside `ThreeDSPayment.tsx` only,
   Kushki completion would never signal.
3. **spa-midd-checkout branch.** That repo is on `develop` and needs a fresh `DEV-2245` branch
   before any change lands; work must not be committed onto `develop`.
4. **Message contract must match.** The page must emit exactly
   `event ∈ { 'checkout.completed', 'checkout.failed' }` in `event.data.event`, matching what
   the SDK `BrowserCheckoutMessenger` expects. Any drift breaks the fast path.
```
