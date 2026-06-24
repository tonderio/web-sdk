# Design: Pay Client Reference and Idempotency Key

## Technical Approach

Keep the Direct API boundary unchanged and tighten the public contract around `PayInput`. The change separates business reconciliation data from transport idempotency data so the SDK can send `client_reference` in the request body while mapping `idempotency_key` to the `X-Request-Id` header only when explicitly provided.

## Architecture Decisions

### Decision: Separate business reference from transport idempotency

| Choice                                   | Tradeoff                                                                       | Decision |
| ---------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Reuse `client_reference` for idempotency | Convenient but wrong semantics; breaks backend contract and merchant reporting | Rejected |
| Add explicit `idempotency_key`           | Clear intent, stable API, aligns with Direct API header contract               | Chosen   |

### Decision: Omit `X-Request-Id` when absent

| Choice                          | Tradeoff                                                                    | Decision |
| ------------------------------- | --------------------------------------------------------------------------- | -------- |
| Generate UUID fallback          | Hides caller intent and violates the requirement                            | Rejected |
| Use `client_reference` fallback | Conflates business reference with idempotency and contradicts backend facts | Rejected |
| Send no header unless requested | Predictable and compliant                                                   | Chosen   |

### Decision: Make `client_reference` required at the type level

| Choice        | Tradeoff                                                     | Decision |
| ------------- | ------------------------------------------------------------ | -------- |
| Keep optional | Leaves an ambiguous contract and allows incomplete payments  | Rejected |
| Require it    | Forces merchants to supply the business reference every time | Chosen   |

## Data Flow

```text
Merchant PayInput
  ├─ amount, currency, return_url, payment_method
  ├─ client_reference ────────────────→ `/api/v1/process/` body
  └─ idempotency_key ────────────────→ `X-Request-Id` header (optional)
```

The SDK still derives `customer.name` from `config.session.customer` and sends the rest of the payment body unchanged.

## File Changes

| File                                                                                 | Action | Description                                                                             |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| `openspec/specs/public-api/spec.md`                                                  | Modify | Update the public API contract for payment input fields.                                |
| `openspec/changes/pay-client-reference-and-idempotency-key/specs/public-api/spec.md` | Create | Delta spec for required `client_reference` and optional `idempotency_key`.              |
| `src/shared/types/index.ts`                                                          | Modify | Make `client_reference` required and add `idempotency_key`.                             |
| `src/core/services/direct-api.service.ts`                                            | Modify | Only send `X-Request-Id` when explicitly provided.                                      |
| `src/tonder.ts`                                                                      | Modify | Build the process body with required `client_reference` and optional `idempotency_key`. |
| `README.md`                                                                          | Modify | Document the new payment input contract and header behavior.                            |

## Interfaces / Contracts

```ts
export interface PayInput {
  amount: number;
  currency?: string;
  return_url: string;
  payment_method: PaymentMethod;
  metadata?: Record<string, unknown>;
  client_reference: string;
  idempotency_key?: string;
}
```

## Testing Strategy

| Layer       | What to Test                                                    | Approach                                                    |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit        | Required `client_reference`, optional `idempotency_key` mapping | Type-level and service tests for body/header composition    |
| Integration | `/api/v1/process/` request shape                                | Assert header is present only when `idempotency_key` exists |
| E2E         | Merchant-facing `pay()` behavior                                | Verify payment still succeeds with explicit reference data  |

## Migration / Rollout

No runtime migration required. This is a contract tightening change and should be released with documentation updates.

## Open Questions

- [ ] None.
