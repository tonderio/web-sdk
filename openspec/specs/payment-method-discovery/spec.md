# Payment Method Discovery Specification

## Purpose

Read-only discovery methods that let SDK consumers list the payment methods configured for the business and the bank list required to build an APM checkout UI.

## Requirements

### Requirement: Fetch Payment Methods

The system MUST expose `getPaymentMethods()` that issues a GET request to
`/api/v1/payment_methods?status=active` and returns a public
`PaymentMethodInfo[]` whose exposed object fields use snake*case. Every entry
whose `payment_method` starts with the prefix `apple_pay*` MUST be excluded
from the returned array.

(Previously: no filtering was applied — every backend entry, including any
`apple_pay_*` one, was mapped and returned like any other method. The catalog
carries `apple_pay_debit_card` / `apple_pay_credit_card` entries that only
the internal Apple Pay availability gate may read, per `apple-pay/spec.md`.
The filter is not cosmetic: merchants render `getPaymentMethods()` output as
selectable options, and a leaked `apple_pay_*` entry would be drawn as a
working generic APM. A merchant calling
`pay({ payment_method: { type: 'apple_pay_debit_card' } })` in response
cannot succeed — Apple Pay requires the button component and a user gesture,
neither of which `pay()` has. Leaking the entry hands the merchant a dead end
that looks like a supported method.)

Constraints:

- URL MUST NOT include a trailing slash.
- The request MUST include `Authorization: Token {api_key}` via the shared
  HTTP client header; no extra auth mechanism is added.
- Every backend item remaining after the `apple_pay_*` filter is mapped to
  public `PaymentMethodInfo { id, payment_method, label, logo, category }`.
- An entry MUST be dropped whenever its `payment_method` starts with
  `apple_pay_`, regardless of `status` or `category`. No other entry MUST be
  affected — the filter matches only that prefix.
- Internal/vendor fields such as `acquirer`, backend lifecycle `status`,
  `priority`, and `unavailable_countries` MUST NOT be exposed.
- UI metadata `label` and `logo` MUST remain available when present, using
  backend-provided values or the SDK catalog fallback.
- On HTTP/network failure the call MUST reject with
  `AppError(FETCH_PAYMENT_METHODS_ERROR)`.
- The call MUST issue its own network request on every invocation. The SDK
  MUST NOT cache the payment-method catalog anywhere — no code path serves a
  `getPaymentMethods()` result from any state `init()` populates.

(Previously: the last constraint additionally forbade reading from a raw
catalog cache `init()` populated concurrently with the business-config
request. `init()` no longer fetches or caches the payment-method catalog at
all, so there is no such cache to avoid reading.)

#### Scenario: Successful fetch returns mapped array with no Apple Pay entries

- GIVEN the SDK is initialized with a valid `api_key`
- AND the backend catalog contains `card`, `spei`, `apple_pay_debit_card` and
  `apple_pay_credit_card` entries
- WHEN `getPaymentMethods()` is called
- THEN the HTTP client issues `GET /api/v1/payment_methods?status=active`
  with header `Authorization: Token {api_key}`
- AND the resolved array contains the mapped `card` and `spei` entries
- AND neither `apple_pay_debit_card` nor `apple_pay_credit_card` appears
  anywhere in the resolved array

#### Scenario: No Apple Pay entries in the catalog changes nothing

- GIVEN the backend catalog contains no `apple_pay_*` entry
- WHEN `getPaymentMethods()` is called
- THEN the resolved array is identical to the pre-change mapped output

#### Scenario: Every non-Apple-Pay method keeps its existing shape

- GIVEN a backend catalog with `card`, `spei`, `oxxopay`, and both
  `apple_pay_*` entries
- WHEN `getPaymentMethods()` is called
- THEN `card`, `spei`, and `oxxopay` are each present in the resolved array
  with the existing `{ id, payment_method, label, logo, category }` shape

#### Scenario: Two calls issue two independent requests, proving no cache serves either

- GIVEN `getPaymentMethods()` is called twice in sequence, with the HTTP
  client resolving a distinct catalog on each call
- WHEN both calls resolve
- THEN each resolved array reflects its own response — the second call is
  not served from any state the first call or `init()` populated

#### Scenario: Transport failure

- GIVEN the HTTP client throws or returns an error status
- WHEN `getPaymentMethods()` is called
- THEN the method rejects with an `AppError` whose code is
  `FETCH_PAYMENT_METHODS_ERROR`

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
