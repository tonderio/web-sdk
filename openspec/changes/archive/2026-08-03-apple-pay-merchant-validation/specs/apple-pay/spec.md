# Delta for apple-pay

## ADDED Requirements

### Requirement: validateMerchant() posts an empty body to the merchant-validation endpoint

`ApplePayService.validateMerchant()` MUST issue exactly one `POST` to
`/api/v1/payments/apple-pay/validate-merchant/` over the injected
`HttpPort`, with an empty body (`{}`) and no `Authorization` header set by
the service itself — auth stays the transport's job.

#### Scenario: Exact method, path, and empty body

- GIVEN a fake `HttpPort` that resolves
- WHEN `validateMerchant()` is called
- THEN the fake receives exactly one `POST` to
  `/api/v1/payments/apple-pay/validate-merchant/` with body `{}`

#### Scenario: No client-derived value travels in the request

- GIVEN a call to `validateMerchant()`
- WHEN the captured request is inspected
- THEN it carries no `validationURL`, `merchant_identifier`, `domain_name`,
  or `initiative_context` field, and no service-set `Authorization` header

### Requirement: event.validationURL is never sent to the backend

`validateMerchant()` MUST take no parameter carrying Apple's
`event.validationURL` or any other value read from the `onvalidatemerchant`
event. No field name in the request MUST carry a client-supplied
validation URL — the backend resolves the target validation host itself.

#### Scenario: The signature has no room for a URL, and none leaks through

- GIVEN a test double exposing a `validationURL`-shaped value in scope
- WHEN `validateMerchant()` is called
- THEN its signature accepts no such argument, and the captured request
  contains no trace of that value

### Requirement: The merchant session response is returned opaque and unparsed

`validateMerchant()` MUST return the `HttpPort` response unmodified, typed
`unknown`. The service MUST NOT parse, validate, reshape, or log it.

#### Scenario: An arbitrary opaque response is passed through unchanged

- GIVEN a fake `HttpPort` that resolves with an arbitrary opaque object
- WHEN `validateMerchant()` resolves
- THEN the returned value is byte-identical to the fake's response and
  typed `unknown`

### Requirement: Transport failure wraps as APPLE_PAY_VALIDATION_ERROR

A rejecting `HttpPort` call MUST cause `validateMerchant()` to throw
`AppError` with code `ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR`, preserving
the original error via `originalError`.

#### Scenario: A rejecting HttpPort wraps into AppError

- GIVEN a fake `HttpPort` whose `request()` rejects
- WHEN `validateMerchant()` is called
- THEN it throws `AppError` with code `APPLE_PAY_VALIDATION_ERROR`
- AND the original rejection is preserved via `originalError`

### Requirement: validateMerchant() holds no session state

`validateMerchant()` MUST NOT cache a merchant session, MUST NOT retry a
failed or successful call, and MUST NOT deduplicate concurrent in-flight
calls — each invocation issues its own independent request, matching
Apple's per-transaction, single-use, five-minute-expiry rules for the
session it returns.

#### Scenario: Two calls issue two independent requests

- GIVEN a fake `HttpPort` that resolves with a distinct value on each call
- WHEN `validateMerchant()` is called twice in sequence
- THEN the fake records two separate requests, neither reusing the other's
  result

#### Scenario: A rejected call is not retried

- GIVEN a fake `HttpPort` whose `request()` rejects exactly once
- WHEN `validateMerchant()` is called and its rejection is awaited
- THEN the fake recorded exactly one request — no automatic retry occurred

### Requirement: The service depends only on the injected HttpPort

`ApplePayService` MUST depend only on the `HttpPort` passed to its
constructor. The module MUST import no DOM global and no `fetch`.

#### Scenario: The module imports no DOM or fetch API

- GIVEN the `apple-pay.service.ts` module
- WHEN its imports are inspected
- THEN only `HttpPort`, `AppError`, and `ErrorKeyEnum` appear — no DOM
  global, no `fetch`

### Requirement: APPLE_PAY_VALIDATION_ERROR resolves to a cause-hedged, distinct message

`MESSAGES_EN` MUST gain exactly one entry,
`[ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR]`, so `AppError` no longer falls
back to the `UNKNOWN_ERROR` copy for this code. The entry MUST name an
unregistered merchant domain as the most likely cause without asserting
it, and MUST remain accurate for an ordinary transport failure. It MUST
read as distinct from `APPLE_PAY_SESSION_ERROR`: this code describes the
backend failing to **obtain** a merchant session from Apple, never the
page failing to **start** a session.

#### Scenario: Entry resolves to code-specific, hedged, distinguishable copy

- GIVEN `MESSAGES_EN`
- WHEN `APPLE_PAY_VALIDATION_ERROR` is looked up
- THEN it resolves to a string distinct from both the `UNKNOWN_ERROR`
  fallback and the `APPLE_PAY_SESSION_ERROR` copy
- AND it names an unregistered domain as the most likely cause using
  hedging language, without asserting it as the sole or certain cause
- AND it describes the backend failing to obtain a session, not the page
  failing to start one
