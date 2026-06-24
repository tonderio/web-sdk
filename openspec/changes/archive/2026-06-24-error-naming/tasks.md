# Tasks: error-naming (mechanical rename + unify; keep suite green)

## 1. Audit
- [x] 1.1 `grep -rni "skyflow\|kushki" src/` — list every occurrence; classify each as (a) PUBLIC
  returned value (error code/message/integrator-read field → must neutralize) or (b) internal
  (loader CDN URL, vault_id usage, adapter internals → keep). Only (a) is in scope.

## 2. Rename codes
- [x] 2.1 `src/shared/errors/ErrorKeyEnum.ts` — `SKYFLOW_NOT_INITIALIZED` → `NOT_INITIALIZED`;
  `SKYFLOW_LOAD_ERROR` → `SECURE_FIELDS_LOAD_ERROR`.
- [x] 2.2 `src/shared/errors/messages.ts` — update the two messages; remove ALL "Skyflow" mentions from
  every message (vendor-neutral wording).
- [x] 2.3 Update all usages across `src/` (skyflow.adapter.ts, tonder.ts, etc.) + their tests.

## 3. Unify not-initialized
- [x] 3.1 `src/tonder.ts` — `pay()` lifecycle guard throws `AppError(NOT_INITIALIZED)` (was
  `INVALID_PAYMENT_REQUEST`). Keep `INVALID_PAYMENT_REQUEST` for invalid input (amount/customer).
- [x] 3.2 Update `src/tonder.pay.test.ts` — the before-ready test asserts `NOT_INITIALIZED`.

## 4. README
- [x] 4.1 Root `README.md` — remove the "Skyflow" mention (auto-load note) → "secure card fields
  script". No vendor name in the public guide.

## 5. Verify
- [x] 5.1 `grep -rni "skyflow" src/shared/errors src/index.ts README.md` → none.
  `grep -rn "SKYFLOW_NOT_INITIALIZED\|SKYFLOW_LOAD_ERROR" src` → none.
- [x] 5.2 `npm run typecheck`, `npm run lint`, `npm run build` (d.ts shows `NOT_INITIALIZED`,
  `SECURE_FIELDS_LOAD_ERROR`), `vitest run` (all pass), `npm audit` (0).
- [x] 5.3 Work-unit commits on `feature/DEV-2245` (e.g. `refactor: vendor-neutral error codes`,
  `refactor: unify NOT_INITIALIZED for pay and mount`).
