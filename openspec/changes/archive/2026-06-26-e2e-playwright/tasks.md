# Tasks: Playwright E2E Suite for @tonder.io/web-sdk

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1 200 (test + config + fixture; no src changes) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 0 (harness) → PR 1 (smoke) → PR 2 (card-pay) → PR 3 (3ds) → PR 4 (cof) → PR 5 (apms) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 0 – Harness | Scaffold + fixture + env model | PR 0 → main | Base for every slice; no tests yet |
| 1 – Smoke | Slice 1 test file + spike | PR 1 → main | Depends on PR 0 |
| 2 – Card Pay | Slice 2 test file | PR 2 → main | Depends on PR 1 (Skyflow spike resolved) |
| 3 – 3DS | Slice 3 test file | PR 3 → main | Depends on PR 2 |
| 4 – COF | Slice 4 test file | PR 4 → main | Depends on PR 3 |
| 5 – APMs | Slice 5 test file | PR 5 → main | Depends on PR 4 |

---

## Phase 0: Harness (folded into Slice 1 commit)

- [x] 0.1 Install devDep: `npm install --save-dev @playwright/test` and run `npx playwright install chromium`; verify `node_modules/.bin/playwright` present.
- [x] 0.2 Add npm scripts to `package.json`: `"pretest:e2e": "npm run build"`, `"test:e2e": "playwright test"`.
- [x] 0.3 Create `playwright.config.ts` at repo root: `testDir: 'e2e/tests'`, `baseURL: 'http://localhost:4321'`, `webServer: { command: 'npx serve e2e/fixture --listen 4321', port: 4321, reuseExistingServer: !process.env.CI }`, `workers: 1` (serial), `retries: process.env.CI ? 2 : 0`, `timeout: 60_000`, `use: { headless: true, trace: 'on-first-retry', video: 'on-first-retry' }`, `projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]`.
- [x] 0.4 Create `e2e/fixture/checkout.html`: loads `../../dist/index.global.js`; declares `#collect-cardholder-name`, `#collect-card-number`, `#collect-expiration-month`, `#collect-expiration-year`, `#collect-cvv`; reveal containers `#reveal-card-number`, `#reveal-cardholder-name`; 3DS container `#tonder-3ds` (480px); exposes `window.__tonderBridge = {}` for `page.evaluate`-injected callbacks and result capture.
- [x] 0.5 Create `e2e/support/env.ts`: reads and exports `TONDER_STAGE_API_KEY`, `TONDER_STAGE_SECURE_TOKEN_ENDPOINT`, `TONDER_STAGE_CUSTOMER_EMAIL`, `TONDER_SKYFLOW_PAN_FRICTIONLESS`, `TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE`, `TONDER_SKYFLOW_PAN_DECLINE`, and optional `TONDER_STAGE_SIGN_ENDPOINT`; throws descriptive error if a mandatory var is missing at runtime (not at load-time — guard is invoked inside tests).
- [x] 0.6 Create `e2e/support/skip.ts`: export `skipIfNoStageCreds(test)` that calls `test.skip(!process.env.TONDER_STAGE_API_KEY, 'TONDER_STAGE_API_KEY not set — skipping E2E')`.
- [x] 0.7 Create `e2e/support/fixtures.ts`: Playwright `test.extend` fixture that navigates to `/checkout.html` and injects `getSecureToken` (fetch from `TONDER_STAGE_SECURE_TOKEN_ENDPOINT`) and optional `getSignature` via `page.exposeFunction`; exports custom `test` and `expect`.
- [x] 0.8 Create `e2e/README.md`: required env vars list, `npm run test:e2e` usage, `@smoke` vs `@full` tag explanation, how to run only smoke (`--grep @smoke`).
- [x] 0.9 Gate: run `npm run typecheck` (config + support files must typecheck) AND `npx playwright test --list` (must exit 0 with 0 tests found but no errors).

---

## Phase 1: Slice 1 — Harness Smoke (commit: `test(e2e): add harness scaffold and smoke suite`)

Sequential dependency: Phase 0 complete.

- [x] 1.1 Create `e2e/tests/smoke.spec.ts`; import custom `test`/`expect` from `e2e/support/fixtures.ts`; tag every `test` with `@smoke`.
- [x] 1.2 Add `skipIfNoStageCreds` guard at the top of each `test` block (or in a `test.beforeEach`).
- [x] 1.3 Write test **init**: `createTonder({ apiKey, mode: 'stage' }).init()` — assert no exception thrown; result has `lifecycle === 'ready'`; `business` non-null.
- [x] 1.4 Write test **mountCardFields**: after init, call `mountCardFields`; `waitForSelector('#collect-card-number iframe', { timeout: 20_000 })`; assert same for the other 4 containers.
- [x] 1.5 Write test **unmountCardFields**: after mount, call `unmountCardFields()`; `expect(page.locator('#collect-card-number iframe')).not.toBeAttached()`.
- [x] 1.6 Write test **getPaymentMethods**: `createTonder(config).getPaymentMethods()` (no init); assert array length > 0; each item has `id`, `paymentMethod`, `acquirer`, `status`, `category`.
- [x] 1.7 Write test **getApmBanks**: `createTonder(config).getApmBanks()`; assert result has `cash` and `transfer` arrays; combined length > 0.
- [x] 1.8 Write test **registerCustomer**: after init, `tonder.registerCustomer({ email: TONDER_STAGE_CUSTOMER_EMAIL, firstName: 'E2E', lastName: 'Test' })`; assert `customerAuthToken` non-empty string in SDK state.
- [x] 1.9 Write test **getTransaction** (smoke): if `TONDER_STAGE_EXISTING_TX_ID` env var set, call `tonder.getTransaction(id)`; assert `transaction.id === id`; else `test.skip`.
- [x] 1.10 Write test **pollTransaction** (smoke): same prereq as 1.9; call `tonder.pollTransaction(id, { timeoutMs: 15_000, intervalMs: 3_000 })`; assert result has a `status` in known final statuses.
- [x] 1.11 Write **Skyflow iframe fill SPIKE** test (tagged `@spike`): after mount, attempt `frameLocator('#collect-card-number iframe').getByRole('textbox').fill('4111111111111111')`; log success or caught error via `console.log`; test.skip result if fill throws — do NOT fail the suite; this is a go/no-go data point for Slice 2.
- [x] 1.12 Gate: `npm run typecheck` green (no TS errors in new files) + `npx playwright test --list` shows all Slice 1 tests discoverable.
- [x] 1.13 Solo commit: `test(e2e): add harness scaffold and smoke suite`.

---

## Phase 2: Slice 2 — Card Pay (commit: `test(e2e): add card pay, decline, and reveal flows`)

Sequential dependency: Phase 1 complete AND Skyflow iframe fill spike confirmed viable.

- [x] 2.1 Create `e2e/tests/card-pay.spec.ts`; import shared fixtures; tag tests `@full`.
- [x] 2.2 Write helper `fillCardFields(page, { pan, month, year, cvv, name })` in `e2e/support/fixtures.ts`: uses `frameLocator` per container, fills all 5 fields; uses `keyboard.type` fallback if `.fill()` is blocked (informed by spike result from 1.11).
- [x] 2.3 Write test **pay card success (frictionless)**: init + mountCardFields + `fillCardFields` with `TONDER_SKYFLOW_PAN_FRICTIONLESS`; call `pay({ amount: 10, customer: {...}, paymentMethod: { type: 'card' } })`; assert `result.status === 'success'`; `result.transaction.id` is string; store `txId` in shared state for reuse.
- [x] 2.4 Write test **pay card declined**: init + mountCardFields + `fillCardFields` with `TONDER_SKYFLOW_PAN_DECLINE`; call `pay`; assert `result.status === 'declined'`; `result.declineCode` present; `result.declineReason` present.
- [x] 2.5 Write test **revealCardFields** (chained after 2.3): reuse stored `txId`; call `revealCardFields({ fields: ['cardNumber', 'cardholderName'] })`; `waitForSelector('#reveal-card-number iframe', { timeout: 15_000 })`; assert same for `#reveal-cardholder-name`.
- [x] 2.6 Gate: `npm run typecheck` green + `npx playwright test --list` shows Slice 2 tests discoverable.
- [x] 2.7 Solo commit: `test(e2e): add card pay, decline, and reveal flows`.

---

## Phase 3: Slice 3 — 3DS (commit: `test(e2e): add 3DS redirect and embedded flows`)

Sequential dependency: Phase 2 complete.

- [x] 3.1 Create `e2e/tests/threeds.spec.ts`; import shared fixtures; tag tests `@full`.
- [x] 3.2 Write test **3DS redirect (frictionless)**: configure `createTonder` with `threeDsMode: 'redirect'` and `returnUrl: 'http://localhost:4321/checkout.html'`; init + mount + fill `TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE`; register `page.waitForURL('**/stage-payflow.tonder.io/**', { timeout: 30_000 })` BEFORE calling `pay()`; after payflow, `page.waitForURL('**/checkout.html?txId=*', { timeout: 60_000 })`; extract `txId` from URL; call `getTransaction(txId)`; assert status in `['success', 'requires_action']`.
- [x] 3.3 Write test **3DS embedded**: configure `createTonder` with `threeDsMode: 'embedded'`; init + mount + fill `TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE`; register `page.waitForEvent('message', msg => msg.data?.event === 'checkout.completed')` BEFORE calling `pay()`; call `pay()` concurrently; `await Promise.race([messagePromise, payPromise])`; if `pay()` wins, assert `result.status === 'success'`; if message wins, assert event payload has `status: 'success'`; wrap with `test.fixme(!process.env.TONDER_DEVS_2245_ON_STAGE, 'DEV-2245 not confirmed on stage-payflow — embedded path unverifiable')`.
- [x] 3.4 Gate: `npm run typecheck` green + `npx playwright test --list` shows Slice 3 tests discoverable.
- [x] 3.5 Solo commit: `test(e2e): add 3DS redirect and embedded flows`.

---

## Phase 4: Slice 4 — COF Lifecycle (commit: `test(e2e): add COF register/enroll/list/pay/remove lifecycle`)

Sequential dependency: Phase 3 complete.

- [x] 4.1 Create `e2e/tests/cof.spec.ts`; import shared fixtures including `getSecureToken` injection; tag tests `@full`.
- [x] 4.2 Declare module-scoped `let enrolledCardId: string` in the describe block for state sharing across ordered tests.
- [x] 4.3 Write ordered describe **COF lifecycle** with `test.describe.serial()`: (a) `registerCustomer` → assert `customerAuthToken`; (b) `enrollCard` → fill frictionless PAN + call `enrollCard()` → assert `result.cardId` is string; store in `enrolledCardId`; (c) `getCustomerCards` → assert array contains `enrolledCardId`; (d) `pay savedCard` → `pay({ paymentMethod: { type: 'savedCard', cardId: enrolledCardId } })` → assert `result.status` in `['success', 'requires_action']`; (e) `removeCustomerCard(enrolledCardId)` → assert resolves; subsequent `getCustomerCards()` does NOT include `enrolledCardId`.
- [x] 4.4 Add `afterAll` cleanup: if `enrolledCardId` still set after test failures, attempt `removeCustomerCard(enrolledCardId)` silently.
- [x] 4.5 Gate: `npm run typecheck` green + `npx playwright test --list` shows Slice 4 tests discoverable.
- [x] 4.6 Solo commit: `test(e2e): add COF register/enroll/list/pay/remove lifecycle`.

---

## Phase 5: Slice 5 — APMs (commit: `test(e2e): add OXXO, SPEI, and SafetyPay pending-shape flows`)

Sequential dependency: Phase 4 complete.

- [x] 5.1 Create `e2e/tests/apms.spec.ts`; import shared fixtures; tag tests `@smoke` (no real charge completes — pending only).
- [x] 5.2 Write test **pay oxxopay**: init + `pay({ amount: 10, customer: {...}, paymentMethod: { type: 'apm', apm: 'oxxopay' } })`; assert `result.status === 'pending'`; `result.transaction.id` is string; `result.paymentInstructions` non-null.
- [x] 5.3 Write test **pay spei**: init + `pay({ amount: 100, ..., paymentMethod: { type: 'spei' } })`; assert `result.status === 'pending'`; `result.clabe` is string of length ≥ 18; `result.bankName` is non-empty string.
- [x] 5.4 Write test **pay safetypaycash**: call `getApmBanks()` first to obtain a valid `bankId`; skip if `cash` array empty; `pay({ ..., paymentMethod: { type: 'apm', apm: 'safetypaycash', config: { country: 'MX', channel: 'cash', bank_ids: [bankId] } } })`; assert `result.status === 'pending'`; `result.nextAction.url` is non-empty string.
- [x] 5.5 Gate: `npm run typecheck` green + `npx playwright test --list` shows Slice 5 tests discoverable.
- [x] 5.6 Solo commit: `test(e2e): add OXXO, SPEI, and SafetyPay pending-shape flows`.

---

## Spec Requirement Traceability

| Task(s) | Spec Requirement |
|---------|-----------------|
| 0.1–0.9 | Harness scaffold; `npx playwright test` passes all-skipped without secrets |
| 1.1–1.13 | Slice 1: init, mount, unmount, getPaymentMethods, getApmBanks, registerCustomer, getTransaction, pollTransaction; @smoke tag; Skyflow iframe spike |
| 2.1–2.7 | Slice 2: pay card success (frictionless), declined, revealCardFields; @full tag |
| 3.1–3.5 | Slice 3: 3DS redirect (frictionless), 3DS embedded (DEV-2245 guard); @full tag |
| 4.1–4.6 | Slice 4: COF lifecycle ordered describe; @full tag; afterAll cleanup |
| 5.1–5.6 | Slice 5: OXXO/SPEI/SafetyPay pending-shape; @smoke tag |

## Parallelism Notes

- Phases 0 and each slice are strictly sequential (each builds on prior).
- Within a slice, tasks 0.x–1.x–2.x etc. are sequential (file creation → test writing → gate).
- The only internal parallelism opportunity: tasks 1.6 and 1.7 (getPaymentMethods / getApmBanks) are independent tests and can be written simultaneously, but they land in the same file so they are naturally concurrent within the dev session.
- The Skyflow spike (1.11) is a hard sequential gate before any Phase 2 work begins.
