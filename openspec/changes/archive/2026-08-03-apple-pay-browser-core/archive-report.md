# Archive Report: Apple Pay Browser Core (Phase 3)

**Change**: `apple-pay-browser-core`
**Archived**: 2026-08-03
**Archived to**: `openspec/changes/archive/2026-08-03-apple-pay-browser-core/`
**Canonical spec updated**: `openspec/specs/apple-pay/spec.md` (10 → 19 requirements)

## Traceability — Engram observation IDs read

| Artifact       | Observation ID | Topic key                                   | Note                                                    |
| -------------- | -------------- | ------------------------------------------- | ------------------------------------------------------- |
| Proposal       | #4008          | `sdd/apple-pay-browser-core/proposal`       | Current, matches disk                                   |
| Spec (delta)   | #4010          | `sdd/apple-pay-browser-core/spec`           | **STALE — superseded by disk. See below.**              |
| Design         | #4011          | `sdd/apple-pay-browser-core/design`         | Current, matches disk                                   |
| Tasks          | #4013          | `sdd/apple-pay-browser-core/tasks`          | Metadata current; disk tasks.md has the post-verify fix |
| Apply progress | #4017          | `sdd/apple-pay-browser-core/apply-progress` | Current                                                 |
| Verify report  | #4018          | `sdd/apple-pay-browser-core/verify-report`  | Current                                                 |

### Critical finding: Engram's spec observation (#4010) was stale — disk was authoritative

Engram observation #4010 (`sdd/apple-pay-browser-core/spec`) still carries the **original,
unsatisfiable** text of the `buildApplePayPaymentMethod` requirement:

> `pay({ payment_method: { type: 'apple_pay' } })` MUST remain a compile-time type error.

This is the exact defect pattern flagged in the archive instructions: `PaymentMethod`'s third
member (`{ type: string; config?: Record<string, unknown> }`,
`src/shared/types/index.ts:121-124`) accepts any string literal, so that call type-checks and
always has. It cannot be made a compile-time error without changing the public union, which is
out of this change's scope.

The **file on disk** at `openspec/changes/apple-pay-browser-core/specs/apple-pay/spec.md`
already carries the **corrected** text from commit `5b8a1d2`: the public union gains no
`apple_pay` member; rejection is a runtime `AppError` owned by the change that ships the
button component. This is the version that was merged into the canonical spec and copied into
this archive. Engram's stale observation was **not** used as merge source for this reason — per
the explicit instruction to verify the corrected text is what gets promoted. No Engram write
was needed to fix this since `sdd-archive` does not own the `spec` topic_key (that belongs to
`sdd-spec`); flagging it here as the audit record of why disk, not Engram, was authoritative for
this one artifact.

## Spec merge — 9 ADDED, 0 MODIFIED, 0 REMOVED, 10 pre-existing untouched

All 9 requirements in the delta are ADDED; none MODIFIED or REMOVED. All 10 pre-existing
requirements in the canonical spec were preserved byte-identical (only content appended, nothing
in the existing text touched).

**Added (verbatim from the corrected disk delta):**

1. ApplePayPort reports browser capability without throwing
2. ApplePayPort.createSession takes handlers as constructor arguments
3. Session handlers are normalized so Apple's event objects never cross the port
4. The adapter surfaces construction and container failures as AppError
5. ApplePayButtonPort renders the WebKit button and owns its click lifecycle
6. buildApplePayPaymentRequest is a pure builder of Apple's request shape
7. buildApplePayPaymentMethod returns a local, non-public payment-method shape (**corrected text — the runtime-guard version, not the original unsatisfiable compile-time-error version**)
8. ApplePaySessionHandle.completePayment uses the version-3 object form
9. Nothing added by the browser core is exported or reachable from merchant code

**Untouched (pre-existing, preserved byte-identical):**

1. BusinessProfile declares country_code; no ApplePayConfig exists anywhere
2. Catalog transport type declares an unread configuration field
3. Apple Pay error codes exist in ErrorKeyEnum
4. Payment, option, and customization types are declared but unreachable (D3)
5. Apple's types are development-only and excluded from the bundle
6. Raw payment-method catalog is fetched and cached during init()
7. Apple Pay availability gate reads the cached catalog only (D4)
8. Apple Pay supported-networks derivation
9. Apple Pay merchantCapabilities derivation
10. Public Apple Pay availability wiring waits for its full runtime

Result: `openspec/specs/apple-pay/spec.md` now has 19 requirements, matching the expected
10 → 19 count.

## Defect-pattern check (both patterns from the archive instructions)

**Pattern 1 — change-scoped wording promoted into canonical text.** Every requirement body (not
scenario) among the 9 ADDED requirements was checked for "this phase", "this change", "not
yet", "before this change". None found in requirement bodies. Scenario steps describing the act
of verifying (e.g. "verified only in Phase 7, on a device") retain their before/after wording,
per the explicit exception for scenario steps. Requirements 4 and 9 use durable phrasing —
"thrown only by the `mount()` gate in the change that adds that gate" and "reachability... is
established only in the change that wires a public entry point to this code" — which name a
future, unspecified change generically rather than referring to "this change" self-referentially.
Clean.

**Pattern 2 — unsatisfiable requirements.** Checked and confirmed the corrected text was
promoted (see the stale-Engram finding above). The merged requirement 7 states the true,
satisfiable rule: the public union gains no `apple_pay` member, and the catch-all `{ type:
string; config? }` member means `pay({ payment_method: { type: 'apple_pay' } })` **compiles** —
rejection is a runtime `AppError` owned by the change shipping the component. Verified against
`src/shared/types/index.ts:121-124` as read during the design/verify passes (line numbers
consistent with both the design doc and the verify report).

## Task Completion Gate

`tasks.md` on disk (and the archived copy) shows all 40 implementation tasks checked (`- [x]`)
across Phase 0 through Phase 4. No unchecked implementation tasks. No stale-checkbox
reconciliation was needed.

## Decisions carried forward (durable, for future phases reading this archive)

- Handlers are passed as ARGUMENTS to `createSession(request, handlers)`, never assigned
  afterward — makes create-and-wire-in-one-tick a type-level guarantee rather than a convention.
- Apple's event objects never cross the port. `onValidateMerchant()` takes nothing;
  `validationURL` is deliberately unread — Apple's current guidance is the static hostname, and
  letting the browser choose where a certificate-bearing backend connects is an SSRF surface.
- `canUseApplePay()` returns a plain boolean and never throws — absence of Apple Pay is a
  state, not a failure.
- `buildApplePayPaymentRequest` rejects an amount that cannot be represented exactly in the
  currency's minor units (`Number(amount.toFixed(2)) !== amount`), because displaying one
  amount and charging another is a silent money bug. **Currency assumption carried forward**:
  `toFixed(2)` presumes two minor units — JPY has zero, KWD has three — and adding such a
  currency invalidates both the check and the string it produces.
- `merchantCapabilities` is mandatory; `supports3DS` means EMV cryptogram support, unrelated to
  3-D Secure.
- The adapter is the only module touching `window.ApplePaySession` or DOM; `core/` stays pure
  and never reads Apple's static constants — the port normalizes completion to
  `'success' | 'failure'`.
- Apple Pay button styles are injected as a `<style>` node rather than inline properties,
  because jsdom silently drops declarations for properties it does not recognize, which would
  make an inline implementation pass a green test asserting `''`.

## Declared but not covered — owned by the Safari phase

Design §7 (S1–S10), ten statements about Apple's own behavior that no fake in this codebase can
establish: Safari accepting the built `ApplePayPaymentRequest`, `-webkit-appearance` actually
rendering, the real user-gesture requirement (this change's synchrony test is a labeled proxy,
not proof), HTTPS + domain registration enforcement, the merchant-validation round trip against
Apple's servers, Face ID / Touch ID and sheet lifecycle, real `supportsVersion(3)` /
`canMakePayments()` return values on hardware, whether keyboard activation counts as a gesture,
whether `completePayment` needs real `ApplePayError` instances, and merchant CSS specificity
against the injected style node. These are **declared, not covered**, by this change and its
verification. They are owned by the Safari phase (Phase 7 of `docs/apple-pay-integration-plan.md`),
not by `apple-pay-browser-core`.

## What this archive step did and did not do

**Did:**

- Read all six required artifacts from Engram plus the four openspec files on disk.
- Detected and reported the stale Engram spec observation; used disk as merge source instead.
- Merged the 9 ADDED requirements into `openspec/specs/apple-pay/spec.md` (10 → 19), preserving
  all 10 pre-existing requirements byte-identical.
- Wrote a full archive copy (proposal, design, tasks, specs delta, apply-progress, verify-report,
  this report) to `openspec/changes/archive/2026-08-03-apple-pay-browser-core/`.
- Checked both known defect patterns against all 9 promoted requirements; both clean.
- Confirmed the tasks.md Task Completion Gate (40/40 checked, no stale checkboxes).

**Did NOT do (outside this tool's capability, per the user's explicit instruction):**

- Did NOT delete or move the original `openspec/changes/apple-pay-browser-core/` folder — no
  shell/git access. The user is responsible for removing the original change folder (or leaving
  it, per their git workflow) after reviewing this archive copy.
- Did NOT re-run `npm run test`, `typecheck`, `build`, or `lint`. The user reported having
  already re-run and confirmed these (407 tests / 38 files, clean typecheck/build, 2 pre-existing
  unrelated lint errors) after fixing the tasks.md stale-drift note in `cf65131`. This archive
  step relied on that report and did not independently re-verify it.
- Did NOT commit or push anything — no git access.

## Source of Truth Updated

`openspec/specs/apple-pay/spec.md` now reflects the new behavior — 19 requirements total,
9 newly added by this change, 10 pre-existing and unmodified.

## SDD Cycle Complete

The change has been planned, implemented, verified, and archived (file-level). Remaining
mechanical steps (removing the original change folder, committing the archive, git operations)
are the user's to perform.
