# Tasks: remove-register-customer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 160–220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception (single PR; well under 400-line budget) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All tasks below | PR 1 | Single atomic commit; breaking change at v0.1.0 pre-publish |

---

## Phase 1: Error Rename — Enum + Message (Foundation)

- [x] 1.1 In `src/shared/errors/ErrorKeyEnum.ts` (L36): rename enum member `CUSTOMER_NOT_REGISTERED = 'CUSTOMER_NOT_REGISTERED'` → `MISSING_CUSTOMER = 'MISSING_CUSTOMER'`. No other members changed.
- [x] 1.2 In `src/shared/errors/messages.ts` (L43–44): replace the `CUSTOMER_NOT_REGISTERED` key with `MISSING_CUSTOMER`. New message: `"No customer set. Provide \`customer\` in createTonder() config."` (remove all "register" wording).
- [x] 1.3 Search the entire repo for `CUSTOMER_NOT_REGISTERED` (`grep -r`) and update every remaining reference in lock-step: source files, test files, README — leave zero occurrences.

**Spec ref**: Proposal §"What Changes" — error rename; message points only to `config.customer`.

---

## Phase 2: RED — Adjust Tests to the New Contract

All test changes happen BEFORE the implementation changes. Tests must express the new contract and fail against current code where the contract differs.

- [x] 2.1 **Delete** `src/tonder.registerCustomer.test.ts` entirely. It tests a method that will no longer exist.
- [x] 2.2 In `src/tonder.customer.test.ts`: **remove case 2.3** ("explicit registerCustomer() still works") and **remove case 2.4** ("explicit registerCustomer() after config.customer overwrites the cache"). Both describe a no-longer-valid API path.
- [x] 2.3 In `src/tonder.customer.test.ts`: **add a new case** asserting `typeof (tonder as any).registerCustomer === 'undefined'` (method is gone from instance). Add alongside remaining cases.
- [x] 2.4 In `src/tonder.customer.test.ts` case 2.5 (currently `CUSTOMER_NOT_REGISTERED`): update the `rejects.toMatchObject` expectation to `{ code: ErrorKeyEnum.MISSING_CUSTOMER }`.
- [x] 2.5 In `src/tonder.removeCustomerCard.test.ts` (L75–84 `readyWithCustomer` helper): remove the `await tonder.registerCustomer(...)` call; replace with `config: { ...BASE_CONFIG, customer: { email: 'ada@example.com' }, getSecureToken: ... }` passed at `_createTonderWithDeps`.
- [x] 2.6 Audit `src/tonder.enrollCard.test.ts` and `src/tonder.getCustomerCards.test.ts`: replace any `registerCustomer()` calls in test setup with `config.customer` provided at `_createTonderWithDeps`; update any `CUSTOMER_NOT_REGISTERED` error code assertions to `MISSING_CUSTOMER`.
- [x] 2.7 Run `npx vitest run` — confirm: (a) tests referencing the deleted `registerCustomer` method fail with "not a function" / type errors; (b) `MISSING_CUSTOMER` assertions fail (enum not renamed yet); (c) no regressions in unrelated tests.

**Spec ref**: Proposal §Tests; strict TDD — RED before GREEN.

---

## Phase 3: GREEN — Remove Public Method + Simplify Resolver

- [x] 3.1 In `src/tonder.ts`: **remove the entire `registerCustomer()` public method** (L618–639) including its JSDoc block. Remove any corresponding `public` export or interface entry if present.
- [x] 3.2 In `src/tonder.ts` `ensureCustomerRegistered()` (L773–791): change `const input = state.customerInput ?? this.core.getConfig().customer;` → `const input = this.core.getConfig().customer;`. The `state.customerInput ??` fallback is dropped; only `config.customer` is the source.
- [x] 3.3 Verify the post-registration state write at L786–789 is KEPT: `this.core.setState({ customerAuthToken: customer.authToken, customerInput: input })`. This caches `customerInput` derived from `config.customer` so `enrollCard()` (L666–668) still reads `firstName/lastName/email` for the subscription contact — no behavioral change to `enrollCard`.
- [x] 3.4 Verify `resolveCardAuth()` (L793–817): after simplification, `userToken` is still a non-empty string when `config.customer` is valid. No code change needed here unless the type narrowing requires it.
- [x] 3.5 Run `npx vitest run` — all adjusted tests from Phase 2 must now pass. Confirm test file count is lower (registerCustomer.test.ts deleted).

**Spec ref**: Proposal §"What Changes" — remove public method; simplify private resolver to `config.customer`-only; keep `customerInput` cache for `enrollCard` contact.

---

## Phase 4: README Purge

- [x] 4.1 Open `README.md`. Remove ALL `registerCustomer` mentions: at minimum L271, L297–298, L343–344 per the proposal. Remove any surrounding "optional" framing that implies calling `registerCustomer` is a valid alternative to `config.customer`.
- [x] 4.2 In any saved-cards or card-on-file section: rewrite setup examples to show ONLY `config.customer` in the `createTonder()` call. No `registerCustomer` step, no comment saying it's optional.
- [x] 4.3 Update any README reference to `CUSTOMER_NOT_REGISTERED` → `MISSING_CUSTOMER`.
- [x] 4.4 Run: `grep -n "registerCustomer" README.md` — must return zero lines. Run: `grep -n "CUSTOMER_NOT_REGISTERED" README.md` — must return zero lines. Commit only after both are confirmed zero.

**Spec ref**: Proposal §README — zero `registerCustomer` references; grep to confirm.

---

## Phase 5: Gate — Typecheck, Lint, Full Test Suite, Commit

- [x] 5.1 Run `npm run typecheck` — zero errors. The removed method must not appear in any public interface or type export.
- [x] 5.2 Run `npm run lint` — zero errors or warnings introduced by this change.
- [x] 5.3 Run `npx vitest run` — all tests green; total test count is lower than before (registerCustomer.test.ts is gone).
- [x] 5.4 Run repo-wide greps to confirm zero residual references: `grep -rn "registerCustomer" src/ README.md` and `grep -rn "CUSTOMER_NOT_REGISTERED" src/ README.md` — both must return zero lines.
- [x] 5.5 Stage all changes and create ONE commit: `refactor(customer)!: remove public registerCustomer; config.customer is the sole, set-once source`. No AI attribution. No push.

**Spec ref**: Full gate before any push; conventional commit with breaking-change marker.

---

## Parallel / Sequential Map

```
Phase 1 (error rename)
  └─→ Phase 2 (RED tests)          [sequential — tests import MISSING_CUSTOMER enum]
        └─→ Phase 3 (GREEN impl)   [sequential — impl makes RED tests pass]
              └─→ Phase 4 (README) [can run after Phase 1; parallel with Phase 3 if confident]
                    └─→ Phase 5 (gate + commit) [sequential — all phases must complete first]
```

Phase 4 (README) has no code dependency on Phase 3 and can proceed in parallel with Phase 3 if the implementer is working alone and confident in Phase 1 being done. Gate (Phase 5) is always last.
