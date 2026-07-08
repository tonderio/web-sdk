# SDK Return Contracts Specification

## Purpose

Defines the public return shape of every SDK method fed by the Direct API
(`pay`, `getTransaction`, `getPaymentMethods`, `getPaymentMethodBanks`). The SDK returns the backend body as a raw passthrough
(snake_case, verbatim) instead of remapping it into a divergent camelCase
model. `amount` coercion and `psp_response` stripping are the only
normalizations applied. `pay()` returns the bare raw transaction — the same
shape as `getTransaction` — with no wrapper object and no
`outcome` field; `transaction.status` (the backend's own raw status string)
is the single source of truth for the payment's state. COF/vault methods are
out of scope — they keep their existing camelCase contract.

## Requirements

### Requirement: Raw Transaction Passthrough

All Direct-API-fed public methods (`pay`, `getTransaction`,
`getPaymentMethods`, `getPaymentMethodBanks`) MUST return the
transaction body exactly as received from the backend (snake_case field
names, no renaming, no flattening, no remapping to a camelCase model),
except for the two normalizations defined in this spec (`amount` coercion,
`psp_response` stripping).

#### Scenario: Raw fields pass through unchanged

- GIVEN the backend transaction body includes `next_action`, `clabe`, and
  `bank_name`
- WHEN any Direct-API-fed method returns that transaction
- THEN the returned transaction includes `next_action`, `clabe`, and
  `bank_name` exactly as sent by the backend, under those same field names

#### Scenario: No SDK-owned wrapper fields on the result

- GIVEN a caller receives a result from `pay` or `getTransaction`
- WHEN the result is inspected
- THEN it MUST NOT contain top-level `nextAction`, `transactionId`,
  `declineCode`, `declineReason`, `paymentInstructions`, `voucher`,
  `clabe`, or `bankName` as SDK-owned fields

### Requirement: Amount Coercion

The system MUST coerce the `amount` field to a JavaScript `number` in every
returned transaction, regardless of whether the backend sent it as a number
or a numeric string. This is the only value-level transformation applied to
the raw transaction body.

#### Scenario: Amount returned as string by backend

- GIVEN the backend responds to a transaction read with `"amount": "150"`
  (string)
- WHEN the SDK returns that transaction to the caller
- THEN `transaction.amount` is the number `150`, not the string `"150"`

#### Scenario: Amount already a number

- GIVEN the backend responds with `"amount": 200` (number)
- WHEN the SDK returns that transaction
- THEN `transaction.amount` is the number `200`, unchanged

### Requirement: psp_response Stripped

The system MUST remove the `psp_response` field from any transaction body
before returning it to the caller, if the backend included it.

#### Scenario: psp_response present in backend response

- GIVEN the backend transaction body includes a `psp_response` object
- WHEN the SDK returns that transaction
- THEN the returned transaction does not contain a `psp_response` key

#### Scenario: psp_response absent in backend response

- GIVEN the backend transaction body does not include `psp_response`
- WHEN the SDK returns that transaction
- THEN the returned transaction still does not contain a `psp_response`
  key (no-op)

### Requirement: pay() Returns Bare Raw Transaction

`pay()` MUST return the raw transaction directly — the exact same shape
returned by `getTransaction` (subject only to
`amount` coercion and `psp_response` stripping). There is no wrapper
object and no `outcome` field. `transaction.status` (the backend's own raw
status string, e.g. `"Success"`, `"Declined"`, `"Pending"`) is the single
source of truth for the payment's state; the SDK never renames, overrides,
or duplicates it into a separate signal. The `requires_action` backend
status MUST NOT be returned to the caller as a still-pending final result
in either 3DS mode: for embedded 3DS the SDK resolves it internally via
polling before returning the final transaction; for APM/SPEI
(redirect-style) flows the SDK returns the raw `/process` transaction
(typically status `"Pending"`) while settlement completes asynchronously,
and the caller is expected to poll or read it later for the final state.

Status-value normalization — i.e. which raw status strings mean "paid",
"declined", or "pending" — is documented in the SDK README as guidance for
integrators. It is NOT a field the SDK adds to the result and NOT a helper
function shipped by this change.

#### Scenario: Frictionless card payment succeeds

- GIVEN a card payment that does not require 3DS challenge
- WHEN `pay()` completes
- THEN the result is the raw, successful backend transaction, with
  `transaction.status` equal to the backend's success status (for example
  `"Success"`)

#### Scenario: Frictionless card payment is declined

- GIVEN a card payment that does not require 3DS challenge
- WHEN the backend declines the payment
- THEN `pay()` resolves with the raw backend transaction, with
  `transaction.status` equal to the backend's decline status (for example
  `"Declined"`)

#### Scenario: Embedded 3DS challenge resolves to success

- GIVEN a card payment that triggers an embedded 3DS challenge
- WHEN the challenge completes successfully and the SDK's internal polling
  confirms the final backend status
- THEN `pay()` resolves with the raw backend transaction reflecting the
  final status (for example `"Success"`), never a still-`"Pending"` or
  `requires_action` intermediate state

#### Scenario: Embedded 3DS challenge resolves to decline

- GIVEN a card payment that triggers an embedded 3DS challenge
- WHEN the challenge fails or the backend declines after polling
- THEN `pay()` resolves with the raw backend transaction reflecting the
  final decline status (for example `"Declined"`), and the transaction
  carries the backend's own decline fields (for example `decline_code`,
  `decline_reason`) if the backend included them

#### Scenario: Redirect-style payment returns the pending process transaction

- GIVEN a payment method that requires a redirect (for example a
  redirect-based 3DS flow)
- WHEN `pay()` resolves after creating the `/process` transaction but
  before the redirect completes
- THEN the result is the raw `/process` transaction with `status`
  `"Pending"`, before the SDK navigates the browser away

#### Scenario: APM or SPEI payment is asynchronous

- GIVEN an APM or SPEI payment method is used
- WHEN the backend responds with a pending/async settlement state
- THEN `pay()` resolves with the raw backend transaction, `status`
  `"Pending"`, carrying settlement data such as `next_action` (containing
  the payflow URL), `clabe`, or `bank_name` exactly as sent by the
  backend, when present

#### Scenario: requires_action never reaches the caller as a final embedded-3DS result

- GIVEN the backend's transaction status is `requires_action` at an
  intermediate point during an embedded 3DS flow
- WHEN `pay()` resolves
- THEN the caller never observes `transaction.status === 'requires_action'`
  as the final result of an embedded 3DS flow; the SDK has already
  resolved the flow to a final status (e.g. `"Success"`/`"Declined"`)
  before returning

### Requirement: Transaction Reads Return Bare Transaction

`getTransaction` MUST return the raw transaction
directly, with the same bare shape as `pay()`. These are read operations
reporting the current backend state, not payment operations.

#### Scenario: Reading a transaction by id

- GIVEN a transaction exists in the backend
- WHEN the caller invokes `getTransaction` with its id
- THEN the result is the raw transaction body (subject to `amount`
  coercion and `psp_response` stripping), with no wrapper object around it

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

### Requirement: COF Methods Keep camelCase

`enrollCard`, `getCustomerCards`, and `removeCustomerCard` are vault-fed,
not Direct-API-fed, and MUST NOT be affected by the raw-passthrough policy.
Their return shapes remain camelCase (`EnrollResult`, `Card[]`, `void`
respectively) and their behavior is unchanged by this specification.

#### Scenario: enrollCard result stays camelCase

- GIVEN a successful card enrollment
- WHEN `enrollCard()` resolves
- THEN the result is a camelCase `EnrollResult`, not a raw backend body

#### Scenario: getCustomerCards result stays camelCase

- GIVEN a customer with stored cards
- WHEN `getCustomerCards()` resolves
- THEN the result is a camelCase `Card[]`, unchanged from current behavior

### Requirement: No Legacy Wrapper Fields

The system MUST NOT expose `nextAction`, `transactionId`, `declineCode`,
`declineReason`, `paymentInstructions`, `voucher`, `clabe`, `bankName`,
`outcome`, or any `mapPendingResult`-derived shape as SDK-owned top-level
fields on any public result. `pay()` MUST NOT return a wrapper object of
any kind around the transaction — its return value IS the transaction.
Equivalent data, when the backend provides it, is only accessible inside
the transaction body under the backend's own snake_case field names (for
example `transaction.clabe`, `transaction.status`).

#### Scenario: Legacy field absent even when backend sends equivalent data

- GIVEN the backend includes `clabe` inside the transaction body
- WHEN `pay()` returns a pending transaction
- THEN the result has no top-level `clabe` field; the value is only
  present at `transaction.clabe`

#### Scenario: No outcome field or wrapper on pay() result

- GIVEN any successful call to `pay()`
- WHEN the result is inspected
- THEN it has no `outcome` field and is not wrapped in any object with a
  `transaction` property; the result itself is the raw transaction, and
  its state is read from `transaction.status`
