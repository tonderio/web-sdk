# Archive Report — apple-pay-merchant-validation (Apple Pay Phase 4)

**Date**: 2026-08-03
**Project**: web-sdk
**Mode**: hybrid (openspec files + Engram)
**Note on sourcing**: this executor was instructed to treat the openspec files on disk as
authoritative over Engram, since Engram topics for this project had gone stale twice before
(once from an MCP outage, once from a spec amended after `sdd-spec` ran). In this run, the
Engram observations for proposal (#4020), verify-report (#4035), and apply-progress (#4026)
were read and cross-checked against the on-disk `proposal.md`, `design.md`, `tasks.md`, and
`specs/apple-pay/spec.md` — no disagreement was found between file and Engram content this
time. The archived copies of proposal/design/tasks/delta-spec in this folder are taken from
the on-disk files (source of truth); apply-progress.md and verify-report.md are transcribed
from the Engram observations, since no on-disk copies of those two exist for this change.

## Task Completion Gate

`tasks.md` on disk: 15/15 implementation tasks checked (`[x]`), across Phase 1 (RED, 1.1a-1.1i),
Phase 2 (GREEN, 2.1-2.5), Phase 3 (Verification, 3.1-3.4), Phase 4 (Commit, 4.1). No stale
unchecked boxes. Gate passed — proceeded to merge and archive.

## Spec Merge

Target: `openspec/specs/apple-pay/spec.md` (this change touches the `apple-pay` capability only).

- **Before**: 19 requirements.
- **After**: 26 requirements.
- **Action**: all 7 delta requirements were `ADDED` — none `MODIFIED`, `REMOVED`, or `RENAMED`.
  All 19 pre-existing requirements were preserved byte-identical; the 7 new ones were appended
  at the end of the file, after "Nothing added by the browser core is exported or reachable
  from merchant code."

### Requirements added (verbatim titles, in append order)

1. `validateMerchant() posts an empty body to the merchant-validation endpoint`
2. `event.validationURL is never sent to the backend`
3. `The merchant session response is returned opaque and unparsed`
4. `Transport failure wraps as APPLE_PAY_VALIDATION_ERROR`
5. `validateMerchant() holds no session state`
6. `The service depends only on the injected HttpPort`
7. `APPLE_PAY_VALIDATION_ERROR resolves to a cause-hedged, distinct message`

### Requirements left untouched

All 19 pre-existing requirements in `openspec/specs/apple-pay/spec.md`, spanning: `BusinessProfile`
declares `country_code`; catalog `configuration` field; `ErrorKeyEnum` six new codes; declared-but-
unreachable payment/option/customization types; `@types/applepayjs` dev-only; raw catalog fetch
during `init()`; availability gate; supported-networks derivation; merchantCapabilities derivation;
public availability wiring deferral; `ApplePayPort.canUseApplePay`; `createSession` handler-argument
shape; normalized session handlers; adapter construction/container-failure wrapping; button-port
render/dispose lifecycle; `buildApplePayPaymentRequest`; `buildApplePayPaymentMethod`;
`completePayment` v3 object form; browser-core non-reachability. None of these were read, edited,
or re-derived — only appended-after.

### Defect-pattern audit performed on the 7 promoted requirements

1. **Change-scoped wording check**: scanned all 7 ADDED requirement bodies and their scenario
   GIVEN/WHEN/THEN text for "this phase", "this change", "not yet", "before this change". None
   found. All 7 read as durable, phase-agnostic statements about `ApplePayService.validateMerchant()`
   ("MUST issue exactly one POST...", "MUST take no parameter...", "MUST return the HttpPort
   response unmodified...", etc.) — nothing forbids a later phase from doing required work, and
   nothing describes this archive event itself.
2. **Unsatisfiable-requirement check**: all 7 are runtime-testable and were runtime-verified per
   the verify report's 7/7 compliance matrix (all backed by passing vitest cases against a fake
   `HttpPort`, not by a compile-time assertion the type system cannot produce). None demand
   anything the current type system or test harness cannot prove.

No requirement was rejected or altered from the delta; the merge was a straight append.

## Decisions carried into canonical spec text (as written in the 7 added requirements)

- **Empty request body, nothing client-controlled travels.** Requirement 1's body: "with an
  empty body (`{}`) and no `Authorization` header set by the service itself — auth stays the
  transport's job." The backend resolves merchant identity from the `api_key` and the
  browser-set `Origin`; this is stated in the proposal (D1) and design (DD2 JSDoc) but is not
  itself asserted as spec prose beyond the empty-body/no-extra-field requirement — which is
  the enforceable surface.
- **`event.validationURL` is never sent — guaranteed at two layers, deliberately.** Requirement
  2 states the SDK-side half: `validateMerchant()` "MUST take no parameter carrying Apple's
  `event.validationURL`... No field name in the request MUST carry a client-supplied validation
  URL." This is the _second_ of two independent enforcement points, and the two are
  complementary, not redundant, exactly as instructed: Phase 3's port
  (`ApplePaySessionHandlers.onValidateMerchant()`, requirement "Session handlers are normalized
  so Apple's event objects never cross the port", already in the canonical spec at position 13)
  passes **zero arguments** to the handler — so the adapter has nothing to hand down. This
  change's requirement 2 closes the second layer: even if a URL were somehow available at the
  call site, `validateMerchant()`'s own signature has no parameter to receive it. Reopening the
  surface requires a deliberate signature change in **two** files (the port and the service).
  Recorded here explicitly so a later reader does not "deduplicate" the two requirements — they
  guard different files and both must hold.
- **No caching, no retry, no in-flight dedup — binds the SDK, not only the backend.**
  Requirement 5 ("validateMerchant() holds no session state") is explicit: "MUST NOT cache...
  MUST NOT retry... MUST NOT deduplicate concurrent in-flight calls... matching Apple's
  per-transaction, single-use, five-minute-expiry rules." Both scenarios (two-calls-two-requests,
  and a rejected call is not retried) are in the canonical spec now, closing the gap the verify
  report flagged as a real design/spec omission (design §5 only had the positive case; the 8th
  test and this scenario cover the negative case).
- **Opaque response — returned by identity, typed `unknown`, never parsed/cloned/reshaped.**
  Requirement 3: "MUST return the HttpPort response unmodified, typed `unknown`. The service
  MUST NOT parse, validate, reshape, or log it," with the scenario requiring byte-identical
  pass-through.
- **Error copy distinctness.** Requirement 7 preserves the binding shape from proposal D5: names
  an unregistered domain as the "most likely" cause without asserting it, and "MUST read as
  distinct from `APPLE_PAY_SESSION_ERROR`: this code describes the backend failing to **obtain**
  a merchant session from Apple, never the page failing to **start** a session." This is now
  permanent spec text, not just proposal narrative.

## Open items recorded for future changes (not resolved by this archive)

- **Backend endpoint contract remains unconfirmed with the backend team** (plan §8.2, owner
  Lenin at proposal time). The SDK's side is now a written, tested artifact (7 requirements,
  runtime-verified) the backend can be held to. The binding constraint that must survive any
  future contract negotiation: **any field the backend later requires must be resolvable by the
  SDK from data it already holds (business config or cached catalog) — never from Apple's
  event.** This is proposal D1/D7 (design DD7) carried forward as a review-time rule; no code
  enforces it today because no such field exists yet. Whoever lands the confirmed contract owns
  re-opening this line.
- **Three Apple Pay error codes still have no `MESSAGES_EN` entry**: `APPLE_PAY_NOT_ENABLED`,
  `APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_UNSUPPORTED_ACTION`. All three were declared in
  Phase 1 (`ErrorKeyEnum`) and confirmed still absent from `MESSAGES_EN` by this change's own
  verify report (no scope creep check). Per the established rule (Phase 3, reaffirmed by this
  change's D5): the change that first throws a code owns adding its message. Phase 5 is
  currently the presumed owner of all three, since it is the phase that wires the click handler,
  the `mount()` browser gate, and the unsupported-action guard — but ownership is determined by
  whichever change first constructs an `AppError` with that code, not by phase number alone.

## Verification summary (from Engram #4035, cross-checked against on-disk tasks.md)

PASS — 0 CRITICAL, 0 WARNING, 1 SUGGESTION (traceability-table gap, fixed in `1851d0d`, confirmed
present in the on-disk `tasks.md` read during this archive run). `npm run test`: 39 files / 415
tests. `npm run typecheck`, `npm run build`: clean. `npm run lint`: 2 pre-existing unrelated
errors, set unchanged. All 7 spec requirements runtime-verified with adversarial checks (mutation
test on the empty-body guarantee, side-by-side message-copy read, reachability greps).

I did not re-run any commands myself in this archive step — the test/typecheck/build/lint
results above are as reported by the verify phase and by the user's own re-run stated in this
task's instructions, not independently re-executed here.

## Traceability — observation IDs

| Artifact                       | Engram Topic Key                                   | Observation ID |
| ------------------------------ | -------------------------------------------------- | -------------- |
| Proposal                       | `sdd/apple-pay-merchant-validation/proposal`       | #4020          |
| Apply progress                 | `sdd/apple-pay-merchant-validation/apply-progress` | #4026          |
| Verify report                  | `sdd/apple-pay-merchant-validation/verify-report`  | #4035          |
| Archive report (this document) | `sdd/apple-pay-merchant-validation/archive-report` | saved this run |

Design and tasks artifacts were read from disk (`openspec/changes/apple-pay-merchant-validation/design.md`,
`tasks.md`) — no separate Engram `design`/`tasks` topic_keys were found or required for this
change; the files on disk were treated as authoritative per this task's instructions.

## Archive Contents

- `proposal.md` — copied verbatim from `openspec/changes/apple-pay-merchant-validation/proposal.md`
- `design.md` — copied verbatim from `openspec/changes/apple-pay-merchant-validation/design.md`
- `tasks.md` — copied verbatim (15/15 checked, includes the `1851d0d` traceability fix)
- `specs/apple-pay/spec.md` — copied verbatim (the delta, 7 ADDED requirements)
- `apply-progress.md` — transcribed from Engram #4026
- `verify-report.md` — transcribed from Engram #4035
- `archive-report.md` — this document

## Source of Truth Updated

`openspec/specs/apple-pay/spec.md` now reflects the new behavior: 26 requirements (19 preserved

- 7 added), Apple Pay merchant validation is a written, tested, permanent contract.

## What this executor did NOT do

- Did not delete `openspec/changes/apple-pay-merchant-validation/` (the original, un-archived
  folder). This executor has no shell/git access and was explicitly instructed not to attempt
  filesystem deletion. **The original change folder still exists alongside the new archive
  copy — the user or a follow-up step with shell access must remove it to complete the move.**
- Did not run `npm run test`, `typecheck`, `build`, or `lint`. All verification numbers in this
  report are carried over from the verify-report artifact and the user's stated re-run, not
  independently reproduced.
- Did not commit or push anything (no git access).

## SDD Cycle Status

Planned, implemented, verified, and now spec-merged and archived (file copy complete; original
folder removal pending, see above). Apple Pay Phase 4 is closed as a spec-and-artifact matter;
Phase 5 (session-lifecycle orchestration) is the next dependent phase and inherits: the
unconfirmed-backend-contract constraint, the three missing `MESSAGES_EN` entries, and the
two-layer `validationURL` non-forwarding guarantee.
