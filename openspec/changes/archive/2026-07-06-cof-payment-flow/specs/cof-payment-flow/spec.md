# Delta for cof-payment-flow

## ADDED Requirements

### Requirement: COF-active new-card pay enrolls before processing

For businesses with active COF configuration, `pay({ paymentMethod: { type: 'card' } })` MUST automatically enroll the mounted new card before charging. The merchant MUST NOT provide a save-card flag, COF flag, `enable_card_on_file`, or `subscription_id` to trigger this behavior.

COF is active when the initialized business config includes `cardonfile_keys.public_key`. If COF is not active, new-card `pay()` MUST keep the existing raw-card Direct API behavior. Explicit `pay({ paymentMethod: { type: 'savedCard', cardId } })` and standalone `enrollCard()` MUST remain behaviorally unchanged.

#### Scenario: COF-active new card is enrolled then charged

- GIVEN the SDK is initialized for a business with `cardonfile_keys.public_key`
- AND card fields for a new card are mounted
- WHEN the merchant calls `pay({ paymentMethod: { type: 'card' } })`
- THEN the SDK enrolls the mounted card through the existing COF enrollment behavior
- AND the SDK calls `/api/v1/process/` only after enrollment succeeds

#### Scenario: Non-COF new-card payment remains raw-card

- GIVEN the SDK is initialized without `cardonfile_keys.public_key`
- WHEN the merchant calls `pay({ paymentMethod: { type: 'card' } })`
- THEN the SDK MUST NOT enroll the card before processing
- AND `/api/v1/process/` receives the existing raw card-field token payload

#### Scenario: Saved-card payment is unchanged

- GIVEN a merchant calls `pay({ paymentMethod: { type: 'savedCard', cardId } })`
- WHEN payment is processed
- THEN the SDK MUST NOT collect or enroll a new card
- AND the saved-card Direct API payload MUST remain unchanged

### Requirement: Auto-enrolled COF payments use token-only Direct API payload

After successful auto-enrollment, `/api/v1/process/` MUST receive `payment_method: { type: 'CARD', token: cardId }`, where `cardId` is the enrolled saved-card identifier returned by the enrollment flow. The SDK MUST NOT send raw card-field tokens, `enable_card_on_file`, or `subscription_id` in the process payload for the auto-enrolled payment. The backend resolves subscription details server-side.

#### Scenario: Process payload uses saved-card token

- GIVEN COF-active `pay({ paymentMethod: { type: 'card' } })` successfully enrolls a card with `cardId = 'card_123'`
- WHEN the SDK calls `/api/v1/process/`
- THEN `payment_method` is exactly `{ type: 'CARD', token: 'card_123' }`
- AND raw card fields are absent from `payment_method`

#### Scenario: Client COF fields are absent

- GIVEN COF-active new-card payment reaches `/api/v1/process/`
- WHEN the request body is inspected
- THEN `enable_card_on_file` MUST NOT be present
- AND `subscription_id` MUST NOT be present

### Requirement: Auto-enrollment rollback boundary

Existing COF enrollment rollback MUST continue to apply during enrollment. If auto-enrollment succeeds but `/api/v1/process/` throws before returning any transaction body, the SDK SHOULD best-effort remove the just-enrolled card and MUST surface the original process error. The SDK MUST NOT remove the card when `/process/` returns a normal transaction body, including `Declined`, `Pending`/3DS, or successful statuses. The SDK MUST NOT remove the card for polling, presentation, or post-transaction errors after a process transaction body exists.

#### Scenario: Process transport failure removes just-enrolled card

- GIVEN COF-active new-card payment has just enrolled `card_123`
- WHEN `/api/v1/process/` throws before returning a transaction body
- THEN the SDK SHOULD attempt to remove `card_123`
- AND the original process error is surfaced to the caller

#### Scenario: Declined transaction does not remove enrolled card

- GIVEN COF-active new-card payment has just enrolled `card_123`
- WHEN `/api/v1/process/` returns a transaction body with status `Declined`
- THEN `card_123` MUST NOT be removed by the SDK
- AND `pay()` resolves according to the raw transaction return contract

#### Scenario: Pending or 3DS transaction does not remove enrolled card

- GIVEN COF-active new-card payment has just enrolled `card_123`
- WHEN `/api/v1/process/` returns a `Pending` or 3DS transaction body
- THEN `card_123` MUST NOT be removed by the SDK
- AND later polling, presentation timeout, or presentation error MUST NOT trigger card removal
