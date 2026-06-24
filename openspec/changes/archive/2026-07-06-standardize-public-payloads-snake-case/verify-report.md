## Verification Report

**Change**: `standardize-public-payloads-snake-case`  
**Version**: N/A  
**Mode**: Strict TDD  
**Artifact store**: OpenSpec  
**Verified repos**:
- SDK: `/Volumes/MacDev/Tonder/SDKs/tonder-js`
- zplit-back: `/Volumes/MacDev/Tonder/zplit-back/zplit_back` (static + compile evidence; pytest unavailable locally)
- spa-midd-checkout: `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout` (typecheck/lint evidence)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |
| Proposal/spec/design/tasks present | Yes |
| Apply progress present | Yes |
| Previous `savedCard` blocker re-checked | Yes — resolved. Specs/design now use `saved_card`; implementation/tests/docs use `saved_card`. |

### Build & Tests Execution

**SDK unit tests**: ✅ Passed

```text
Command: npm test
Result: exit 0
Test Files: 30 passed (30)
Tests: 284 passed (284)
Duration: 8.80s
```

**SDK typecheck**: ✅ Passed

```text
Command: npm run typecheck -- --pretty false
Result: exit 0
Runs: tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json --pretty false
```

**SDK build**: ✅ Passed

```text
Command: npm run build
Result: exit 0
Outputs: dist/index.mjs, dist/index.cjs, dist/index.global.js, dist/index.global.min.js, dist/index.d.ts
```

**SDK lint**: ✅ Passed

```text
Command: npm run lint
Result: exit 0
```

**SDK targeted e2e contract files**: ⚠️ Command passed, tests skipped by environment guard

```text
Command: npx playwright test e2e/tests/apms.spec.ts e2e/tests/card-pay.spec.ts e2e/tests/cof.spec.ts
Result: exit 0
Tests: 11 skipped
Reason: stage credentials are not present, so Playwright tests called skipIfNoStageCreds().
```

**SDK coverage**: ➖ Not available

```text
Command: npx vitest run --coverage
Result: exit 1
MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'
```

**SDK diff whitespace**: ✅ Passed

```text
Command: git diff --check
Result: exit 0
```

**zplit-back compile + diff whitespace**: ✅ Passed

```text
Command: python3 -m py_compile apps/payments/api/direct_views.py apps/payments/models/checkout.py apps/payments/services/direct_payment_service.py apps/payments/tests/direct_api/unit/test_serializers.py apps/payments/tests/direct_api/unit/test_services.py apps/payments/tests/direct_api/unit/test_direct_views.py && git diff --check
Result: exit 0
```

**zplit-back pytest**: ⚠️ Blocked locally by missing pytest

```text
Command: pytest apps/payments/tests/direct_api/unit/test_serializers.py apps/payments/tests/direct_api/unit/test_services.py apps/payments/tests/direct_api/unit/test_direct_views.py -q
Result: exit 127
zsh:1: command not found: pytest

Command: python3 -m pytest apps/payments/tests/direct_api/unit/test_serializers.py apps/payments/tests/direct_api/unit/test_services.py apps/payments/tests/direct_api/unit/test_direct_views.py -q
Result: exit 1
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3: No module named pytest
```

**spa-midd-checkout typecheck/lint/diff whitespace**: ✅ Passed with one pre-existing lint warning

```text
Command: npx tsc --noEmit && npm run lint && git diff --check
Result: exit 0
Warning: src/modules/unlimit/components/Payment.tsx has an existing react-hooks/exhaustive-deps warning for handleValidateStatus.
```

### `saved_card` Contract Re-check

| Check | Evidence | Result |
|-------|----------|--------|
| OpenSpec delta no longer requires `savedCard` | `rg "savedCard" openspec/changes/standardize-public-payloads-snake-case --glob '!verify-report.md'` returned no matches. | ✅ PASS |
| COF delta requires `saved_card` | `specs/cof-payment-flow/spec.md:15` and `:39` use `type: 'saved_card'`. | ✅ PASS |
| Design requires `saved_card` | `design.md:51` uses `tonder.pay({ amount, return_url, payment_method: { type: 'saved_card', card_id } })`. | ✅ PASS |
| Implementation accepts `saved_card` | `src/shared/types/index.ts:90`, `src/tonder.ts:341`, and `src/tonder.ts:523` use `saved_card`. | ✅ PASS |
| Tests/docs use `saved_card` | `src/tonder.pay.test.ts`, `README.md:397`, and `e2e/tests/cof.spec.ts:80` use `saved_card`. | ✅ PASS |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress.md` contains a TDD Cycle Evidence table for SDK tasks and remediation verification notes. |
| All tasks have tests/evidence | ✅ | 13/13 tasks complete; SDK tasks have runtime Vitest evidence; external tasks have static/compile/typecheck/lint evidence, with pytest unavailable locally. |
| RED confirmed (tests exist) | ✅ | Apply progress records failing contract tests first; referenced SDK test files exist. |
| GREEN confirmed (tests pass) | ✅ | Full SDK Vitest suite passed: 284 tests. |
| Triangulation adequate | ✅ | Card, saved-card, APM, discovery, error, RawTransaction, and embedded presentation paths have multiple assertions across unit/facade/service tests. |
| Safety Net for modified files | ✅ | SDK full suite/typecheck/build/lint passed; cross-repo static safety checks passed. |

**TDD Compliance**: 6/6 checks passed for the SDK repo. External runtime pytest remains environment-blocked, not implementation-failing.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 284 passed | 30 SDK test files | Vitest |
| Integration-style | Included in SDK facade/service tests | `src/tonder.pay.test.ts`, `src/core/services/direct-api.service.test.ts`, related facade tests | Vitest with mocked ports |
| E2E | 0 executed, 11 skipped | SDK Playwright APM/card/COF files | Playwright; stage credentials absent |
| External static/quality | Passed | zplit-back, spa-midd-checkout changed files | py_compile, tsc, eslint |
| **Total executed** | **284 runtime SDK tests passed** | **30 SDK runtime files** | |

### Changed File Coverage

Coverage analysis skipped — no coverage provider is installed. `npx vitest run --coverage` failed because `@vitest/coverage-v8` is missing. This is informational only; project coverage threshold is `0`.

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `src/types/card.test.ts` | 72 | `expect(options.events?.card_number).toBeDefined()` | Type-only assertion, but paired with compile-time type assertion and concrete snake_case key setup in the same test. | INFO |
| `src/tonder.handleRequiresAction.test.ts` | 495 | `expect(result.next_action).toBeDefined()` | Type-only assertion, but paired with `host.redirect` and raw transaction status assertions. | INFO |
| `src/tonder.pay.test.ts` | 754 | `expect(result.next_action).toBeDefined()` | Type-only assertion, but paired with saved-card payment path and status assertions. | INFO |
| `src/tonder.getPaymentMethodBanks.test.ts` | 66 | `expect(result.transfer).toEqual([])` | Empty array assertion has a companion non-empty `cash` assertion in the same test. | INFO |
| `e2e/tests/card-pay.spec.ts` | 63-64 | `decline_code` / `decline_reason` defined | Type-only e2e checks are paired with status and no-alias assertions; e2e skipped without credentials in this run. | INFO |

**Assertion quality**: ✅ No CRITICAL trivial assertions found. No tautologies, no ghost loops, and no assertion-only tests were found in the changed tests reviewed.

### Quality Metrics

**Linter**: ✅ SDK lint passes; hosted checkout lint exits 0 with one unrelated pre-existing warning.  
**Type Checker**: ✅ SDK and hosted checkout typechecks pass.  
**Build**: ✅ SDK build passes.  
**Python compile**: ✅ zplit-back changed files compile.  
**Runtime backend tests**: ⚠️ Blocked because pytest is not installed locally.  
**Coverage**: ➖ Coverage provider unavailable.

### Spec Compliance Matrix

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| Public object fields use snake_case | Config and payment input use snake_case fields | `src/tonder.snake-case-contract.test.ts`; `src/shared/types/index.ts`; `src/tonder.ts`; `npm test` passed | ✅ COMPLIANT |
| Public object fields use snake_case | Method names remain camelCase | `src/index.ts`; `src/tonder.ts`; public methods remain `createTonder`, `getTransaction`, `getPaymentMethods`, `getPaymentMethodBanks`; `npm test` passed | ✅ COMPLIANT |
| Public object fields use snake_case | Public errors use snake_case fields | `src/shared/errors/AppError.ts`; `src/tonder.snake-case-contract.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Public object fields use snake_case | Embedded payflow bridge keeps `event` control field | `BrowserCheckoutMessenger` path preserved; `src/tonder.handleRequiresAction.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Raw Transaction Passthrough | Raw fields pass through unchanged | `src/models/transaction.model.ts`; SDK tests passed; e2e assertions check snake_case/no-alias statically but skipped at runtime | ✅ COMPLIANT for SDK unit evidence; ⚠️ e2e runtime skipped |
| Raw Transaction Passthrough | No SDK-owned wrapper fields on result | `src/tonder.pay.test.ts` no-alias assertions; e2e no-alias assertions; `npm test` passed | ✅ COMPLIANT for SDK unit evidence; ⚠️ e2e runtime skipped |
| Raw Transaction Passthrough | Public transaction fields stay snake_case | SDK tests passed; e2e files assert `payment_instructions`, `bank_name`, `next_action`, `decline_code`, `decline_reason` | ✅ COMPLIANT for SDK unit/static evidence; ⚠️ e2e runtime skipped |
| Raw Transaction Passthrough | Embedded redirect URL path remains raw | `handleRequiresAction` reads `next_action.redirect_to_url.url`; SDK tests passed | ✅ COMPLIANT |
| Transaction Reads Return Bare Transaction | Reading a transaction by id | SDK `getTransaction` tests passed | ✅ COMPLIANT |
| Non-transaction public return payloads use snake_case | Saved-card return payloads expose snake_case fields | `src/models/card.model.ts`; `src/tonder.snake-case-contract.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Non-transaction public return payloads use snake_case | Enrollment return payload exposes snake_case fields | `src/tonder.ts`; SDK enrollment tests passed | ✅ COMPLIANT |
| Non-transaction public return payloads use snake_case | Error payload exposes snake_case fields | `src/shared/errors/AppError.ts`; SDK tests passed | ✅ COMPLIANT |
| Fetch Payment Methods | Successful fetch returns mapped snake_case array | `src/core/services/direct-api.service.ts`; `src/tonder.getPaymentMethods.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Fetch Payment Methods | Transport failure | SDK tests passed | ✅ COMPLIANT |
| Fetch APM Banks | Successful fetch returns grouped banks | `src/tonder.getPaymentMethodBanks.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Fetch APM Banks | Transport failure | SDK tests passed | ✅ COMPLIANT |
| COF-active new-card pay enrolls before processing | COF-active new card is enrolled then charged | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| COF-active new-card pay enrolls before processing | Non-COF new-card payment remains raw-card | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| COF-active new-card pay enrolls before processing | Saved-card payment is unchanged | OpenSpec now says `saved_card`; implementation accepts `saved_card`; `src/tonder.pay.test.ts` passed | ✅ COMPLIANT |
| Auto-enrolled COF payments use token-only Direct API payload | Process payload uses saved-card token | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Auto-enrolled COF payments use token-only Direct API payload | Client COF fields are absent | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Auto-enrollment rollback boundary | Process transport failure removes just-enrolled card | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Auto-enrollment rollback boundary | Declined transaction does not remove enrolled card | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Auto-enrollment rollback boundary | Pending or 3DS transaction does not remove enrolled card | `src/tonder.pay.test.ts`; `npm test` passed | ✅ COMPLIANT |
| Public COF enrollment payloads use snake_case | Enrollment and payment data stay snake_case | SDK card/enrollment tests passed | ✅ COMPLIANT |
| Backend checkout hand-off | SDK sends `X-Presentation-Mode` with `/process` | `src/core/services/direct-api.service.ts`; SDK tests passed | ✅ COMPLIANT |
| Backend checkout hand-off | zplit-back derives `presentation_mode` from header, not body | `direct_views.py`, `test_direct_views.py`, `test_serializers.py`; py_compile passed; pytest unavailable | ⚠️ PARTIAL — static/test-file evidence exists; runtime blocked by missing pytest |
| Backend checkout JWT | `extra_data.needs_redirect=false` for embedded while preserving provider extra_data | `checkout.py`, `test_services.py`; py_compile passed; pytest unavailable | ⚠️ PARTIAL — static/test-file evidence exists; runtime blocked by missing pytest |
| Hosted checkout redirect guard | ProcessCheckout does not redirect when `needs_redirect=false` | `ProcessCheckout.tsx`; hosted typecheck/lint passed | ⚠️ PARTIAL — static evidence only |
| Hosted checkout redirect guard | ThreeDSPayment does not redirect when `needs_redirect=false` | `ThreeDSPayment.tsx`; hosted typecheck/lint passed | ⚠️ PARTIAL — static evidence only |

**Compliance summary**: 26 compliant, 4 partial/environment-blocked, 0 failing.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Public config uses `api_key`, `environment`, `presentation_mode`, `session.secure_token`, and snake_case customer fields | ✅ Implemented | `TonderConfig` exposes snake_case config/session/customer fields. |
| `return_url` is on `pay()` | ✅ Implemented | `PayInput.return_url` is required; `buildProcessBody()` uses `input.return_url`. |
| Method names remain camelCase | ✅ Implemented | Public method names remain idiomatic JS. |
| Public component options and customization payloads use snake_case | ✅ Implemented | `CardFieldState`, `CardFieldEvents`, `CardFieldsOptions`, `RevealCardField`, and `TonderCustomization` expose snake_case object fields. |
| RawTransaction unchanged | ✅ Implemented | Runtime model preserves raw fields; e2e assertions check snake_case and absence of stale aliases. |
| Saved-card public discriminator | ✅ Implemented | Spec/design and implementation now agree on `type: 'saved_card'`. |
| SDK sends `X-Presentation-Mode` | ✅ Implemented | `DirectApiService.processPayment()` sends the header for `/api/v1/process/`. |
| zplit-back trusts header, not body | ✅ Static implementation | Serializer/view tests exist; py_compile passed; pytest unavailable locally. |
| Embedded checkout JWT sets `needs_redirect=false` and preserves provider data | ✅ Static implementation | `generate_checkout_token()` merges provider `extra_data` and overrides `needs_redirect` for embedded. Runtime pytest unavailable locally. |
| Hosted checkout avoids iframe redirect when `needs_redirect=false` | ✅ Static implementation | `ProcessCheckout` and `ThreeDSPayment` guard redirects; hosted typecheck/lint passed. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Public object fields snake_case; methods camelCase | ✅ Yes | Public payload fields use snake_case; method names remain camelCase. |
| `createTonder({ api_key, environment, presentation_mode, session })`; `return_url` on `pay()` | ✅ Yes | Source, README/e2e, and SDK tests align. |
| Saved-card example is `type: 'saved_card', card_id` | ✅ Yes | `cof-payment-flow` delta, design, implementation, tests, README, and e2e now align. |
| Presentation callbacks `events.presentation.on_open` / `on_close` | ✅ Yes | Implemented and covered by SDK tests. |
| Embedded checkout redirect state via JWT `extra_data.needs_redirect=false` | ⚠️ Static only | Code matches design; runtime zplit-back tests could not run because pytest is unavailable. |
| zplit-back derives `presentation_mode` from `X-Presentation-Mode` | ⚠️ Static only | Code matches design; runtime zplit-back tests could not run. |
| spa-midd-checkout guards ProcessCheckout and ThreeDSPayment redirects | ⚠️ Static only | Typecheck/lint passed; no behavior test was executed. |

### Issues Found

**CRITICAL**

None.

**WARNING**

1. zplit-back runtime tests could not execute because pytest is not installed locally. Static code and test files exist and compile.
2. SDK Playwright e2e contract files passed the command but all 11 targeted tests skipped because stage credentials are absent. Static assertions check snake_case and no stale aliases, but no live stage behavior was exercised.
3. hosted-checkout redirect suppression has static implementation and passing typecheck/lint, but no behavioral test was run for `needs_redirect=false` on `ProcessCheckout` or `ThreeDSPayment`.
4. Generated type documentation/source comments still contain stale wording such as `PUBLIC, camelCase saved card` and `snake→camel projection` even though the actual public fields are snake_case. Evidence: `src/models/card.model.ts:33`, `src/models/card.model.ts:61`, `src/shared/types/index.ts:95`, and generated `dist/index.d.ts` comments. This is documentation wording, not a runtime/type contract failure.
5. hosted-checkout lint still reports one unrelated pre-existing React Hook dependency warning in `src/modules/unlimit/components/Payment.tsx` while exiting 0.

**SUGGESTION**

1. Clean up stale source/test descriptions that still say `camelCase` for public card/payment-method projections so generated `.d.ts` documentation matches the new public contract.
2. Add/enable a zplit-back pytest environment for verification agents.
3. Add focused hosted-checkout behavior tests around `extra_data.needs_redirect=false`.

### Verdict

**PASS WITH WARNINGS**

The previous blocking mismatch is resolved: OpenSpec/design now intentionally require the public saved-card discriminator `saved_card`, and implementation/tests/docs align with it. SDK runtime verification is green (`npm test`, typecheck, build, lint, and diff whitespace all pass). Remaining warnings are environment/test-evidence gaps outside the SDK runtime path plus stale generated documentation wording, not current spec/design implementation failures.
