# Delta for Public API Consistency

## MODIFIED Requirements

### Requirement: Customer is optional at initialization and required only for customer-dependent flows

The system MUST allow `createTonder()` to be called without `session.customer` so read-only flows can initialize on a return_url page. The system MUST still require customer context for customer-dependent operations: `pay()`, `enrollCard()`, `getCustomerCards()`, `removeCustomerCard()`, and any COF/customer path that derives from those operations. Those methods MUST throw `MISSING_CUSTOMER` before any network call when customer context is absent.
(Previously: `session.customer` was required broadly for pay and card operations, which implied initialization itself needed customer context.)

#### Scenario: Read-only initialization without customer is allowed

- GIVEN a merchant calls `createTonder()` with no `session.customer`
- WHEN the SDK initializes for read-only usage
- THEN initialization succeeds
- AND `getTransaction()` remains available for later use

#### Scenario: pay() still requires customer context

- GIVEN the SDK was created without `session.customer`
- WHEN a merchant calls `pay()`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no payment network call is made

#### Scenario: COF customer flows still require customer context

- GIVEN the SDK was created without `session.customer`
- WHEN a merchant calls `enrollCard()`, `getCustomerCards()`, or `removeCustomerCard()`
- THEN the SDK throws `MISSING_CUSTOMER`
- AND no customer/COF network call is made
