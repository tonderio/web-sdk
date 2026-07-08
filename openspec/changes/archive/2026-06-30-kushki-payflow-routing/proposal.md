# Proposal: Kushki Payflow Routing (Slice 2b)

## Intent

When a merchant's card 3DS is routed through the acquirer's own 3DS (Kushki/Cardinal) instead of Tonder native 3DS, the web SDK's embedded 3DS never receives the instant completion signal. Today zplit-back returns a self-contained Kushki `url` that bypasses the payflow `/process` page, so the SDK iframe cannot detect completion. Routing the Kushki acq-direct 3DS through payflow (iframe mode) restores instant completion for `sdk/web`. The Kushki Lambda and hosted page already support iframe mode — this is NOT blocked.

## Scope

### In Scope

- Two gated, additive edits in **zplit-back**, both keyed on `app_origin == 'sdk/web'`:
  1. `apps/payments/services/direct_payment_service.py:329` — make `authValidation` conditional: `"iframe" if app_origin == 'sdk/web' else "url"` (was hardcoded `"url"`).
  2. `apps/payments/models/checkout.py` `extract_redirect_url_if_exists` (~L219-229) — allow the payflow `/process?token=` wrap for `direct_api` when `self.checkout_data.get("app_origin") == 'sdk/web'`.
- Tests covering both branches (SDK vs non-SDK).

### Out of Scope

- No change to the Kushki Lambda (`usrv-kushki-acq`) — already defaults to iframe and returns `url` in both modes.
- No spa-midd-checkout change — its Cardinal iframe + `/acq-kushki/charge` flow already runs for hosted/checkout.
- No SDK change, no `usrv-3ds`/Tonder-native path change (already works), no Stripe (Kushki-only wrap).
- Non-SDK direct_api (empty `app_origin`) keeps the current self-contained raw-URL 3DS with no wrap.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- None (behavior change is provider-routing at the implementation level, not a spec-defined capability contract in this repo).

## Approach

Both edits gate on the header-derived `app_origin` already threaded through `checkout_data` (from the prior `app-origin-completion` change). For `sdk/web`, request `authValidation: "iframe"` from Kushki and let the existing Kushki+SPA payflow wrap apply to `direct_api`, producing a `/process?token=` URL the SDK iframe already knows how to complete. The redirect is read from `response["url"]` (`PSPS_WITH_3DS_REDIRECT["kushki"]=["url"]`), present in both modes. Every other origin keeps the current raw-URL path unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/payments/services/direct_payment_service.py` | Modified | Conditional `authValidation` gated on `sdk/web` |
| `apps/payments/models/checkout.py` | Modified | Allow payflow wrap for `direct_api` when `app_origin == sdk/web` |
| tests | New/Modified | Cover SDK (iframe+wrap) and non-SDK (url, no wrap) branches |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Non-SDK direct_api behavior regresses | Low | Both edits strictly gated on `app_origin == 'sdk/web'`; non-SDK falls through unchanged |
| `/acq-kushki/charge` rejects the direct_api tx | Med | Verify the endpoint accepts the direct_api transaction before merge; same flow proven for hosted/checkout |
| Charge completion shifts from Kushki self-callback to payflow `/acq-kushki/charge` for the SDK | Med | Confirm parity in test/staging; hosted/checkout already relies on this exact completion path |

## Rollback Plan

Revert the two edits. Both are additive and gated; reverting restores the hardcoded `"url"` and the `direct_api` exclusion, returning `sdk/web` to the prior raw-URL 3DS. No data migration, no Lambda or hosted-page coupling to unwind.

## Dependencies

- Prior `app-origin-completion` change (already merged) that threads `app_origin` from the `X-App-Origin` header into `checkout_data` / `payment_data`.

## Success Criteria

- [ ] `sdk/web` Kushki acq-direct 3DS routes through payflow (`/process?token=`) and the SDK iframe receives instant completion.
- [ ] Non-SDK direct_api (empty `app_origin`) still returns the self-contained raw Kushki URL with no payflow wrap.
- [ ] hosted/checkout and sdk/ionic behavior unchanged.
- [ ] Tests pass for both gated branches.
