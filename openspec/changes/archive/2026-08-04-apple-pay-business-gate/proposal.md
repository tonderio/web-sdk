# Proposal: Apple Pay availability moves to the business config

## Intent

The backend confirmed that `GET /api/v1/payments/business/{apiKey}` — the request `init()`
already makes — carries a root-level `apple_pay` block:

```jsonc
{
  "apple_pay": {
    "enabled": true,
    "merchant_identifier": "merchant.io.tonder.checkout",
  },
}
```

That supersedes the interim design, which derived availability, networks and card-type
capabilities from `apple_pay_*` entries in the payment-method catalog. **This change is
mostly a deletion**: a request, a cache and three helpers go away. Every merchant's `init()`
makes one fewer request, including merchants who never use Apple Pay. Six-plus canonical
requirements currently assert behavior that will no longer exist; leaving them appended
alongside the new ones is the defect class this project already cleaned up twice.

## Scope

### In scope — removed

| Removed                                                                                                                                                                                                   | Current site                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Concurrent catalog fetch in `init()` + its non-fatal `.catch(() => null)` leg                                                                                                                             | `src/tonder.ts:487-509`                             |
| `TonderState.paymentMethodCatalog`                                                                                                                                                                        | `src/core/TonderCore.ts:21`                         |
| `hasActiveApplePayMethod`; the catalog form of `resolveApplePayNetworks` / `resolveApplePayMerchantCapabilities`. The whole module goes — the block-derived resolution folds into `apple-pay.strategy.ts` | `src/core/strategies/apple-pay-catalog.strategy.ts` |
| `configuration?: { supported_networks }` on `BackendPaymentMethod` — no reader remains                                                                                                                    | `src/models/payment-method.model.ts:36`             |

### In scope — changed

- `ApplePayConfig` on `BusinessConfig` at the root, sibling of `mercado_pago`.
- `isApplePayAvailable()` = browser support && `apple_pay.enabled` && `country_code`.
- Networks and capabilities resolve from the `apple_pay` block, SDK default `['visa','masterCard']`.
- `BuildApplePayPaymentRequestInput` and the checkout context take the `apple_pay` block, not `catalog`.

### In scope — corrected comments

Comments the deletion turns into false statements are fixed **in the same commit as the
deletion** — a comment describing code that no longer exists is a false statement in the
source, not a style issue. Known sites: `TonderCore.ts:13-20` (the removed state slot),
`direct-api.service.ts:156-167` ("cached by `init()` for the Apple Pay availability gate"),
`payment-method.model.ts:31-35` and `:71-72` (both reference the cached raw catalog).

The general sweep — comments that are merely unnecessary, or that leak Tonder internals onto
a public surface — stays with phase 7. Do not start it here.

## What must still be there afterwards

A deletion change is reviewed by reading what disappeared, so the real risk is something
disappearing that nobody listed. These are not "unaffected"; they are **load-bearing and
must be confirmed present**:

| Must survive                                                               | Site                                                   | Why it looks deletable and is not                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `apple_pay_*` filter                                                   | `src/models/payment-method.model.ts:78`                | Those entries **keep arriving**. It runs on `getPaymentMethods()`'s own live fetch (`src/tonder.ts:956-960`) and never depended on the cache. Without it a merchant renders them as APMs and calls `pay({ type: 'apple_pay_debit_card' })`, which cannot work |
| `toPublicPaymentMethods()` as the single producer of `PaymentMethodInfo[]` | `src/models/payment-method.model.ts:74`                | The structural guarantee that makes the filter unbypassable                                                                                                                                                                                                   |
| `mapPaymentMethod` module-private, exactly one call site                   | `src/models/payment-method.model.ts:48`                | Export it or add a second call site and an entry can reach a merchant without passing the filter                                                                                                                                                              |
| `isApplePayCatalogMethod`                                                  | `src/shared/payment-method-catalog.ts`                 | The one thing with "catalog" in its name that **is** genuinely about the catalog: it is the filter's predicate. It lives in the leaf module so `models/` can import it without a cycle. Do not touch it                                                       |
| `DirectApiService.getPaymentMethodCatalog()`                               | `src/core/services/direct-api.service.ts:168`          | Still the transport for `getPaymentMethods()`. Only its JSDoc changes                                                                                                                                                                                         |
| The `payment-method-discovery` filter requirement                          | `openspec/specs/payment-method-discovery/spec.md:9-44` | Untouched. Only that spec's cache references change                                                                                                                                                                                                           |

### Out of scope

- Consuming `merchant_identifier`. Typed so the response shape is honest; **unread** because
  it is not a field of `ApplePayPaymentRequest`, and the only three Apple APIs taking it
  (`applePayCapabilities()`, `canMakePaymentsWithActiveCard()`, `openPaymentSetup()`) are all
  deferred. This must be said in code, or someone will wire it up.
- Real-Safari validation (phase 6), third-party browsers, Google Pay.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `apple-pay`: at least **ten** requirements, not the six first counted. Verified against
  `openspec/specs/apple-pay/spec.md`: (1) "no `ApplePayConfig` exists anywhere" — inverted;
  (2) raw catalog fetched and cached during `init()`; (3) the gate reads the cached catalog
  only (D4); (4) supported-networks derivation; (5) `merchantCapabilities` derivation;
  (6) the unread catalog `configuration` field; (7) public availability wiring, which spells
  out `hasActiveApplePayMethod(state.paymentMethodCatalog)`; (8) `buildApplePayPaymentRequest`,
  which requires the catalog helpers' exact output; (9) `mount()`'s four ordered gates, whose
  row 3 is "the catalog gate and `business.country_code`"; (10) `APPLE_PAY_NOT_ENABLED`'s
  documented meaning ("no active `apple_pay_*` method in the catalog").
- `public-api`: "init() fetches business config and the Apple Pay catalog concurrently; the
  catalog leg is non-fatal" — `init()` returns to a single request.
- `payment-method-discovery`: the **filter requirement stays**. Only its cache references
  change: the constraint "MUST NOT read from the raw catalog `init()` caches" and the
  scenario "issues its own request even when `init()`'s catalog leg failed" describe a cache
  that will not exist.

Every one of these is MODIFIED or REMOVED in place. None is appended alongside, and no delta
may use change-scoped wording ("this change", "previously") in the canonical text itself.

## Approach

1. Declare `ApplePayConfig` and `BusinessConfig.apple_pay`; extend the business fixtures.
2. **Fold** network/capability resolution into `src/core/strategies/apple-pay.strategy.ts`
   — not inline in the facade, and not a renamed module. It stays pure and independently
   testable (absent field, empty array, the asymmetric debit-only case are the cases worth
   testing); `buildApplePayPaymentRequest` is its only consumer and already lives there; and
   a module named `apple-pay-catalog.strategy.ts` that reads no catalog is a name that lies.
   The `supports3DS` comment (EMV cryptogram, not 3-D Secure) moves with it.
3. Rewrite `isApplePayAvailable()` and `mount()` gate 3 against `business.apple_pay`.
4. Delete the `init()` catalog leg, the state slot, the catalog strategy module and the
   transport `configuration` field — last, so each earlier step keeps the suite green.
   Correct the comments the deletion falsifies in this same commit.
5. Rewrite the three specs.

**No error copy changes.** Checked: `MESSAGES_EN[APPLE_PAY_NOT_ENABLED]`
(`src/shared/errors/messages.ts:67-68`) reads "Apple Pay is not enabled for this business.
Contact Tonder to enable it and to confirm the business country." It never mentioned the
catalog, and it is _more_ accurate after this change — "not enabled for this business" is
now literally `apple_pay.enabled === false`. Recorded here so the next reader does not
re-open it.

`core/` stays pure. Strict TDD applies genuinely: `HttpPort` is injected, so every response
is faked and every step above has a runtime behavior to red-test first.

## Affected Areas

| Area                                                | Impact    | Description                                                                                    |
| --------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `src/models/business.model.ts`                      | Modified  | `ApplePayConfig`, `BusinessConfig.apple_pay`                                                   |
| `src/tonder.ts`                                     | Modified  | `init()` single request, `isApplePayAvailable()`, `mount()` gate, checkout context             |
| `src/core/TonderCore.ts`                            | Modified  | Drop `paymentMethodCatalog`                                                                    |
| `src/core/strategies/apple-pay-catalog.strategy.ts` | Removed   | Folded into `apple-pay.strategy.ts`                                                            |
| `src/core/strategies/apple-pay.strategy.ts`         | Modified  | Absorbs the resolution helpers; input takes the block                                          |
| `src/models/payment-method.model.ts`                | Modified  | Drop `configuration`; correct two comments; **filter and single-producer structure untouched** |
| `src/shared/payment-method-catalog.ts`              | Unchanged | `isApplePayCatalogMethod` is the filter's predicate — do not touch                             |
| `src/shared/errors/messages.ts`                     | Unchanged | Copy verified accurate post-change                                                             |
| `src/core/services/direct-api.service.ts`           | Modified  | JSDoc only — the method still serves `getPaymentMethods()`                                     |
| `src/tonder.init.catalog.test.ts`                   | Removed   | Covers the deleted leg                                                                         |

## Risks

| Risk                                                    | Likelihood | Mitigation                                                                                                                         |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The `apple_pay_*` filter is deleted with the cache      | Med        | Named in scope, in the specs, and in a test asserting `getPaymentMethods()` still hides both entries                               |
| Backend field names for networks/card types unconfirmed | High       | Both optional with SDK defaults; `HttpPort` is faked, so nothing is blocked. Recorded below                                        |
| A spec delta appends instead of replacing               | Med        | Delta targets enumerated above; verify no requirement names `paymentMethodCatalog` afterwards                                      |
| A new lint error hides behind the two pre-existing ones | Low        | `src/tonder.handleRequiresAction.test.ts:184` and `src/tonder.pay.test.ts:483` are the only permitted reds; count before and after |

## Open item — record, do not resolve

The backend sample carries only `enabled` and `merchant_identifier`. **Field names for
supported networks and for debit/credit card types are not confirmed.** Proposed shape,
pending:

```ts
export interface ApplePayConfig {
  enabled: boolean;
  merchant_identifier?: string; // declared, never read
  supported_networks?: string[]; // PENDING — name unconfirmed
  supports_debit?: boolean; // PENDING — name unconfirmed
  supports_credit?: boolean; // PENDING — name unconfirmed
}
```

All optional with SDK defaults, so a wrong name degrades to the default rather than failing.
Only the mapping changes if the names differ. Written down here so the contract is an
artifact, not something discovered in Safari.

## Rollback Plan

Delivery is commits only, no PR. Each step is a work-unit commit, so `git revert` of the
range restores the catalog gate exactly — the archived `2026-08-03-apple-pay-catalog-gate`
artifacts remain the record of the superseded design. The spec rewrites revert with it.

## Dependencies

- Backend `apple_pay` block live on stage before phase 6, not before this change.
- Archived `2026-08-03-apple-pay-catalog-gate` and `2026-08-04-apple-pay-checkout` are the
  superseded baselines.

## Success Criteria

- [ ] `init()` issues exactly **one** request; a test asserts the count, not just the absence.
- [ ] `isApplePayAvailable()` returns `false` independently for each of: browser unsupported,
      `apple_pay.enabled` false or absent, `country_code` absent. Never throws before `init()`.
- [ ] `getPaymentMethods()` still excludes both `apple_pay_*` entries, with no cache anywhere.
- [ ] `rg 'paymentMethodCatalog|hasActiveApplePayMethod' src/ openspec/specs/` returns nothing,
      and `resolveApplePayNetworks` / `resolveApplePayMerchantCapabilities` appear only in
      `apple-pay.strategy.ts` and its test.
- [ ] **The survival table above is walked item by item.** `toPublicPaymentMethods` is still
      the only producer of `PaymentMethodInfo[]`; `mapPaymentMethod` still has exactly one
      call site; `src/shared/payment-method-catalog.ts` shows a zero-line diff.
- [ ] No comment in `src/` still describes a cached catalog.
- [ ] `merchant_identifier` is typed and has zero read sites, with the reason in a comment.
- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass. `npm run lint` shows the same
      two pre-existing errors and no third.
