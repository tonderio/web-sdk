# Proposal: remove-register-customer

## Why

The public `registerCustomer()` method on the `Tonder` class is being removed for two reasons:

1. **Redundancy.** The customer identity is already provided transparently through
   `config.customer`, set once at `createTonder()`. The private, memoized
   `ensureCustomerRegistered()` resolver added recently already get-or-creates the
   customer on first saved-card use. `registerCustomer()` is now a second, parallel
   path to do the same thing — extra public surface for zero capability.

2. **Security (customer-confusion).** A mutable/explicit customer setter on the client
   lets the integrator set customer A at init and switch to customer B before a
   saved-card operation, so the SDK could list or charge another customer's cards.
   The industry-correct model (Stripe) binds customer identity to a server-minted,
   customer-scoped credential (CustomerSession / ephemeral key) that the client
   CANNOT switch — a new customer means a new server credential. Therefore the SDK's
   customer must be **set-once and immutable** for an instance's lifetime via
   `config.customer`. There is no `setCustomer`, and there must be no
   `registerCustomer`.

This is a breaking change to the public surface, accepted because the package is
pre-publish (v0.1.0) with no external consumers.

## What Changes

1. **Remove the public `registerCustomer()` method** from the `Tonder` class
   (`src/tonder.ts` ~L618) and any export of it. The method ceases to exist.

2. **Simplify `ensureCustomerRegistered()`** (private, memoized, transparent). Resolve
   the customer ONLY from `config.customer` — drop the
   `state.customerInput`-from-`registerCustomer` branch (`src/tonder.ts` L778). It still
   calls `customerService.registerOrFetch` internally and caches the resulting auth
   token (memoized via `state.customerAuthToken`). `registerOrFetch` and
   `customer.service.ts` stay INTERNAL — no surface change there.

3. **`config.customer` is the only customer source and is effectively immutable** for
   the instance's lifetime. Late-binding or switching customers = recreate the SDK
   instance with a fresh `secureToken` scoped to that customer (the Stripe model).
   Document this as the supported path.

4. **Rename the error** `CUSTOMER_NOT_REGISTERED` (which references the removed
   "register" concept) to a customer-agnostic code — recommend `MISSING_CUSTOMER`
   (alternative: `CUSTOMER_REQUIRED`). Its message must point ONLY to `config.customer`,
   e.g. `"No customer set. Provide \`customer\` in createTonder() config."`. No
   "register" wording anywhere (`ErrorKeyEnum.ts` L36, `messages.ts` L43-44). Safe to
   rename outright — v0.1.0, no external consumers.

5. **Purge the README** (the npm-published consumer guide). Remove EVERY mention of
   `registerCustomer` (README L271, L297-298, L343-344). The saved-cards and enroll
   sections must show ONLY `config.customer`. Do NOT say "registerCustomer is optional"
   — the method won't exist. Update the `CUSTOMER_NOT_REGISTERED` reference (L299-300,
   L345) to the new error code with the config-only message. Target: zero
   `registerCustomer` references in the repository.

6. **Update tests:**
   - Delete `src/tonder.registerCustomer.test.ts`.
   - Remove explicit-register cases 2.3 and 2.4 from `src/tonder.customer.test.ts`
     (L138-173) — or repurpose them to assert `tonder.registerCustomer` is no longer a
     function.
   - Update `src/tonder.removeCustomerCard.test.ts` L82 (`readyWithCustomer` helper) to
     supply the customer via `config.customer` instead of calling `registerCustomer()`.

## Impact

- `src/tonder.ts` — remove `registerCustomer()`; simplify `ensureCustomerRegistered()`.
- `src/shared/errors/ErrorKeyEnum.ts` — rename `CUSTOMER_NOT_REGISTERED`.
- `src/shared/errors/messages.ts` — rename key + rewrite message (config.customer only).
- `src/shared/types/index.ts` — update `TonderConfig.customer` doc and `CustomerInput`
  doc that reference `registerCustomer()` (L32-36, L112).
- `src/core/TonderCore.ts` — review the `customerInput` state usage; keep only what the
  simplified resolver and `enrollCard` contact still need.
- `README.md` — full purge of `registerCustomer`; new error code in messages.
- `src/tonder.registerCustomer.test.ts` — delete.
- `src/tonder.customer.test.ts` — drop/repurpose cases 2.3, 2.4.
- `src/tonder.removeCustomerCard.test.ts` — config.customer in helper.
- `src/tonder.enrollCard.test.ts`, `src/tonder.getCustomerCards.test.ts` — review for
  `registerCustomer` / `CUSTOMER_NOT_REGISTERED` references and update to config.customer
  and the new error code.

## Non-goals

- `pay()` with a fresh card still sends the customer INLINE in the `/process` request —
  unchanged.
- No `setCustomer` is added. The customer stays set-once / immutable.
- No backend change in this change. NOTE for follow-up (defense in depth, out of scope):
  the backend should scope the `secureToken` to the customer so the client cannot
  operate on another customer's cards even at the transport layer.

## Risks

- **Breaking the transparent flow.** `ensureCustomerRegistered()` must still resolve from
  `config.customer`, get-or-create via `registerOrFetch`, and memoize the token. Verify
  with strict TDD that all COF ops (`enrollCard`, `getCustomerCards`, `removeCustomerCard`)
  still work end-to-end with only `config.customer`.
- **`resolveCardAuth` must yield a non-empty `userToken`.** The simplified resolver must
  not return an empty/undefined token for a valid `config.customer`. Cover with a test.
- **Incomplete README purge.** The README is the published consumer contract — a single
  stale `registerCustomer` mention misleads integrators. Grep for zero references before
  done.
- **`enrollCard` contact data.** `enrollCard()` reads `customerInput` (firstName /
  lastName / email) from state for the subscription contact. Ensure the simplified
  resolver still populates that contact from `config.customer` so enrollment names are
  not lost.
- **Error-code rename fanout.** All references to `CUSTOMER_NOT_REGISTERED` (tests,
  messages, README) must move to the new code in lockstep; a missed reference breaks the
  build or a test assertion.

## Constraints

- Public surface is camelCase, no `I`-prefix on types.
- No internal vendor names leak into the public surface.
- Breaking surface change, acceptable at v0.1.0 (pre-publish).
- English only across code, comments, docs, and copy.
- Strict TDD is active.
