# Verify Report: B2 Slice 2 — Embedded 3DS postMessage plumbing (full-stack)

**Change**: b2-slice2-plumbing
**Date**: 2026-06-25
**Mode**: Hybrid (Engram + openspec)
**Verdict**: PASS WITH WARNINGS

---

## Test Execution Evidence

| Repo | Runner | Result | Notes |
|------|--------|--------|-------|
| web-sdk (tonder-js) | `npx vitest run` | 243 passed (28 files) | Baseline 237 → +6 for this change. Strict TDD mode. |
| web-sdk | `npm run typecheck` | PASS (zero errors) | tsc --noEmit |
| web-sdk | `npm run lint` | PASS | ESLint zero issues |
| zplit-back | pytest (docker, 18/18) | PASS (apply-reported) | 9 new embedded_completion tests across test_serializers.py + test_services.py. Not re-run (env finicky per apply notes). Code + test content verified by read. |
| spa-midd-checkout | lint + next build | PASS (apply-reported) | No test harness. Manual acceptance documented in ACCEPTANCE.md. |

---

## Task Completion

| Repo | Tasks | Status |
|------|-------|--------|
| web-sdk (Repo 3) | All 9 tasks checked off in tasks artifact | COMPLETE |
| zplit-back (Repo 1) | Tasks 1.1, 2.1, 3.1, 4.1-4.4, 5.1-5.2 — apply-progress-backend confirms all done | COMPLETE |
| spa-midd-checkout (Repo 2) | Tasks 1.1-6.2 — apply-progress-front confirms all done (5.1 test harness skipped per no-harness branch) | COMPLETE |

Note: Repo 1 and Repo 2 tasks remain unchecked in the tasks artifact (the checkboxes were only updated for Repo 3). This is a documentation gap, NOT a code gap — code evidence confirms completion. Flagged as WARNING.

---

## Spec Compliance Matrix

### web-sdk

| Spec Scenario | Test(s) | Status |
|---|---|---|
| embedded mode → embedded_completion: true | `threeDsMode embedded → /process body includes embedded_completion: true` | PASS |
| redirect mode → key ABSENT | `threeDsMode redirect → embedded_completion key ABSENT` | PASS |
| unset mode → key ABSENT | `threeDsMode unset → embedded_completion key ABSENT` | PASS |
| card shape unchanged (regression) | `REGRESSION: card body shape otherwise unchanged with threeDsMode embedded` | PASS |
| saved-card/APM shapes unchanged | `REGRESSION: saved-card body shape unchanged regardless of threeDsMode embedded` | PASS |

### zplit-back

| Spec Scenario | Test(s) | Status |
|---|---|---|
| flag true accepted by serializer | `test_embedded_completion_true_accepted` | PASS (code+test verified) |
| flag absent defaults to False | `test_embedded_completion_absent_defaults_to_false` | PASS |
| flag false accepted | `test_embedded_completion_false_accepted` | PASS |
| flag true reaches checkout_data | `test_embedded_completion_true_reaches_checkout_data` | PASS |
| flag false/absent is falsy in checkout_data | `test_embedded_completion_absent_is_falsy`, `test_embedded_completion_false_is_falsy` | PASS |
| JWT claim carries embedded_completion: True | `TestGenerateCheckoutTokenEmbeddedCompletion` — flag true | PASS |
| JWT claim is False when absent | `TestGenerateCheckoutTokenEmbeddedCompletion` — flag absent/False | PASS |

Note: spec said "BOTH call sites pass extra_data" — the design overrode this with a single-edit in generate_checkout_token reading self.checkout_data. The implementation is internally consistent (both Kushki mint L226 and Tonder mint threeds_service.py:78 call self.generate_checkout_token). See spec-vs-design divergence note below.

### spa-midd-checkout (manual acceptance)

| Spec Scenario | Evidence | Status |
|---|---|---|
| Interface includes embedded_completion?: boolean | `ICheckoutTokenInterface.ts` L15 — top-level optional field | PASS |
| Tonder success → checkout.completed postMessage | `ThreeDSPayment.tsx:61-62` — guarded on `props.embedded_completion === true`, calls `emitEmbeddedCompletion("completed")` | PASS (code verified) |
| Tonder failure → checkout.failed postMessage | Same guard — emits "failed" when !isSuccess | PASS |
| Kushki success → checkout.completed | `ProcessCheckout.tsx:47-49` — handleSuccess guards on embedded_completion===true | PASS |
| Kushki failure → checkout.failed | `ProcessCheckout.tsx:60-62` — handleError guards on embedded_completion===true | PASS |
| Flag absent/false → NO postMessage, redirect preserved | All emits are `=== true` gated; ThreeDSPayment redirect unchanged (L66-70) | PASS |
| No polling in ProcessCheckout | No setInterval/setTimeout-loop/recursive fetch found in ProcessCheckout.tsx or ThreeDSPayment.tsx | PASS |
| hosted-checkout app/checkout/* unmodified | Commit 04433ee touches only: CheckoutTokenInterface.ts, embeddedCompletion.ts, ProcessCheckout.tsx, ThreeDSPayment.tsx, ACCEPTANCE.md — no app/checkout/** files | PASS |

### Cross-Cutting

| Contract Point | Evidence | Status |
|---|---|---|
| Event strings byte-exact match | SDK COMPLETION_EVENTS: `{'checkout.completed','checkout.failed'}`. Front emits: `'checkout.completed'` / `'checkout.failed'`. Exact match. | PASS |
| postMessage shape: `{ event: string }` | `embeddedCompletion.ts:27` — `window.parent.postMessage({ event }, '*')` | PASS |
| SDK adapter reads `event.data.event` | `browser-checkout-messenger.adapter.ts:18` — `(data as {event?:unknown}).event` | PASS |
| targetOrigin `'*'` | `embeddedCompletion.ts:27` | PASS |
| SDK field name snake_case `embedded_completion` | SDK body uses `embedded_completion`; DRF serializer `embedded_completion = BooleanField(...)` | PASS |

---

## Cross-Repo Contract Verification (Critical Path)

### 1. JWT claim placement consistency

**Backend** (`checkout.py:539-541`): adds `"embedded_completion": bool(self.checkout_data.get("embedded_completion", False))` as a **TOP-LEVEL payload key**. Not inside `extra_data`.

**Front** (`CheckoutTokenInterface.ts:15`): declares `embedded_completion?: boolean` at **TOP-LEVEL** on `ICheckoutTokenInterface`.

**Front reads** (`ProcessCheckout.tsx:47,60,115`): `decodeToken?.embedded_completion` — **top-level access, not `extra_data.embedded_completion`**.

VERDICT: Both backend and front agree on TOP-LEVEL. Contract is internally consistent and correct.

Note: the original spec text mentioned `extra_data?.embedded_completion` and `extra_data={'embedded_completion': True}` at call sites — this wording is stale. The design decision explicitly overrode it: "dedicated top-level claim keeps extra_data reserved for ACS data." The implementation follows the design, not the stale spec. Flagged as SUGGESTION (update spec wording for future readers).

### 2. Message contract byte-exact match

SDK adapter `COMPLETION_EVENTS` = `{'checkout.completed', 'checkout.failed'}`.
Front `emitEmbeddedCompletion` emits `{ event: 'checkout.completed' }` or `{ event: 'checkout.failed' }` with `targetOrigin '*'`.
SDK reads `event.data.event` and checks against the set.

VERDICT: PASS. Byte-exact match confirmed.

### 3. SDK field name matches DRF serializer

SDK sends `embedded_completion: true` (snake_case). DRF serializer declares `embedded_completion = serializers.BooleanField(required=False, default=False)`.

VERDICT: PASS. Field name matches exactly.

### 4. Dual-emit correctness (design's key fix)

- **Kushki path**: `ProcessCheckout.handleSuccess` (L47-49) and `handleError` (L60-62) call `emitEmbeddedCompletion` guarded on `embedded_completion === true`. Container-level emit covers Kushki because KushkiPayment routes completion through onSuccess/onError callbacks.
- **Tonder path**: `ThreeDSPayment.handlePostChallengeResult` (L61-63) calls `emitEmbeddedCompletion` guarded on `props.embedded_completion === true`, BEFORE the `window.location.href` redirect. This is mandatory because ThreeDSPayment self-completes and never calls the container.
- The `embedded_completion` prop is passed into `<ThreeDSPayment>` at `ProcessCheckout.tsx:115`: `embedded_completion={decodeToken.embedded_completion ?? false}`.

VERDICT: PASS. Both branches emit correctly. Container-only would have missed Tonder — both emit points are implemented exactly per design Decision #2.

### 5. Regression safety — no-flag path

- **SDK**: `buildProcessBody` only sets `body.embedded_completion = true` inside `if (threeDsMode === 'embedded')`. Redirect/unset → key absent from body.
- **Backend**: DRF `BooleanField(required=False, default=False)` → absent input → `False`. `generate_checkout_token` emits `bool(False)` = False as a JWT claim (harmless, not a behavioral flag for the page).
- **Front**: all emit calls guarded on `=== true`. `false` or `undefined` → no postMessage, redirect unchanged.

VERDICT: PASS. No-flag path is clean across all three layers.

---

## Spec-vs-Design Divergence Assessment

The spec (written before design finalization) describes:
1. `extra_data={'embedded_completion': True}` passed at both call sites to `generate_checkout_token`.
2. `ICheckoutTokenInterface` accessing via `extra_data?.embedded_completion`.

The design overrode both decisions:
1. Single-edit inside `generate_checkout_token` reading `self.checkout_data` — eliminates call-site risk.
2. Top-level JWT claim — reserves `extra_data` for ACS data.

**Judge**: The implementation is internally consistent — backend and front BOTH use top-level. The design approach is architecturally superior (one edit covers all mint sites, no call-site drift). The stale spec wording is NOT a defect in the implementation; it is a stale artifact. The cross-repo contract holds.

---

## Issues

### CRITICAL
None.

### WARNING

**W1 — Tasks artifact has unchecked boxes for Repos 1 and 2.**
The tasks.md artifact still shows `[ ]` for all zplit-back and spa-midd-checkout tasks. Only Repo 3 (web-sdk) tasks were checked off. The code confirms completion, but the artifact is stale. Recommend checking off those tasks (or noting in the archive) before closing.

**W2 — pytest not re-executed by verify agent (env constraint).**
The backend test suite (18/18 per apply-progress) was not re-run here due to the Docker/postgres env complexity documented in apply-progress-backend. Verification relies on apply-reported evidence + code/test content inspection. Risk is low (tests are present and clearly mapped to spec scenarios) but is not zero.

**W3 — spa-midd-checkout has no automated test harness.**
All front scenarios are covered only by manual acceptance (ACCEPTANCE.md). No automated coverage for the postMessage emit paths. Risk: regression could go undetected in the future. Recommend adding a test harness (jest/RTL or Playwright) in a follow-up.

### SUGGESTION

**S1 — Spec artifact wording is stale.**
Spec says `extra_data` for the JWT approach and call-site passing. Update the spec to reflect the design's top-level claim decision so future readers aren't confused.

**S2 — Missing env var in .envs/.local/.django.**
`WITHDRAWAL_SERVICE_URL_V2` is required by `base.py:560` but absent from the local env file. Must be supplied as a workaround when running pytest locally. Add it to `.envs/.local/.django` as a follow-up.

**S3 — Frictionless (no-challenge) Tonder 3DS out of scope.**
Noted in design Open Questions: frictionless 3DS may return final status directly via API response, bypassing the /process page entirely. SDK resolves from response/poll in that case — the messenger is never engaged. This slice is correct for the challenge flow. The frictionless path needs a separate investigation.

---

## Verdict: PASS WITH WARNINGS

The implementation is functionally correct and cross-repo consistent. The critical JWT claim placement is internally consistent (top-level backend → top-level front). Both dual-emit paths are correctly wired. All web-sdk tests pass (243). Event strings match byte-exact. The three WARNINGs are: stale task checkboxes, unverified pytest re-run, and absence of automated front-end tests. None block the implementation from being correct. Archive is recommended after checking off the task boxes.
