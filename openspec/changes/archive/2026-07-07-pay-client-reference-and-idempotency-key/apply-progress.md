# Apply Progress: Pay Client Reference and Idempotency Key

## Change

`pay-client-reference-and-idempotency-key`

## Mode

Strict TDD

## Completed Tasks

- [x] 1.1 Update `src/shared/types/index.ts` so `PayInput.client_reference` is required and `PayInput.idempotency_key` is optional.
- [x] 1.2 Update `openspec/specs/public-api/spec.md` and `openspec/changes/pay-client-reference-and-idempotency-key/specs/public-api/spec.md` to reflect the required business reference and separate idempotency key.
- [x] 2.1 Update `src/tonder.ts` to require `client_reference` in `buildProcessBody()` and pass through `idempotency_key` when present.
- [x] 2.2 Update `src/core/services/direct-api.service.ts` so `X-Request-Id` is added only when the caller supplies an idempotency key.
- [x] 2.3 Remove any fallback path that derives idempotency from `client_reference` or generates a random UUID.
- [x] 3.1 Add/adjust unit tests for `pay()` body composition: required `client_reference`, optional `idempotency_key`, and no header when omitted.
- [x] 3.2 Add/adjust Direct API tests for `POST /api/v1/process/` to assert the `X-Request-Id` contract.
- [x] 3.3 Update README and JSDoc examples to match the new public API.

## TDD Cycle Evidence

| Task | Test File                                                                                                                 | Layer            | Safety Net                                            | RED                                                                                                   | GREEN                                                                    | TRIANGULATE                                                              | REFACTOR                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1.1  | `src/tonder.pay.test.ts`                                                                                                  | Unit/type-facing | ✅ 69/69 focused baseline                             | ✅ Tests updated to require `client_reference` in pay helpers and type-facing examples                | ✅ Focused tests passed                                                  | ✅ Runtime missing-reference guard added for blank reference             | ✅ Removed obsolete UUID spy/import                                                             |
| 1.2  | `openspec/specs/public-api/spec.md`, `openspec/changes/pay-client-reference-and-idempotency-key/specs/public-api/spec.md` | Spec/docs        | N/A (spec artifact)                                   | ✅ Delta spec already described required reference and idempotency split                              | ✅ Main spec updated to match delta                                      | ➖ Documentation-only spec sync                                          | ✅ Wording aligned to snake_case customer fields                                                |
| 2.1  | `src/tonder.pay.test.ts`                                                                                                  | Unit             | ✅ 69/69 focused baseline                             | ✅ Expected `idempotency_key` to be passed as `X-Request-Id` and body to retain `client_reference`    | ✅ Focused tests passed                                                  | ✅ Added omitted-idempotency case to prove no fallback header            | ✅ `buildProcessBody()` now always carries `client_reference` and keeps idempotency out of body |
| 2.2  | `src/core/services/direct-api.service.test.ts`                                                                            | Unit             | ✅ 69/69 focused baseline                             | ✅ Added service test for omitted `X-Request-Id` when request id is absent                            | ✅ Focused tests passed                                                  | ✅ Existing provided-request-id test covers present header path          | ✅ Header object built conditionally                                                            |
| 2.3  | `src/tonder.pay.test.ts`, `src/tonder.handleRequiresAction.test.ts`                                                       | Unit             | ✅ 69/69 focused baseline                             | ✅ Tests no longer expect generated UUID headers                                                      | ✅ Focused tests passed                                                  | ✅ Grep confirmed no remaining `crypto.randomUUID` usage in source/tests | ✅ Removed obsolete spies and unused imports                                                    |
| 3.1  | `src/tonder.pay.test.ts`, `src/tonder.snake-case-contract.test.ts`                                                        | Unit             | ✅ Focused tests passing before docs/spec persistence | ✅ Tests asserted required body `client_reference`, optional idempotency, and missing-header behavior | ✅ 4 focused files passed plus added facade idempotency header assertion | ✅ Saved-card and card flows both verify no fallback header              | ✅ Shared test helpers updated                                                                  |
| 3.2  | `src/core/services/direct-api.service.test.ts`                                                                            | Unit             | ✅ Focused service test baseline                      | ✅ Added absent-header service test                                                                   | ✅ 4 focused files passed plus added facade idempotency header assertion | ✅ Present and absent header paths both covered                          | ✅ Request-id parameter is optional                                                             |
| 3.3  | `README.md`, JSDoc in `src/shared/types/index.ts`, `src/core/services/direct-api.service.ts`, `src/tonder.ts`             | Docs             | N/A (docs)                                            | ✅ Tests/spec established contract before docs update                                                 | ✅ Lint/build passed after docs/JSDoc updates                            | ➖ Documentation examples updated across multiple payment methods        | ✅ README describes no UUID/fallback behavior                                                   |

## Validation Commands

- `npm test -- src/tonder.pay.test.ts src/core/services/direct-api.service.test.ts` — initial safety net: 69/69 passed.
- `npm test -- src/tonder.pay.test.ts src/core/services/direct-api.service.test.ts` — RED check after test updates: failed because production still generated `X-Request-Id`.
- `npm test -- src/tonder.pay.test.ts src/core/services/direct-api.service.test.ts` — GREEN: 70/70 passed.
- `npm test -- src/tonder.handleRequiresAction.test.ts` — 15/15 passed.
- `npm test -- src/tonder.pay.test.ts src/core/services/direct-api.service.test.ts src/tonder.handleRequiresAction.test.ts src/tonder.snake-case-contract.test.ts` — 89/89 passed.
- `npm test` — 30 files / 286 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed after removing obsolete `beforeEach` imports.
- `npm run build` — passed.

## Deviations

None — implementation matches the design. One runtime validation guard was added so JavaScript callers also receive `INVALID_PAYMENT_REQUEST` when `client_reference` is blank, aligning runtime behavior with the required public contract.

## Issues

None.

## Status

8/8 tasks complete. Ready for `sdd-verify`.
