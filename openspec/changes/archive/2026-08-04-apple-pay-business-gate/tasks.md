# Tasks: Apple Pay availability moves to the business config

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~900–1200 (mostly deletions: two whole test files, one whole module, one state slot)                                                                                                  |
| 400-line budget risk    | High by raw count — **overstated**: bulk is file deletion (no new logic to review). True review load is §7's survivor checklist, which is small and fixed regardless of deletion size |
| Chained PRs recommended | No — delivery is commits-only per explicit instruction, not PR-gated                                                                                                                  |
| Suggested split         | 6 work-unit commits (WU1–WU6), one per row below, in order                                                                                                                            |
| Delivery strategy       | commits-only (no PR, no chain skill loaded)                                                                                                                                           |
| Chain strategy          | N/A — no PR exists for this change                                                                                                                                                    |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High

Each WU below is one work-unit commit: RED test → GREEN implementation/deletion → verify `npm run test && npm run typecheck` green before moving on. Strict TDD is active — do not skip RED.

### Suggested Work Units

| Unit | Goal                                                                           | Depends on |
| ---- | ------------------------------------------------------------------------------ | ---------- |
| WU1  | `ApplePayConfig` type, additive only                                           | none       |
| WU2  | Fold resolvers into `apple-pay.strategy.ts`; fix tautological test             | WU1        |
| WU3  | Gate rewire (`isApplePayAvailable`, `mount()`); delete catalog strategy module | WU2        |
| WU4  | `init()` single request; delete state slot + its test file                     | WU3        |
| WU5  | Delete transport `configuration` field                                         | WU2        |
| WU6  | Confirm delta specs match shipped behavior                                     | WU1–5      |

---

## Phase 1 — WU1: Additive type (`ApplePayConfig`)

- [x] 1.1 RED: `business.model.test.ts` — one fixture with `apple_pay`, one without; both must type-check.
- [x] 1.2 GREEN: add `ApplePayConfig` to `src/models/business.model.ts` (fields: `enabled: boolean`; optional `merchant_identifier`, `supported_networks`, `supports_debit`, `supports_credit`, each PENDING-name-commented). Add `BusinessConfig.apple_pay?: ApplePayConfig`.
- [x] 1.3 No reader exists yet — nothing else changes. Commit.

## Phase 2 — WU2: Fold resolvers; kill the tautology

- [x] 2.1 RED in `apple-pay.strategy.test.ts`: absent block, empty array, debit-only, credit-only, both-absent cases for both resolvers, retyped over `ApplePayConfig | undefined`.
- [x] 2.2 GREEN: move `DEFAULT_APPLE_PAY_NETWORKS`, `resolveApplePayNetworks`, `resolveApplePayMerchantCapabilities` into `apple-pay.strategy.ts` (names unchanged, `supports3DS` comment moves verbatim). Retype `BuildApplePayPaymentRequestInput.catalog` → `.applePay: ApplePayConfig | undefined`. Update call sites (`apple-pay.strategy.ts:106,111`) to `input.applePay`.
- [x] 2.3 In `resolveApplePayMerchantCapabilities`, keep the code comment stating: absent `supports_debit`/`supports_credit` means "do not filter by that card type" (permissive default for an unconfirmed field name), the inverse of the old catalog behavior — this is intentional, not a lost feature (DD8).
- [x] 2.4 **Fix the tautology** at `apple-pay.strategy.test.ts:162-167`: replace `expect(request.merchantCapabilities).toEqual(resolveApplePayMerchantCapabilities(catalog))` / the networks equivalent with **literal expected arrays** per case. Add a one-line comment: "asserts wiring against literal values, not `f(x) === f(x)`, so a wrong resolver output fails this test." Keep exactly one wiring-only test confirming the builder does not re-derive.
- [x] 2.5 Update `ApplePayCheckoutContext` (`catalog` → `applePay: ApplePayConfig | undefined`) and `ApplePayCheckoutService.start()` pass-through; swap the `BackendPaymentMethod` type import for `ApplePayConfig`.
- [x] 2.6 `src/tonder.ts` `getContext()`: `applePay: state.business?.apple_pay`. Commit — old module (`apple-pay-catalog.strategy.ts`) still exports `hasActiveApplePayMethod` only at this point; no duplicate export exists.

## Phase 3 — WU3: Gate rewire; delete the catalog strategy module

- [x] 3.1 RED in `tonder.applePay.test.ts` / `tonder.applePayButton.test.ts`: one failing factor per false case (browser, `apple_pay.enabled`, country), one all-pass `true` case per `describe`.
- [x] 3.2 GREEN: `isApplePayAvailable()` reads `Boolean(state.business?.apple_pay?.enabled)` directly, no helper (DD3). `mount()` gate 3 reads the same field plus `country_code`. Remove the `hasActiveApplePayMethod` import from `tonder.ts:36`.
- [x] 3.3 Delete `src/core/strategies/apple-pay-catalog.strategy.ts` and `apple-pay-catalog.strategy.test.ts` in this same commit (last two call sites left in 3.2).
- [x] 3.4 Correct `tonder.ts:247-249` (the `isApplePayAvailable()` comment claiming "catalog and business config are unset") in this commit — it is falsified by 3.2, not deferred.

## Phase 4 — WU4: `init()` single request; drop the state slot

- [x] 4.1 RED: init test asserting the fake `HttpPort` records **exactly one** request, and its path — not "no request to `/payment_methods`".
- [x] 4.2 GREEN: replace `init()` body (`tonder.ts`, current lines ~476–521) with the plain-`await` version from design.md §1 — remove `Promise.all`, the `.catch(() => null)` leg, the destructure, the `paymentMethodCatalog` state write, and their three explanatory comments. Keep the `try/catch`, `INIT_ERROR` wrapping, and the `lifecycle` guard/transition unchanged.
- [x] 4.3 Correct `tonder.ts:470-474` JSDoc ("two requests issued concurrently") in this same commit — it is falsified by 4.2.
- [x] 4.4 Remove `TonderState.paymentMethodCatalog` (`TonderCore.ts:21`), its 9-line comment (13-20), the `null` initializer (51), and the now-unused `import type { BackendPaymentMethod }`.
- [x] 4.5 Delete `src/tonder.init.catalog.test.ts` (covers only the removed leg) in this same commit.
- [x] 4.6 Correct the `direct-api.service.ts:156-167` comment ("cached by `init()` for the Apple Pay availability gate") — falsified by 4.4, corrected here.

## Phase 5 — WU5: Drop the transport field

- [x] 5.1 RED: re-run `getPaymentMethods.test.ts`'s Apple-Pay-exclusion test with `configuration` removed from the fixture.
- [x] 5.2 GREEN: remove `BackendPaymentMethod.configuration?: { supported_networks?: string[] }` (`payment-method.model.ts:36`). Update the now-excess-property fixtures: `tonder.getPaymentMethods.test.ts:108,115`, `direct-api.service.test.ts:184`. Delete `payment-method.model.test.ts:77-86` (its entire subject is the removed field).
- [x] 5.3 **The exclusion assertion itself**: name `apple_pay_debit_card` and `apple_pay_credit_card` explicitly in the `.not.toContain`/equivalent checks, AND assert the surviving `card`/`spei` entries positively by value — never assert array length alone (a length-2 check would pass with the wrong two entries). Confirm the fake `HttpPort` still records the request (proves no cache is being read).
- [x] 5.4 Correct `payment-method.model.ts:31-35` ("read by the Apple Pay derivation helpers") and `:71-72` ("the cached raw catalog never reaches this function") in this same commit. Preserve `:59-70` (why the filter exists) almost intact — only its final cached-catalog sentence changes.

## Phase 6 — WU6: Spec accuracy check

- [x] 6.1 Confirm the three delta specs already in `openspec/changes/apple-pay-business-gate/specs/` (`apple-pay`, `public-api`, `payment-method-discovery`) match the behavior shipped in WU1–5 — no source change in this step.
- [x] 6.2 Confirm `payment-method-discovery/spec.md` changed only the cache-reference constraint and scenario; the filter requirement, its other constraints, and its scenarios are untouched.

## Phase 7 — Survivor verification (read the output, do not assume it)

- [x] 7.1 `rg -n 'isApplePayCatalogMethod' src/models/payment-method.model.ts` → exactly 2 hits (import + one use inside `toPublicPaymentMethods`'s filter chain).
- [x] 7.2 `rg -n 'PaymentMethodInfo\[\]' src/ | rg -v '\.test\.ts'` → read every hit; exactly one is the producer (`toPublicPaymentMethods`'s return).
- [x] 7.3 `rg -n 'mapPaymentMethod' src/` → exactly 2 hits (unexported `function` declaration + its one `.map()` call).
- [x] 7.4 `git diff --stat -- src/shared/payment-method-catalog.ts` → confirm **no semantic change**: read the diff (not the line count — husky/prettier may reformat staged files and a formatting pass would fail a zero-line-diff check for a non-reason). The function, its predicate, and its location must be unchanged.
- [x] 7.5 `rg -n 'paymentMethodCatalog|hasActiveApplePayMethod' src/ openspec/specs/` → zero hits.
- [x] 7.6 `rg -n 'resolveApplePayNetworks|resolveApplePayMerchantCapabilities' src/` → only `apple-pay.strategy.ts` + its test.
- [x] 7.7 `rg -n 'apple-pay-catalog' src/` → zero hits.
- [x] 7.8 `rg -n 'catalog' src/ -g '!*.test.ts'` → every hit is `getPaymentMethodCatalog`/`payment-method-catalog`/`getPaymentMethodCatalogDetails`; none describes a cache.
- [x] 7.9 `rg -n 'merchant_identifier' src/` → exactly one hit, the declaration + never-read comment.
- [x] 7.10 `npm run test`, `npm run typecheck`, `npm run build` all pass.
- [x] 7.11 **Lint baseline**: run `npm run lint` before starting Phase 1 and record the errors (expected: exactly `src/tonder.handleRequiresAction.test.ts:184`, `src/tonder.pay.test.ts:483`). Re-run after Phase 6; the set must be identical — same 2 errors, same file:line pairs, no third. Do not fix the pre-existing two.

## Next Step

Ready for `sdd-apply`, work-unit commits only (WU1 → WU6 → Phase 7 verification), no PR.
