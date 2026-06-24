# Tasks: Transparent Customer for Card-on-File

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 140–200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | N/A |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full feature + tests + docs | PR 1 | Self-contained; all files ship together |

---

## Phase 1: Foundation — Types and Error Message

- [x] 1.1 In `src/shared/types/index.ts`, add `customer?: CustomerInput` field to `TonderConfig` (after `getSignature`). Add JSDoc: "Pre-registered customer identity. Resolved transparently by COF operations — `registerCustomer()` is no longer required when this is set."
- [x] 1.2 In `src/shared/errors/messages.ts`, update `CUSTOMER_NOT_REGISTERED` message to: `'No customer registered. Provide config.customer at createTonder() or call registerCustomer() before this operation.'`

## Phase 2: RED — Failing Tests First (Strict TDD)

Write ALL tests in a new file `src/tonder.customer.test.ts` using `_createTonderWithDeps` with a fake `CustomerService`. Each test MUST fail (RED) before any production code is written in Phase 3.

- [x] 2.1 **RED — transparent enroll via config.customer**: `config.customer` set, `enrollCard()` called without prior `registerCustomer()` → `customerService.registerOrFetch` invoked exactly once; enroll proceeds and resolves.
- [x] 2.2 **RED — memoization**: two sequential COF ops (`enrollCard` + `getCustomerCards`) with `config.customer` set and no `registerCustomer()` → `customerService.registerOrFetch` called exactly ONCE across both calls.
- [x] 2.3 **RED — explicit registerCustomer() still works**: `registerCustomer()` called before any COF op, no `config.customer` → registerOrFetch called once by registerCustomer; COF ops use cached token (registerOrFetch NOT called again).
- [x] 2.4 **RED — explicit registerCustomer() after config.customer overwrites cache**: `config.customer` set, first COF op triggers auto-register; then `registerCustomer({ email: 'other@example.com' })` called → subsequent COF op uses the new (overwritten) token, not the cached one.
- [x] 2.5 **RED — no customer anywhere**: no `config.customer`, no `registerCustomer()` → `enrollCard()` throws `AppError` with `errorCode: ErrorKeyEnum.CUSTOMER_NOT_REGISTERED`.
- [x] 2.6 **RED — getCustomerCards transparent**: `config.customer` set, no `registerCustomer()` → `getCustomerCards()` resolves without throwing.
- [x] 2.7 **RED — removeCustomerCard transparent**: `config.customer` set, no `registerCustomer()` → `removeCustomerCard('card_123')` resolves without throwing.

## Phase 3: GREEN — Production Implementation

Make all RED tests pass. No scope beyond what the tests require.

- [x] 3.1 In `src/tonder.ts`, add private `#ensureCustomerRegistered(): Promise<string>`. Logic:
  - If `state.customerAuthToken` is set → return it immediately (no network).
  - Else resolve `state.customerInput ?? config.customer`. If neither → throw `AppError({ errorCode: ErrorKeyEnum.CUSTOMER_NOT_REGISTERED })`.
  - Else call `customerService.registerOrFetch(apiKey, input)`, store result via `core.setState({ customerAuthToken, customerInput })`, return token.
- [x] 3.2 In `src/tonder.ts`, refactor `resolveCardAuth()` (~L761–788): replace the inline `if (!userToken) throw CUSTOMER_NOT_REGISTERED` guard with `const userToken = await this.#ensureCustomerRegistered()`. Remove the dead `if (!userToken)` block.
- [x] 3.3 Verify `registerCustomer()` (~L618) continues to call `customerService.registerOrFetch` and stores result via `core.setState` — this naturally overwrites the cache, satisfying task 2.4. No structural change needed; confirm it is already correct.
- [x] 3.4 Run `npx vitest run src/tonder.customer.test.ts` → all 7 tests GREEN.

## Phase 4: Full Gate

- [x] 4.1 Run full suite: `npx vitest run` → zero regressions across all `*.test.ts` files.
- [x] 4.2 Run `npm run typecheck` → zero TypeScript errors.
- [x] 4.3 Run `npm run lint` → zero NEW lint errors. NOTE: 4 pre-existing errors remain under `e2e/` (from prior commits, unrelated to this change; confirmed identical via `git stash`). All files touched by this change lint clean.

## Phase 5: Documentation and Demo

- [x] 5.1 Update root `README.md` — **Saved cards** section: replace the mandatory `registerCustomer()` call before `getCustomerCards()` / `removeCustomerCard()` with a `config.customer` example in the `createTonder()` block; add inline note that `registerCustomer()` is now optional (pre-warm or switch-customer use cases).
- [x] 5.2 Update root `README.md` — **Enroll a card** section: same treatment — move customer identity to `config.customer`; note `registerCustomer()` is optional. Update the stale `Call registerCustomer first, otherwise enrollCard() throws CUSTOMER_NOT_REGISTERED` sentence to name both sources.
- [N/A] 5.3 Demo update — N/A. Demos live in a separate repo (`/Volumes/MacDev/Tonder/SDKs/demos`), out of this repo's scope; the orchestrator will update them.

## Phase 6: Commit

- [x] 6.1 Stage all changed files (`src/shared/types/index.ts`, `src/shared/errors/messages.ts`, `src/tonder.ts`, `src/tonder.customer.test.ts`, `README.md`). Commit message exactly: `feat(customer): transparent Card-on-File customer via config.customer`. No AI attribution, no co-author trailer, no push.
