# Delta for zplit-back — embedded_completion serializer and token propagation

## ADDED Requirements

### Requirement: DirectProcessRequestSerializer accepts embedded_completion

`DirectProcessRequestSerializer` MUST include an `embedded_completion` field defined as `BooleanField(required=False, default=False)`.
The field MUST be accepted when present; when absent the deserialized value MUST be `False`.
Unknown values outside `{true, false}` MUST be rejected with a validation error (standard DRF BooleanField behavior).

#### Scenario: flag present and true is accepted

- GIVEN a POST /api/v1/process/ request body that includes `"embedded_completion": true`
- WHEN the serializer validates the input
- THEN `validated_data['embedded_completion']` is `True`

#### Scenario: flag absent defaults to False

- GIVEN a POST /api/v1/process/ request body with no `embedded_completion` key
- WHEN the serializer validates the input
- THEN `validated_data['embedded_completion']` is `False`

#### Scenario: flag explicitly false is accepted

- GIVEN a POST /api/v1/process/ request body that includes `"embedded_completion": false`
- WHEN the serializer validates the input
- THEN `validated_data['embedded_completion']` is `False`

---

### Requirement: embedded_completion carried into checkout_data

`DirectPaymentService._prepare_checkout_data()` MUST read `embedded_completion` from the incoming payment data and carry it into the `checkout_data` dict that is passed to the token-generation call sites.

#### Scenario: flag true reaches checkout_data

- GIVEN `payment_data` contains `embedded_completion: True`
- WHEN `_prepare_checkout_data()` executes
- THEN the returned `checkout_data` dict contains `embedded_completion: True`

#### Scenario: flag false or absent does not pollute checkout_data path

- GIVEN `payment_data` contains `embedded_completion: False` or the key is absent
- WHEN `_prepare_checkout_data()` executes
- THEN `checkout_data['embedded_completion']` is `False` (falsy; downstream call sites MAY omit `extra_data` or pass `extra_data={'embedded_completion': False}`)

---

### Requirement: generate_checkout_token adds embedded_completion as a top-level JWT claim

`Checkout.generate_checkout_token()` MUST read `embedded_completion` from `self.checkout_data` and add it as a top-level JWT claim in the payload. This single implementation covers BOTH call sites (Kushki native 3DS in `checkout.py` ~L226 and Tonder usrv-3ds in `threeds_service.py` ~L78) automatically.

#### Scenario: JWT includes embedded_completion claim when checkout_data has flag true

- GIVEN `checkout_data['embedded_completion']` is `True`
- WHEN `generate_checkout_token()` generates the JWT
- THEN the JWT payload contains `"embedded_completion": true` as a top-level claim

#### Scenario: JWT includes embedded_completion false when checkout_data has flag false or absent

- GIVEN `checkout_data['embedded_completion']` is `False` or absent
- WHEN `generate_checkout_token()` generates the JWT
- THEN the JWT payload contains `"embedded_completion": false` as a top-level claim

#### Scenario: call sites unchanged — flag read internally

- GIVEN embedded_completion is carried in checkout_data to `generate_checkout_token()`
- WHEN either call site (Kushki or Tonder) invokes `generate_checkout_token`
- THEN the call signature and arguments are unchanged; flag is read and added to payload internally
