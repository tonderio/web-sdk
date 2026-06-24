# Proposal: App-Origin Completion Discriminator (Slice 2a)

## Intent
The embedded-3DS postMessage completion emit is gated on `embedded_completion`, a design error that conflates client PRESENTATION (embedded vs redirect iframe — a client-side `threeDsMode` concern) with client TYPE (is this the web SDK — the `X-App-Origin` concern). Worse, `embedded_completion` is a client BODY flag, so the emit gate trusts spoofable client input. This slice retires that flag and drives the completion emit off `X-App-Origin: sdk/web`, a header the SDK already sends (Slice 1) and the backend reads server-side. Verifiable usrv-3ds (native 3DS) path only.

## Scope
### In Scope
- **web SDK**: remove `body.embedded_completion` (tonder.ts buildProcessBody) + `embedded_completion?: boolean` from `ProcessPaymentBody` (direct-api.service.ts). Update tests referencing it.
- **zplit-back**: in direct-process view read `X-App-Origin` from `request.headers`, inject `app_origin` into `validated_data`; set `checkout_data["app_origin"]` in `_prepare_checkout_data`; stamp `app_origin` JWT claim in `generate_checkout_token`; remove the `embedded_completion` serializer field/claim.
- **spa-midd-checkout**: swap emit gate `decodeToken?.embedded_completion === true` → `decodeToken?.app_origin === 'sdk/web'` (ProcessCheckout.tsx, ThreeDSPayment.tsx); add `app_origin?: string` to CheckoutTokenInterface.

### Out of Scope (Slice 2b — DEFERRED)
- Acquirer-direct iframe `authValidation` routing (lives in external AWS Lambda / Cardinal — unverifiable from repos).
- payflow-wrap-for-direct_api, checkout.py `extract_redirect_url`. No emit behavior change for redirect mode.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
None (discriminator swap for existing emit behavior; no spec-level requirement change).

## Approach
- **Discriminator swap, header-driven**: the completion emit already works today gated on the `embedded_completion` JWT claim. Replace the claim's SOURCE, not the emit mechanism. SDK stops sending the body flag; backend derives `app_origin` from the `X-App-Origin` header server-side and threads it → `validated_data` → `checkout_data` → JWT claim; spa-midd reads `app_origin === 'sdk/web'`.
- **KEEP** all SDK `threeDsMode` presentation logic (handleRequiresAction/handleApmResult iframe mount) — client-side, unchanged.
- **Non-SDK requests** (no `X-App-Origin`) → `app_origin` empty → no emit → current redirect behavior preserved.
- `emitEmbeddedCompletion` util unchanged.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| SDK tonder.ts (buildProcessBody) | Removed | delete `body.embedded_completion = true` |
| SDK direct-api.service.ts | Modified | drop `embedded_completion?: boolean` from ProcessPaymentBody |
| SDK tests | Modified | remove body-flag assertions |
| zplit-back direct_views.py | Modified | read `X-App-Origin` header, inject `app_origin` into validated_data |
| zplit-back direct_payment_service.py | Modified | `checkout_data["app_origin"]` in `_prepare_checkout_data` |
| zplit-back checkout.py | Modified | `app_origin` JWT claim in `generate_checkout_token` |
| zplit-back direct_serializers.py | Removed | drop `embedded_completion` field |
| zplit-back pytest | Modified | header-derived claim; empty when headerless |
| spa-midd ProcessCheckout.tsx, ThreeDSPayment.tsx | Modified | gate on `app_origin === 'sdk/web'` |
| spa-midd CheckoutTokenInterface.ts | Modified | add `app_origin?: string` |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| usrv-3ds emit breaks after swap | Med | test that `app_origin=sdk/web` claim → emit fires; parity with old flow |
| Redirect (non-SDK) starts emitting | Low | headerless → empty `app_origin` → no emit; test asserts |
| `app_origin` trusted from body not header | Med | derive ONLY from `request.headers`; never map a client body field |

## Rollback Plan
- Per repo, independent reverts. SDK: restore body flag lines. Backend: restore serializer field + claim, drop header read. spa-midd: restore `embedded_completion` gate. The three coordinate but each reverts cleanly.

## Dependencies
- Slice 1 (`X-App-Origin: sdk/web` sent by SDK) — SHIPPED. Backend + spa-midd changes must ship together for the emit to keep working.

## Success Criteria
- [ ] SDK sends NO `embedded_completion` body flag; `threeDsMode` presentation unchanged.
- [ ] Backend derives `app_origin` from `X-App-Origin` header → JWT claim; `embedded_completion` field/claim gone.
- [ ] usrv-3ds embedded flow keeps emitting completed/failed, now gated on `app_origin === 'sdk/web'`.
- [ ] Headerless non-SDK Direct API: no emit (redirect behavior preserved).
- [ ] SDK (vitest run) + backend (pytest) tests pass.
