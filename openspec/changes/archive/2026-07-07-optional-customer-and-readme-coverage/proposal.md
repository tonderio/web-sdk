# Proposal: Optional Customer and README Coverage

## Intent

Align the spec with the implemented SDK behavior: `createTonder()` should remain usable without `session.customer` for read-only flows like `getTransaction()` on return_url pages, while customer-dependent flows still guard correctly. Also refresh public docs coverage for customization and presentation callbacks.

## Scope

### In Scope

- Make the public contract explicit: `session.customer` is optional at SDK creation for read-only usage.
- Keep `MISSING_CUSTOMER` guards only on customer-dependent public flows: `pay()`, `enrollCard()`, `getCustomerCards()`, `removeCustomerCard()`, and their COF/customer paths.
- Add or update tests that prove `getTransaction()` works without customer context and customer-dependent methods still guard.
- Expand README coverage for optional customer usage, `customization.card_fields`, and `events.presentation.on_open` / `on_close`.

### Out of Scope

- Changing payment processing semantics.
- Adding new presentation callbacks or aliases.
- Reworking payment or COF behavior beyond the customer guard boundary.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `public-api`: `createTonder()` no longer requires `session.customer`; customer requirement narrows to customer-dependent operations only.
- `sdk-return-contracts`: read-only transaction reads must remain available without customer/session context.

## Approach

Update the existing public API delta to separate initialization from customer-required operations, and add a read-path contract confirming `getTransaction()` is valid on a return_url page without customer context. Keep presentation behavior documented through the existing presentation spec contract.

## Affected Areas

| Area                                          | Impact   | Description                                                                      |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `openspec/specs/public-api/spec.md`           | Modified | Narrow customer requirement to customer-dependent flows only                     |
| `openspec/specs/sdk-return-contracts/spec.md` | Modified | Clarify customer-free read-only transaction access                               |
| `src/shared/types/index.ts`                   | Modified | Document optional customer/session behavior                                      |
| `src/tonder*.test.ts`                         | Modified | Add contract tests for optional customer/read-only flows                         |
| `README.md`                                   | Modified | Expand public docs for optional customer, customization, and presentation events |

## Risks

| Risk                                          | Likelihood | Mitigation                                      |
| --------------------------------------------- | ---------- | ----------------------------------------------- |
| Spec drift from current implementation        | Low        | Align deltas to the verified SDK behavior       |
| Hidden customer dependency in read-only flows | Low        | Restrict guards to stateful public methods only |

## Rollback Plan

Revert the OpenSpec delta files and SDK/README edits if the customer/return_url contract is not accepted. No data migration is required.

## Dependencies

- Existing `public-api`, `sdk-return-contracts`, and `presentation-mode` specs.

## Success Criteria

- [ ] The spec and README no longer imply `session.customer` is required at `createTonder()` time.
- [ ] Tests prove `getTransaction()` can be used without customer context.
- [ ] Tests prove customer-dependent methods still throw `MISSING_CUSTOMER`.
- [ ] README documents `customization.card_fields` and `events.presentation.on_open` / `on_close`.
