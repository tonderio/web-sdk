# Payment Method Discovery Specification

## Purpose

Read-only discovery methods that let SDK consumers list the payment methods configured for the business and the bank list required to build an APM checkout UI.

## Requirements

### Requirement: Fetch Payment Methods

The system MUST expose `getPaymentMethods()` that issues a GET request to `/api/v1/payment_methods` and returns the list mapped to `PaymentMethodInfo[]`.

Constraints:
- URL MUST NOT include a trailing slash.
- The optional `?status=active` query parameter MAY be appended when the caller requests only active methods.
- The request MUST include `Authorization: Token {apiKey}` via the shared HTTP client header; no extra auth mechanism is added.
- Each backend item is mapped snake_case → camelCase: `pk → id`, `payment_method → paymentMethod`, `acquirer → acquirer`, `status → status`, `priority → priority`, `category → category`, `unavailable_countries → unavailableCountries`.
- On HTTP/network failure the call MUST reject with `AppError(FETCH_PAYMENT_METHODS_ERROR)`.

#### Scenario: Successful fetch returns mapped array

- GIVEN the SDK is initialized with a valid apiKey
- WHEN `getPaymentMethods()` is called
- THEN the HTTP client issues `GET /api/v1/payment_methods` with header `Authorization: Token {apiKey}`
- AND the URL contains no trailing slash
- AND each item is mapped to `PaymentMethodInfo { id, paymentMethod, acquirer, status, priority, category, unavailableCountries }`
- AND the method resolves with the mapped array

#### Scenario: Fetch with status filter

- GIVEN the SDK is initialized
- WHEN `getPaymentMethods({ status: 'active' })` is called (or equivalent)
- THEN the request URL includes `?status=active`

#### Scenario: Transport failure

- GIVEN the HTTP client throws or returns an error status
- WHEN `getPaymentMethods()` is called
- THEN the method rejects with an `AppError` whose code is `FETCH_PAYMENT_METHODS_ERROR`

---

### Requirement: Fetch APM Banks

The system MUST expose `getApmBanks()` that issues a GET request to `/api/v1/safetypay/banks/{apiKey}/` and returns `{ cash: ApmBank[]; transfer: ApmBank[] }`.

Constraints:
- The `apiKey` MUST be embedded in the URL path, NOT in the `Authorization` header (the endpoint authenticates by path lookup).
- Each raw bank object is mapped to `ApmBank { id, name, bankCode, logo, country, countryName, paymentType, priority }` (nested `bank.*` fields promoted to top level).
- On HTTP/network failure the call MUST reject with `AppError(FETCH_APM_BANKS_ERROR)`.

#### Scenario: Successful fetch returns grouped banks

- GIVEN the SDK is initialized with apiKey `"tok_abc"`
- WHEN `getApmBanks()` is called
- THEN the HTTP client issues `GET /api/v1/safetypay/banks/tok_abc/`
- AND the request does NOT include `Authorization: Token` header for this call
- AND the response is mapped to `{ cash: ApmBank[], transfer: ApmBank[] }`
- AND each `ApmBank` has fields `id, name, bankCode, logo, country, countryName, paymentType, priority`

#### Scenario: Transport failure

- GIVEN the HTTP client throws or returns an error status
- WHEN `getApmBanks()` is called
- THEN the method rejects with an `AppError` whose code is `FETCH_APM_BANKS_ERROR`
