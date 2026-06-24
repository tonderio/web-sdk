# Proposal: Playwright E2E Suite for @tonder.io/web-sdk

## Intent

The 237 unit tests cover SDK logic in isolation but cannot reach the integration seams where real failures hide: Skyflow cross-origin collect/reveal iframes, the live Direct API contract on STAGE, and real-browser 3DS navigation + the `embedded_completion` postMessage. E2E **complements** unit tests — it does not replace them. Pure logic already covered by unit tests gets only thin smoke coverage here; the unique value is the real-browser, real-network integration path. There is no sandbox (sandbox aliases stage), so the suite targets STAGE. We build the COMPLETE set now: harness + all 20 flows across 5 slices.

## Scope

### In Scope
- **Harness**: `@playwright/test` devDep (chromium); `playwright.config.ts` (testDir `e2e/tests`, baseURL localhost static server, serial workers, retries, timeouts); `e2e/fixture/checkout.html` (loads `dist/index.global.js` + all Skyflow collect/reveal containers + `#tonder-3ds`); static web server; npm scripts (`pretest:e2e` builds IIFE, `test:e2e` runs playwright); env-var fixture injecting `getSecureToken`/`getSignature`.
- **Slice 1 (e2e-harness-smoke)**: init, mountCardFields (assert Skyflow iframes), unmountCardFields, registerCustomer, getTransaction, pollTransaction, getPaymentMethods, getApmBanks + the **Skyflow-iframe-fill spike**.
- **Slice 2 (e2e-card-pay)**: pay card success (frictionless), pay card declined, revealCardFields. Flagship: real collect→tokenize→charge.
- **Slice 3 (e2e-threeds)**: 3DS redirect (frictionless), 3DS embedded (guard/`fixme` if DEV-2245 not on stage-payflow → poll fallback).
- **Slice 4 (e2e-cof-lifecycle)**: registerCustomer → enrollCard → getCustomerCards → pay savedCard → removeCustomerCard.
- **Slice 5 (e2e-apms)**: oxxopay (pending), spei (pending, assert clabe/bankName), safetypaycash (pending, nextAction.url). Assert pending shape ONLY.
- **Env-var/skip model**: tests parameterized by env vars; `test.skip` when creds absent (e.g. `TONDER_STAGE_API_KEY` unset) so `npx playwright test` passes (all skipped) without secrets, and runs for real when provided. NO secrets in repo.
- **Tags**: `@smoke` (fast, no charge) vs `@full` (real charge / iframe fill). Cleanup created cards/customers where possible.

### Out of Scope (Non-goals)
- Automating real ACS OTP challenge (use frictionless test PANs only).
- Asserting APM final settlement (webhook, out of band).
- Any change to SDK `src/` production code — test-only; if a test reveals a real bug, FLAG it, do not silently patch.

## Capabilities

### New Capabilities
- `e2e-harness`: Playwright scaffold, fixture page, env-var/skip model, build integration.
- `e2e-card-flows`: collect→tokenize→charge, decline, reveal coverage.
- `e2e-threeds-flows`: 3DS redirect + embedded with DEV-2245 guard.
- `e2e-cof-flows`: register/enroll/list/pay-saved/remove lifecycle.
- `e2e-apm-flows`: OXXO/SPEI/SafetyPay pending-shape coverage.

### Modified Capabilities
- None (no production behavior changes).

## Approach

Single universal `checkout.html` driven entirely via `page.evaluate()` / `exposeFunction()`; `window.__tonderBridge` injects callbacks and captures results. Serial workers (shared stage state), conservative timeouts (60s), `retries: 2` on CI. Slices land as solo commits in order; each guards its own credential/feature prerequisites via `test.skip`/`test.fixme`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `e2e/tests/`, `e2e/fixture/checkout.html` | New | Test specs + universal fixture page |
| `playwright.config.ts` | New | Config: testDir, baseURL, web server, retries, timeouts |
| `package.json` | Modified | `@playwright/test` devDep + `pretest:e2e`/`test:e2e` scripts |
| SDK `src/` | Unchanged | Test-only change; bugs flagged, not patched |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Skyflow cross-origin iframe `.fill()` blocked | High | Slice-1 spike with real stage apiKey (user-owned); confirm before Slice 2 |
| DEV-2245 not on stage-payflow | Med | Embedded test guarded with `fixme`/poll fallback |
| Stage instability / CDN latency | Med | Serial workers, 60s timeouts, `retries: 2` |
| Missing creds/test-PANs at run time | High | `test.skip` when env absent; user owns creds as run-time prerequisite |

## Rollback Plan

Test-only and additive. Revert the slice commit(s): delete `e2e/`, `playwright.config.ts`, and the `package.json` devDep/script additions. No production code or runtime behavior is touched.

## Dependencies

- **User-owned run-time prerequisites**: stage `TONDER_STAGE_API_KEY`, secure-token endpoint, test customer email, frictionless/decline/3DS test PANs, optional sign endpoint.
- The Skyflow iframe `.fill()` unknown can only be confirmed with a real stage apiKey (Slice-1 spike) — not verifiable headless without creds.
- DEV-2245 deployment status on stage-payflow (Slice 3).

## Success Criteria

- [ ] `npx playwright test` passes with all tests skipped when no env vars are set (CI-safe, no secrets).
- [ ] With env vars provided, each of the 20 flows runs against stage and asserts its documented contract.
- [ ] Slice-1 spike confirms (or refutes) Skyflow iframe `.fill()` before Slice 2.
- [ ] `@smoke` subset runs fast with no real charges; `@full` isolated behind tags.
- [ ] No SDK `src/` production code modified.
