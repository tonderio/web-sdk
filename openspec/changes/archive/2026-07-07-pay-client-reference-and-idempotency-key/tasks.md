# Tasks: Pay Client Reference and Idempotency Key

## Review Workload Forecast

| Field                   | Value       |
| ----------------------- | ----------- |
| Estimated changed lines | 80-140      |
| 400-line budget risk    | Low         |
| Chained PRs recommended | No          |
| Suggested split         | Single PR   |
| Delivery strategy       | ask-on-risk |
| Chain strategy          | pending     |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                        | Likely PR | Notes                                |
| ---- | --------------------------- | --------- | ------------------------------------ |
| 1    | Contract and runtime update | PR 1      | Types, request mapping, docs, tests. |

## Phase 1: Contract Update

- [x] 1.1 Update `src/shared/types/index.ts` so `PayInput.client_reference` is required and `PayInput.idempotency_key` is optional.
- [x] 1.2 Update `openspec/specs/public-api/spec.md` and `openspec/changes/pay-client-reference-and-idempotency-key/specs/public-api/spec.md` to reflect the required business reference and separate idempotency key.

## Phase 2: Runtime Behavior

- [x] 2.1 Update `src/tonder.ts` to require `client_reference` in `buildProcessBody()` and pass through `idempotency_key` when present.
- [x] 2.2 Update `src/core/services/direct-api.service.ts` so `X-Request-Id` is added only when the caller supplies an idempotency key.
- [x] 2.3 Remove any fallback path that derives idempotency from `client_reference` or generates a random UUID.

## Phase 3: Verification

- [x] 3.1 Add/adjust unit tests for `pay()` body composition: required `client_reference`, optional `idempotency_key`, and no header when omitted.
- [x] 3.2 Add/adjust Direct API tests for `POST /api/v1/process/` to assert the `X-Request-Id` contract.
- [x] 3.3 Update README and JSDoc examples to match the new public API.
