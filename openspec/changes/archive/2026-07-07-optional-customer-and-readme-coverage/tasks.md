# Tasks: Optional Customer and README Coverage

## Review Workload Forecast

| Field                   | Value       |
| ----------------------- | ----------- |
| Estimated changed lines | 180-260     |
| 400-line budget risk    | Low         |
| Chained PRs recommended | No          |
| Suggested split         | Single PR   |
| Delivery strategy       | ask-on-risk |
| Chain strategy          | pending     |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                                 | Likely PR | Notes                                            |
| ---- | ---------------------------------------------------- | --------- | ------------------------------------------------ |
| 1    | Align optional customer contract and README coverage | PR 1      | Tests and docs stay with the API contract change |

## Phase 1: RED Tests

- [x] 1.1 Add/adjust tests proving `createTonder()` without `session.customer` is valid for `getTransaction()` and does not throw `MISSING_CUSTOMER`.
- [x] 1.2 Add/adjust tests proving `pay()`, `enrollCard()`, `getCustomerCards()`, and `removeCustomerCard()` throw `MISSING_CUSTOMER` before customer-dependent network work when customer is absent.
- [x] 1.3 Add/adjust README contract tests/search assertions if this repo has them; otherwise keep docs verification manual.

## Phase 2: GREEN Implementation

- [x] 2.1 Update public type/JSDoc comments in `src/shared/types/index.ts` and `src/tonder.ts` so `session.customer` is optional at creation and required only by customer-dependent methods.
- [x] 2.2 Keep or adjust runtime guards so read-only `getTransaction()` remains customer-free and customer-dependent methods still guard with `MISSING_CUSTOMER`.
- [x] 2.3 Remove stale camelCase presentation callback wording; use only `events.presentation.on_open` and `events.presentation.on_close` for the public API.

## Phase 3: README Coverage

- [x] 3.1 Update `README.md` configuration docs to explain optional `session.customer`, `session.secure_token`, and return_url `getTransaction()` usage.
- [x] 3.2 Add focused examples for `customization.card_fields` styling/error messages and `events.presentation.on_open` / `on_close`.
- [x] 3.3 Ensure README covers current public methods without exposing internal implementation details.

## Phase 4: Verification

- [x] 4.1 Run typecheck, unit tests, lint, and build.
- [x] 4.2 Update task checkboxes and record verification evidence.
