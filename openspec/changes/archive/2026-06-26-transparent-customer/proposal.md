# Proposal: Transparent Customer for Card-on-File

## Intent

Today the SDK REQUIRES an explicit `registerCustomer()` before ANY Card-on-File
operation (`enrollCard`, `getCustomerCards`, `removeCustomerCard`) — they throw
`CUSTOMER_NOT_REGISTERED` otherwise. The reference SDKs (`tonder-sdk`
`LiteInlineCheckout`) make this TRANSPARENT: the merchant provides the customer
ONCE and every COF op internally resolves it via a memoized `#getCustomer()`.
Align v3 with that UX through a config-level customer, removing the mandatory
pre-call without breaking existing integrations.

## Scope

### In Scope
- Add `customer?: CustomerInput` to `TonderConfig` (set once at `createTonder`).
- New private memoized `ensureCustomerRegistered()`: returns cached
  `customerAuthToken` if present (no network); else resolves
  `state.customerInput ?? config.customer`; if NONE anywhere → throw
  `CUSTOMER_NOT_REGISTERED`; else `customerService.registerOrFetch`, cache token
  + input, return token.
- `enrollCard` / `getCustomerCards` / `removeCustomerCard` call
  `ensureCustomerRegistered()` internally instead of reading the token directly.
- `registerCustomer()` STAYS as an OPTIONAL explicit call (pre-warm or switch
  customer dynamically); still caches token + input.
- Clarify `CUSTOMER_NOT_REGISTERED` message: customer may come from
  `config.customer` OR `registerCustomer()`.

### Out of Scope
- `pay()` with a fresh card still sends `customer` INLINE per call
  (`PayInput.customer`) — unchanged.
- No backend change. No new error codes. No new credential providers.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `card-on-file`: COF operations no longer require an explicit prior
  `registerCustomer()`; customer identity is resolved transparently and memoized
  from `config.customer` or a prior registration.

## Approach

Introduce a single memoization seam (`ensureCustomerRegistered()`) mirroring the
reference's `#getCustomer()`. COF entry points call it; `resolveCardAuth()` stops
throwing `CUSTOMER_NOT_REGISTERED` for a missing token and instead receives a
guaranteed token. Resolution order: cached token → `state.customerInput` →
`config.customer`. Memoization keys off `state.customerAuthToken`, so once
registered (config-transparent OR explicit) the token is reused — never
re-registering per COF op.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/types/index.ts` | Modified | Add `customer?: CustomerInput` to `TonderConfig` |
| `src/tonder.ts` | Modified | Add `ensureCustomerRegistered()`; COF ops call it; `resolveCardAuth` uses guaranteed token |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double-registration on each COF op | Med | Memoize on cached `customerAuthToken`; short-circuit before network |
| Silent failure when no customer anywhere | Med | Throw `CUSTOMER_NOT_REGISTERED` with message naming both sources |
| Breaking existing `registerCustomer()`-first flows | Low | Keep `registerCustomer()` public; cached token still wins |
| Stale customer after dynamic switch | Low | `registerCustomer()` overwrites cached token + input |

## Rollback Plan

Revert `src/tonder.ts` and `src/shared/types/index.ts`. The `customer` config
field is additive and optional; removing it and restoring the direct
token-read + throw in COF ops returns the prior mandatory-registration behavior
with no data migration.

## Dependencies

- None (reuses existing `CustomerService.registerOrFetch`).

## Success Criteria

- [ ] COF ops succeed with only `config.customer` set — no `registerCustomer()`.
- [ ] No customer anywhere → `CUSTOMER_NOT_REGISTERED` with a message naming both sources.
- [ ] Repeated COF ops register the customer at most once (memoized).
- [ ] Existing `registerCustomer()`-first integrations keep working unchanged.
- [ ] Public surface stays camelCase, no I-prefix, no vendor names.
