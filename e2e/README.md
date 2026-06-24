# E2E suite (Playwright)

Real-browser, real-network integration tests for `@tonder.io/web-sdk` against
**Tonder STAGE**. They complement the 240+ unit tests by exercising the seams
unit tests cannot reach: Skyflow cross-origin collect/reveal iframes, the live
Direct API contract, real 3DS navigation, and the embedded `embedded_completion`
postMessage path.

> **Test-only. No production `src/` code is touched.** If a test reveals a real
> SDK bug, it is FLAGGED in the apply-progress notes — never silently patched.

## CI-safe by default (no secrets in the repo)

Every test is wrapped in `skipIfNoStageCreds()`. With no credentials set,
`npx playwright test` runs **all-skipped, green, zero errors**. The suite only
runs for real when you provide STAGE credentials via environment variables.

## Run

```bash
# Build the IIFE bundle the fixture loads, then run the suite.
npm run test:e2e            # = pretest:e2e (npm run build) + playwright test

# Or directly (assumes dist/tonder-web-sdk.js already built):
npx playwright test
npx playwright test --list  # discover tests without running them
```

### Filter by tag

- `@smoke` — fast, no real charge completes (reads, mount/unmount, APM pending).
- `@full` — real charge / Skyflow iframe fill (card pay, 3DS, COF).
- `@spike` — go/no-go probes (e.g. Skyflow iframe fill viability).

```bash
npx playwright test --grep @smoke   # smoke gate (PR-friendly)
npx playwright test --grep @full    # full integration
```

## Required environment variables

Mandatory for the suite to actually run (absent → all tests skip):

| Variable                               | Purpose                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `TONDER_STAGE_API_KEY`                 | Public publishable key for a STAGE business. Gate for the whole suite. |
| `TONDER_STAGE_SECURE_TOKEN_ENDPOINT`   | URL that mints a secure token (COF/card-manage flows).                 |
| `TONDER_STAGE_CUSTOMER_EMAIL`          | Deterministic test customer email.                                     |
| `TONDER_SKYFLOW_PAN_FRICTIONLESS`      | Frictionless success test PAN.                                         |
| `TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE` | 3DS-triggering test PAN.                                               |
| `TONDER_SKYFLOW_PAN_DECLINE`           | Decline test PAN.                                                      |

Optional:

| Variable                      | Purpose                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `TONDER_STAGE_EXISTING_TX_ID` | Pre-existing transaction id for the `getTransaction` smoke test.                           |
| `TONDER_DEVS_2245_ON_STAGE`   | Set to any value to un-`fixme` the embedded 3DS test (DEV-2245 deployed on stage-payflow). |
| `E2E_PORT`                    | Override the fixture server port (default `4321`).                                         |
| `CI`                          | When set: 2 retries, GitHub reporter, no server reuse.                                     |

Example:

```bash
export TONDER_STAGE_API_KEY="pk_stage_..."
export TONDER_STAGE_SECURE_TOKEN_ENDPOINT="https://your-backend/stage/secure-token"
export TONDER_STAGE_CUSTOMER_EMAIL="e2e+test@stage.tonder.io"
export TONDER_SKYFLOW_PAN_FRICTIONLESS="<your-frictionless-test-pan>"
export TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE="<your-3ds-challenge-test-pan>"
export TONDER_SKYFLOW_PAN_DECLINE="<your-decline-test-pan>"
npm run test:e2e
```

## How it works

- `e2e/fixture/checkout.html` loads `dist/tonder-web-sdk.js` (exposes
  `window.Tonder`) and declares every Skyflow collect/reveal container plus the
  `#tonder-3ds` embedded container. It runs NO SDK calls on its own.
- `e2e/support/server.mjs` is a zero-dependency Node static server (serves the
  fixture and `dist/`). No `npx serve` download — works offline / locked-down CI.
- `e2e/support/fixtures.ts` extends Playwright `test` with a `tonder` harness
  that drives `window.Tonder` over `page.evaluate`, injects credential callbacks
  via `page.exposeFunction`, and fills Skyflow iframes via
  `frameLocator`.
- Workers are serial (`workers: 1`): STAGE state (customers, cards, txns) is
  shared and order-sensitive.

## Setup (first time)

```bash
npm install                       # installs @playwright/test
npx playwright install chromium   # Chromium only
```
