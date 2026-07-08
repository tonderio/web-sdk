# Design: B2 Slice 2 — Embedded 3DS postMessage plumbing (full-stack)

## Technical Approach

Thread one internal boolean, `embedded_completion`, SDK → backend → /process page so the
embedded 3DS landing emits `window.parent.postMessage({ event })` on completion. The SDK
`BrowserCheckoutMessenger` (Slice 1) resolves on that signal (fast path); redirect mode and the
SDK poll fallback are untouched. Integrators never set the flag — the SDK derives it from the
public `config.threeDsMode === 'embedded'`. Additive and backward-compatible in all 3 repos.

## Architecture Decisions

### Decision: Backend reads the flag inside `generate_checkout_token`, NOT per call site

**Choice**: Carry `embedded_completion` in `checkout_data`; inside `Checkout.generate_checkout_token`
(checkout.py:516) read `self.checkout_data.get("embedded_completion")` and add it as a top-level JWT
claim. Do NOT pass `extra_data` at each call site.
**Alternatives considered**: (a) Proposal/exploration plan — pass `extra_data={'embedded_completion': True}`
at the two `/process`-landing sites (threeds_service.py:78, checkout.py:226). (b) URL query param. (c) Pollute existing `extra_data`.
**Rationale**: `generate_checkout_token` ALREADY reads `self.checkout_data` for `return_url`,
`payment_method`, `is_route_finished`. Reading one more key there covers BOTH `/process` sites (and
oxxopay:1302, 3ds-challenge:438) automatically with a single edit, eliminating risk #1 from the
proposal (forgetting a call site degrades a provider to poll-only). A dedicated top-level claim keeps
`extra_data` reserved for ACS data (acs_url/creq). No signature change.

### Decision: Emit via a shared helper called from BOTH branches, not container-only

**Choice**: Add `emitEmbeddedCompletion(ok: boolean)` posting `{ event: 'checkout.completed' | 'checkout.failed' }`.
Call it from `ProcessCheckout.handleSuccess`/`handleError` (Kushki branch) AND from inside
`ThreeDSPayment.handlePostChallengeResult` (Tonder branch), gated on the flag.
**Alternatives considered**: Container-only emit (proposal assumption).
**Rationale**: VERIFIED the proposal assumption is WRONG. The two branches complete differently:
KushkiPayment routes completion through container callbacks `onSuccess`/`onError`
(Payment.tsx:87/93), but ThreeDSPayment handles completion internally — reads `?status=`, sets
state, and self-redirects (`window.location.href = props.return_url`, ThreeDSPayment.tsx:54-58) —
and NEVER calls the container. A container-only emit would silently miss the entire Tonder branch.
The flag is passed to ThreeDSPayment as a new prop.

### Decision: `targetOrigin: '*'`

**Choice**: Post with `'*'`. **Rationale**: child→parent completion signal carries no secrets; the
page cannot know the merchant origin. The SDK adapter gates inbound by `event.origin` against its
payflow allowlist (browser-checkout-messenger.adapter.ts:54) and reads only `event.data.event`, so
spoofing is blocked SDK-side.

## Data Flow

    SDK pay(embedded)
      └─ buildProcessBody → { ..., embedded_completion: true }   [tonder.ts:825]
           └─ POST /api/v1/process/
                └─ DirectProcessRequestSerializer (accepts field)   [direct_serializers.py:136]
                     └─ _prepare_checkout_data → checkout_data.embedded_completion   [direct_payment_service.py:240]
                          └─ Checkout.checkout_data (persisted)
                               └─ generate_checkout_token → JWT claim embedded_completion   [checkout.py:516]
                                    ├─ threeds_service.py:78  → /process?token   (Tonder)
                                    └─ checkout.py:226        → /process?token   (Kushki)
                                         └─ ProcessCheckout decodes JWT   [ProcessCheckout.tsx:26]
                                              ├─ Kushki: handleSuccess/Error → emitEmbeddedCompletion
                                              └─ Tonder: ThreeDSPayment.handlePostChallengeResult → emitEmbeddedCompletion
                                                   └─ window.parent.postMessage({ event }, '*')
                                                        └─ SDK BrowserCheckoutMessenger resolves → getTransaction → PayResult

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `tonder-js/src/core/services/direct-api.service.ts` | Modify | `ProcessPaymentBody += embedded_completion?: boolean` (after `metadata`, L93) |
| `tonder-js/src/tonder.ts` | Modify | `buildProcessBody` (L825): if `this.core.getConfig().threeDsMode === 'embedded'` set `body.embedded_completion = true` (omit otherwise) |
| `zplit-back/.../api/direct_serializers.py` | Modify | `DirectProcessRequestSerializer += embedded_completion = BooleanField(required=False, default=False)` |
| `zplit-back/.../services/direct_payment_service.py` | Modify | `_prepare_checkout_data` (L297 dict): add `"embedded_completion": payment_data.get("embedded_completion", False)` |
| `zplit-back/.../models/checkout.py` | Modify | `generate_checkout_token` (L522 payload): add `"embedded_completion": bool(self.checkout_data.get("embedded_completion", False))` |
| `spa-midd-checkout/.../interfaces/CheckoutTokenInterface.ts` | Modify | `ICheckoutTokenInterface += embedded_completion?: boolean` |
| `spa-midd-checkout/.../process/components/ProcessCheckout.tsx` | Modify | Add `emitEmbeddedCompletion`; call in `handleSuccess`(ok)/`handleError`(fail); pass `embedded_completion` prop to `ThreeDSPayment` |
| `spa-midd-checkout/.../tonder/components/ThreeDSPayment.tsx` | Modify | New `embedded_completion?: boolean` prop; in `handlePostChallengeResult` emit `checkout.completed`/`checkout.failed` before the self-redirect, gated on flag |

## Interfaces / Contracts

```ts
// SDK ProcessPaymentBody (direct-api.service.ts)
embedded_completion?: boolean;   // internal; true only when threeDsMode === 'embedded'

// postMessage contract (MUST match adapter COMPLETION_EVENTS exactly)
window.parent.postMessage({ event: 'checkout.completed' }, '*'); // success
window.parent.postMessage({ event: 'checkout.failed' }, '*');    // failure
```

```python
# JWT payload claim (checkout.py generate_checkout_token)
"embedded_completion": bool(self.checkout_data.get("embedded_completion", False)),
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (SDK, strict TDD) | `buildProcessBody` sets flag iff embedded; omits in redirect | existing `tonder.pay.test.ts` pattern |
| Unit (backend, pytest) | serializer accepts/defaults flag; `_prepare_checkout_data` carries it; JWT claim emitted from `checkout_data` | pytest on the 3 functions |
| Manual/E2E | postMessage emitted on both Tonder and Kushki branches; redirect mode unchanged | embedded 3DS run per provider |

## Migration / Rollout

No data migration. Additive across all repos. **Deploy order is recommended (backend → front → SDK)
but NOT required — every ordering is safe:**
- DRF `Serializer` ignores unknown input fields by default (no `Meta.fields`, no strict flag here), so
  SDK-before-backend → backend silently drops the field → poll fallback wins → correct result.
- SDK-before-front → JWT carries the claim, page ignores it → no postMessage → poll fallback wins.
- `embedded_completion=False`/absent → redirect path fully unaffected (no emit, existing self-redirect runs).
No polling is added to spa-midd-checkout (it remains a post-challenge landing reading `?status=`; the
SDK poll is the fallback layer).

## Open Questions

- [ ] Frictionless (no-challenge) Tonder 3DS path may return a final API status directly without
  landing on /process; in that case the messenger is never engaged and the SDK resolves from the
  response/poll. Out of scope for this slice (no /process emit possible), flagged for verify.

## Line-ref corrections vs exploration

- `generate_checkout_token` is at **checkout.py:516** (def); Kushki `/process` mint at **checkout.py:226**
  (inside `extract_redirect_url_if_exists`), not "~L229" (L229 is the URL build). Tonder mint at
  **threeds_service.py:78**, not "~L83" (L83 is the `return_url` string build).
- Container is `src/modules/process/components/ProcessCheckout.tsx` (exploration said `src/app/process`).
  ThreeDSPayment is `src/modules/tonder/components/ThreeDSPayment.tsx`; Kushki is
  `src/modules/kushki/components/Payment.tsx`.
- `generate_checkout_token` has additional call sites (oxxopay:1302, 3ds-challenge:438); reading the
  flag from `checkout_data` inside the function (chosen design) covers them harmlessly.
- CORRECTION to proposal: container-only emit does NOT cover the Tonder branch — ThreeDSPayment
  self-completes and never calls the container. Emit must also live inside ThreeDSPayment.
