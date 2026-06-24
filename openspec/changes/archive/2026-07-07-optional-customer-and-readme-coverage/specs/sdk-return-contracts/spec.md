# Delta for SDK Return Contracts

## ADDED Requirements

### Requirement: Transaction reads are valid without customer/session context

`getTransaction()` MUST remain callable on a return_url page even when the SDK was initialized without `session.customer`. This requirement applies to read-only transaction reconciliation only; it does not change the customer guard rules for payment or COF/customer mutation methods.

#### Scenario: getTransaction() works without customer context

- GIVEN the SDK was created without `session.customer`
- AND the merchant is on a return_url page with a transaction id
- WHEN the merchant calls `getTransaction(id)`
- THEN the SDK returns the raw transaction body
- AND no `MISSING_CUSTOMER` error is thrown

#### Scenario: Read-only access does not relax customer-dependent guards

- GIVEN the SDK was created without `session.customer`
- WHEN the merchant calls `pay()` or a COF/customer mutation method
- THEN the existing `MISSING_CUSTOMER` guard still applies
- AND the read-only transaction contract does not bypass that guard
