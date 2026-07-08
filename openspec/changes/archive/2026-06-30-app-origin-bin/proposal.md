# Proposal: X-App-Origin BIN Fix (Slice 1)

## Intent

The web SDK's Card-on-File (COF) enrollment is BROKEN: `enrollCard` calls save-card, then hard-fails with `CARD_ON_FILE_DECLINED` when the response has no `card_bin`. The backend only returns `card_bin` when the request carries an allowlisted `X-App-Origin` header. The SDK sends NO `X-App-Origin` on any request, and `sdk/web` is not in the backend allowlist. Result: COF enrollment is dead on arrival. This slice unblocks it with two additive, backward-compatible changes.

## Scope

### In Scope
- **web SDK**: send `X-App-Origin: sdk/web` on ALL requests via the default headers in `FetchHttpClient.request()`, covering both client instances (main + acquirer).
- **zplit-back**: add `sdk/web` to the BIN allowlist in `vault/api/views.py` so save-card returns `card_bin` (+ `card_scheme`) for the web SDK.
- Tests on both sides asserting the header is sent and the BIN is included for `sdk/web`.

### Out of Scope
- Slice 2: the `embedded_completion` → `app_origin` 3DS/payflow routing redesign.
- No changes to `embedded_completion`, `authValidation`, 3DS routing, `checkout.py`, or `spa-midd-checkout`.
- No change for other origins or headerless non-SDK clients (behavior preserved).

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- None (transport default header + backend allowlist; no spec-level requirement change)

## Approach

- **SDK**: add `'X-App-Origin': 'sdk/web'` to the default `headers` object in `FetchHttpClient.request()` (`fetch-http.client.ts`), BEFORE the per-call `...(options.headers ?? {})` spread. Both `FetchHttpClient` instances inherit it. `card.service` `buildAuthHeaders` sets only `Authorization` / `User-Token` / `X-Signature-Transaction`, so it does NOT clobber the new default.
- **Backend**: extend the tuple at `vault/api/views.py:92` to `('sdk/ionic','hosted/checkout','sdk/web')`. `include_bin` then covers the web SDK; the `if include_bin:` block in `models.py` returns `card_bin` + `card_scheme`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/http/fetch-http.client.ts` | Modified | Add `X-App-Origin: sdk/web` to default headers |
| SDK http client test | New/Modified | Assert header present on outgoing requests |
| `zplit_back/apps/vault/api/views.py` | Modified | Add `sdk/web` to BIN allowlist tuple |
| vault pytest | New/Modified | Assert BIN included for `sdk/web` origin |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| A per-call header merge clobbers `X-App-Origin` | Low | Default-first merge; verified `buildAuthHeaders` sets no `X-App-Origin` key; test asserts presence |
| Allowlist change affects other origins | Low | Additive only; `sdk/ionic` + `hosted/checkout` untouched; headerless clients keep no-BIN behavior |
| Header leaks to non-BIN endpoints | Low | Header is inert unless backend checks it; safe to send globally |

## Rollback Plan

- SDK: remove the `X-App-Origin` line from default headers (single-line revert).
- Backend: remove `'sdk/web'` from the allowlist tuple (single-line revert).
- Independent reverts; either side rolls back without affecting the other.

## Dependencies

- Backend allowlist change must ship for BIN to return; SDK header alone is inert without it.

## Success Criteria

- [ ] Every SDK request carries `X-App-Origin: sdk/web` (both client instances).
- [ ] save-card returns `card_bin` for `sdk/web` requests; `enrollCard` proceeds past the BIN check.
- [ ] `sdk/ionic` and `hosted/checkout` behavior unchanged; headerless clients still get no BIN.
- [ ] SDK (`vitest run`) and backend (`pytest`) tests pass.
