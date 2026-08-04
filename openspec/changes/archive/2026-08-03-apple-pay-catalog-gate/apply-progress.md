**What**: Implemented all of Apple Pay Catalog Gate (Phase 2) on `feature/applepay-foundation`. Every task in `openspec/changes/apple-pay-catalog-gate/tasks.md` (0.1 through 4.3) is checked off. Delivered as 5 commits, commits-only, no PR:

- `f8c6d02` feat: add a raw payment-method catalog fetch and cache slot (unit 1a)
- `227a8ec` feat: fetch the payment-method catalog concurrently during init (unit 1b)
- `0426c9a` feat: add the Apple Pay catalog predicate and availability gate (unit 2a)
- `d7acf2e` feat: derive Apple Pay supported networks and merchant capabilities (unit 2b)
- `10a5f16` feat: hide Apple Pay entries from getPaymentMethods (unit 3)

**Why**: Phase 2 of `docs/apple-pay-integration-plan.md` — the first phase with runtime behavior. `init()` must cache the raw payment-method catalog for the Apple Pay availability gate, while `getPaymentMethods()` must stop leaking `apple_pay_*` entries that merchants would render as selectable-but-uncharageable options.

**Where**:

- Created `src/models/payment-method.model.ts` (`BackendPaymentMethod`, `BackendPaymentMethodsPage` moved verbatim out of `direct-api.service.ts`)
- Created `src/core/strategies/apple-pay-catalog.strategy.ts` + `.test.ts` (4 pure helpers + `DEFAULT_APPLE_PAY_NETWORKS`)
- Created `src/tonder.init.catalog.test.ts` (7 tests: concurrency, non-fatal, fatal-business, no-unhandled-rejection, raw cache, paginated cache)
- Modified `src/core/TonderCore.ts` (`TonderState.paymentMethodCatalog`), `src/core/services/direct-api.service.ts` (`getPaymentMethodCatalog()` + `toPublicPaymentMethods()`), `src/tonder.ts` (`init()` rewrite), `src/tonder.test.ts` (call counts now by path), `src/tonder.getPaymentMethods.test.ts` (3 new cases), `README.md` (one note)
- `src/index.ts` UNTOUCHED — no new public export, no `isApplePayAvailable()`

**Verification (real output)**: `npm run test` 359 passed / 34 files; `npm run typecheck` clean; `npm run build` clean. `npm run lint` still exactly the 2 pre-existing errors (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) — baseline unchanged, no new error introduced. Reverting commit 3 alone was actually executed and applies cleanly with the pre-change getPaymentMethods suite green.

**Learned**:

- **The 9-file fixture audit (task 1.12) was a false premise.** Only 2 assertions in 1 file broke (`tonder.test.ts` `toHaveBeenCalledTimes(1)`), because the other 8 files' fake `HttpPort`s are catch-all mocks that answered the new catalog path harmlessly. Fixed by counting requests by path instead of totalling them.
- **Because of that, the requested 1a/1b split (src change vs. fixture audit) would have produced a RED intermediate commit** for a 4-line follow-up. Used the split `tasks.md` itself documents instead — 1a = model move + state slot + `getPaymentMethodCatalog()`, 1b = `init()` rewrite + its tests + the 2 fixture fixes. Still 5 commits, every one green.
- `mapPaymentMethod` verified at exactly one call site via `rg`; the other matches are `mapPaymentMethodBank`, a different function that shares the prefix. Read the output, do not grep-and-assume.
- The `.catch(() => null)` must be attached at promise creation. The both-legs-fail test genuinely fails (Node reports an unhandled rejection) when it is not — RED was observed, not assumed.
- Declaring `APPLE_PAY_DEBIT_METHOD`/`APPLE_PAY_CREDIT_METHOD` in commit 2a would have been a lint error (unused); they had to travel with 2b, the commit that uses them.

Session: a82698fa-0f92-40b3-a2a3-68480eecb3e1
Project: web-sdk
Scope: project
Topic: sdd/apple-pay-catalog-gate/apply-progress
Engram observation: #4005
Created: 2026-08-03 14:31:15

## Post-apply refactor (post-dates this progress record)

A follow-up refactor landed in commits `54f7ff2` and `04702ac`, after this apply-progress was recorded. It moved `mapPaymentMethod`/`toPublicPaymentMethods` into `models/payment-method.model.ts` and `isApplePayCatalogMethod` into `shared/payment-method-catalog.ts`, making `direct-api.service.ts` transport-only. See `verify-report.md` in this archive folder for the judged assessment of that refactor (single-producer guarantee preserved, no coverage lost, design.md updated correctly).
