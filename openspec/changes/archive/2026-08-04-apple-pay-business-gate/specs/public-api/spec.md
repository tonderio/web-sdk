# Delta for Public API Consistency

## MODIFIED Requirements

### Requirement: init() fetches business config and the Apple Pay catalog concurrently; the catalog leg is non-fatal

`init()` MUST issue exactly one request — `GET /api/v1/payments/business/{api_key}`
— via the injected `HttpPort`. No concurrent or chained Apple Pay
payment-method-catalog request MUST run inside `init()`. `init()` MUST reach
`lifecycle: 'ready'` when that request resolves, and MUST reach
`lifecycle: 'error'` and throw `AppError(INIT_ERROR)` when it rejects. Every
ready-gated method (`pay()`, `enrollCard()`, saved-card
`create('card_fields', { card_id })`, `isApplePayAvailable()`, and so on)
MUST remain usable once `init()` reaches ready, independent of whether Apple
Pay is available for the business.

(Previously: `init()` issued the business-config request and the Apple Pay
catalog request concurrently via `Promise.all`, with the catalog leg's
rejection handled independently and non-fatal to `init()`'s ready state.)

#### Scenario: init() issues exactly one request

- GIVEN a fake `HttpPort`
- WHEN `init()` is called
- THEN exactly one request is issued, targeting `GET /api/v1/payments/business/{api_key}`

#### Scenario: A rejecting business-config request still fails init() as before

- GIVEN the business-config request rejects
- WHEN `init()` is called
- THEN `init()` rejects with `AppError(INIT_ERROR)`
- AND core state's `lifecycle` is `'error'`

#### Scenario: Ready-gated flows are unaffected by Apple Pay's availability for the business

- GIVEN `init()` has resolved (`lifecycle: 'ready'`)
- WHEN a merchant calls `pay({ payment_method: { type: 'card' } })` with a
  valid configured customer and card input, or calls `enrollCard()`, or
  mounts a saved-card `create('card_fields', { card_id })` component
- THEN each behaves normally, regardless of the business's `apple_pay`
  configuration
