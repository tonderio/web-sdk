# Archive Report — apple-pay-business-gate

**Change**: Apple Pay availability moves from the payment-method catalog to the
root-level `apple_pay` block on the business config. Mode: `openspec` (files
are authoritative; Engram observation IDs recorded below for traceability
only). Archived: 2026-08-04.

**Nature of this merge**: unlike the four prior archives on this project, this
merge is predominantly MODIFIED (7 of 10 apple-pay delta requirements) and
REMOVED (3 of 10), not ADDED. Three canonical requirements were deleted
outright; seven were rewritten in place under byte-identical titles used as
merge anchors.

## Verification report referenced

Engram `sdd/apple-pay-business-gate/verify-report` (#4051): **PASS** — 0
CRITICAL, 0 blocking WARNING, 3 non-blocking SUGGESTION. 491/491 tests across
43 files, `npm run typecheck` clean, `npm run build` clean, `npm run lint` at
its two pre-existing unrelated errors (`src/tonder.handleRequiresAction.test.ts:184`,
`src/tonder.pay.test.ts:483`), no third. The three SUGGESTIONs were:

1. tasks.md §7.3's literal `rg 'mapPaymentMethod' src/` over-matches
   (`mapPaymentMethodBank`, a JSDoc mention) — checklist wording issue, not a
   code defect. Tighten to `rg -w` or file-scope it in future changes.
2. Pre-existing, repo-wide gap: no pipeline command type-checks `*.test.ts`
   files (`tsconfig.json` excludes them; `npm run typecheck` runs the same
   `tsc --noEmit`). Not introduced by this change (confirmed unchanged against
   `9dc34db`). Recommend a follow-up ticket; out of scope here.
3. `business.model.ts:33-39`'s `country_code` comment ("Declared only —
   nothing reads it in this phase") is stale — `isApplePayAvailable()` and
   `mount()` now read it — but predates this branch (unchanged against
   `9dc34db`), so it is not a regression this change introduced. Left for the
   phase-7 general comment sweep, per the proposal's own scoping.

Task-completion gate: `openspec/changes/apple-pay-business-gate/tasks.md`
shows all 7 phases (WU1–WU6 plus Phase 7 survivor verification) fully checked
— no unchecked implementation tasks. Archive proceeded without any
reconciliation exception.

## Spec merge — apple-pay (`openspec/specs/apple-pay/spec.md`)

Requirement count: **36 → 33** (matches the proposal's stated expectation).

### MODIFIED in place (7) — title used as merge anchor, byte-identical

| Requirement                                                              | What changed                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| BusinessProfile declares country_code; no ApplePayConfig exists anywhere | Inverted: `ApplePayConfig` now exists, declared once on `BusinessConfig.apple_pay`                                   |
| Apple Pay supported-networks derivation                                  | Source is the `apple_pay` block, not the catalog union; no dedup, no case normalization                              |
| Apple Pay merchantCapabilities derivation                                | Source is the `apple_pay` block's `supports_debit`/`supports_credit`, not active catalog entries                     |
| Public Apple Pay availability wiring waits for its full runtime          | Composition is `canUseApplePay() && apple_pay?.enabled === true && country_code` — no catalog gate                   |
| buildApplePayPaymentRequest is a pure builder of Apple's request shape   | Helpers take the `apple_pay` block, not the catalog; test assertion changed from resolver-equality to literal values |
| mount() runs four ordered gates, each with its own error code (D7)       | Row 3 reads `business.apple_pay?.enabled` + `country_code`, not the catalog gate                                     |
| Apple Pay error codes exist in ErrorKeyEnum                              | `APPLE_PAY_NOT_ENABLED`'s documented meaning updated to the business flag, not "no active catalog entry"             |

### REMOVED (3) — deleted entirely, with Reason/Migration recorded in the delta

| Requirement                                                    | Reason                                             | Migration                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Raw payment-method catalog is fetched and cached during init() | Cache had no reader once the gate moved            | None — `getPaymentMethods()` still fetches its own catalog on every call      |
| Apple Pay availability gate reads the cached catalog only (D4) | No cached catalog left to read                     | Superseded by the MODIFIED "Public Apple Pay availability wiring" requirement |
| Catalog transport type declares an unread configuration field  | `BackendPaymentMethod.configuration` had no reader | Equivalent fields declared on `ApplePayConfig`                                |

### Untouched (26)

All other apple-pay requirements (types/customization declarations, browser
port, session/adapter behavior, click-path synchrony, merchant validation,
completePayment/outcome mapping, oncancel, unmount, the shared `/process`
body builder, the `pay({ type: 'apple_pay' })` runtime guard, and the
MESSAGES_EN completeness requirement) were not part of this delta and were
preserved verbatim.

## Spec merge — public-api (`openspec/specs/public-api/spec.md`)

Requirement count: **8 → 8** (one requirement modified in place, none
added/removed). "init() fetches business config and the Apple Pay catalog
concurrently; the catalog leg is non-fatal" now describes exactly one
request, matching the design's DD1 (`Promise.all` removed, plain `await`
restored). Every other public-api requirement is untouched.

## Spec merge — payment-method-discovery (`openspec/specs/payment-method-discovery/spec.md`)

Requirement count unchanged (2: "Fetch Payment Methods", "Fetch APM Banks").
"Fetch Payment Methods" was modified in place, but narrowly, per the
design's WU6 scope guard: only the last constraint (cache-avoidance wording)
and one scenario changed. The filter requirement itself — MUST exclude
`apple_pay_*` entries — its other constraints, and its other three scenarios
are untouched, confirming this requirement remains the load-bearing
guarantee the whole change depends on: `getPaymentMethods()` still excludes
both `apple_pay_*` payment methods from what a merchant can render as a
selectable option.

## KNOWN RESIDUAL FINDING — not hand-patched, reported as instructed

Post-merge check of `rg 'paymentMethodCatalog|hasActiveApplePayMethod' openspec/specs/`
(the exact command named in the proposal's own Success Criteria and in this
task's verification instructions): **one hit remains**, in
`openspec/specs/apple-pay/spec.md`, inside the `(Previously: ...)` historical
annotation attached to the merged "Public Apple Pay availability wiring waits
for its full runtime" requirement:

> (Previously: composed `port.canUseApplePay() &&
hasActiveApplePayMethod(state.paymentMethodCatalog) &&
Boolean(state.business?.business.country_code)` — the catalog gate stood in
> for the business's `apple_pay.enabled` flag.)

This is **not** the same hit the pre-merge canonical spec had (that one was in
the operative requirement body — `port.canUseApplePay() &&
hasActiveApplePayMethod(state.paymentMethodCatalog) && ...` as the method's
actual return statement — and it is gone; the merged requirement's operative
text now reads `business.apple_pay?.enabled === true`, with no trace of the
old identifiers). The residual hit is newly introduced by the delta spec's
own `(Previously: ...)` footnote, which the delta's author (validated by
`sdd-apply`/`sdd-verify` as matching shipped behavior, per tasks.md §6.1) quoted
verbatim for historical context. I merged the requirement using the delta's
text exactly as authored — per this task's explicit instruction not to
hand-patch — so this residual hit was carried in unchanged rather than edited
by me.

Two notes on scope, for whoever resolves this:

- Every other `(Previously: ...)` annotation in this merge (and in the
  pre-existing canonical spec, e.g. the "Payment, option, and customization
  types" and "Nothing added by the browser core" requirements) describes past
  behavior in prose, without quoting removed source-code identifiers verbatim.
  This one footnote breaks that established pattern.
- This is a documentation-only residual (inside a historical footnote, not
  operative requirement text) and does not affect `src/`, which is clean —
  the verify-report already confirmed zero hits there. It does mean the
  proposal's own stated `openspec/specs/` grep criterion is not fully
  satisfied to the letter.

**Recommendation**: a follow-up correction editing just that one footnote
(dropping the literal `hasActiveApplePayMethod(state.paymentMethodCatalog)`
quote in favor of prose, matching every other footnote's convention) would
close this. Left undone here per the explicit "report rather than
hand-patch" instruction for this archive run.

## Decisions preserved into canonical text

- Availability = `apple_pay.enabled` on the business config, composed with
  browser support and `country_code`. No catalog gate, no cached catalog,
  `init()` makes a single request (`public-api/spec.md`).
- **The `getPaymentMethods()` filter is the load-bearing point of the whole
  change and survives untouched in substance.** `apple_pay_*` catalog entries
  keep arriving; without the filter a merchant would render them as
  selectable APMs and call `pay({ type: 'apple_pay_debit_card' })`, which
  cannot succeed. `toPublicPaymentMethods()` remains the single producer of
  `PaymentMethodInfo[]`, with `mapPaymentMethod` module-private and exactly
  one call site — verified by `sdd-verify`, not just asserted by the spec.
- `isApplePayCatalogMethod` stays in `src/shared/payment-method-catalog.ts`
  (deliberate cycle-avoidance placement `models/payment-method.model.ts`
  depends on) — confirmed zero-line diff by verify-report.
- `merchant_identifier` is declared, never read: not a field of
  `ApplePayPaymentRequest`; the three Apple APIs that take it are out of
  scope. Verify-report confirmed zero read sites.
- Absent card-type fields (`supports_debit`/`supports_credit`) mean **do not
  filter by that card type** — the inverse of the old catalog behavior, and
  the correct degradation while backend field names are unconfirmed.
- Networks and card-type capabilities come from the `apple_pay` block with
  SDK defaults (`DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard']`).

## Open items carried forward (not blocking)

- Backend field names for `supported_networks`, `supports_debit`,
  `supports_credit` are **still unconfirmed**. All optional with SDK
  defaults, so nothing blocks; only the two `resolveApplePay*` functions
  would need to change if the names differ.
- S1–S10 (real-Safari verification) remain declared, not covered — owned by
  the Safari phase, not this change.
- This change supersedes the design in the archived
  `openspec/changes/archive/2026-08-03-apple-pay-catalog-gate/` change. That
  archived copy is left untouched as history, per the "archive is an audit
  trail, never edit archived changes" rule — it is not touched by this
  archive run.

## What this archive run did and did not do

**Did:**

- Read all five artifacts from files (`openspec/changes/apple-pay-business-gate/`:
  proposal.md, design.md, tasks.md, specs/apple-pay/spec.md,
  specs/public-api/spec.md, specs/payment-method-discovery/spec.md) and cross-
  checked Engram observations #4046–#4049, #4051 — files and Engram content
  agreed, no discrepancy found.
- Merged all three delta specs into `openspec/specs/{apple-pay,public-api,
payment-method-discovery}/spec.md` in place, using `Edit`.
- Wrote a full copy of the change folder (proposal.md, design.md, tasks.md,
  the three delta specs, and this report) to
  `openspec/changes/archive/2026-08-04-apple-pay-business-gate/` using `Write`.

**Did not do (per this task's explicit tool constraints):**

- Did **not** delete or move the original
  `openspec/changes/apple-pay-business-gate/` folder — it still exists
  alongside its new archive copy. The user (who has shell/git access)
  is expected to `git mv` it or otherwise remove the working copy.
- Did **not** run any shell or git command, and did not re-run
  `npm run test`/`typecheck`/`build`/`lint` or any `rg` command — all
  verification numbers above are taken from the Engram verify-report
  (#4051) and from manual text inspection of the merged files, not from
  fresh command execution.
- Did **not** hand-patch the one residual `(Previously: ...)` grep hit
  described above.

## Traceability — Engram observation IDs

| Artifact      | Observation ID |
| ------------- | -------------- |
| proposal      | #4046          |
| spec          | #4047          |
| design        | #4048          |
| tasks         | #4049          |
| verify-report | #4051          |
