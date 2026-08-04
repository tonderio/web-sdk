# Delta for Public API Consistency

## ADDED Requirements

### Requirement: init() fetches business config and the Apple Pay catalog concurrently; the catalog leg is non-fatal

`init()` MUST issue the business-config request
(`GET /api/v1/payments/business/{api_key}`) and the Apple Pay catalog request
(`GET /api/v1/payment_methods?status=active`) concurrently via `Promise.all`
with each leg's rejection handled independently — never one request chained
after the other. The catalog leg's rejection MUST NOT cause `init()` to
reject: `init()` MUST still reach `lifecycle: 'ready'` using the
business-config result alone, and every ready-gated method (`pay()`,
`enrollCard()`, saved-card `create('card_fields', { card_id })`, and so on)
MUST remain usable regardless of the catalog leg's outcome. Only a rejection
of the business-config leg triggers `init()`'s failure semantics —
`lifecycle: 'error'` and a thrown `AppError(INIT_ERROR)`.

(Previously: `init()` issued a single request — business config only.)

#### Scenario: Business-config and catalog requests are issued concurrently, not chained

- GIVEN a fake `HttpPort` where the business-config request resolves only
  after the catalog request has already been issued
- WHEN `init()` is called
- THEN both requests are observed in flight before either resolves — the
  catalog request is issued without waiting for the business-config response
  to arrive first

#### Scenario: A rejecting catalog request still lets init() reach ready

- GIVEN the catalog request rejects with a network error
- AND the business-config request resolves normally
- WHEN `init()` is called
- THEN `init()` resolves without throwing
- AND core state's `lifecycle` is `'ready'`

#### Scenario: Card payments and other ready-gated flows are unaffected when the catalog request fails

- GIVEN the catalog request rejected during `init()`
- AND `init()` has resolved (`lifecycle: 'ready'`)
- WHEN a merchant calls `pay({ payment_method: { type: 'card' } })` with a
  valid configured customer and card input, or calls `enrollCard()`, or
  mounts a saved-card `create('card_fields', { card_id })` component
- THEN each behaves normally — none of them is blocked, delayed, or altered
  by the failed catalog leg

#### Scenario: A rejecting business-config request still fails init() as before

- GIVEN the business-config request rejects
- AND the catalog request resolves normally
- WHEN `init()` is called
- THEN `init()` rejects with `AppError(INIT_ERROR)`
- AND core state's `lifecycle` is `'error'`
