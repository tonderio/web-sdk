# Tasks: Apple Pay Catalog Gate (Phase 2)

Delivery is **commits only — no pull requests**. Order: Unit 1 (init/caching) →
Unit 2 (derivation helpers) → Unit 3 (filter + README), per design DD8.
Green after every unit: `npm run test`, `npm run typecheck`, `npm run build`.

## Review Workload Forecast

| Field                   | Value                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Estimated changed lines | Unit 1 ~350-450 (incl. 9-file fixture audit) · Unit 2 ~350-400 · Unit 3 ~150-200          |
| 400-line budget risk    | High                                                                                      |
| Chained PRs recommended | No — delivery is commits-only, not PR-based                                               |
| Suggested split         | If a unit's diff is uncomfortable to review, split that **commit**, never open a PR chain |
| Delivery strategy       | commits-only (no PR splitting)                                                            |
| Chain strategy          | size-exception (no chaining mechanism available)                                          |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

**Commit-splitting guidance (not PR splitting):** Unit 1 may split into `1a` (state

- transport plumbing: model move, `TonderCore`, `getPaymentMethodCatalog()`) and
  `1b` (`init()` parallel/non-fatal wiring + its tests) if the combined diff is
  uncomfortable. Unit 2 may split into `2a` (`isApplePayCatalogMethod` +
  `hasActiveApplePayMethod`) and `2b` (`resolveApplePayNetworks` +
  `resolveApplePayMerchantCapabilities`) — each sub-commit keeps its own tests
  (work-unit-commits: tests travel with the behavior). Unit 3 stays one commit;
  splitting the filter from the README note would separate code from the doc that
  explains it.

## Phase 0: Baseline

- [x] 0.1 Run `npm run lint`; record the current 2 pre-existing errors
      (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) as the baseline set.
- [x] 0.2 List every test file calling `.init()` (9 files: `tonder.test.ts`,
      `tonder.pay.test.ts`, `tonder.enrollCard.test.ts`, `tonder.customer.test.ts`,
      `tonder.create.test.ts`, `tonder.getCustomerCards.test.ts`,
      `tonder.removeCustomerCard.test.ts`, `tonder.handleRequiresAction.test.ts`,
      `tonder.snake-case-contract.test.ts`) — these need a second `HttpPort` path
      answered once `init()` issues two requests.

## Phase 1: Unit 1 — raw catalog fetch, non-fatal `init()`, core state

- [x] 1.1 Create `src/models/payment-method.model.ts`: move `BackendPaymentMethod`
      and `BackendPaymentMethodsPage` out of `direct-api.service.ts` verbatim (no
      imports, matching `business.model.ts`).
- [x] 1.2 Update `src/core/services/direct-api.service.ts` to import both types
      from the new model module instead of declaring them locally.
- [x] 1.3 Add `paymentMethodCatalog: BackendPaymentMethod[] | null` to
      `TonderState` in `src/core/TonderCore.ts` (+ constructor initializer `null`).
- [x] 1.4 RED: in `src/core/services/direct-api.service.test.ts`, add a failing
      test for `getPaymentMethodCatalog()` — issues `GET
/api/v1/payment_methods?status=active`, returns the flattened array
      (array and paginated-envelope fixtures), wraps transport failure as
      `AppError(FETCH_PAYMENT_METHODS_ERROR)`.
- [x] 1.5 GREEN: implement `getPaymentMethodCatalog()` per design DD3.
- [x] 1.6 RED: new test file `src/tonder.init.catalog.test.ts` — concurrency
      case: fake `HttpPort` proves both paths are in flight before either
      resolves (deferred promises + microtask flush).
- [x] 1.7 RED (same file): catalog-leg-non-fatal case — catalog rejects,
      business resolves → `init()` resolves, `lifecycle === 'ready'`,
      `paymentMethodCatalog === null`, `lastErrorCode === null`, and a
      subsequent `pay({ payment_method: { type: 'card' } })` still succeeds.
- [x] 1.8 RED (same file): business-still-fatal case — business rejects,
      catalog resolves → `init()` rejects `AppError(INIT_ERROR)`,
      `lifecycle === 'error'`, `originalError` is the original
      `AppError(FETCH_BUSINESS_ERROR)`.
- [x] 1.9 RED (same file): both-legs-fail case with an `unhandledrejection` /
      `process.on('unhandledRejection')` spy — asserts it records **nothing**.
      This is the test that proves DD1's `.catch` placement.
- [x] 1.10 RED (same file): raw-cache case — fixture with both `apple_pay_*`
      entries (carrying `configuration`) + one card + one APM → after
      `init()`, state contains all four, **including** `configuration`.
- [x] 1.11 GREEN: rewrite `init()` in `src/tonder.ts` (~L264) per design DD1 —
      issue both requests before the first `await`, `.catch(() => null)`
      attached at creation on the catalog leg, `Promise.all`, `setState({
lifecycle: 'ready', business, paymentMethodCatalog })`.
- [x] 1.12 Audit the 9 files from 0.2: update each fake `HttpPort` so an
      unknown/second path resolves or is left to the fake's default 404/throw
      behavior (the non-fatal rule tolerates this). No assertion on existing
      business-config behavior changes.
- [x] 1.13 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
      `getPaymentMethods()` output is still byte-identical (nothing filters yet).
- [x] 1.14 Commit 1: `feat: cache the raw payment-method catalog during init`.

## Phase 2: Unit 2 — pure derivation helpers

- [x] 2.1 RED: create `src/core/strategies/apple-pay-catalog.strategy.test.ts`
      with cases for `isApplePayCatalogMethod` (both known variants, a
      hypothetical third `apple_pay_*` variant, `'card'`/`'oxxo'`/`'spei'`,
      bare `'apple_pay'` non-match per DD5).
- [x] 2.2 RED (same file): `hasActiveApplePayMethod` — null, empty, no Apple
      entries, debit only, credit only, both.
- [x] 2.3 GREEN: implement `isApplePayCatalogMethod` and
      `hasActiveApplePayMethod` in new
      `src/core/strategies/apple-pay-catalog.strategy.ts` (design DD5/DD6).
- [x] 2.4 RED: `resolveApplePayNetworks` — identical-network dedup, disjoint
      union, one entry only, entry without `configuration`, `[]`
      `supported_networks`, null catalog, non-Apple entries' `configuration`
      ignored. Include the totality case: zero active entries → fresh copy of
      `DEFAULT_APPLE_PAY_NETWORKS`.
- [x] 2.5 GREEN: implement `resolveApplePayNetworks` + `DEFAULT_APPLE_PAY_NETWORKS`.
- [x] 2.6 RED: `resolveApplePayMerchantCapabilities` — both, debit only,
      credit only, neither. Assert `supports3DS` present in all four and
      fixed order.
- [x] 2.7 GREEN: implement `resolveApplePayMerchantCapabilities`, with the
      `supports3DS` ≠ 3-D-Secure code comment (DD6 gotcha #1).
- [x] 2.8 Mechanical check: `rg -n 'isApplePayCatalogMethod|hasActiveApplePayMethod|resolveApplePayNetworks|resolveApplePayMerchantCapabilities' src/`
      — confirm each is unreferenced outside its own module and test file
      (unreachable by construction, phase-1 DD2 precedent).
- [x] 2.9 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
- [x] 2.10 Commit 2: `feat: derive Apple Pay availability, networks and capabilities`.

## Phase 3: Unit 3 — filter `getPaymentMethods()` + README (merchant-visible)

- [x] 3.1 RED: in `src/tonder.getPaymentMethods.test.ts`, add — catalog with
      `card`, `spei`, both `apple_pay_*` entries → resolved array excludes
      both; catalog with no Apple Pay entries → output identical to
      pre-change; every non-Apple method keeps its existing shape.
- [x] 3.2 RED (same file): `getPaymentMethods()` issues its **own** fresh
      request even when `init()`'s catalog leg failed (cache stays empty; the
      public call still returns real methods, not `[]`).
- [x] 3.3 GREEN: add `toPublicPaymentMethods()` per design DD4 (filters
      `isApplePayCatalogMethod`, then maps via the module-private
      `mapPaymentMethod`), and compose it with the catalog fetch in
      `getPaymentMethods()`.
      **Landed in `models/payment-method.model.ts`, not in the transport
      service** — a follow-up refactor (`54f7ff2`) moved the projection to the
      model, the predicate to `shared/payment-method-catalog.ts`, and the
      composition to `tonder.ts`, matching how `getTransaction()` already pairs
      the service with `toRawTransaction`. `direct-api.service.ts` keeps
      transport only and no longer has a `getPaymentMethods()`.
- [x] 3.4 Mechanical check: `rg -n 'mapPaymentMethod' src/` — declaration plus
      exactly **one** call site (inside `toPublicPaymentMethods`). This is the
      structural enforcement DD4 relies on; read the output, don't assume it.
- [x] 3.5 Non-regression: run `src/tonder.getPaymentMethods.test.ts` and
      `src/core/services/direct-api.service.test.ts` — zero assertion edits
      for any non-Apple-Pay method (only new Apple Pay cases added).
- [x] 3.6 Update `README.md`: one note that `getPaymentMethods()` never
      returns Apple Pay entries, and why. No other README change.
- [x] 3.7 Absence check: confirm no `isApplePayAvailable` on the `Tonder`
      instance and no Apple Pay export in `src/index.ts` (`rg -n
'isApplePayAvailable' src/index.ts src/tonder.ts` returns nothing).
- [x] 3.8 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
- [x] 3.9 Commit 3: `feat: hide Apple Pay entries from getPaymentMethods`.

## Phase 4: Final verification

- [x] 4.1 Re-run `npm run lint`; diff the error set against the Phase 0
      baseline — must be exactly the same 2 pre-existing errors, no new ones.
- [x] 4.2 Confirm `src/index.ts` has no diff (design: not touched, no new
      public export).
- [x] 4.3 Confirm rollback: verified at the time each commit landed — reverting
      commit 3 alone restored prior `getPaymentMethods()` output, 3+2 restored
      prior state fully, and reverting all three restored single-request
      `init()`.
      **No longer operationally true at current HEAD.** The follow-up refactor
      (`54f7ff2`) restructured `direct-api.service.ts`, so `git revert 10a5f16`
      now conflicts there. Rolling back the filter today means reverting the
      refactor first, or reverting the range as a unit. The per-commit
      granularity was real when built and was consumed by a later change — worth
      knowing before relying on it in an incident.
