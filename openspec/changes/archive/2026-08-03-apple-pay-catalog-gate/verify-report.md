## Verification Report — apple-pay-catalog-gate

**Branch**: feature/applepay-foundation, commits f8c6d02..04702ac (7 commits; acdfab2 excluded, belongs to phase 1).
**Verdict**: PASS WITH WARNINGS

### Command evidence (all run against current HEAD)

- `npm run test`: 365 passed / 36 files (0 failed) — up from apply-progress's reported 359/34, consistent with the two new files (`payment-method.model.test.ts`, `payment-method-catalog.test.ts`) created by the post-task-list refactor (54f7ff2).
- `npm run typecheck`: clean, no errors.
- `npm run build`: clean, rollup + `.d.ts` emitted.
- `npm run lint`: exactly 2 pre-existing errors (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`), baseline unchanged, no new error. Confirmed not-grown.

### Spec compliance (all three delta specs: apple-pay, public-api, payment-method-discovery)

Every scenario in all three specs has a passing, correctly-targeted covering test. Verified by reading test bodies, not just pass/fail:

- **Non-fatal catalog leg**: `src/tonder.init.catalog.test.ts` — catalog rejects, business resolves → `init()` resolves, `lifecycle: 'ready'`, `paymentMethodCatalog: null`, `lastErrorCode: null`, AND a subsequent `pay({type:'card'})` succeeds (separate `it`). Genuinely covers the safety property end to end.
- **`.catch` placement (DD1)**: `describe('Tonder.init — both legs failing produces no unhandled rejection')` installs a real `process.on('unhandledRejection', ...)` spy, rejects catalog AFTER business already rejected `init()`, asserts `unhandled` array is empty. This is a real runtime observation, not a comment-only claim.
- **Parallel not chained**: deferred-promise test proves both `BUSINESS_PATH` and `CATALOG_PATH` are recorded in-flight before either resolves (`await Promise.resolve()` then assert both paths present, then resolve both).
- **Filter confinement (DD3/DD4)**: `rg -n 'mapPaymentMethod' src/` → exactly one declaration + one call site (`models/payment-method.model.ts:48,79`), inside `toPublicPaymentMethods`. `rg -n 'PaymentMethodInfo' src/` (non-test) → only `payment-method.model.ts` constructs it; `tonder.ts`/`index.ts`/`shared/types` only reference the type. Single-producer guarantee holds structurally post-refactor.
- **Cache raw / filter at boundary, both directions**: `tonder.init.catalog.test.ts` proves the cache retains both `apple_pay_*` entries with `configuration`; `tonder.getPaymentMethods.test.ts` proves the same fixture's public output excludes both and never contains the string `apple_pay`.
- **Helper totality**: `apple-pay-catalog.strategy.test.ts` explicitly tests null/empty/zero-active-entry inputs for all three helpers; `resolveApplePayNetworks(null)` and empty-input cases resolve to `DEFAULT_APPLE_PAY_NETWORKS`; `resolveApplePayMerchantCapabilities` always contains `supports3DS` including for `null` and `[]`.
- **Absence**: no `isApplePayAvailable` in `src/index.ts`/`src/tonder.ts` (grep empty); `src/index.ts` has zero diff vs the phase-1 baseline (`git diff acdfab2 HEAD -- src/index.ts` empty).
- **Non-regression**: `payment-method.model.test.ts` and `direct-api.service.test.ts` keep byte-identical non-Apple-Pay assertions (oxxopay/spei shapes unchanged); pay/enrollCard/saved-card suites untouched and green.

### The late refactor (54f7ff2 + 04702ac) — judged

Moves `mapPaymentMethod`/`toPublicPaymentMethods` into `models/payment-method.model.ts` and `isApplePayCatalogMethod` into `shared/payment-method-catalog.ts`; `direct-api.service.ts` now transport-only.

- **DD3/DD4 single-producer guarantee**: survives the move undiminished — verified structurally above, not just by design-doc claim.
- **`shared/payment-method-catalog.ts` as home for the predicate**: defensible. It already held the code→label/logo lookup table (pre-existing), the module has zero imports (a true leaf, confirmed via `rg -n '^import' src/shared/payment-method-catalog.ts` → no output), and the model importing from `core/` would cycle since `core/` imports these types. No better home was available given the layering constraint the model's own header comment states.
- **Test coverage after the move**: no coverage lost. `payment-method.model.test.ts` (7 cases incl. Apple Pay filter, configuration non-leak, totality) and `shared/payment-method-catalog.test.ts` (prefix match, non-match, bare-`apple_pay` non-match) together cover everything `direct-api.service.test.ts` covered pre-move, field for field.
- **design.md**: correctly updated by 04702ac — DD3/DD4 code blocks in the current file already show `models/payment-method.model.ts` + `shared/payment-method-catalog.ts` as the homes, matching actual code. Not stale.

### Findings

**WARNING — `tasks.md` was not updated after the late refactor and now misdescribes the code layout.** Tasks 1.1–1.2 and 3.3 still say the projection/`toPublicPaymentMethods()` lives in `src/core/services/direct-api.service.ts`; it was moved to `src/models/payment-method.model.ts` and `src/shared/payment-method-catalog.ts` by 54f7ff2, one commit after the task list was written. The checked boxes are not false (the work described was done, then superseded), but a reader trusting `tasks.md` today would look in the wrong file. Recommend a follow-up note or amendment before archive.

**WARNING — task 4.3's rollback claim ("reverting commit 3 alone restores prior `getPaymentMethods()` output") no longer holds cleanly at current HEAD.** Verified directly: `git revert --no-commit 10a5f16` (commit 3, "hide Apple Pay entries from getPaymentMethods") now produces a merge conflict in `src/core/services/direct-api.service.ts`, because `54f7ff2` restructured the same file after 10a5f16 landed and moved the code the revert touches into a different module. The task box is checked and was true at the time it was verified (before the refactor), but is stale relative to the current commit graph — the same drift class as the tasks.md finding above, just load-bearing on a specific operational claim instead of a description. Reverting all changes back through 04702ac in strict reverse order would still work; a bare "revert commit 3" no longer does.

**WARNING — duplicate/redundant test coverage in `src/core/services/direct-api.service.test.ts`.** Two `describe('DirectApiService.getPaymentMethodCatalog', ...)` blocks exist (lines 166 and 248), both testing GET path/method, paginated-envelope flattening, and transport-failure re-wrapping with near-identical fixtures. Origin: `54f7ff2` renamed the OLD `describe('DirectApiService.getPaymentMethods', ...)` block (which used to test the now-removed `getPaymentMethods()` on the service) to `getPaymentMethodCatalog`, colliding with the pre-existing `getPaymentMethodCatalog` describe block written in `f8c6d02` (unit 1, tasks 1.4/1.5). Not a correctness defect — all tests pass and add no false confidence — but it is dead test-hygiene debt from the refactor that should be de-duplicated (the renamed block's `apple_pay_debit_card`-untouched case is the only genuinely new assertion; the rest duplicates the older block).

**No CRITICAL issues.** No spec requirement is violated, no task box is falsely checked (all describe genuinely-completed work), no unhandled rejection, no leak of `apple_pay_*` into `getPaymentMethods()`, no regression in card/enrollCard/saved-card flows, lint baseline unchanged, `src/index.ts` untouched, no new public export.

### Task completeness

All boxes in `tasks.md` (0.1–4.3) checked and each verified true against the code at time of apply; two of them (task descriptions in 1.1/1.2/3.3, and the rollback claim in 4.3) are now stale relative to the current HEAD due to the unplanned late refactor landing after the task list was frozen. This is documentation drift, not implementation failure.

Session: a82698fa-0f92-40b3-a2a3-68480eecb3e1
Project: web-sdk
Scope: project
Topic: sdd/apple-pay-catalog-gate/verify-report
Engram observation: #4006
Created: 2026-08-03 15:11:24

## Post-verify remediation (added at archive time)

Per the orchestrator's brief for this archive: the three WARNINGs above were fixed in commit `9ff8c47`, and the full command suite was re-run after the fix — `npm run test`: 361 passing / 36 files, `npm run typecheck` clean, `npm run build` clean, `npm run lint` at the same two pre-existing unrelated errors. This archive proceeds on that basis: 0 CRITICAL at verify time, and all WARNINGs subsequently closed. The archive executor (this agent) did not re-run the test/build/lint commands itself — it has no shell access — and is relying on the orchestrator's report of `9ff8c47` and the re-run results stated in the archive brief.
