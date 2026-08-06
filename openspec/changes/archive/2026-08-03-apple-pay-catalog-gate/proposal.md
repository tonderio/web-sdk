# Proposal: Apple Pay Catalog Gate (Phase 2)

## Intent

Phase 2 of `docs/apple-pay-integration-plan.md`. The first phase with **runtime behavior**,
and the only one that changes an existing public method — which is why it is isolated.

Phase 1 declared `BackendPaymentMethod.configuration?` and nothing read it. This change makes
the catalog real: `init()` caches it, internal helpers derive Apple Pay availability, networks
and capabilities from it, and `getPaymentMethods()` stops leaking `apple_pay_*` entries to
merchants.

The filter is not cosmetic. Merchants render `getPaymentMethods()` as selectable options, so an
`apple_pay_debit_card` row is drawn as a generic APM and the merchant then calls
`pay({ payment_method: { type: 'apple_pay_debit_card' } })` — which cannot work, because Apple
Pay needs the button component and the user gesture. Leaking those entries hands merchants a
dead end that looks like a supported method.

## Scope

### In Scope

| Item                                                                                                                                                                                                      | File                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `init()` fetches business config **and** catalog via `Promise.all` — parallel, never chained                                                                                                              | `src/tonder.ts` (~L264)                                            |
| Catalog request is **non-fatal**: on rejection `init()` still reaches `ready`; card payments unaffected                                                                                                   | `src/tonder.ts`                                                    |
| Raw catalog cached in core state via `core.setState()`, alongside `business`                                                                                                                              | `src/core/TonderCore.ts`                                           |
| Raw-catalog fetch on `DirectApiService` (unmapped, unfiltered), reusing the existing path and error code                                                                                                  | `src/core/services/direct-api.service.ts`                          |
| `getPaymentMethods()` filters out every `apple_pay_*` entry, in the existing mapping layer                                                                                                                | `src/core/services/direct-api.service.ts`                          |
| Internal helpers over active `apple_pay_*` entries: availability gate, deduplicated `supported_networks` union with `DEFAULT_APPLE_PAY_NETWORKS = ['visa','masterCard']` fallback, `merchantCapabilities` | new internal module (design decides placement; `core/` stays pure) |
| README note: `getPaymentMethods()` never returns Apple Pay entries, and why                                                                                                                               | `README.md`                                                        |

### Out of Scope

Ports, adapters, strategies, `ApplePaySession`, browser detection, the button component,
`create('apple_pay_button')`, `validate-merchant`, `events.payment` wiring, and the **public**
`tonder.isApplePayAvailable()`.

The public method cannot land here: it also needs browser detection, which arrives with the
adapter in Phase 3. Wiring it now would promise a runtime that does not exist — inherited
decision **D3 / DD2** (declare, do not wire). This phase ships the **internal** helper only.
No README changes beyond the one note.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-method-discovery`: `getPaymentMethods()` MUST omit every `apple_pay_*` entry.
  Every non-Apple-Pay method is unchanged.
- `apple-pay`: catalog runtime — parallel non-fatal fetch, raw caching, availability gate,
  network union with fallback, capability derivation.
- `public-api`: `init()` gains a second concurrent request whose failure is non-fatal.

**Delta targets.** `apple-pay-foundation` is being archived before `sdd-spec` runs for this
change, so these deltas target the canonical capability specs — `openspec/specs/apple-pay/`
and `openspec/specs/public-api/` — not the phase-1 change folder. Deferring that archive would
force every later Apple Pay phase to delta against a change folder, and the deltas would stack.

## Approach

**Cache raw, filter at the public boundary.** This is the load-bearing design point.

```
init() → Promise.all([business, catalog]) → cache the RAW catalog in state
                                                  │
        ┌─────────────────────────────────────────┴──────────────────────┐
        ▼                                                                ▼
internal helpers (availability, networks, capabilities)          getPaymentMethods()
READ apple_pay_* entries                                         FILTERS them OUT
```

Filtering before caching would destroy the data the gate depends on. Filtering in the existing
`mapPaymentMethod` layer keeps exactly one place where an entry can be dropped.

### Decisions

**D1 — The catalog request is non-fatal, and that is the safety property.** `init()` has one
`await` and one failure mode today. Adding a second request changes its failure semantics; the
non-fatal rule is what keeps that safe. A catalog outage must not take down card checkout —
that would be a new failure mode where none exists today. Verified by its own test.

**D2 — Parallel, never chained.** Two sequential round trips at `init()` would be paid by every
merchant. `Promise.all` with the rejection handled per-request (the catalog leg absorbs its own
failure) rather than a bare `Promise.all` that would reject the business leg too.

**D3 — `getPaymentMethods()` keeps issuing its own request; the cache is internal-only.**
This is an explicit decision, not an omission — cache-served reads will be proposed again as an
optimization, and the answer belongs here in writing.

1. **Primary reason — the non-fatal rule and a cache-served read are in direct tension.** D1
   guarantees `init()` reaches `ready` when the catalog request fails, which leaves the cache
   **empty**. A cache-served `getPaymentMethods()` would then return `[]` instead of the
   merchant's real methods. The rule that protects card checkout would silently break catalog
   discovery. That is a correctness bug, not a latency trade, and it surfaces as "my payment
   methods disappeared" with nothing in the logs.
2. It would change the same public method **twice** in one phase — filter _and_ transport — in
   the phase whose entire value is isolating one behavior change.
3. It contradicts the standing requirement in `openspec/specs/payment-method-discovery/spec.md`
   that the call issues `GET /api/v1/payment_methods?status=active`.

Cache-with-fetch-fallback remains a possible future change **if anyone actually measures a
problem**. It is not this one, and caching does not imply it.

**D4 — The internal gate is catalog-only.** `hasActiveApplePayMethod(catalog)` answers "is any
`apple_pay_*` active". The `country_code` check and browser detection compose on top of it in
the phases that own them (plan §3), so this helper stays testable with no browser and no
business fixture.

> **Supersedes phase 1.** The `apple-pay-foundation` design's forward table stated the gate as
> the combined form — "at least one active `apple_pay_*` method **and** a non-empty
> `country_code`". D4 splits it deliberately: one responsibility per helper. Neither statement
> is a mistake; D4 is the later one and wins.

**D5 — Strict TDD genuinely applies.** Phase 1 was a compile-time surface where `expectTypeOf`
assertions are erased and never checked (`tsconfig.json:20` excludes `**/*.test.ts`; `npm run
test` is `vitest run` with no `--typecheck`). This phase is runtime behavior, so vitest actually
enforces it. RED/GREEN is real: failing test first, then the implementation.

### Work units

Commits only — **no pull requests**. Three reviewable units:

1. `init()` parallel + non-fatal fetch + raw catalog in core state
2. `getPaymentMethods()` filter + README note (the only merchant-visible change)
3. Internal derivation helpers (availability, networks, capabilities) — pure, no I/O

Green between units: `npm run test`, `npm run typecheck`, `npm run build`.

Binding constraints (plan §7): `core/` stays pure — no DOM/HTTP imports; named exports,
tree-shakeable; snake_case on every merchant-facing key; no duplicated interfaces — reuse
`PaymentMethodInfo`, `HttpPort`, `AppError`, `ErrorKeyEnum`; no unnecessary validation; test
doubles only in `*.test.ts`.

## Affected Areas

| Area                                      | Impact   | Description                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------ |
| `src/tonder.ts`                           | Modified | `init()` parallel + non-fatal catalog leg                    |
| `src/core/TonderCore.ts`                  | Modified | New state slot for the raw catalog                           |
| `src/core/services/direct-api.service.ts` | Modified | Raw-catalog fetch; `apple_pay_*` filter in the mapping layer |
| new internal module                       | New      | Availability / networks / capabilities derivation (pure)     |
| `README.md`                               | Modified | One note on the `getPaymentMethods()` filter                 |

## Risks

| Risk                                                                                                                    | Likelihood | Mitigation                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A catalog outage takes down card checkout — a new failure mode where none exists today                                  | **Med**    | D1: non-fatal by contract, with a dedicated test asserting `init()` still reaches `ready` and `pay()` still works                          |
| Every merchant pays one extra `init()` request, including those never using Apple Pay                                   | **Med**    | Accepted and stated, not slipped in: it keeps the later `isApplePayAvailable()` synchronous. Parallel (D2), so latency is `max`, not `sum` |
| The filter regresses an existing public method                                                                          | **Med**    | Non-regression tests for every non-Apple-Pay method; the filter matches the `apple_pay_` prefix only                                       |
| Someone "finishes the job" by wiring the public `isApplePayAvailable()`                                                 | **Med**    | Out of scope by D3/DD2; success criteria verify its absence                                                                                |
| Filtering before caching destroys the gate's data                                                                       | Low        | Explicit in the approach diagram; verified in both directions by test                                                                      |
| Pre-existing red `npm run lint` (`tonder.handleRequiresAction.test.ts:184`, `tonder.pay.test.ts:483`) masks a new error | Low        | Tracked separately, not fixed here; compare the lint error set before and after                                                            |

## Rollback Plan

Revert the three commits in reverse order. Unit 3 is pure and unreferenced by any public
surface. Unit 2 alone restores the previous `getPaymentMethods()` output. Unit 1 alone restores
the single-request `init()`. No persisted data, no backend contract change, no migration.

## Dependencies

- Backend ships `apple_pay_debit_card` / `apple_pay_credit_card` with
  `configuration.supported_networks` in `GET /payment_methods?status=active`. **Never
  blocking**: absent entries mean Apple Pay simply unavailable, and absent
  `supported_networks` falls back to `['visa','masterCard']`.
- `apple-pay-foundation` (Phase 1) — implemented and verified on this branch, and **archived
  before `sdd-spec` runs for this change** so the deltas target the canonical capability specs.

## Success Criteria

- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass
- [ ] A catalog with both `apple_pay_*` entries yields `getPaymentMethods()` results with
      neither, while the internal gate still sees them — both directions of the
      cache-raw / filter-at-the-boundary split verified
- [ ] A rejecting catalog request leaves `init()` at `ready`, with card payments unaffected
- [ ] The two requests are proven **concurrent**, not chained
- [ ] Networks resolve for: both methods, one method, and neither carrying
      `configuration.supported_networks` (fallback), always deduplicated
- [ ] Capabilities resolve for all three activation shapes — both, debit only, credit only —
      with `supports3DS` present in every case
- [ ] No regression in `getPaymentMethods()` for every non-Apple-Pay method
- [ ] No public `isApplePayAvailable()`, no new `src/index.ts` export
- [ ] README states the filter and why; no other README change
- [ ] `core/` imports no DOM or HTTP module; no file under `src/` exists only for testing

## Open questions

None. D3 and D4 were raised for review and confirmed; both are recorded above as decisions.
