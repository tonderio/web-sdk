# Tasks: App-Origin Completion Discriminator (Slice 2a)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 80–140 (across 3 repos) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | One PR per repo (3 independent solo commits, ship together) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| A | Drop embedded_completion from web SDK | feature/DEV-2245 | STRICT TDD; vitest baseline 247; solo commit |
| B | Derive app_origin from X-App-Origin in zplit-back | release/DEV-2245 | pytest; Docker-gated; solo commit |
| C | Swap emit gate in spa-midd-checkout | DEV-2245 branch | typecheck/build; solo commit |

> Ship-together dependency: Unit B and Unit C must be deployed atomically. Unit A can land first (body flag removal is backward-compatible because backend already ignores an absent field once B ships). Ship order: A → B+C together.

---

## Track A — web SDK (feature/DEV-2245, STRICT TDD, vitest)

### Phase A1: RED — Failing Tests

- [x] A1.1 In `src/tonder.pay.test.ts`, rename the describe block `Tonder.pay — embedded_completion request flag` to `Tonder.pay — 3DS body shape (no embedded_completion flag)`.
- [x] A1.2 Replace the first test (`threeDsMode embedded → body includes embedded_completion: true`) with: `threeDsMode embedded → /process body does NOT include embedded_completion` — assert `expect(body).not.toHaveProperty('embedded_completion')`.
- [x] A1.3 Replace the REGRESSION test assertion that checks `embedded_completion: true` in the body — assert the key is absent while `payment_method` shape is still present.
- [x] A1.4 Keep the two existing "redirect → absent" and "unset → absent" tests unchanged (they already pass; keep them as regression guard).
- [x] A1.5 Run `vitest run` — confirm exactly the two edited tests now FAIL (RED gate). Do not proceed to GREEN until RED is confirmed.

### Phase A2: GREEN — Remove Body Flag

- [ ] A2.1 In `src/tonder.ts` lines 829–831, delete the `if (this.core.getConfig().threeDsMode === 'embedded') { body.embedded_completion = true; }` block and its preceding comment (lines 825–828). Keep all surrounding body-building logic untouched.
- [ ] A2.2 In `src/core/services/direct-api.service.ts` line 100, delete the `embedded_completion?: boolean;` field from `ProcessPaymentBody`. Do not touch any other field.
- [ ] A2.3 Run `vitest run` — all tests must be GREEN. Verify total count is still 247 (no tests deleted, only semantics changed).

### Phase A3: Gate & Commit

- [x] A3.1 Run `tsc --noEmit` — no type errors.
- [x] A3.2 Run linter (e.g. `eslint src/`) — no new errors.
- [x] A3.3 Stage only: `src/tonder.ts`, `src/core/services/direct-api.service.ts`, `src/tonder.pay.test.ts`.
- [x] A3.4 Commit: `refactor(3ds): drop embedded_completion body flag (use X-App-Origin)`. No AI attribution. No push.

---

## Track B — zplit-back (release/DEV-2245, Standard + pytest)

### Phase B1: Header Injection in View

- [x] B1.1 In `apps/payments/api/direct_views.py`, in the direct-process view handler, read `app_origin = request.headers.get('X-App-Origin', '')` immediately after request validation and before calling `DirectPaymentService`.
- [x] B1.2 Inject `validated_data['app_origin'] = app_origin` into the validated data dict before it is passed to `DirectPaymentService`. Do NOT read `app_origin` from `request.data` (body) — header ONLY.

### Phase B2: Propagate to checkout_data

- [x] B2.1 In `apps/payments/services/direct_payment_service.py` around line 335 (inside `_prepare_checkout_data`), add `checkout_data['app_origin'] = self.validated_data.get('app_origin', '')`. Remove or replace the existing `checkout_data['embedded_completion']` assignment on that same line.

### Phase B3: Stamp JWT Claim

- [x] B3.1 In `apps/payments/models/checkout.py` lines 539–541, inside `generate_checkout_token`, replace the `embedded_completion` JWT claim with `'app_origin': checkout_data.get('app_origin', '')`. Remove the old claim key entirely.

### Phase B4: Remove Serializer Field

- [x] B4.1 In `apps/payments/api/direct_serializers.py`, delete the `embedded_completion` field declaration from the Direct process serializer. No replacement field needed (app_origin is injected server-side, not from body).

### Phase B5: pytest

- [x] B5.1 Write pytest: when request has header `X-App-Origin: sdk/web`, the minted JWT token payload contains `app_origin == 'sdk/web'` and does NOT contain `embedded_completion`.
- [x] B5.2 Write pytest: when request has no `X-App-Origin` header, the JWT payload contains `app_origin == ''` (or key absent) and does NOT contain `embedded_completion`.
- [x] B5.3 Run pytest via Docker if available (`docker compose run --rm web pytest apps/payments/tests/...`). If Docker env is blocked, document the blocker inline, commit the test file, and proceed.

### Phase B6: Commit

- [x] B6.1 Stage: `direct_views.py`, `direct_payment_service.py`, `checkout.py`, `direct_serializers.py`, and new/modified test file.
- [x] B6.2 Commit: `refactor(payments): derive app_origin from X-App-Origin header for 3ds completion`. No AI attribution. No push.

---

## Track C — spa-midd-checkout (DEV-2245 branch)

### Phase C1: Interface Update

- [x] C1.1 In `src/lib/interfaces/CheckoutTokenInterface.ts`, add `app_origin?: string;` field. Remove `embedded_completion?: boolean;` field (or rename if it is used elsewhere — check usages first via grep).

### Phase C2: Gate Swap in Components

- [x] C2.1 In `src/modules/process/components/ProcessCheckout.tsx` (lines ~47, ~60, ~115), replace every occurrence of `decodeToken?.embedded_completion === true` (or `embedded_completion` truthiness check) with `decodeToken?.app_origin === 'sdk/web'`. Replace prop pass `embedded_completion={...}` → `appOrigin={...}` or align with ThreeDSPayment prop name.
- [x] C2.2 In `src/modules/tonder/components/ThreeDSPayment.tsx` (lines ~16, ~63), replace the `embedded_completion` prop declaration and guard with `appOrigin?: string` and `appOrigin === 'sdk/web'`. The `emitEmbeddedCompletion` util call itself is UNCHANGED — only the gate condition changes.

### Phase C3: Gate & Commit

- [x] C3.1 Run `tsc --noEmit` (or the repo's typecheck script) — no errors.
- [x] C3.2 Run lint and/or build if present in `package.json` scripts.
- [x] C3.3 Stage: `CheckoutTokenInterface.ts`, `ProcessCheckout.tsx`, `ThreeDSPayment.tsx`.
- [x] C3.4 Commit: `refactor(process): gate embedded completion emit on app_origin`. No AI attribution. No push.

---

## Spec Traceability

| Spec requirement | Tasks |
|-----------------|-------|
| SDK sends no embedded_completion body flag | A1.1–A1.5, A2.1–A2.3 |
| threeDsMode presentation logic unchanged | A1.4 (regression guard) |
| Backend derives app_origin from header only | B1.1–B1.2 |
| app_origin in checkout_data and JWT claim | B2.1, B3.1 |
| embedded_completion serializer field removed | B4.1 |
| Header-derived JWT claim tested | B5.1–B5.3 |
| spa-midd gate: app_origin === 'sdk/web' | C1.1–C2.2 |
| emitEmbeddedCompletion util unchanged | C2.2 (explicit guard) |
| Non-SDK (headerless) → no emit | B5.2 |

---

## Parallelism

Tracks A, B, and C are fully independent and can run in parallel. Within each track the phases are strictly sequential (RED before GREEN, view before service before JWT). Ship order: A first (backward-compatible); B and C must deploy together.
