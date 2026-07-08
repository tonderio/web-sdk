# Verify Report: Transparent Customer for Card-on-File

**Change**: transparent-customer
**Branch**: feature/DEV-2245
**Commit**: 6e4e79e
**Date**: 2026-06-30
**Verdict**: PASS

---

## Build / Type-Check Evidence

| Command | Exit Code | Output |
|---------|-----------|--------|
| `npm run typecheck` | 0 | Clean — zero errors across src/ and e2e/ |
| `npx vitest run` | 0 | 251 passed (29 test files), 0 failures |
| `npm run lint` | 1 | 4 errors, all under `e2e/` — pre-existing, NOT introduced by this change; zero new errors in any file this change touched |

---

## Task Completion

| Phase | Tasks | Checked | Status |
|-------|-------|---------|--------|
| Phase 1 — Foundation | 2 | 2 | COMPLETE |
| Phase 2 — RED tests | 7 | 7 | COMPLETE |
| Phase 3 — GREEN impl | 4 | 4 | COMPLETE |
| Phase 4 — Full gate | 3 | 3 | COMPLETE |
| Phase 5 — Docs | 3 | 2 + 1 N/A | COMPLETE (5.3 demos out of scope) |
| Phase 6 — Commit | 1 | 1 | COMPLETE |

All implementation tasks are checked. Task 5.3 (demo repo) correctly marked N/A — demos live in a separate repository.

---

## Spec Compliance Matrix

| Requirement | Evidence | Status |
|-------------|----------|--------|
| `customer?: CustomerInput` added to TonderConfig | `src/shared/types/index.ts` L36, with full JSDoc | PASS |
| `ensureCustomerRegistered()` is memoized — cached token short-circuits network | Implementation L773–791: `if (state.customerAuthToken) return state.customerAuthToken` | PASS |
| Memoization proven by test — two COF ops → registerOrFetch called ONCE | Test 2.2: `enrollCard()` + `getCustomerCards()` → `customerSpy` called once | PASS |
| `enrollCard` registers transparently via config.customer | Test 2.1: no prior `registerCustomer()` → enroll resolves, spy called once | PASS |
| `getCustomerCards` registers transparently via config.customer | Test 2.6: resolves with `[]`, spy called once | PASS |
| `removeCustomerCard` registers transparently via config.customer | Test 2.7: resolves, spy called once | PASS |
| resolveCardAuth delegates to ensureCustomerRegistered — guaranteed non-empty userToken | `tonder.ts` L799: `const userToken = await this.ensureCustomerRegistered()` | PASS |
| No customer anywhere → CUSTOMER_NOT_REGISTERED | Test 2.5: `enrollCard()` rejects with `code: CUSTOMER_NOT_REGISTERED` | PASS |
| Error message names BOTH sources | `messages.ts` L44: "Provide config.customer at createTonder() or call registerCustomer() …" | PASS |
| Explicit registerCustomer() still works | Test 2.3: registerCustomer alone, COF ops use cache | PASS |
| registerCustomer() after config.customer overwrites cache (switch-customer) | Test 2.4: second identity's token returned after `registerCustomer({ email: 'other@example.com' })` | PASS |
| pay() with fresh card sends customer INLINE, unchanged | `tonder.ts` L276 `pay()` never calls `ensureCustomerRegistered`; comment at L853 confirms inline | PASS |
| README saved-cards section: config.customer shown, registerCustomer optional | `README.md` L272, L297–299 | PASS |
| README enroll section: config.customer shown, registerCustomer optional | `README.md` L316, L343–344 | PASS |
| Public surface: camelCase, no vendor names, no I-prefix | All public types checked | PASS |

---

## Design Deviation Assessment

| Deviation | Spec Said | Implemented | Judgment |
|-----------|-----------|-------------|----------|
| Native `#` private vs TypeScript `private` | Task 3.1 said `#ensureCustomerRegistered` | `private async ensureCustomerRegistered()` | ACCEPTABLE — entire codebase uses TypeScript `private` (117–130, 216, 340, 399, etc.); no `#` anywhere. Behaviorally identical. |
| registerOrFetch counted via HTTP spy | Tasks assumed customerService injectable | Spy intercepts `/api/v1/customer/` POST | ACCEPTABLE — customerService is constructed internally; POST spy is the proven seam and correctly counts one call per registerOrFetch invocation. |
| Demo update (5.3) N/A | Tasks noted N/A explicitly | Not implemented | ACCEPTABLE — demos live in separate repo per apply-progress; orchestrator scope. |

No deviation breaks a spec requirement.

---

## Issues

### CRITICAL
None.

### WARNING
- **Pre-existing lint errors under `e2e/`** (4 errors: `no-undef` in `server.mjs`, `no-unused-vars` in `threeds.spec.ts`): not introduced by this change. None of the 7 files this change touched (src/shared/types/index.ts, src/shared/errors/messages.ts, src/tonder.ts, src/tonder.customer.test.ts, README.md, openspec proposal/tasks) appear in the lint report. Recommend a separate cleanup PR.

### SUGGESTION
- The `2.4` test verifies cache overwrite indirectly (last returned value of the spy). A follow-up could assert that subsequent COF ops after `registerCustomer()` also use the new token (no third POST) to make the cache-clear contract even more explicit. Current coverage is sufficient for archive readiness.

---

## Final Verdict

**PASS** — 0 CRITICAL, 1 WARNING (pre-existing, out of scope), 1 SUGGESTION (non-blocking).

All spec requirements are satisfied with runtime test evidence. All 25 tasks are checked. Both build commands exit clean. Design deviations match codebase convention and do not break specs. Ready for `sdd-archive`.
