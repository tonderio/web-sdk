# Change: error-naming — no internal vendor in returned values; unify not-initialized

## Intent
Two follow-ups: (1) **no returned value may leak the internal vendor "Skyflow"** — public `AppError.code`s
and messages must be vendor-neutral; (2) **unify the "not initialized" error** (today `pay()` uses
`INVALID_PAYMENT_REQUEST` while `mountCardFields`/`revealCardFields` use `SKYFLOW_NOT_INITIALIZED`).

## Why
Skyflow is an internal implementation detail. Integrators catching `AppError` must never see a code or
message naming a third-party vendor. And "you must call init() first" should be one consistent code.

## Scope (in)
- **Rename error codes** (`ErrorKeyEnum` + all usages + tests):
  - `SKYFLOW_NOT_INITIALIZED` → **`NOT_INITIALIZED`** (generic "call init() first").
  - `SKYFLOW_LOAD_ERROR` → **`SECURE_FIELDS_LOAD_ERROR`**.
- **Unify not-initialized**: `pay()`'s lifecycle guard throws `NOT_INITIALIZED` (NOT
  `INVALID_PAYMENT_REQUEST`). Keep `INVALID_PAYMENT_REQUEST` only for genuine invalid input (missing
  amount/customer). So `pay`, `mountCardFields`, `revealCardFields` all throw `NOT_INITIALIZED` before
  `init()` completes.
- **Messages** (`messages.ts`): remove every "Skyflow" mention. e.g.
  `NOT_INITIALIZED`: 'The SDK is not initialized. Call init() before this operation.'
  `SECURE_FIELDS_LOAD_ERROR`: 'Failed to load the secure card fields library.'
  Audit all messages for any vendor name (Skyflow / Kushki) and neutralize.
- **README**: remove the "Skyflow" mention (the auto-load note) → "secure card fields script". (CSP
  guidance that must name `js.skyflow.com` / `cdn.kushkipagos.com` for the allowlist is a separate
  internal doc and stays — that's a domain the merchant must allowlist, not a returned value.)
- Audit `src/` for any other vendor string in a PUBLIC returned value (error code, message, or a field
  the integrator reads) and neutralize. The Skyflow CDN URL inside the loader and the
  `vault_id`/`vault_url` internal usage are fine (not returned to the integrator).

## Scope (out)
- No behavior change beyond the error code thrown for not-initialized. No new features.

## Approach
Mechanical rename + the one-line `pay()` guard change, tests updated alongside (keep `vitest run`
green at the same/adjusted count). The reveal-before-collect adapter case also uses `NOT_INITIALIZED`.

## Acceptance criteria
- `grep -rni "skyflow" src/shared/errors src/index.ts` → no matches (no vendor in error codes/messages).
- `grep -rn "SKYFLOW_NOT_INITIALIZED\|SKYFLOW_LOAD_ERROR" src` → none.
- `ErrorKeyEnum` has `NOT_INITIALIZED` + `SECURE_FIELDS_LOAD_ERROR`; no `SKYFLOW_*` member.
- `pay()` before ready → throws `AppError(NOT_INITIALIZED)`; `mountCardFields`/`revealCardFields` before
  ready → `NOT_INITIALIZED`; secure-fields library load failure → `SECURE_FIELDS_LOAD_ERROR`.
- README contains no "Skyflow" (the public guide); dist/index.d.ts shows the renamed codes.
- Gates green: typecheck, lint, build, `vitest run` (all pass), `npm audit` 0. Public surface camelCase.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR).
