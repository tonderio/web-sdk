# Delta for Apple Pay

## ADDED Requirements

### Requirement: Raw payment-method catalog is fetched and cached during init()

During `init()`, the SDK MUST fetch the payment-method catalog via
`GET /api/v1/payment_methods?status=active` — the same endpoint and
`Authorization: Token {api_key}` header `getPaymentMethods()` uses — and
cache the **raw, unmapped, unfiltered** array of backend entries in core
state. This request MUST run concurrently with the business-config request
(see `public-api/spec.md`), never chained after it.

A rejection of this request MUST NOT be surfaced to the `init()` caller. A
transport failure MUST be wrapped as `AppError(FETCH_PAYMENT_METHODS_ERROR)`
— the same code `getPaymentMethods()` uses — then absorbed internally by
`init()`, not re-thrown, leaving the cached catalog empty (unset) rather than
populated. Only `apple_pay_*` entries within the cached raw catalog are read
by the internal helpers below.

#### Scenario: Raw catalog is cached unfiltered, including Apple Pay entries

- GIVEN the catalog response contains `apple_pay_debit_card`,
  `apple_pay_credit_card`, and `card` entries
- WHEN `init()` resolves
- THEN the cached raw catalog contains all three entries, unmapped, including
  both `apple_pay_*` ones

#### Scenario: A rejecting catalog request leaves the cache empty without failing init()

- GIVEN the catalog request rejects with a network error
- AND the business-config request resolves normally
- WHEN `init()` is called
- THEN `init()` resolves without throwing
- AND the cached raw catalog is empty (unset)
- AND the availability gate below reports no active `apple_pay_*` method

### Requirement: Apple Pay availability gate reads the cached catalog only (D4)

The SDK MUST expose an internal helper (illustrative name:
`hasActiveApplePayMethod`) that takes the cached raw catalog and returns
`true` when it contains at least one entry whose `payment_method` starts with
`apple_pay_`, and `false` otherwise — including when the cache is empty. The
catalog is always fetched with `?status=active`, so presence in the cached
list already means the method is active; the helper MUST NOT re-check a
`status` field on individual entries. The helper MUST NOT read
`business.country_code` or any browser API — composing the country and
browser checks on top of this gate is deferred to the phase that owns the
public `isApplePayAvailable()` method (plan §3). This supersedes the combined
gate description in `apple-pay-foundation`'s design ("active `apple_pay_*`
method AND a non-empty `country_code`"): D4 is the later decision and splits
the responsibility.

#### Scenario: Gate returns true when at least one apple*pay*\* entry is present

- GIVEN a cached catalog containing `apple_pay_debit_card` and `card`
- WHEN the gate runs against that catalog
- THEN it returns `true`

#### Scenario: Gate returns false when no apple*pay*\* entry is present

- GIVEN a cached catalog containing only `card` and `spei`
- WHEN the gate runs against that catalog
- THEN it returns `false`

#### Scenario: Gate returns false when the cache is empty

- GIVEN the cached catalog is empty because the catalog request failed during
  `init()`
- WHEN the gate runs
- THEN it returns `false`, with no throw

#### Scenario: Gate still sees Apple Pay entries that getPaymentMethods() excludes — cache-raw / filter-at-the-boundary verified in both directions

- GIVEN a cached catalog containing both `apple_pay_debit_card` and
  `apple_pay_credit_card`
- WHEN the gate runs against that SAME cached catalog
- THEN it returns `true`
- AND a call to `getPaymentMethods()` against the same backend catalog
  excludes both entries from its resolved array (`payment-method-discovery/spec.md`)

### Requirement: Apple Pay supported-networks derivation

The SDK MUST expose an internal helper that derives the Apple Pay
`supportedNetworks` list from the active `apple_pay_*` entries in the cached
catalog: the deduplicated union of every active entry's
`configuration.supported_networks`. When no active entry carries a
non-empty `configuration.supported_networks`, the helper MUST fall back to
`DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard']`. A network value MUST
NOT appear twice in the result regardless of how many active entries carry
it. The helper MUST be total over its input: an input with zero active
`apple_pay_*` entries is a valid input for a pure function and MUST also
resolve to the fallback, not to an undefined or implementation-dependent
result. The availability gate above determines whether production ever
calls the helper with such an input — it does not relieve the helper of
defining the case.

#### Scenario: Union of two methods' networks, deduplicated

- GIVEN `apple_pay_debit_card` is active with
  `configuration.supported_networks: ['visa', 'masterCard']`
- AND `apple_pay_credit_card` is active with
  `configuration.supported_networks: ['masterCard']`
- WHEN the helper runs
- THEN the result is `['visa', 'masterCard']`, with `masterCard` appearing
  exactly once

#### Scenario: Only one Apple Pay method active

- GIVEN only `apple_pay_debit_card` is active, with
  `configuration.supported_networks: ['visa']`
- WHEN the helper runs
- THEN the result is `['visa']`

#### Scenario: Neither active method carries configuration.supported_networks

- GIVEN both `apple_pay_debit_card` and `apple_pay_credit_card` are active
  and neither carries a `configuration.supported_networks` value
- WHEN the helper runs
- THEN the result is the fallback `['visa', 'masterCard']`

#### Scenario: The helper is total — zero active methods also resolves to the fallback

- GIVEN the cached catalog has no `apple_pay_*` entry
- WHEN the helper runs directly against that catalog
- THEN the result is still the fallback `['visa', 'masterCard']`, because the
  union is defined for every input, not only the inputs the availability
  gate would let through in production
- AND this is a property of the pure helper, not a business case the
  availability gate is expected to have already excluded — the gate makes
  the input rare in production, it does not make the helper's behavior on
  that input optional

### Requirement: Apple Pay merchantCapabilities derivation

The SDK MUST expose an internal helper that derives Apple Pay
`merchantCapabilities` from the active `apple_pay_*` entries in the cached
catalog. `'supports3DS'` MUST be present in every result, unconditionally —
it denotes EMV cryptogram support, unrelated to 3-D Secure, and its
definition site MUST carry a code comment recording that distinction so it
is not later removed as apparently contradictory. `'supportsDebit'` MUST be
present when `apple_pay_debit_card` is active. `'supportsCredit'` MUST be
present when `apple_pay_credit_card` is active. Neither MUST be present when
its corresponding method is not active. The helper MUST be total over its
input: an input with zero active `apple_pay_*` entries is valid and MUST
still resolve to a result containing `'supports3DS'` and neither of the
other two — the availability gate above determines whether production ever
calls the helper with such an input, not what the helper returns when it
does.

#### Scenario: Both methods active

- GIVEN both `apple_pay_debit_card` and `apple_pay_credit_card` are active
- WHEN the helper runs
- THEN the result contains `supports3DS`, `supportsDebit`, and
  `supportsCredit`

#### Scenario: Debit only

- GIVEN only `apple_pay_debit_card` is active
- WHEN the helper runs
- THEN the result contains `supports3DS` and `supportsDebit`
- AND the result does not contain `supportsCredit`

#### Scenario: Credit only

- GIVEN only `apple_pay_credit_card` is active
- WHEN the helper runs
- THEN the result contains `supports3DS` and `supportsCredit`
- AND the result does not contain `supportsDebit`

#### Scenario: The helper is total — zero active methods still resolves to supports3DS only

- GIVEN the cached catalog has no `apple_pay_*` entry
- WHEN the helper runs directly against that catalog
- THEN the result still contains `supports3DS`
- AND the result contains neither `supportsDebit` nor `supportsCredit`
- AND this is a property of the pure helper, not a business case the
  availability gate is expected to have already excluded — the gate makes
  the input rare in production, it does not make the helper's behavior on
  that input optional

### Requirement: Public Apple Pay availability wiring waits for its full runtime

A public `isApplePayAvailable()` method (or equivalent public availability
check) on `Tonder` or `src/index.ts` MUST be wired only in the change that
also ships the runtime it depends on — browser detection
(`window.ApplePaySession`, `supportsVersion`, `canMakePayments`) and
`business.country_code`, composed together with the catalog-only gate above
(plan §3; inherited decision D3/DD2: declare, do not wire before the
behavior exists). Wiring it ahead of that composition would let the method
type-check while returning an incomplete or incorrect answer — a merchant
would have no way to tell it apart from a fully correct one. The
availability gate, network derivation, and capability derivation above stay
internal helpers with no public consumer until that composing change lands.

#### Scenario: isApplePayAvailable is absent from the public facade

- GIVEN the `Tonder` instance returned by `createTonder()`
- WHEN its members are inspected
- THEN no `isApplePayAvailable` method exists

#### Scenario: src/index.ts exports no Apple Pay member

- GIVEN the `.d.ts` public surface of `src/index.ts`
- WHEN its exports are inspected
- THEN no Apple Pay type or method is exported — the internal helpers above
  stay unexported
