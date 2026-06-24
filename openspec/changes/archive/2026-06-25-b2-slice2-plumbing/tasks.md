# Tasks: B2 Slice 2 — Embedded 3DS postMessage plumbing (full-stack)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120–160 total (≈40 backend, ≈60 front, ≈30 SDK) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Solo commit per repo — no PRs |
| Delivery strategy | exception-ok (solo commits, no push) |
| Chain strategy | N/A — solo commits |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Commit | Notes |
|------|------|--------|-------|
| 1 | zplit-back: serializer + checkout_data + JWT claim | solo commit | release/DEV-2245; pytest gate before commit |
| 2 | spa-midd-checkout: interface + helper + ProcessCheckout + ThreeDSPayment | solo commit | new branch DEV-2245 off develop; lint/build gate |
| 3 | web-sdk: ProcessPaymentBody + buildProcessBody + status doc | solo commit | feature/DEV-2245; strict TDD + typecheck/lint gate |

---

## Repo 1 — zplit-back (branch: release/DEV-2245, Standard mode + pytest, solo commit, NO push)

### Phase 1: Serializer

- [x] 1.1 In `api/direct_serializers.py` → `DirectProcessRequestSerializer`: add `embedded_completion = serializers.BooleanField(required=False, default=False)` after existing fields.

### Phase 2: Checkout data threading

- [x] 2.1 In `services/direct_payment_service.py` → `_prepare_checkout_data()`: read `payment_data.get('embedded_completion', False)` and assign to `checkout_data['embedded_completion']`.

### Phase 3: JWT claim

- [x] 3.1 In `models/checkout.py` → `generate_checkout_token()` payload block (L~522): add `'embedded_completion': bool(self.checkout_data.get('embedded_completion', False))` as a top-level JWT claim. ONE edit; covers Kushki mint (L226) and Tonder mint (threeds_service.py:78) automatically.

### Phase 4: Tests (Standard mode — write; no RED-first gate)

- [x] 4.1 Serializer: test `embedded_completion: true` → `validated_data['embedded_completion'] is True`.
- [x] 4.2 Serializer: test key absent → `validated_data['embedded_completion'] is False` (default).
- [x] 4.3 `generate_checkout_token`: test flag true in `checkout_data` → decoded JWT contains `embedded_completion: True`.
- [x] 4.4 `generate_checkout_token`: test flag false/absent → JWT `embedded_completion` is falsy; redirect fields unchanged.

### Phase 5: Gate + commit

- [x] 5.1 Run `pytest` for touched modules (`direct_serializers`, `direct_payment_service`, `checkout`). All tests pass.
- [x] 5.2 `git add -p` the three files + test file(s); `git commit -m "feat(3ds): thread embedded_completion through serializer, checkout_data, and JWT claim"`. NO push.

---

## Repo 2 — spa-midd-checkout (new branch DEV-2245 off develop, solo commit, NO push)

### Phase 1: Interface

- [x] 1.1 In `interfaces/CheckoutTokenInterface.ts` (or wherever `ICheckoutTokenInterface` is declared): add `embedded_completion?: boolean` to the interface.

### Phase 2: Shared emit helper

- [x] 2.1 In `src/modules/process/components/ProcessCheckout.tsx` (or a co-located `embeddedCompletion.ts`): implement `emitEmbeddedCompletion(ok: boolean): void` — calls `window.parent.postMessage({ event: ok ? 'checkout.completed' : 'checkout.failed' }, '*')`. No conditional inside the helper; guards live at call sites.

### Phase 3: ProcessCheckout wiring (Kushki path)

- [x] 3.1 In `ProcessCheckout.tsx`: decode JWT and read `embedded_completion` from `extra_data` (via `ICheckoutTokenInterface`).
- [x] 3.2 In `ProcessCheckout.tsx` `handleSuccess` callback: call `emitEmbeddedCompletion(true)` guarded by `decoded.embedded_completion === true`.
- [x] 3.3 In `ProcessCheckout.tsx` `handleError` callback: call `emitEmbeddedCompletion(false)` guarded by `decoded.embedded_completion === true`.
- [x] 3.4 In `ProcessCheckout.tsx`: pass `embedded_completion={decoded.embedded_completion ?? false}` as a prop into `<ThreeDSPayment />`.

### Phase 4: ThreeDSPayment wiring (Tonder path)

- [x] 4.1 In `src/modules/tonder/components/ThreeDSPayment.tsx`: add `embedded_completion?: boolean` to the component's Props interface.
- [x] 4.2 In `ThreeDSPayment.tsx` → `handlePostChallengeResult`: when `props.embedded_completion === true`, call `emitEmbeddedCompletion(isSuccess)` BEFORE the `window.location.href = props.return_url` redirect. When flag is absent/false, preserve the existing redirect path unchanged.

### Phase 5: Tests / acceptance

- [x] 5.1 If the repo has jest/RTL configured: write a component test for `ProcessCheckout` asserting `postMessage` is called with `{ event: 'checkout.completed' }` when `embedded_completion === true` and success fires.
- [x] 5.2 If no test harness: document a manual acceptance checklist in a `ACCEPTANCE.md` note covering the four spec scenarios (tonder success, tonder failure, kushki success, kushki failure) and the two redirect-preservation scenarios.
- [x] 5.3 Verify `window.parent.postMessage` is NOT called in any path where `embedded_completion` is false or absent.

### Phase 6: Gate + commit

- [x] 6.1 Run lint (`eslint`) + build (`tsc --noEmit` or equivalent). Zero errors.
- [x] 6.2 `git add -p` all changed files; `git commit -m "feat(3ds): add emitEmbeddedCompletion to ProcessCheckout and ThreeDSPayment"`. NO push.

---

## Repo 3 — web-sdk (branch: feature/DEV-2245, STRICT TDD, solo commit, NO push)

### Phase 1: Type (RED gate first)

- [x] 1.1 In `src/core/services/direct-api.service.ts` → `ProcessPaymentBody`: add `embedded_completion?: boolean` after the `metadata` field (~L93).

### Phase 2: RED tests

- [x] 2.1 Write failing vitest: `buildProcessBody()` with `threeDsMode === 'embedded'` → result contains `embedded_completion: true`. (Must fail before impl.)
- [x] 2.2 Write failing vitest: `buildProcessBody()` with `threeDsMode === 'redirect'` → key `embedded_completion` is **absent** from result (not `false`).
- [x] 2.3 Write failing vitest: `buildProcessBody()` with `threeDsMode` unset → key `embedded_completion` is **absent**.
- [x] 2.4 Write regression test: card payment shape with `threeDsMode === 'embedded'` → all existing fields present and unchanged.
- [x] 2.5 Write regression test: APM / saved-card shapes unchanged regardless of `threeDsMode`.

### Phase 3: GREEN implementation

- [x] 3.1 In `src/tonder.ts` → `buildProcessBody()` (~L825): add `if (this.core.getConfig().threeDsMode === 'embedded') { body.embedded_completion = true; }`. No `else` branch (key must be absent, not false, when not embedded). Run vitest — all tests pass.

### Phase 4: Status doc

- [x] 4.1 In `docs/07-implementation-status.md`: check off the B2 Slice 2 web-sdk row (set `[x]` on the `ProcessPaymentBody embedded_completion` and `buildProcessBody flag` items).

### Phase 5: Gate + commit

- [x] 5.1 Run `npm run typecheck && npm run lint && npx vitest run`. All pass.
- [x] 5.2 `git add -p` touched files; `git commit -m "feat(3ds): add embedded_completion flag to ProcessPaymentBody and buildProcessBody (TDD)"`. NO push.
