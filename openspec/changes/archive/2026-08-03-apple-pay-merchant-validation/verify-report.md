# Verification Report — apple-pay-merchant-validation (Phase 4)

Source: Engram observation #4035 (`sdd/apple-pay-merchant-validation/verify-report`)

**Change**: apple-pay-merchant-validation | **Branch**: feature/applepay-foundation
**Commits reviewed**: e333204 (feat), 371f21b (docs)
**Verdict**: PASS — 0 CRITICAL, 0 WARNING, 1 SUGGESTION

### Commands (all green)

- `npm run test` → 39 files, 415 tests passed (incl. 8 apple-pay.service.test.ts cases)
- `npm run typecheck` → clean
- `npm run build` → clean
- `npm run lint` → exactly 2 pre-existing errors (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`); set unchanged, no growth, no new errors in apple-pay files

### Spec compliance matrix (7/7 requirements, runtime-verified)

1. Empty-body POST to exact path — test 1, PASS
2. event.validationURL never sent — test 1 + test 2, PASS
3. Opaque unparsed response — test 3 (identity `toBe`) + test 4 (non-object), PASS
4. Transport failure → APPLE_PAY_VALIDATION_ERROR — test 5, PASS
5. No session state (2 calls → 2 requests; rejected call not retried) — test 7 + test 8, PASS
6. Depends only on injected HttpPort — import check: only `HttpPort` (type-only), `AppError`, `ErrorKeyEnum`. PASS
7. MESSAGES_EN cause-hedged distinct message — test 6 + manual read, PASS

### Adversarial checks performed directly (not taken on faith)

- **Exact-equality claim verified experimentally**: patched the service to inject `body: { validationURL: '...' }`, ran the suite — test 1 (`toHaveBeenCalledWith` exact object) and test 2 (`Object.keys(body).toHaveLength(0)`) both went RED as claimed. Reverted; `git diff` clean afterward. The apply phase's claim holds.
- **Identity pass-through**: test 3 uses `expect(result).toBe(merchantSession)` — reference equality, not `toEqual`. Confirmed no clone/reshape possible.
- **MESSAGES_EN pair read side by side**: `APPLE_PAY_SESSION_ERROR` = "Could not start the Apple Pay session..." (page/browser, pre-network) vs `APPLE_PAY_VALIDATION_ERROR` = "Could not obtain an Apple Pay merchant session from Apple. The most likely cause is a domain that is not registered..." (backend handshake, post-sheet-open). Distinction lands: "start the session" vs "obtain a session from Apple" — the copy correctly separates page-side vs backend-handshake failure, hedges cause with "most likely," and stays accurate for a plain transport failure. Only the load-bearing `not.toBe(UNKNOWN_ERROR)` assertion is what fails on a missing entry; the `toBe(APPLE_PAY_VALIDATION_ERROR)` line is correctly commented as secondary/tautological. Both present, correctly labelled.
- **No inherited doc bug**: apple-pay.service.ts JSDoc says wrap is UNCONDITIONAL ("including an incoming AppError, which is re-wrapped rather than re-thrown") — does NOT repeat DirectApiService's false "re-thrown unchanged (no double-wrap)" claim. Confirmed by direct read of both files.
- **Reachability (DD1)**: `rg "ApplePayService" src -g '!*.test.ts'` → only the service's own file. `rg "apple-pay.service|ApplePayService" src/index.ts src/tonder.ts` → no matches. Commit e333204 touches exactly 3 files (service, test, messages.ts) — matches proposal's frozen scope.
- **Exactly one MESSAGES_EN entry**: confirmed APPLE_PAY_VALIDATION_ERROR present, placed between APPLE_PAY_CONTAINER_NOT_FOUND and UNKNOWN_ERROR (DD4 placement correct); confirmed the three Phase-5-owed codes (APPLE_PAY_NOT_ENABLED, APPLE_PAY_UNSUPPORTED_BROWSER, APPLE_PAY_UNSUPPORTED_ACTION) are still absent — no scope creep.
- **core/ purity**: only `HttpPort` (type-only import), `AppError`, `ErrorKeyEnum` imported. No DOM, no fetch.

### Deviation judgment — 8th test ("does not retry a rejected call")

Design §5's test-case list has 7 cases and covers only the positive case of the "holds no session state" requirement (2 calls → 2 requests). The spec (`spec.md` lines 80-84) has a second, explicit scenario under that same requirement: "A rejected call is not retried." Design's list is incomplete relative to the spec it must satisfy — the spec is the binding contract, not the design's illustrative code block. Per verify hard rules, a spec scenario is compliant only when a covering test passed at runtime; without test 8, that scenario would be CRITICAL/UNTESTED. **Judgment: the deviation reasoning holds and the test earns its place** — it closes a real design/spec gap rather than adding decorative coverage. This is a legitimate, necessary addition, not a design violation.

### SUGGESTION (non-blocking) — resolved before archive in commit `1851d0d`

- `tasks.md` task 1.1 says "all 8 test cases below" but its sub-items (a–h) enumerate only 7 actual test descriptions plus one negative instruction (h: "do NOT add a ts-expect-error test"), so the doc's own count is off by one. More materially, the Requirement Traceability table at the bottom mapped "validateMerchant() holds no session state" only to task 1.1g (the 2-calls-2-requests case) — it never explicitly traced the 8th test / "rejected call not retried" scenario. Fixed in `1851d0d`: the archived `tasks.md` in this folder shows the corrected traceability row `1.1g, 1.1h, 2.2 | validateMerchant() holds no session state`.

### Tasks (15/15 checked, all claims verified true)

All Phase 1 (RED), Phase 2 (GREEN), Phase 3 (Verification), Phase 4 (Commit) boxes confirmed against actual code/test/command state. No unchecked-but-actually-incomplete items found.

### Final verdict: PASS

No CRITICAL or WARNING issues. One documentation SUGGESTION on tasks.md traceability completeness (resolved in `1851d0d`, re-verified live by the archive executor per the post-fix `tasks.md` read on 2026-08-03). Ready for archive.

Original Engram metadata: project web-sdk, scope project, topic `sdd/apple-pay-merchant-validation/verify-report`, observation #4035, created 2026-08-03 17:36:24.
