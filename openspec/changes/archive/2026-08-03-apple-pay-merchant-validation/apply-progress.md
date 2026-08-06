# Apply Progress — apple-pay-merchant-validation (Phase 4)

Source: Engram observation #4026 (`sdd/apple-pay-merchant-validation/apply-progress`)

**What**: Implemented Apple Pay Phase 4 (`apple-pay-merchant-validation`) in full — 15/15 tasks done, one commit `e333204` on `feature/applepay-foundation`. `ApplePayService.validateMerchant()` POSTs an empty body to `/api/v1/payments/apple-pay/validate-merchant/` over the injected `HttpPort`, returns Apple's opaque `merchantSession` verbatim as `unknown`, and wraps every transport failure unconditionally as `AppError(APPLE_PAY_VALIDATION_ERROR)`.

**Why**: Phase 4 of `docs/apple-pay-integration-plan.md` §6. The empty body IS the security content of the change — `event.validationURL` is never read, so the browser cannot choose where a certificate-bearing backend connects (SSRF). Shipping it as its own phase makes that reviewable instead of three lines buried in Phase 5.

**Where**:

- `src/core/services/apple-pay.service.ts` (new, 64 lines)
- `src/core/services/apple-pay.service.test.ts` (new, 143 lines, 8 cases)
- `src/shared/errors/messages.ts` (+2 lines, one `APPLE_PAY_VALIDATION_ERROR` entry after `APPLE_PAY_CONTAINER_NOT_FOUND`)
- Untouched as designed: `src/tonder.ts`, `src/index.ts`, `src/ports/*`, `ErrorKeyEnum.ts`

**Verification (real output)**: `npm run test` 39 files / 415 tests passed · `npm run typecheck` clean (`tsc --noEmit` + e2e config) · `npm run build` created all 5 bundles + `.d.ts` · `npm run lint` error set IDENTICAL before and after (2 pre-existing unrelated errors: `tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483` — not fixed, out of scope). Reachability: `rg "apple-pay.service" src/index.ts src/tonder.ts` → no matches; `rg "ApplePayService" src -g '!*.test.ts'` → only the service's own class declaration. DD1 holds.

**Learned**:

- `expect.objectContaining` PASSES when extra keys are present. The neighbouring `direct-api.service.test.ts` tests use it. Test 1 here deliberately uses EXACT deep equality with an in-file comment saying not to "align" it with the neighbours — with objectContaining the empty-body test would go green while `validationURL` was being sent, asserting the reverse of its own name.
- MUTATION-VERIFIED, not assumed: temporarily injected `body: { validationURL: ... }` into the service and confirmed tests 1 AND 2 both fail, then restored. The absence assertions genuinely bite.
- TDD was staged in two reds: first RED on missing module, then the service was written WITHOUT the `MESSAGES_EN` entry to watch case 6's load-bearing `not.toBe(MESSAGES_EN[UNKNOWN_ERROR])` fail on the literal string 'An unexpected error occurred.' That proves the line is load-bearing; the sibling `toBe(MESSAGES_EN[APPLE_PAY_VALIDATION_ERROR])` is partly tautological (reads the map it verifies) and is labelled as secondary in a comment.
- `direct-api.service.ts:78-80` class JSDoc claims "An existing AppError is re-thrown unchanged (no double-wrap)". That claim is FALSE about that service — its catch wraps unconditionally. The described behavior belongs to `Tonder.pay`. Known pre-existing doc bug, tracked separately, deliberately NOT copied into `ApplePayService`'s JSDoc, which documents the actual unconditional wrap and says collapsing a double wrap is the consumer's job.
- DD3 reasoning worth keeping: an `instanceof AppError` re-throw guard here would mean `APPLE_PAY_VALIDATION_ERROR` is NEVER thrown in production, because `FetchHttpClient` reports every 4xx/5xx/network failure as `AppError(REQUEST_FAILED)`.
- Added an 8th test beyond design's 7: "does not retry a rejected call" — covers the spec scenario "A rejected call is not retried", which design §5 omitted.
- Message copy manually read side by side against `APPLE_PAY_SESSION_ERROR` (no command proves copy quality): SESSION = "Could not **start**" + page preconditions (browser-side, pre-network); VALIDATION = "Could not **obtain** … **from Apple**" (backend handshake returned nothing), hedged with "most likely cause … it can also be a temporary failure".
- Typed the fake as `type FakeRequest = (options: HttpRequestOptions) => Promise<unknown>` with `{ request } as unknown as HttpPort` — `HttpPort['request']` is generic `<T>` and resists direct `vi.fn()` assignment.
- husky/lint-staged reformatted one assertion in the test file during commit (prettier). Expected; tree clean afterwards.

**Next (as recorded at apply time)**: `sdd-verify`. Phase 5 owns wiring (`onValidateMerchant` handler, `completeMerchantValidation`, `session.abort()`), the injection style decision (DD1 deliberately deferred), and the three remaining `MESSAGES_EN` codes (`APPLE_PAY_NOT_ENABLED`, `APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_UNSUPPORTED_ACTION`).

Original Engram metadata: project web-sdk, scope project, topic `sdd/apple-pay-merchant-validation/apply-progress`, observation #4026, created 2026-08-03 16:40:58.
