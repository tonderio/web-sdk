# Apply Progress: Apple Pay Browser Core (Phase 3)

> Recovered from Engram observation `sdd/apple-pay-browser-core/apply-progress` (#4017), full content, for archive traceability. This is the recovery summary saved during the apply phase; the authoritative task-level record is `tasks.md` in this same archive folder.

**What**: Implemented Apple Pay Phase 3 (browser core) end to end. All 40 tasks checked off. Four commits on `feature/applepay-foundation`, green between each:

- 11f1584 `feat: add Apple Pay port contracts` (WU1a — type-only port)
- 864f356 `feat: add pure Apple Pay payment-request and payment-method builders` (WU1b)
- 4c7e1a3 `feat: add Apple Pay adapter session lifecycle` (WU2)
- 0578c2d `feat: add Apple Pay adapter button rendering and customization` (WU3)
- df723bb `docs(openspec): check off apple-pay-browser-core tasks`

**Why**: SDD apply phase for change `apple-pay-browser-core`. Strict TDD (RED observed before every GREEN), delivery commits-only, no PRs.

**Where**:

- `src/ports/apple-pay.port.ts` (new, type-only) — the ONLY module naming `ApplePayJS`
- `src/core/strategies/apple-pay.strategy.ts` + `.test.ts` (new) — `buildApplePayPaymentRequest`, `buildApplePayPaymentMethod`, no mocks
- `src/adapters/browser/apple-pay.adapter.ts` + `.test.ts` (new) — `BrowserApplePay implements ApplePayPort, ApplePayButtonPort`
- `src/shared/errors/messages.ts` — exactly TWO new entries: `APPLE_PAY_SESSION_ERROR` (WU2), `APPLE_PAY_CONTAINER_NOT_FOUND` (WU3)
- `openspec/changes/apple-pay-browser-core/tasks.md` — checked off, annotated

**Verification (real output)**: `npm run test` 38 files / 407 tests passed (was 36/361 at baseline). `npm run typecheck` clean. `npm run build` clean. `npm run lint` still exactly the 2 pre-existing errors (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) — unchanged from baseline, not fixed.

**Learned / gotchas**:

1. **Task 4.6 was over-specified.** `rg -i 'applepay' dist/` does NOT return zero — it matches `isApplePayCatalogMethod`, a reachable Phase 2 helper that predates this change. The check the task intends passes: zero matches in `dist/` for `ApplePaySession`, `ApplePayJS`, `BrowserApplePay`, `buildApplePayPaymentRequest`, `buildApplePayPaymentMethod`, `tonder-apple-pay-button`, `-apple-pay-button-type`, and `dist/index.d.ts` references no Apple type. `@types/applepayjs` produces no runtime output. The two new MESSAGES_EN strings DO ship, correctly.
2. **Tasks 1.6/4.4 grep** finds one extra PROSE match at `apple-pay-catalog.strategy.ts:59` (a Phase 2 doc comment). Only type reference is the port. Own strategy doc comment was reworded to avoid writing the identifier so the grep stays meaningful.
3. **Unresolved spec drift, R7 (at the time of apply)**: the spec still said `pay({ payment_method: { type: 'apple_pay' } })` MUST be a compile-time type error. It is NOT and was deliberately not implemented — `PaymentMethod`'s `{ type: string; config? }` member swallows any literal. Design §6.1 + proposal R2 override the spec; rejection is a runtime AppError owned by Phase 5. The spec text needed amending. Recorded in a "Known spec drift" section in tasks.md at the time — since RESOLVED in commit `5b8a1d2` (see verify-report and the merged spec.md).
4. **DD7 CSS trap handled**: the customization tests read the injected `<style>` node's `textContent`, never `button.style.getPropertyValue`. jsdom silently drops `-apple-pay-button-*` declarations, so an inline-style implementation would produce a green test asserting `''`. The why is carried as a comment block in the test file.
5. **The validationURL test is genuine**: the fake event exposes `validationURL` through a getter that flips a flag, so "the adapter never reads it" is actually observed, not assumed.
6. **Synchrony test is labelled a PROXY** for Apple's gesture requirement (design §7 S3) — it queues a microtask before `createSession` and asserts construction happened first. jsdom models no user activation; real enforcement is Phase 7 hardware.
7. Nothing under `src/` exists only for testing; both fakes are local classes in `*.test.ts`. No importer of the three new files outside their own tests. `src/index.ts` untouched, `TonderCustomization` still has only `card_fields`.
8. `openspec/changes/apple-pay-browser-core/{proposal,design,specs}` were still UNTRACKED in git at the time apply-progress was recorded — only `tasks.md` had been committed. Flagged for the archive phase to add them (git operations are performed by the requesting user outside this archive step; not performed here).
9. The husky prettier hook reflowed tasks.md, flattening the 6-space-indented sub-bullets into paragraphs. Content preserved, structure less readable.

**Not verified here (Phase 7, real Safari hardware)**: all ten design §7 statements S1-S10 — Safari accepting the request, WebKit rendering `-apple-pay-button`, the real gesture requirement, HTTPS/domain enforcement, the merchant-validation round trip, Face ID, what `supportsVersion(3)`/`canMakePayments()` really return, keyboard activation counting as a gesture, whether `completePayment` needs real `ApplePayError` instances, and merchant CSS specificity over the injected style node (no shadow root by choice).
