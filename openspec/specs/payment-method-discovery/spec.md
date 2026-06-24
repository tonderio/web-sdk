# Payment Method Discovery Specification

## Purpose

Read-only discovery methods that let SDK consumers list the payment methods configured for the business and the bank list required to build an APM checkout UI.

## Requirements

### Requirement: Fetch Payment Methods

The system MUST expose `getPaymentMethods()` that issues a GET request to `/api/v1/payment_methods?status=active` and returns a public `PaymentMethodInfo[]` whose exposed object fields use snake_case.

Constraints:
- URL MUST NOT include a trailing slash.
- The request MUST include `Authorization: Token {apiKey}` via the shared HTTP client header; no extra auth mechanism is added.
- Each backend item is mapped to public `PaymentMethodInfo { id, payment_method, label, logo, category }`.
- Internal/vendor fields such as `acquirer`, backend lifecycle `status`, `priority`, and `unavailable_countries` MUST NOT be exposed.
- UI metadata `label` and `logo` MUST remain available when present, using backend-provided values or the SDK catalog fallback.
- On HTTP/network failure the call MUST reject with `AppError(FETCH_PAYMENT_METHODS_ERROR)`.

#### Scenario: Successful fetch returns mapped array

- GIVEN the SDK is initialized with a valid apiKey
- WHEN `getPaymentMethods()` is called
- THEN the HTTP client issues `GET /api/v1/payment_methods?status=active` with header `Authorization: Token {apiKey}`
- AND the URL contains no trailing slash
- AND each item is mapped to `PaymentMethodInfo { id, payment_method, label, logo, category }`
- AND the method resolves with the mapped array

#### Scenario: Transport failure

- GIVEN the HTTP client throws or returns an error status
- WHEN `getPaymentMethods()` is called
- THEN the method rejects with an `AppError` whose code is `FETCH_PAYMENT_METHODS_ERROR`

---

### Requirement: Fetch APM Banks

The system MUST expose `getPaymentMethodBanks()` that issues a GET request to `/api/v1/safetypay/banks/{apiKey}/` and returns `{ cash: PaymentMethodBank[]; transfer: PaymentMethodBank[] }`.

Constraints:
- The configured `apiKey` MUST be embedded in the URL path.
- Each raw bank object is mapped to `PaymentMethodBank { id, name, code, logo? }`, where public `id` is the nested backend `bank.id` used in SafetyPay `config.bank_ids`; the outer business-bank row id remains internal.
- On HTTP/network failure the call MUST reject with `AppError(FETCH_PAYMENT_METHOD_BANKS_ERROR)`.

#### Scenario: Successful fetch returns grouped banks

- GIVEN the SDK is initialized with apiKey "tok_abc"
- WHEN `getPaymentMethodBanks()` is called
- THEN the HTTP client issues `GET /api/v1/safetypay/banks/tok_abc/`
- AND the response is mapped to `{ cash: PaymentMethodBank[], transfer: PaymentMethodBank[] }`
- AND each `PaymentMethodBank` has fields `id, name, code, logo?`

#### Scenario: Transport failure

- GIVEN the HTTP client throws or returns an error status
- WHEN `getPaymentMethodBanks()` is called
- THEN the method rejects with an `AppError` whose code is `FETCH_PAYMENT_METHOD_BANKS_ERROR`
