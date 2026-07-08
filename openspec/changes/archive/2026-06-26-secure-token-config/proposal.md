# Proposal: Secure token as set-once config value

## Intent

Saved-card / COF operations currently require a `getSecureToken?: () => Promise<string>` callback. But the merchant already mints the secure token server-side, so the callback is unnecessary indirection: the SDK re-invokes a function to obtain a value the integrator already holds. Replace it with a `secureToken?: string` passed once at `createTonder()`. This makes the SDK "dumber" — it receives an already-minted credential — and matches the reference `tonder-sdk` `BaseInlineCheckout`, which sets `this.secureToken` from a passed value. Breaking surface change, acceptable pre-publish (v0.1.0).

## Scope

### In Scope
- `TonderConfig`: REMOVE `getSecureToken?`; ADD `secureToken?: string` (set once, immutable for instance lifetime).
- `resolveCardAuth` (sole COF auth path): read `getConfig().secureToken` instead of awaiting the callback. Missing/empty → throw `SECURE_TOKEN_REQUIRED`.
- Remove `SECURE_TOKEN_ERROR` (the "callback threw" path) from `ErrorKeyEnum` + `messages.ts` — no callback can throw anymore.
- Reword `SECURE_TOKEN_REQUIRED`: "No secure token. Provide `secureToken` in createTonder() config." (no callback wording).
- README purge: remove EVERY `getSecureToken` mention (saved-cards + enroll sections show only `secureToken`); add a note that the token is server-minted and short-lived — recreate the SDK on expiry. Grep must return ZERO.
- Tests: switch all `getSecureToken` configs to a `secureToken` string; repurpose the "callback throws" test to assert `SECURE_TOKEN_REQUIRED` when `secureToken` is absent.

### Out of Scope
- `pay()` with a fresh card — uses Skyflow + public `apiKey`, no secure token. Unchanged.
- `config.customer` (prior change, set-once) — unchanged.
- No setter for `secureToken` — set-once; expiry handled by recreating the instance.
- Backend customer-scoping of the token (defense in depth) — note only.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `cof-enrollment`: secure-token credential moves from a callback to a set-once config string; `SECURE_TOKEN_ERROR` removed; `SECURE_TOKEN_REQUIRED` rule rephrased.

## Approach

`card.service.ts` and `cof.service.ts` already consume `secureToken` as a plain string. The change is localized: `resolveCardAuth` stops awaiting a callback and reads the config string, validating non-empty. Drop the callback type and its dedicated error. Security: `secureToken` is the server-minted credential; the SDK never mints it nor holds the secret key.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/types/index.ts` | Modified | `getSecureToken` → `secureToken?: string` |
| `src/tonder.ts` | Modified | `resolveCardAuth` reads config; drop `SECURE_TOKEN_ERROR` path + JSDoc |
| `src/shared/errors/ErrorKeyEnum.ts` | Removed | `SECURE_TOKEN_ERROR` |
| `src/shared/errors/messages.ts` | Modified | drop `SECURE_TOKEN_ERROR`; reword `SECURE_TOKEN_REQUIRED` |
| `README.md` | Modified | purge `getSecureToken`; add expiry note |
| `src/tonder.{enrollCard,getCustomerCards,removeCustomerCard,customer}.test.ts`, `src/core/services/cof.service.test.ts` | Modified | use `secureToken` string; repurpose throws-test |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token expires mid-session | Med | Documented: integrator recreates SDK with fresh token (accepted tradeoff) |
| `resolveCardAuth` returns empty token | Low | Validate non-empty → `SECURE_TOKEN_REQUIRED`; keep non-empty `userToken` |
| Stray `getSecureToken` in README/docs | Low | Grep README → must be ZERO |
| `SECURE_TOKEN_ERROR` referenced elsewhere | Low | Confirmed only in `tonder.ts`/error files (current archives excluded) |

## Rollback Plan

Revert the commit. No persisted state or migration; all changes are source + docs + tests.

## Dependencies

None. Builds on the prior `customer` set-once change.

## Success Criteria

- [ ] `TonderConfig.secureToken?: string` exists; `getSecureToken` gone.
- [ ] COF ops authenticate from `config.secureToken`; absent/empty → `SECURE_TOKEN_REQUIRED`.
- [ ] `SECURE_TOKEN_ERROR` removed from enum + messages; no references remain.
- [ ] `grep getSecureToken README.md` → 0 matches; expiry note present.
- [ ] Tests pass using `secureToken` string; throws-test repurposed.
