# TEC-1101 — Phone-identified saved cards

## Objective

When the business identifies saved-card customers by phone (`save_cards_identifier_type: "phone"`) and the merchant passes a customer without a phone, the Web SDK disables saved cards without breaking payments.

## Problem

With Card on File active, `pay({ type: "card" })` enrolls the card implicitly before charging. In phone mode without a phone the backend refuses that enrollment (and `GET /cards/`), so the payment fails.

## Scope (authorized, ticket TEC-1101)

- `BusinessConfig.save_cards_identifier_type: "email" | "phone"`, absent or unknown → `"email"`. Read from `GET /api/v1/payments/business/{apiKey}`.
- Rule: unavailable iff type is `"phone"` and `session.customer.phone` is missing or blank.
- Public `canSaveCards(): boolean`.
- `pay({ type: "card" })`: only when Card on File is active, skip implicit enrollment, charge as a regular card, `console.warn`. Without Card on File: unchanged, no warning.
- `getCustomerCards()`, `enrollCard()`, `pay({ type: "saved_card" })`: reject with `AppError(SAVE_CARDS_UNAVAILABLE)` (message: customer phone required) before any request.
- `removeCustomerCard()`: unchanged.
- No customer-facing UI or message.

Out of scope: other SDKs, backend, collecting the phone.

## Constraints

- TDD: strict, on. Source: `openspec/config.yaml` (`testing.strict_tdd: true`). Runner: `npm test` (`vitest run`).
- Review (RDD): off (global).
- Delivery strategy: `single-pr`.
- Branch: `feature/TEC-1101` from `develop` @ `1e0c9cc`.

## Tasks

- [x] **T1 — Availability rule.** `BusinessConfig` field + normalization, private rule, public `canSaveCards()`, new error key/message `SAVE_CARDS_UNAVAILABLE`. Route: delegated (writer).
- [ ] **T2 — Guard explicit saved-card calls.** `getCustomerCards()`, `enrollCard()`, `pay({ type: "saved_card" })` reject before any request. Route: delegated (writer).
- [ ] **T3 — Card payment with Card on File.** Skip implicit enrollment + `console.warn` only when Card on File is active. Route: delegated (writer).
- [ ] **T4 — Docs.** README: `canSaveCards()`, phone rule, error code. Route: delegated (writer).

Route evidence: the change touches 2+ non-trivial files (`src/tonder.ts`, `src/models/business.model.ts`, `src/shared/errors/*`, tests, README) → writer trigger.

## Acceptance criteria

AC-1 to AC-9 as published in TEC-1101.

## Checks per task

`npm test`, `npm run typecheck`, `npm run build`.

## Progress

- **T1 done.** Commit: 0424d83. RED: `src/tonder.canSaveCards.test.ts` 11/11 failed (`tonder.canSaveCards is not a function`, missing `SAVE_CARDS_UNAVAILABLE` message). GREEN after implementation. Checks: `npm test` 57 files / 676 tests passed; `npm run typecheck` clean; `npm run build` clean (0 findings).
  - Decisions: `canSaveCards()` returns `false` before `init()` and never throws (same stance as `isApplePayAvailable()`); the model keeps the raw field (no normalization layer exists), the rule treats anything but `'phone'` as email.
  - Route: delegated (writer).

## Next step

T2.
