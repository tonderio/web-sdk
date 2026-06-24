# Design: Optional Customer and README Coverage

## Technical Approach

Keep the existing runtime behavior as the source of truth: initialization may omit `session.customer`, while customer-dependent methods continue to enforce `MISSING_CUSTOMER`. Document the read-only `getTransaction()` path as valid on return_url pages, and align README coverage with the current public API contract for customization and presentation callbacks.

## Architecture Decisions

### Decision: Initialization is separated from customer-required flows

**Choice**: `createTonder()` stays legal without customer context; only stateful customer/COF methods guard with `MISSING_CUSTOMER`.
**Alternatives considered**: Requiring customer at init; introducing a separate read-only factory.
**Rationale**: Preserves return_url reconciliation and avoids fragmenting the facade.

### Decision: Read-only transaction access is explicitly speced

**Choice**: `getTransaction()` is documented as a customer-free read path.
**Alternatives considered**: Implied behavior only in README; broadening the customer requirement everywhere.
**Rationale**: The return_url page has no shopper context; the contract must say that plainly.

### Decision: Docs coverage stays aligned to existing event names

**Choice**: Keep presentation callback coverage under `events.presentation` and reflect customization/current functionality in docs-oriented wording.
**Alternatives considered**: Adding new callback shapes or a docs-only API layer.
**Rationale**: The public API is already settled; docs should explain it clearly, not invent new surface.

## Data Flow

createTonder() ──→ init ──→ read-only getTransaction(id)
│ │
│ └── works without session.customer
└── customer-dependent methods ──→ MISSING_CUSTOMER guard when absent

## File Changes

| File                                                                                        | Action | Description                                             |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `openspec/changes/optional-customer-and-readme-coverage/proposal.md`                        | Create | Scope and spec contract                                 |
| `openspec/changes/optional-customer-and-readme-coverage/specs/public-api/spec.md`           | Create | Narrow customer requirement to customer-dependent flows |
| `openspec/changes/optional-customer-and-readme-coverage/specs/sdk-return-contracts/spec.md` | Create | Add customer-free read-only transaction access          |
| `openspec/changes/optional-customer-and-readme-coverage/tasks.md`                           | Create | Implementation/documentation plan                       |

## Interfaces / Contracts

```ts
// Contract intent only; no source changes in this change
createTonder(config: TonderConfig): Tonder

// Allowed without session.customer
getTransaction(id: string): Promise<RawTransaction>

// Still guarded by MISSING_CUSTOMER when session.customer is absent
pay(...): Promise<RawTransaction>
enrollCard(...): Promise<EnrollResult>
getCustomerCards(): Promise<Card[]>
removeCustomerCard(...): Promise<void>
```

## Testing Strategy

| Layer | What to Test                                   | Approach                                                                      |
| ----- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Unit  | Optional customer/read-only transaction access | Add/adjust tests around `createTonder()` and `getTransaction()`               |
| Unit  | Customer guard boundaries                      | Add/adjust tests for `pay()` and saved-card methods without customer          |
| Docs  | README completeness                            | Review examples for optional customer, customization, and presentation events |

## Migration / Rollout

No migration required. This is a contract, tests, and documentation alignment change only.

## Open Questions

None. The runtime public callback names are `events.presentation.on_open` and `events.presentation.on_close`.
