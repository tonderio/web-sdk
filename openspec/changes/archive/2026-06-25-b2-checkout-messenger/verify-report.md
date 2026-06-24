# Verify Report: b2-checkout-messenger (Slice 1, SDK)

**Change**: b2-checkout-messenger — Embedded 3DS CheckoutMessenger  
**Commit**: 8fa893b `feat(3ds): embedded completion via CheckoutMessenger with poll fallback`  
**Branch**: feature/DEV-2245  
**Mode**: HYBRID (Engram + openspec). Strict TDD ON.  
**Date**: 2026-06-25  
**Verdict**: PASS WITH WARNINGS

---

## Build / Test Evidence

| Command | Exit | Evidence |
|---------|------|----------|
| `npm run typecheck` | 0 | `tsc --noEmit` — zero errors |
| `npm run lint` | 0 | `eslint .` — zero warnings |
| `npx vitest run` | 0 | 28 files / **236 tests passed** (221 → +15) |

All gates green. Test count matches apply-progress report exactly.

---

## Task Completion

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Port `src/ports/checkout-messenger.port.ts` | COMPLETE | Pure interface, no DOM imports |
| 2.1 RED adapter test (8 cases) | COMPLETE | All 8 cases ran and passed |
| 2.2 GREEN `BrowserCheckoutMessenger` adapter | COMPLETE | 8/8 green |
| 3.1 RED race test (7 + 1 additive) | COMPLETE | 8 it() blocks total, 7 planned + 1 additive |
| 3.2 GREEN `tonder.ts` race wiring | COMPLETE | Field + ctor arg + race branch + _createTonderWithDeps |
| 4.1 README update | COMPLETE | Instant via postMessage + poll fallback; no "Coming next" line |
| 5.1–5.4 Final gate + commit | COMPLETE | All green, commit 8fa893b, no AI attribution |

**10/10 tasks complete.**

---

## Spec Compliance Matrix

| Requirement | Scenarios | Status | Evidence |
|-------------|-----------|--------|---------|
| CheckoutMessengerPort Contract | Port is pure TS interface | PASS | File has no DOM types, no implementation. `tsc --noEmit` clean. |
| BrowserCheckoutMessenger — Resolves on Allowed-Origin Completion | `checkout.completed`, `checkout.failed` | PASS | Tests 1 & 2 in adapter test, both green. |
| Silently Ignores Non-Allowed Origins | Disallowed origin remains pending | PASS | Test 3 — promise remains pending, settled=false confirmed. |
| Silently Ignores Unrecognized Event Types | `checkout.redirected` ignored | PASS | Test 4 — promise remains pending. |
| Rejects REQUEST_ABORTED on Pre-Aborted Signal | Pre-aborted: immediate reject, no listener | PASS | Test 5 — `addSpy` confirms no `message` listener attached. |
| Rejects REQUEST_ABORTED on Post-Attach Abort | Signal aborts after listen | PASS | Test 6 — reject + removeEventListener confirmed. |
| Removes Listener After Resolution | No double-resolve | PASS | Test 7 — second dispatch causes no throw; `settled` guard in code. |
| No Listener Leak After Signal Abort | Both message + abort listeners removed | PASS | Test 8 — both `removeSpy` and `abortRemoveSpy` confirmed. |
| handleRequiresAction — Messenger wins | getTransaction used once, poll aborted, unmount | PASS | Race test case 1. `transactionCalls()===1`, `signal().aborted===true`. |
| handleRequiresAction — Poll wins | Messenger signal aborted, unmount | PASS | Race test case 2. `signal().aborted===true`. |
| handleRequiresAction — Messenger never fires (regression guard) | Poll resolves normally | PASS | Race test case 3. `neverFiringMessenger`, declined result matches expected. |
| handleRequiresAction — External abort (REQUEST_ABORTED propagates) | Caller aborts during race | **WARNING** | No dedicated test. See findings. |
| handleRequiresAction — Messenger fires but getTransaction fails | Error propagates, unmount | PASS | Race test case 5. `FETCH_TRANSACTION_ERROR` propagated. |
| Redirect-Mode 3DS Path Unchanged | waitForCompletion never called | PASS | Race test case 6. `waitForCompletion` not called, `redirect` called. |
| APM Embedded Path Unchanged | waitForCompletion never called | PASS | Race test case 7. `waitForCompletion` not called, returns `pending`. |
| Origin Allowlist Source | `resolveEnv(mode).payflow` | PASS | `tonder.ts:185` — `new Set([this.env.payflow])`. `this.env` = `resolveEnv(config.mode)`. |
| No Listener Leak After Signal Abort | window + signal listeners removed | PASS | Covered by adapter test 8. |
| No new public error codes | ErrorKeyEnum unchanged | PASS | `git diff` shows no changes to `ErrorKeyEnum.ts`. |
| No vendor names in public surface | skyflow/kushki absent from messenger code | PASS | grep confirms zero vendor names in ports/ and browser adapter. |

---

## Core Purity Check (CRITICAL contract)

| Check | Result |
|-------|--------|
| `window` in `src/core/` (runtime, non-comment) | CLEAN — 0 hits |
| `window` in `src/ports/` (runtime, non-comment) | CLEAN — only doc-comment mentions (`window` in description text) |
| `window` in `src/tonder.ts` (runtime) | CLEAN — 0 hits |
| `postMessage` in `src/core/` | CLEAN |
| `postMessage` in `src/tonder.ts` | CLEAN |
| `addEventListener` in `src/tonder.ts` | NOTE: `externalSignal.addEventListener('abort', ...)` at line 593 in `pollTransaction` — this is `AbortSignal.addEventListener`, NOT `window.addEventListener`. Pre-existing signal wiring, not a DOM touch. CLEAN. |
| `window.addEventListener` in `src/core/` | CLEAN |

**Core purity: PASS.** `window`/`postMessage` are confined exclusively to `src/adapters/browser/browser-checkout-messenger.adapter.ts`.

---

## Design Coherence

| Design Decision | Implementation | Status |
|-----------------|----------------|--------|
| D1: Port resolves `void` | `Promise<void>` confirmed in port and adapter | PASS |
| D2: `COMPLETION_EVENTS = new Set([...])`, origin gate, shape gate, single `cleanup()`, pre-abort check | All present in adapter | PASS |
| D3: Shared `AbortController`, `messengerPromise.catch(()=>{})`, `pollPromise.catch(()=>{})`, `finally { controller.abort(); host.unmount(); }` | All present in `handleRequiresAction` embedded branch | PASS |
| D4: `messenger?` as 6th ctor arg, default `new BrowserCheckoutMessenger(new Set([this.env.payflow]))`, `_createTonderWithDeps` forwarding, `createTonder` unchanged | All confirmed | PASS |
| D5: `handleApmResult` messenger-free, redirect branch untouched | Confirmed by grep — `messenger` appears nowhere in `handleApmResult`. `handleApmResult` appears only at lines 301 and 399. | PASS |

---

## Race Logic Verification (4-Branch Proof)

Reading `handleRequiresAction` embedded branch (lines 355–377 in tonder.ts):

1. **Messenger wins**: `.then(() => { controller.abort(); return getTransaction(...); })` — poll onAbort fires, poll rejection swallowed by `pollPromise.catch(()=>{})`. Messenger resolves with Transaction. `finally` re-aborts (no-op). `host.unmount()` called. ✓
2. **Poll wins**: Poll resolves with Transaction. `Promise.race` adopts it. `finally` aborts controller — messenger's `onAbort` fires, rejection swallowed by `messengerPromise.catch(()=>{})`. `host.unmount()` called. ✓
3. **External abort / genuine error**: Race rejects. `finally` aborts controller, `host.unmount()` called. Loser suppressors (`catch(()=>{})`) swallow the secondary rejection. ✓
4. **Messenger fires but getTransaction fails**: Messenger `.then` chain rejects. `controller.abort()` already fired from inside `.then`, so poll's `REQUEST_ABORTED` is suppressed. Messenger rejection (real error) propagates from `Promise.race`. `finally` runs. ✓

No double-resolve path exists. No listener/timer leak path exists. PASS.

---

## Apply Deviation Assessment

| Deviation | Verdict |
|-----------|---------|
| Race test ended with 8 `it()` cases instead of planned 7 | ACCEPTABLE — additive coverage (poll-genuine-error case), no scope change, all tests pass, no spec scenario removed. |
| External abort spec scenario not covered by a dedicated test | WARNING — see findings. |

---

## Issues

### WARNING

**W1 — Spec scenario "External abort → REQUEST_ABORTED propagates" has no dedicated test.**  
The spec explicitly requires: "External abort → `waitForCompletion` rejects with `REQUEST_ABORTED`, poll rejects with `REQUEST_ABORTED`, `Promise.race` rejects with `REQUEST_ABORTED`, iframe unmounted in `finally`." No test in `tonder.handleRequiresAction.test.ts` fires an external `AbortController` during the race to exercise this branch end-to-end. The `tonder.pollTransaction.test.ts` covers signal-abort on polling in isolation, but the race composition is unexercised for the abort path. The implementation is provably correct by code inspection (the `finally { controller.abort(); host.unmount(); }` and loser suppressors cover all exits), but the spec scenario lacks runtime evidence.  
**Recommendation**: Add one test case: inject an external `AbortController`, call `pay()`, let both messenger and poll hang, abort the external controller, and assert `REQUEST_ABORTED` propagates and `host.unmount` is called once.

### SUGGESTION

**S1 — `{ once: true }` on abort listener is correct but explicit `removeEventListener` also called.**  
In `browser-checkout-messenger.adapter.ts`, the `abort` listener is added with `{ once: true }` AND `cleanup()` also explicitly calls `signal.removeEventListener('abort', onAbort)`. This double-remove is safe (no-op on second call) and reflects the "mirrors `poll.ts`" design note. The duplication is intentional but could cause confusion in future maintenance — a comment noting this was intentional would improve clarity.

**S2 — `_createTonderWithDeps` deps object vs positional args.**  
The factory accepts a named-deps object (`{ config, http, tokenizer, acquirer, host, messenger }`) but `Tonder` constructor still takes positional args. A future refactor to named deps at the constructor level would remove the parameter-order fragility, but this is pre-existing design debt, not introduced by this change.

---

## Final Verdict

**PASS WITH WARNINGS**

1 WARNING (W1: external-abort spec scenario missing dedicated runtime evidence), 2 SUGGESTIONS. Zero CRITICAL issues. All 10 tasks complete. All build/lint/typecheck gates green. 236/236 tests pass. Core purity confirmed. Race logic verified by code inspection across 4 branches. No new public error codes. No vendor names in public surface. README accurately reflects instant-via-message + poll-fallback behavior.

Ready for `sdd-archive` after optionally adding the external-abort test (W1). The warning does not block archive since the implementation is correct by inspection and the spec scenario is covered by a combination of the existing poll abort test (`pollTransaction.test.ts`) and the `finally`-branch proof above. Archive at team's discretion.
