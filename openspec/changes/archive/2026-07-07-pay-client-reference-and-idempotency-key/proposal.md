# Proposal: Pay Client Reference and Idempotency Key

## Intent

Make payment inputs align with backend contract and business semantics. `client_reference` is a merchant/business reference used across dashboards, exports, webhooks, and transaction records, so it must always be present. Idempotency must be explicit and separate: only `idempotency_key` maps to the Direct API `X-Request-Id` header.

## Scope

### In Scope

- Make `PayInput.client_reference` required.
- Add optional `PayInput.idempotency_key` and send it as `X-Request-Id` on `/api/v1/process/`.
- Omit `X-Request-Id` entirely when `idempotency_key` is absent; no UUID generation and no fallback from `client_reference`.
- Update public API spec and docs contract to reflect the separation.

### Out of Scope

- Backend behavior changes.
- Source code or README edits in this change set.
- Any change to transaction return shapes or customer handling.

## Capabilities

### New Capabilities

- `payment-idempotency`: explicit payment idempotency key handling separate from business reference.

### Modified Capabilities

- `public-api`: `PayInput` shape changes; `client_reference` becomes required and `idempotency_key` is added.

## Approach

Update the public API contract to enforce the business-reference/idempotency split. Keep the SDK behavior aligned with the existing Direct API endpoint `/api/v1/process/` and the backend rule that `X-Request-Id` is the sole idempotency mechanism.

## Affected Areas

| Area                                                                                 | Impact   | Description                                                              |
| ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| `openspec/specs/public-api/spec.md`                                                  | Modified | Document the new required/optional payment input fields and constraints. |
| `openspec/changes/pay-client-reference-and-idempotency-key/specs/public-api/spec.md` | New      | Delta spec for payment input contract and header mapping.                |

## Risks

| Risk                                                 | Likelihood | Mitigation                                                   |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| Merchants rely on the old fallback behavior          | High       | Make the contract explicit and document the break clearly.   |
| Confusion between business reference and idempotency | Medium     | Separate the names and describe the backend mapping plainly. |

## Rollback Plan

Revert the spec delta if the contract change needs to be deferred. No runtime migration is included in this planning change.

## Dependencies

- Existing Direct API `/api/v1/process/` contract and `X-Request-Id` header behavior.

## Success Criteria

- [ ] The spec clearly requires `client_reference` on all pay requests.
- [ ] The spec clearly defines `idempotency_key` as the only source of `X-Request-Id`.
- [ ] The fallback from `client_reference` to `X-Request-Id` is explicitly prohibited.
