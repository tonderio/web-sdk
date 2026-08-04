# Verify Report: Apple Pay Browser Core (Phase 3)

> Recovered from Engram observation `sdd/apple-pay-browser-core/verify-report` (#4018), full content, for archive traceability.

**Result: CLEAN. 0 CRITICAL, 1 WARNING, 0 SUGGESTION.**

**What**: Verified `apple-pay-browser-core` (Phase 3) implementation against its spec/design/tasks on branch `feature/applepay-foundation` (commits 11f1584..df723bb..5b8a1d2).

**Why**: sdd-verify phase before archive. This phase was flagged as high-risk for tests that pass for the wrong reason (jsdom CSS-drop trap, synchrony-as-proxy, fake-global overclaiming).

**Where checked**:

- `src/ports/apple-pay.port.ts`, `src/core/strategies/apple-pay.strategy.ts`, `src/adapters/browser/apple-pay.adapter.ts`, `src/shared/errors/messages.ts` — all match design §2/§5/§6 closely.
- `src/adapters/browser/apple-pay.adapter.test.ts`, `src/core/strategies/apple-pay.strategy.test.ts` — read in full.
- Ran `npm run test` (407/407 pass), `npm run typecheck` (clean), `npm run build` (clean), `npm run lint` (2 pre-existing errors only, unchanged from baseline).
- `rg` checks: `ApplePayJS` confined to port.ts (+1 pre-existing prose match in apple-pay-catalog.strategy.ts, unchanged); `dist/` has zero `ApplePaySession`/`ApplePayJS`/`BrowserApplePay`/builder-name matches, only `isApplePayCatalogMethod` (legit phase-2 export) — matches tasks.md 4.6 exactly; `src/index.ts` and `TonderCustomization` gain nothing; no `MockApplePaySessionAdapter` or `class Fake*` outside `*.test.ts`; no importer of the three new files outside their own tests (4.7 confirmed).
- Adversarial checks (all held): DD7 CSS test asserts `<style>` node `textContent`, not `style.setProperty` — verified in adapter.test.ts lines 400-452, with an explicit block comment at lines 331-345 explaining the jsdom CSS-drop trap. Synchrony test (createSession before microtask) is explicitly labeled "PROXY, NOT PROOF" inline in the test itself (adapter.test.ts:146-164), not only in design. No test anywhere claims a fake global proves Safari's real acceptance — every boundary test carries a "DECLARED, NOT VERIFIED HERE" / "Phase 7" comment. No test asserts design §7's S1-S10.
- Rounding test (`10.005` rejected, `10.5`/`10` accepted) carries the required two-decimal-currency (JPY/KWD) comment in strategy.test.ts:118-123.
- Exactly 2 new `MESSAGES_EN` entries confirmed via `rg`; `APPLE_PAY_UNSUPPORTED_BROWSER` only appears in a doc comment, never thrown.
- Amended spec.md requirement (buildApplePayPaymentMethod / union unchanged) verified correct against `src/shared/types/index.ts:121-124` — the catch-all `{ type: string; config? }` member does swallow `'apple_pay'`, confirmed by direct read.

**Learned / WARNING (at time of verify)**: `tasks.md`'s "Known spec drift" section was STALE at the time of the verify pass. It was written in commit `df723bb` (checking off tasks) BEFORE commit `5b8a1d2` (same branch, later) added the corrected `spec.md`. The section still asserted "Spec requirement R7 still asserts... MUST remain a compile-time type error... That is false today and was not implemented" — but `spec.md` on disk already carried the corrected text (no compile-time-error claim; runtime AppError owned by Phase 5). This was a factual inaccuracy in committed docs, non-blocking for code correctness. Recommended cleanup before/during archive.

**Resolution**: this WARNING was fixed in commit `cf65131` (outside this archive step, per the user's report) — `tasks.md` was updated to record the "RESOLVED in `5b8a1d2`" note that the archived `tasks.md` copy in this folder now carries. The user independently re-ran `npm run test` (407 tests / 38 files), `npm run typecheck`, `npm run build` (all clean), and `npm run lint` (2 pre-existing unrelated errors, unchanged) after that fix. This archive step did not re-run those commands itself — see the archive-report for what was and was not independently verified during archiving.

No other CRITICAL/WARNING/SUGGESTION found. Implementation, tests, and commands all confirmed the tasks.md checkbox claims were true at verify time.
