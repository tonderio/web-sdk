# Proposal: Apple Pay Merchant Validation Service (Phase 4)

## Intent

Phase 4 of `docs/apple-pay-integration-plan.md` §6. The smallest phase in the plan: one
service, one method, one endpoint.

`ApplePayService.validateMerchant()` performs the backend round trip that turns Apple's
`onvalidatemerchant` event into a `merchantSession` the payment sheet will accept. It posts an
**empty body** to `POST /api/v1/payments/apple-pay/validate-merchant/` over the injected
`HttpPort`, returns the opaque response untouched, and wraps any transport failure as
`AppError(APPLE_PAY_VALIDATION_ERROR)`.

Two reasons this is its own phase rather than a few lines inside Phase 5's orchestration:

1. **The empty body is the design, and it deserves to be reviewed on its own.** What the SDK
   deliberately does _not_ send is the entire security content of this change (§ Approach, D1).
   Buried inside the Phase 5 diff — click handling, session lifecycle, response mapping,
   `create()` wiring, README — it reads as three lines of boilerplate and nobody looks twice.
2. **The endpoint contract is not yet confirmed with the backend** (plan §8.2). Landing the
   client half first makes the contract a written, tested artifact the backend can be held to,
   instead of something discovered mid-Safari in Phase 7.

Nothing here is reachable from merchant code. The service has no consumer until Phase 5.

## Scope

### In Scope

| Item                                                                                                                                                                                  | File                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ApplePayService` with `validateMerchant(): Promise<unknown>` over the injected `HttpPort` — `POST /api/v1/payments/apple-pay/validate-merchant/`, body `{}`, response returned as-is | `src/core/services/apple-pay.service.ts` (new)      |
| Transport failure wrapped as `AppError(APPLE_PAY_VALIDATION_ERROR)`, following the `DirectApiService` pattern verbatim                                                                | same file                                           |
| Exactly **one** `MESSAGES_EN` entry — `APPLE_PAY_VALIDATION_ERROR` (plan §5.2 forward constraint: the change that first throws a code owns its message)                               | `src/shared/errors/messages.ts`                     |
| Tests against a fake `HttpPort`: success passes the opaque body through; failure wraps; the exact method/path; and **nothing client-derived is sent**                                 | `src/core/services/apple-pay.service.test.ts` (new) |

### Out of Scope

**The orchestration that calls this — all of Phase 5.** The `onValidateMerchant` handler,
`session.completeMerchantValidation(merchantSession)`, `session.abort()` on failure, and
`config.events.payment.on_error(...)`. This change ships the round trip; the phase that owns
the session lifecycle wires it.

**Every form of reachability (inherited D3).** No `src/index.ts` export, no instantiation from
`src/tonder.ts`, no key on any public config type. The service is constructed for the first
time in the change that gives it behavior.

**The four remaining `MESSAGES_EN` entries.** `APPLE_PAY_SESSION_ERROR` and
`APPLE_PAY_CONTAINER_NOT_FOUND` landed in Phase 3. `APPLE_PAY_NOT_ENABLED`,
`APPLE_PAY_UNSUPPORTED_BROWSER` and `APPLE_PAY_UNSUPPORTED_ACTION` are still owed by Phase 5.

**Retries, caching, timeouts, and session reuse.** Named here because the Apple constraints in
D3 make them actively wrong, not merely unnecessary.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `apple-pay`: adds the merchant-validation request contract, the empty-body / no-`validationURL`
  guarantee, the opaque-response guarantee, and the failure-wrapping rule. Delta targets
  `openspec/specs/apple-pay/spec.md`.

## Approach

### The contract, in full

```
POST {api}/api/v1/payments/apple-pay/validate-merchant/
Authorization: Token <api_key>          ← attached by the transport, not by this service

{}
```

Response: Apple's opaque `merchantSession`, returned verbatim.

The whole client-side surface is that block. Everything below explains why it is that small.

### D1 — The request body is empty by design, and that is the point of this phase

The backend resolves `merchantIdentifier`, `displayName` and `initiativeContext` from the
business tied to the `api_key`, using the browser-set `Origin` header to pick the domain when a
merchant has several registered. **Nothing client-controlled travels.**

Two independent reasons, and both matter:

| Reason                       | Detail                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple's current guidance** | The validation URL is the static hostname `apple-pay-gateway.apple.com` (`docs/apple-pay/ApplePaySession.md:303-309`). Forwarding the event's `validationURL` is the _legacy_ path Apple still supports for existing implementations — not the one a new integration should adopt                                                                                     |
| **SSRF surface**             | The backend holds the Apple merchant certificate. Letting the browser choose where a certificate-bearing server connects is a server-side request forgery surface with no upside. **The SDK not sending it is what removes the surface** — not the backend validating it away. A backend allowlist is a second line of defense against a hole this change never opens |

`event.validationURL` is therefore never read. Phase 3 already enforced the first half of this
at the port boundary: `ApplePaySessionHandlers.onValidateMerchant()` takes **no arguments**, so
the adapter cannot hand a URL to anything (`openspec/specs/apple-pay/spec.md` — "Session
handlers are normalized"). This change enforces the second half: even if a URL were available,
the service has no parameter to receive it. The two halves together make forwarding it require
a deliberate signature change in two files, which is exactly the friction it deserves.

### D2 — The response is `unknown`, and stays `unknown`

`merchantSession` is opaque by Apple's own definition — `completeMerchantValidation(any
merchantSession)` (`ApplePaySession.md:313-325`). The SDK is a courier: it does not parse it,
does not validate it, does not log it, and does not type it beyond `unknown`.

Inventing a shape would be worse than useless. It would be a guess about a payload Apple can
change without notice, it would tempt a future author to assert on fields, and the first
divergence would surface as a type error in the SDK for a payload that is perfectly valid to
Apple.

`unknown` rather than `any` so the value cannot be dereferenced accidentally — the only legal
thing to do with it is pass it on.

### D3 — Apple's session rules, recorded because they constrain the SDK too

`ApplePaySession.md:331-335`:

| Rule                                                    | Consequence for the SDK                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A **new** merchant session per transaction              | Never reuse one across payment attempts                                                |
| **Single use**                                          | Never retry `completeMerchantValidation` with a session already spent                  |
| Expires **five minutes** after creation                 | Never cache. A cached session is either already used or about to expire                |
| The request must come from the server, never the client | Already satisfied: the certificate lives on the backend and the SDK only calls our API |

Operationally this means `validateMerchant()` is a **plain call with no memory** — no cache
field, no in-flight deduplication, no retry. Those are all normal service-layer additions that
would each be a correctness bug here. Recording them as forbidden is cheaper than someone
adding a "harmless" cache in six months.

The backend must respect the same rules; the SDK cannot verify that it does, and does not try.

### D4 — Its own service, not a method on `DirectApiService`

Plan §5 assigns this to `src/core/services/apple-pay.service.ts`. Worth stating why, since
`DirectApiService` already wraps `HttpPort` the same way:

`DirectApiService` is the `/process` + transaction + catalog surface, already consumed by
`pay()`, `getPaymentMethods()` and the polling path. Adding an Apple-Pay-only method there
couples every existing caller's module graph to a wallet they may never use, and blurs a class
that currently has one clear subject. A separate service also keeps Phase 5's constructor
honest: the orchestration declares exactly which collaborators it needs.

What is **not** duplicated: the `try` / `catch` / `throw new AppError({ errorCode,
originalError })` pattern is copied from `DirectApiService` deliberately — it is the codebase's
established shape for a transport wrapper (`processPayment`, `getTransaction`,
`getPaymentMethodCatalog`, `getPaymentMethodBanks` are all identical in structure). Abstracting
it into a shared helper is a separate refactor with a much larger blast radius, and is not this
change.

### D5 — One `MESSAGES_EN` entry, in this change

`APPLE_PAY_VALIDATION_ERROR` was declared in Phase 1 and has never been thrown. `MESSAGES_EN`
is `Record<string, string>` and not exhaustive, so nothing forces the entry — `AppError`
silently falls back to the `UNKNOWN_ERROR` copy ("An unexpected error occurred.") for any code
it does not know.

Phase 3 established the working rule and applied it to two codes: **the change that first
throws a code adds its `MESSAGES_EN` entry.** This change throws this one, so it adds exactly
one — no more, no less.

The copy follows the existing "what failed, then the actionable fix" style set by Phase 3's own
two entries (`src/shared/errors/messages.ts:63-66`), and must not leak Apple or backend
internals. A bare "Merchant validation failed." would be the outlier among its own siblings.

**Name the likely cause as a cause, not as an assertion.** The failure this code most often
describes in production is an **unregistered merchant domain** (plan §8.2 note) — an
operational step outside the SDK — but the same code also covers an ordinary transport failure,
so the copy must be accurate in both branches:

> Could not obtain an Apple Pay merchant session from Apple. The most likely cause is a domain
> that is not registered with Apple for this merchant; it can also be a temporary failure
> reaching the validation service.

**The distinction from `APPLE_PAY_SESSION_ERROR` must be visible in the copy itself.** That code
already mentions "a domain registered with Apple", so two codes now point at domain
registration and a merchant debugging at 2 AM must be able to tell which one they are holding:

| Code                         | What failed                                                                   | Where                                   |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `APPLE_PAY_SESSION_ERROR`    | The **page** could not start a session — HTTPS, the served domain, the amount | In the browser, before any network call |
| `APPLE_PAY_VALIDATION_ERROR` | The **backend handshake with Apple** did not return a merchant session        | Server-side, after the sheet opened     |

"Could not **obtain** a merchant session **from Apple**" carries that distinction in the opening
clause: it describes a handshake that returned nothing, not a session that failed to start. The
wording above is the binding shape; the spec may tighten the words, but must preserve both the
cause-not-assertion hedge and the visible separation from `APPLE_PAY_SESSION_ERROR`.

Deeper guidance belongs in the README error table's "How to fix" column — where a merchant looks
second — and ships with Phase 5. The message stays short.

### The open question, and why it does not block

Plan §8.2 records that the endpoint contract is **not yet confirmed with the backend** (owner:
Lenin): whether it can resolve everything from the `api_key` plus `Origin` with an empty body,
and where `displayName` comes from.

It does not block this change:

- `HttpPort` is injected, so the service is built and fully tested against a fake. No backend,
  no network, no Safari.
- Stating plainly what the SDK sends and what it expects back turns the contract into a written
  artifact the backend can be held to.
- **If the backend ends up requiring a field**, adding one is a small, localized change: one
  parameter, one body key, one test. The service has a single method and a single caller-to-be.
- **What must not change in that case**: the SDK still never sends `event.validationURL`. Any
  added field must be resolvable by the SDK from data it already holds (business config,
  catalog) — never from Apple's event.

The genuine risk is not "the contract changes"; it is "the contract changes into something
client-supplied". D1 is the line that must hold.

### Work units

**Commits only — no pull requests.** One work unit, green on `npm run test`,
`npm run typecheck` and `npm run build`:

1. `apple-pay.service.ts` + its test + the single `MESSAGES_EN` entry. The message entry ships
   in the same commit as the first throw of its code, matching Phase 3.

**Strict TDD applies and genuinely bites here.** Unlike Phase 1's erased type assertions, this
is runtime behavior over an injected port — vitest can and does enforce it. Test first.

Binding constraints (plan §7): `core/` stays pure (no DOM, no `fetch`, only the injected
`HttpPort`); reuse `AppError`, `ErrorKeyEnum` and `HttpPort` — no new error class, no duplicated
interface; no unnecessary validation, because there is no client input to validate; test doubles
live in `*.test.ts` and never under `src/`; snake_case on any public surface (none here).

## Affected Areas

| Area                                          | Impact    | Description                                                               |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| `src/core/services/apple-pay.service.ts`      | New       | `validateMerchant()` over `HttpPort`; the only file with real logic       |
| `src/core/services/apple-pay.service.test.ts` | New       | Fake `HttpPort`; success, failure, exact path, and the absence assertions |
| `src/shared/errors/messages.ts`               | Modified  | Exactly one entry: `APPLE_PAY_VALIDATION_ERROR`                           |
| `src/shared/errors/ErrorKeyEnum.ts`           | Unchanged | The code already exists from Phase 1                                      |
| `src/index.ts`                                | Unchanged | Verified by absence                                                       |
| `src/tonder.ts`                               | Unchanged | The service is not constructed until Phase 5                              |

## Risks

| Risk                                                                                                                            | Likelihood | Mitigation                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The backend rejects an empty body and someone "fixes" it by forwarding `event.validationURL`                                    | **Med**    | D1 states the rule in two places; the port already passes no arguments to `onValidateMerchant`; a spec scenario asserts the body carries no URL and no client-derived field |
| The unconfirmed contract (plan §8.2) needs a field, discovered in Phase 7                                                       | **Med**    | Written contract lands now so the backend can confirm before Safari. Adding a field is one parameter and one test; the SSRF constraint is what may not move                 |
| Someone adds caching, retry or in-flight deduplication as a "normal" service improvement                                        | Low        | D3 records the Apple rules that make each of them a correctness bug: single use, per transaction, five-minute expiry                                                        |
| A future author types the response to assert on fields                                                                          | Low        | D2; the response is `unknown`, and a spec scenario asserts pass-through of an arbitrary opaque value                                                                        |
| Two codes now point at domain registration — a merchant cannot tell `APPLE_PAY_VALIDATION_ERROR` from `APPLE_PAY_SESSION_ERROR` | **Med**    | D5 makes the distinction part of the copy itself: page-cannot-start-a-session vs backend-handshake-returned-none. A success criterion checks the two read as distinct       |
| The copy asserts an unregistered domain when the real cause was a transport blip, sending Support down the wrong path           | **Med**    | D5's wording hedges — "most likely cause… it can also be a temporary failure reaching the validation service" — so it is accurate in both branches                          |
| The `MESSAGES_EN` copy drifts from the three entries Phase 5 still owes                                                         | Low        | Written in the existing style; Phase 5 reviews all six codes together when it adds the last three                                                                           |
| Pre-existing red `npm run lint` (`src/tonder.handleRequiresAction.test.ts:184`, `src/tonder.pay.test.ts:483`) hides a new error | Low        | Compare the lint error set before and after; do not fix the two                                                                                                             |

## Rollback Plan

Revert the single commit. The service file is new and has no importer outside its own test; the
`MESSAGES_EN` entry is additive and reverting it only restores the `UNKNOWN_ERROR` fallback for
a code nothing throws. No public surface, no persisted data, no migration, no backend
dependency.

## Dependencies

- Phase 1 (`apple-pay-foundation`) — archived. Supplies `ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR`.
- Phase 3 (`apple-pay-browser-core`) — archived. Establishes the no-`validationURL` port
  boundary this change mirrors, and the `MESSAGES_EN` working rule.
- `HttpPort` (`src/ports/http.port.ts`) and `AppError` — existing, unchanged.
- Backend: **not confirmed**. Deliberately not a blocker — see § The open question.

## Success Criteria

- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass
- [ ] `validateMerchant()` issues exactly one `POST` to
      `/api/v1/payments/apple-pay/validate-merchant/`, asserted on the fake `HttpPort`
- [ ] The request body is empty, and **no client-derived value is sent** — specifically no
      `validationURL`, no `merchant_identifier`, no `domain_name`, no `initiative_context`
- [ ] The service sets no `Authorization` header itself; auth stays the transport's job
- [ ] An arbitrary opaque success response is returned **byte-identical**, unparsed and typed
      `unknown`
- [ ] A rejecting `HttpPort` produces `AppError` with code `APPLE_PAY_VALIDATION_ERROR`, with
      the original error preserved via `originalError`
- [ ] `MESSAGES_EN` gains exactly one entry, and `AppError` no longer falls back to the
      `UNKNOWN_ERROR` copy for `APPLE_PAY_VALIDATION_ERROR`. The three codes Phase 5 owes still
      have none
- [ ] That entry names the unregistered domain as the **most likely** cause without asserting
      it, stays accurate for a plain transport failure, and reads as distinct from
      `APPLE_PAY_SESSION_ERROR` — which also mentions domain registration but describes the
      page failing to start a session, not the backend handshake returning none (D5)
- [ ] The service holds no state: no cache field, no retry, no in-flight deduplication (D3)
- [ ] `src/index.ts` exports nothing new; `src/tonder.ts` is unchanged; the service has no
      importer outside its own test
- [ ] `core/` imports no DOM or `fetch` — only the injected `HttpPort`
- [ ] The lint error set is identical before and after

## Proposal question round — resolved

| #   | Question                                                                                                                               | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | If the backend comes back requiring a field, is _any_ field acceptable, or only fields the SDK can resolve from data it already holds? | **Only the latter.** A field sourced from Apple's event — `validationURL` above all — reopens the SSRF surface D1 closes. A field the SDK derives from the business config or catalog is a small, localized change: one parameter, one body key, one test. This is the line that must hold when the contract is confirmed                                                                                                                                                                                                                            |
| 2   | Should the copy for `APPLE_PAY_VALIDATION_ERROR` point at domain registration specifically?                                            | **Yes — as the likely cause, never as an assertion.** Phase 3's two entries already set the "what failed, then the fix" convention, so a bare "Merchant validation failed." would be the outlier among its own siblings. The copy names the unregistered domain as _most likely_ while still covering the transport-failure branch, and must stay visibly distinct from `APPLE_PAY_SESSION_ERROR`, which also mentions domain registration — that code is about the **page**, this one about the **backend handshake**. See D5 for the binding shape |
| 3   | Is a validation failure retryable from the merchant's point of view?                                                                   | **No, and the SDK will not retry.** D3's single-use / per-transaction / five-minute rules mean a fresh session requires a fresh transaction — a retry would replay a spent session. Phase 5 aborts the sheet and reports the error; the shopper starts a new payment                                                                                                                                                                                                                                                                                 |
| 4   | Does anything need to be observable about this call — timing, failure rate, correlation id?                                            | **Nothing is added here.** No logging, no metric, no request id. Adding observability to a call with no consumer is speculative; if Support needs to correlate a failed validation with a backend log, that is a contract addition owned by the change that has real traffic to observe                                                                                                                                                                                                                                                              |

No open questions remain. Scope is frozen at the three files in Affected Areas.

**Confirmed on review**: D3 and D4 stand as written. D4 because an unargued file placement is
what a later refactor "tidies up" — the plan assigns the file but never defends it. D3 because
caching, retry and in-flight deduplication are each a normal optimization a reviewer would wave
through, and each would silently break a payment by replaying a spent session.
