# Verification Report: Pay Client Reference and Idempotency Key

**Change**: pay-client-reference-and-idempotency-key  
**Mode**: Strict TDD  
**Verdict**: PASS

## Completeness

| Metric           | Value   |
| ---------------- | ------- |
| Tasks total      | 6       |
| Tasks complete   | 6       |
| Tasks incomplete | 0       |
| Proposal         | Present |
| Specs            | Present |
| Design           | Present |
| Apply progress   | Present |

## Runtime Evidence

| Command                                                                           | Result                      |
| --------------------------------------------------------------------------------- | --------------------------- |
| `npm test -- src/tonder.pay.test.ts src/core/services/direct-api.service.test.ts` | PASS — 2 files / 71 tests   |
| `npm test`                                                                        | PASS — 30 files / 287 tests |
| `npm run typecheck -- --pretty false`                                             | PASS                        |
| `npm run lint`                                                                    | PASS                        |
| `npm run build`                                                                   | PASS                        |
| `git diff --check`                                                                | PASS                        |

## Spec Compliance Matrix

| Scenario                                                      | Evidence                                                                                                        | Status |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| `client_reference` is mandatory                               | `PayInput.client_reference` is required and `pay()` validates blank/missing values as `INVALID_PAYMENT_REQUEST` | PASS   |
| `idempotency_key` is optional and maps only to `X-Request-Id` | `src/tonder.pay.test.ts` asserts facade maps `idempotency_key` to header and keeps it out of body               | PASS   |
| Missing `idempotency_key` omits `X-Request-Id`                | `src/core/services/direct-api.service.test.ts` and `src/tonder.pay.test.ts` cover no-header behavior            | PASS   |
| No fallback from `client_reference` to idempotency            | Tests assert `client_reference` remains in body while `X-Request-Id` is absent without `idempotency_key`        | PASS   |
| No random UUID generation                                     | Grep/source inspection confirms `crypto.randomUUID` no longer appears in SDK source/tests                       | PASS   |

## Design Coherence

| Decision                                     | Evidence                                                          | Status |
| -------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Separate business reference from idempotency | `client_reference` is body-only; `idempotency_key` is header-only | PASS   |
| Omit `X-Request-Id` when absent              | Service builds headers conditionally                              | PASS   |
| Make `client_reference` required             | Types, runtime validation, README, and tests align                | PASS   |

## TDD Compliance

| Check                  | Result | Details                                                               |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| TDD Evidence reported  | ✅     | Found in `apply-progress.md`                                          |
| RED confirmed          | ✅     | Worker recorded failing focused tests before production change        |
| GREEN confirmed        | ✅     | Focused and full suites pass                                          |
| Triangulation adequate | ✅     | Service and facade tests cover header-present and header-absent paths |
| Safety net             | ✅     | Full test/typecheck/lint/build executed                               |

## Assertion Quality

**Assertion quality**: ✅ Assertions verify body/header behavior and error codes; no tautologies or smoke-only checks found in changed tests.

## Issues

### CRITICAL

None.

### WARNING

None.

### SUGGESTION

- Consider documenting backend idempotency cache namespace/TTL in Direct API docs if merchants need retry-window guarantees.

## Final Verdict

PASS — the SDK now separates `client_reference` from explicit `idempotency_key` and matches the verified zplit-back Direct API idempotency contract.
