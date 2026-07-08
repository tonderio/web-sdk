# Tasks: secure-token-config

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120–170 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception (single PR, no chain needed) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full change: tests RED → source GREEN → docs → gate | PR 1 | Single autonomous slice; all files; one commit |

---

## Phase 1: RED — Update tests to new contract (strict TDD)

- [x] 1.1 `src/tonder.enrollCard.test.ts` — Replace `config({ getSecureToken: () => Promise.resolve(SECURE_TOKEN) })` helper default with `config({ secureToken: SECURE_TOKEN })`; remove the `getSecureToken` import reference. Assert SECURE_TOKEN_REQUIRED when `secureToken` is absent (repurpose existing test at L136–143 — drop `getSecureToken: undefined`, use `config()` with no `secureToken`).
- [x] 1.2 `src/tonder.getCustomerCards.test.ts` — Replace all `getSecureToken: () => Promise.resolve('...')` inline config overrides (L104, L117, L152, L186, L210, L234) with `secureToken: 'secure_abc'` (or matching literal). Repurpose SECURE_TOKEN_REQUIRED test (L128–133) to assert when `secureToken` is absent. **Delete** the SECURE_TOKEN_ERROR test (L137–145 "throws SECURE_TOKEN_ERROR when getSecureToken rejects") — this error code is being removed.
- [x] 1.3 `src/tonder.removeCustomerCard.test.ts` — Replace `getSecureToken` overrides (L89, L102, L140, L167) with `secureToken` string. Repurpose SECURE_TOKEN_REQUIRED test (L113–118). **Delete** the SECURE_TOKEN_ERROR test (L122–130).
- [x] 1.4 `src/tonder.customer.test.ts` — Replace the `getSecureToken` callback at L16 in the base config with `secureToken: SECURE_TOKEN` (or equivalent constant).
- [x] 1.5 `src/core/services/cof.service.test.ts` — Verify no `getSecureToken` / `SECURE_TOKEN_ERROR` references exist (grep confirms zero matches); no changes needed unless grep reveals new hits.
- [x] 1.6 Confirm tests are RED: run `npx vitest run` — expect TypeScript errors / failing assertions because `TonderConfig.getSecureToken` still exists and `secureToken` does not.

## Phase 2: GREEN — Source changes to satisfy the tests

- [x] 2.1 `src/shared/types/index.ts` — In `TonderConfig`: remove the `getSecureToken?: () => Promise<string>` field and its JSDoc; add `/** Server-minted secure token required for COF operations. Set once at createTonder(); recreate the SDK instance if the token expires. */ secureToken?: string;`.
- [x] 2.2 `src/shared/errors/ErrorKeyEnum.ts` — Remove `SECURE_TOKEN_ERROR = 'SECURE_TOKEN_ERROR'` (L33).
- [x] 2.3 `src/shared/errors/messages.ts` — Remove `[ErrorKeyEnum.SECURE_TOKEN_ERROR]: 'Error getting secure token.'` (L39). Update `SECURE_TOKEN_REQUIRED` message to: `'No secure token. Provide \`secureToken\` in createTonder() config.'` (currently L41–42).
- [x] 2.4 `src/tonder.ts` — In `resolveCardAuth` (L756–780): replace `const getSecureToken = this.core.getConfig().getSecureToken` + callback invocation + SECURE_TOKEN_ERROR catch block with `const secureToken = this.core.getConfig().secureToken ?? '';` and a single guard `if (!secureToken) throw new AppError({ errorCode: ErrorKeyEnum.SECURE_TOKEN_REQUIRED });`. Remove the `try/catch` wrapping the callback.
- [x] 2.5 `src/tonder.ts` — Update JSDoc for `enrollCard` (L607), `getCustomerCards` (L658, L665–666), and `removeCustomerCard` (L721): replace `getSecureToken present/missing` and `getSecureToken throws → SECURE_TOKEN_ERROR` lines with `secureToken absent/empty → SECURE_TOKEN_REQUIRED`.
- [x] 2.6 Confirm tests are GREEN: run `npx vitest run` — all COF-related suites must pass.

## Phase 3: Documentation purge

- [x] 3.1 `README.md` — Remove every occurrence of `getSecureToken` (L260, L269, L299, L306, L313, L344 per proposal). Replace callback examples (`getSecureToken: async () => fetchSecureTokenFromYourBackend()`) with `secureToken: await fetchSecureTokenFromYourBackend()` (note: merchant passes the already-resolved string at construction time).
- [x] 3.2 `README.md` — Add one-line expiry note near the `secureToken` config entry: "The token is server-minted and short-lived; recreate the SDK instance when it expires."
- [x] 3.3 Grep verify: `grep -r "getSecureToken" README.md` → must return **zero** matches.

## Phase 4: Gate — typecheck, lint, tests, grep, commit

- [x] 4.1 Run `npm run typecheck` — zero errors.
- [x] 4.2 Run `npm run lint` — zero new warnings or errors.
- [x] 4.3 Run `npx vitest run` — all suites green.
- [x] 4.4 Grep source: `grep -r "getSecureToken" src/` → zero matches.
- [x] 4.5 Grep source: `grep -r "SECURE_TOKEN_ERROR" src/` → zero matches (SECURE_TOKEN_INVALID and SECURE_TOKEN_REQUIRED must still exist).
- [x] 4.6 Grep README: `grep "getSecureToken" README.md` → zero matches.
- [x] 4.7 Stage all changes and commit with exactly: `refactor(auth)!: pass secureToken in config instead of a getSecureToken callback`. No "Co-Authored-By" or AI attribution lines.
