# Delta for SDK Return Contracts

## MODIFIED Requirements

### Requirement: Raw Transaction Passthrough

All transaction-returning public methods (`pay`, `getTransaction`) MUST return
the transaction body exactly as received from the backend (snake_case field
names, no renaming, no flattening, no remapping to a camelCase model), except
for the two normalizations defined in this spec (`amount` coercion,
`psp_response` stripping).

(Previously: this requirement still mentioned the removed public
`pollTransaction` method.)

#### Scenario: Raw fields pass through unchanged

- GIVEN the backend transaction body includes `next_action`, `clabe`, and
  `bank_name`
- WHEN any transaction-returning public method returns that transaction
- THEN the returned transaction includes `next_action`, `clabe`, and
  `bank_name` exactly as sent by the backend, under those same field names

#### Scenario: No SDK-owned wrapper fields on the result

- GIVEN a caller receives a result from `pay` or `getTransaction`
- WHEN the result is inspected
- THEN it MUST NOT contain top-level `nextAction`, `transactionId`,
  `declineCode`, `declineReason`, `paymentInstructions`, `voucher`, or
  `bankName` as SDK-owned fields

#### Scenario: Public transaction fields stay snake_case

- GIVEN a caller receives a transaction from `pay` or `getTransaction`
- WHEN the result is inspected
- THEN backend fields such as `decline_code`, `decline_reason`, and
  `next_action` remain snake_case
- AND no camelCase alias is added by the SDK

#### Scenario: Embedded redirect URL path remains raw

- GIVEN an embedded card 3DS or APM transaction includes
  `next_action.redirect_to_url.url`
- WHEN the SDK decides whether to open the payflow iframe
- THEN it reads that raw path unchanged
- AND it MUST NOT look for `nextAction.redirectToUrl.url`

### Requirement: Transaction Reads Return Bare Transaction

`getTransaction` MUST return the raw transaction directly, with the same bare
shape as `pay()`. This is a read operation reporting the current backend state,
not a payment operation.

(Previously: this requirement also covered the removed public
`pollTransaction` method.)

#### Scenario: Reading a transaction by id

- GIVEN a transaction exists in the backend
- WHEN the caller invokes `getTransaction` with its id
- THEN the result is the raw transaction body (subject to `amount` coercion and
  `psp_response` stripping), with no wrapper object around it

## ADDED Requirements

### Requirement: Non-transaction public return payloads use snake_case

Public SDK return payloads that are not `RawTransaction` MUST expose snake_case
field names. This includes card/enrollment/payment-method discovery results and
public error objects.

#### Scenario: Saved-card return payloads expose snake_case fields

- GIVEN `getCustomerCards()` resolves with stored cards
- WHEN the caller inspects each card
- THEN fields such as `card_id`, `card_number`, `expiration_month`,
  `expiration_year`, `card_scheme`, and `subscription_id` are used
- AND camelCase aliases such as `cardId` or `cardNumber` are absent

#### Scenario: Enrollment return payload exposes snake_case fields

- GIVEN `enrollCard()` resolves successfully
- WHEN the caller inspects the result
- THEN the result uses `card_id` and optional `subscription_id`
- AND camelCase aliases such as `cardId` or `subscriptionId` are absent

#### Scenario: Error payload exposes snake_case fields

- GIVEN a public SDK method rejects with `AppError`
- WHEN the caller inspects the error object
- THEN public fields include `status_code`
- AND nested details use `system_error`
- AND camelCase aliases such as `statusCode` and `systemError` are absent
