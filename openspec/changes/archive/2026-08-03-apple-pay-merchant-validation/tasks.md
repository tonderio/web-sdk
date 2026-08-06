# Tasks: Apple Pay Merchant Validation Service (Phase 4)

One service, one method, one test file, one `MESSAGES_EN` entry. One commit. Delivery is
**commits only** — no PRs, no chaining.

## Review Workload Forecast

| Field                   | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Estimated changed lines | ~150-180 (service ~35 incl. JSDoc, test ~110, messages.ts +1) |
| 400-line budget risk    | Low                                                           |
| Chained PRs recommended | No                                                            |
| Suggested split         | Single commit (DD8)                                           |
| Delivery strategy       | commits only (no PR)                                          |
| Chain strategy          | not applicable — commits only                                 |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                                                             | Commit     | Notes                                                                                                |
| ---- | -------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 1    | `ApplePayService.validateMerchant()` + test + `MESSAGES_EN` entry, TDD red→green | one commit | DD8: message entry ships with its first throw; service cannot ship without its test under strict TDD |

## Phase 1: RED — Failing Tests First (Strict TDD)

- [x] 1.1 Create `src/core/services/apple-pay.service.test.ts` with the fake `HttpPort` helper
      (`fakeHttp`, built on `vi.fn()`, per design §5) and all 8 test cases below. Run
      `npm run test` and confirm every case fails on a missing module/export (RED).
  - [x] 1.1a Exact method/path/body: `expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/payments/apple-pay/validate-merchant/', body: {} })` — **use exact deep equality, never `expect.objectContaining`**. `objectContaining` passes even when extra keys (e.g. `validationURL`) are present in the body; this test exists specifically to catch an unauthorized field leaking into the request, so a matcher that tolerates extra keys would produce a green test asserting the opposite of what it claims.
  - [x] 1.1b Absence assertions: empty `body` keys, `options.headers` is `undefined`, and `JSON.stringify(options)` does not match `/validationURL|merchant_identifier|domain_name|initiative_context/i`.
  - [x] 1.1c Pass-through by identity: `expect(result).toBe(merchantSession)` (reference equality, not `toEqual`) — proves the service does not clone, reshape, or inspect Apple's blob.
  - [x] 1.1d Non-object response passes through unparsed (`'an-opaque-string'`).
  - [x] 1.1e Transport `AppError` is re-wrapped, not re-thrown (DD3): asserts `error.code === APPLE_PAY_VALIDATION_ERROR`, `error.originalError === transportError`, `error.status_code` survives the wrap.
  - [x] 1.1f `MESSAGES_EN` resolution: assert `error.message).not.toBe(MESSAGES_EN[UNKNOWN_ERROR])` — this is the load-bearing line, it fails if the entry is missing. Also assert `error.message === MESSAGES_EN[APPLE_PAY_VALIDATION_ERROR]` as a secondary, partly-tautological check (it reads the same map it verifies) — keep both, comment which one does the work.
  - [x] 1.1g No memory between calls: two sequential `validateMerchant()` calls produce `toHaveBeenCalledTimes(2)` on the fake — proves no cache, no dedup (DD6).
  - [x] 1.1h A rejected call is not retried: a failing fake is called exactly once, `toHaveBeenCalledTimes(1)`. Added during apply — the spec carries this scenario but design §5's seven-case list has no counterpart, and a spec scenario with no passing test is an untested requirement, not an optional one. Together with 1.1g this covers both halves of "holds no session state": no reuse on success, no replay on failure. Retrying would resend a spent single-use session.
  - [x] 1.1i Do NOT add a `@ts-expect-error` "cannot pass a URL" test — `tsconfig.json` excludes `*.test.ts` and vitest does not typecheck, so it would be decorative (design §2.2 enforcement note). This is an instruction, not a test case: cases are 1.1a through 1.1h, eight in total.

## Phase 2: GREEN — Implementation

- [x] 2.1 Add `[ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR]` to `MESSAGES_EN` in
      `src/shared/errors/messages.ts`, placed immediately after `APPLE_PAY_CONTAINER_NOT_FOUND`
      and before `UNKNOWN_ERROR` (DD4). Copy: names an unregistered merchant domain as the
      **most likely** cause without asserting it, stays accurate for a plain transport failure,
      and reads distinct from `APPLE_PAY_SESSION_ERROR` — that entry is the **page** failing to
      **start** a session; this one is the **backend handshake** failing to **obtain** one from
      Apple. Verify the distinction by reading both entries side by side in the diff — no
      command proves copy quality, so this is a manual read, not a script.
- [x] 2.2 Create `src/core/services/apple-pay.service.ts`: `ApplePayService` class, one field
      (`http: HttpPort`), constructor takes `HttpPort` (DD1 — no `ServiceManager` registration).
- [x] 2.3 Implement `validateMerchant(): Promise<unknown>` — zero parameters, ever (DD2):
      `this.http.request<unknown>({ method: 'POST', path: '/api/v1/payments/apple-pay/validate-merchant/', body: {} })`.
- [x] 2.4 Wrap every transport failure unconditionally as
      `AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR, originalError: error })`
      (DD3) — no `instanceof AppError` re-throw guard. Do NOT copy
      `direct-api.service.ts`'s class-JSDoc claim of "no double-wrap" — that sentence describes
      `Tonder.pay`'s behavior, not the service's, and is a known doc bug in that file (out of
      scope to fix here). Write this service's JSDoc to match what the code actually does:
      unconditional wrap.
- [x] 2.5 Run `npm run test` — confirm all 8 cases from Phase 1 now pass (GREEN).

## Phase 3: Verification

- [x] 3.1 `npm run typecheck` passes.
- [x] 3.2 `npm run build` passes.
- [x] 3.3 Capture the pre-existing `npm run lint` error set (two known errors:
      `src/tonder.handleRequiresAction.test.ts:184`, `src/tonder.pay.test.ts:483`) before
      starting, and diff it against the post-change run — the set MUST be identical. Do not fix
      either pre-existing error.
- [x] 3.4 Reachability check: `rg "apple-pay.service" src/index.ts src/tonder.ts` returns no
      matches, and `rg "ApplePayService" src -g '!*.test.ts'` returns only the new service file
      itself — confirms no `src/index.ts` export and no `ServiceManager` registration (DD1),
      read the command output, don't assume it.

## Phase 4: Commit

- [x] 4.1 One commit containing `apple-pay.service.ts`, `apple-pay.service.test.ts`, and the
      `messages.ts` entry (DD8). Conventional Commit message describing the outcome (e.g.
      `feat(apple-pay): add merchant validation service`), not the file list. No PR opened.

## Requirement Traceability

| Task            | Spec Requirement                                                           |
| --------------- | -------------------------------------------------------------------------- |
| 1.1a, 2.3       | validateMerchant() posts an empty body to the merchant-validation endpoint |
| 1.1a, 1.1b, 2.3 | event.validationURL is never sent to the backend                           |
| 1.1c, 1.1d, 2.3 | The merchant session response is returned opaque and unparsed              |
| 1.1e, 2.4       | Transport failure wraps as APPLE_PAY_VALIDATION_ERROR                      |
| 1.1g, 1.1h, 2.2 | validateMerchant() holds no session state                                  |
| 3.4             | The service depends only on the injected HttpPort                          |
| 1.1f, 2.1       | APPLE_PAY_VALIDATION_ERROR resolves to a cause-hedged, distinct message    |
