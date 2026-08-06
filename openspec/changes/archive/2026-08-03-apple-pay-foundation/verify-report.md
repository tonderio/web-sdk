## Verification Report: apple-pay-foundation

**Change**: apple-pay-foundation (Phase 1 — inert type declarations + component factory refactor)
**Branch**: feature/applepay-foundation, commits c29fb86 / 277c8b3 / 30a2b0d, not pushed
**Mode**: full artifact set (proposal + specs + design + tasks + apply-progress), all verified against live source and command execution

### Command evidence (executed independently, not trusted from reports)

- `npm run test` → 32 files, 317 tests, all passing (exit 0)
- `npm run typecheck` → `tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json`, both passes exit 0, no output (covers real call site `e2e/support/fixtures.ts:123-135`)
- `npm run build` → all bundles + `dist/index.d.ts` emitted successfully
- `npm run lint` → RED, 2 errors, reproduced exactly as claimed (see Deviation 3 below)

### Task completeness (23/23 checked)

All 23 checkboxes in tasks.md verified true against source, not just trusted:

- Unit 1 (277c8b3): package.json, business.model.ts, direct-api.service.ts, ErrorKeyEnum.ts, shared/types/index.ts, customization.ts, business.model.test.ts, direct-api.service.test.ts — all present and match spec. Files touched: exactly the 8 listed in tasks.md + tasks.md itself + package-lock.json.
- Unit 2 (30a2b0d): component.ts, card.ts, apple-pay.ts, tonder.ts, index.ts, card.test.ts, apple-pay.test.ts — all present and match spec. Files touched: exactly the 7 listed + tasks.md.
- No file outside the declared scope was touched by either commit (confirmed via `git show --stat`).

### Absence checks (all verified directly via rg/python, not trusted from report)

- `rg -n ApplePayConfig src` → no matches. CONFIRMED.
- `rg -n "apple_pay[^_]" src` → no matches. CONFIRMED — no `apple_pay` field anywhere.
- `TonderEvents` interface → only `presentation?`. No `payment` key. CONFIRMED.
- `TonderCustomization` interface → only `card_fields?`. No `apple_pay_button` key. CONFIRMED.
- `TonderComponentType` → exactly `'card_fields'`. CONFIRMED.
- `src/index.ts` diff vs main → exactly one new line added: `export type { TonderMountableComponent } from './types/component';`. CONFIRMED via `git diff main...30a2b0d -- src/index.ts`.
- `@types/applepayjs` → present only under `devDependencies` in package.json (verified via JSON parse, not just grep). CONFIRMED.
- `rg -c applepayjs dist/index.d.ts` and `rg -c 'ApplePayJS|applepayjs'` across `dist/tonder-web-sdk.js`, `dist/index.mjs`, `dist/index.cjs` → zero matches in every artifact. CONFIRMED.
- `getPaymentMethods()` / `mapPaymentMethod()` → does not reference `raw.configuration` anywhere; output byte-identical by construction. CONFIRMED by reading the mapping function body.
- None of `ApplePayButtonComponent`, `ApplePayButtonOptions`, `ApplePayPaymentInput`, `PaymentEvents`, `ApplePayButtonCustomization` appear in built `dist/index.d.ts`. CONFIRMED via disposable clone build.
- `dist/index.d.ts` diff between commit 277c8b3 and 30a2b0d (built in an isolated scratch clone to avoid mutating the working tree) → confirmed the ONLY export-list change is the addition of `TonderMountableComponent`; every other exported name identical. This directly satisfies task 2.9's diff check and spec's "src/index.ts gains exactly one new export" scenario.

### Known deviations — judged

**1. `ApplePayButtonComponent` is a type alias, not an empty `extends` interface — WARNING (not CRITICAL).**
Design.md (§DD3, "Interfaces added" code block) and tasks.md task 2.3 both literally specify `export interface ApplePayButtonComponent extends TonderMountableComponent {}`. spec.md's requirement text says "`ApplePayButtonComponent` MUST extend `TonderMountableComponent`" — so yes, the spec text does assert the extends relationship specifically, using that word. The shipped code is `export type ApplePayButtonComponent = TonderMountableComponent`.
Judgment: structurally and behaviorally this is equivalent for every current and reachable consumer — `type X = Y` and `interface X extends Y {}` are indistinguishable under TS structural typing when X adds no members, and since `ApplePayButtonComponent` is unexported (D3/DD2), no external consumer can observe the difference at all; confirmed zero eslint-disable suppressions exist anywhere in `src/` (`rg -c eslint-disable src` → all zero), so the alternative (empty extends interface + suppression) would have introduced the only lint suppression in the whole codebase for zero functional gain. This is a deliberate, reasoned, and low-risk divergence from the literal design/spec text, not a spec violation in any behavior-observable sense. Flagged as WARNING because the written contract (spec.md + design.md + tasks.md 2.3) is not literally what shipped, and the task 2.3 checkbox is checked without a caveat — a reviewer diffing tasks.md against code would be surprised. Recommend either updating spec/design/tasks text to say "MUST be structurally equivalent to an empty extends of TonderMountableComponent" going forward, or converting to the interface form in the phase that gives the button its first real method (as the code comment already promises).

> **Archive-time note**: the canonical `apple-pay/spec.md` merged into `openspec/specs/` on 2026-08-03 already restates this requirement in terms of the alias decision (commit `e4cf755`, "spec alignment with the `ApplePayButtonComponent` alias decision"), so this WARNING is resolved for the canonical spec going forward — this archived copy retains the delta text as originally authored for audit purposes.

**2. Six new `ErrorKeyEnum` members have no `MESSAGES_EN` entries — confirmed genuinely inert, not a bug.**
`MESSAGES_EN` in `src/shared/errors/messages.ts` has no `APPLE_PAY_*` keys. Read `AppError.resolveMessage()`: falls back through `MESSAGES_EN[errorCode] || MESSAGES_EN[UNKNOWN_ERROR] || 'An unexpected error occurred.'` — no crash path, degrades to generic UNKNOWN_ERROR copy. Confirmed no code path in `src/` constructs an AppError with any of the six new codes (spec scenario "No code path constructs these errors yet" holds — grep found zero throw sites). SUGGESTION only: the phase that first throws one of these codes must remember to add its message, but nothing forces that today (Record<string,string> isn't exhaustively typed) — worth a lint rule or exhaustiveness check in a future phase, not blocking here.

**3. `npm run lint` is red with two pre-existing `no-unused-vars` errors — confirmed unrelated, not introduced by this change.**
Reproduced independently: `src/tonder.handleRequiresAction.test.ts:184` (`externallyAbortedMessenger`) and `src/tonder.pay.test.ts:483` (`cardSaveSpy`). Checked `git show --stat` for both 277c8b3 and 30a2b0d — neither file appears in either commit's changed-file list. Claim verified true. WARNING only insofar as leaving repo-wide lint red is generally undesirable, but it predates this branch and is explicitly out of scope; not this change's responsibility to fix.

### Spec compliance matrix

All requirements in `specs/apple-pay/spec.md` and `specs/public-api/spec.md` verified: BusinessProfile.country_code, no ApplePayConfig, BackendPaymentMethod.configuration (unread), six ErrorKeyEnum codes (no consumer), PaymentEvents/customization/option types declared-and-unreachable, @types/applepayjs devDependency-only and absent from every bundle, create<T>() exact narrowing, TonderMountableComponent shared base exported, ComponentOptionsByType/ComponentByType explicit maps, TonderComponentType unwidened, exactly one new barrel export. Every scenario that is type-level is genuinely gated by `npm run typecheck` (both passes verified green), not merely by `*.test.ts` `expectTypeOf` assertions (which are correctly present as documentation only, matching the binding verification caveat in tasks.md/spec.md). No scenario relies solely on an unenforced in-test type assertion for its pass/fail claim in this report.

### Verdict

**PASS WITH WARNINGS.** Zero CRITICAL issues. All 23 tasks genuinely complete and match code. All D3/DD2 absence invariants hold. Build, test, and both typecheck passes are green. Two WARNINGs (ApplePayButtonComponent alias-vs-interface divergence from literal spec/design/tasks text; pre-existing unrelated lint failures) and one SUGGESTION (ErrorKeyEnum message-map gap, self-acknowledged forward constraint). Safe to proceed to archive; recommend the spec/design/tasks text be reconciled with the alias decision (or reverted to interface form) as a fast follow, and the pre-existing lint failures be tracked as a separate ticket.

### Process note

While diffing dist/index.d.ts across commits, an initial `git checkout 277c8b3 -- .` was run directly in the working repo, which briefly reverted several files (index.ts, card.ts, tonder.ts) away from HEAD. Immediately caught and restored via `git checkout HEAD -- .`; working tree confirmed clean before continuing. All subsequent commit-diffing was done via a disposable clone in the scratchpad directory to avoid repeating the mutation. No lasting effect on the repo.
