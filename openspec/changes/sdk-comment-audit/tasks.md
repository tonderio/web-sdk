# Tasks: Remove internal vocabulary from published SDK artifacts

## Review Workload Forecast

| Field                   | Value                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~550–850 (guard script + fixtures ~350–450, comment cleanup ~150–250 per explore, config diffs ~30, direct-api fix ~15) |
| 400-line budget risk    | High by raw line count                                                                                                  |
| Chained PRs recommended | No — **not applicable, delivery is commits-only, no PR is opened**                                                      |
| Suggested split         | 4 sequential commits per design DD7 (see below); no PR splitting needed                                                 |
| Delivery strategy       | commits only                                                                                                            |
| Chain strategy          | not applicable                                                                                                          |

Decision needed before apply: No — commits-only delivery, no PR review-budget gate applies.
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High (line count only; does not trigger PR chaining under commits-only delivery)

### Suggested Work Units (commits, not PRs)

| Unit | Goal                                                            | Commit message                                                           | Depends on                                                             |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1    | Guard built, unit-tested against verbatim real leaks, NOT wired | `feat(scripts): add published-artifact vocabulary detector`              | none                                                                   |
| 2    | Fix false `AppError` re-throw claim                             | `docs(direct-api): correct AppError wrapping description`                | Unit 1 (baseline captured)                                             |
| 3    | ~57-line vocabulary cleanup, single commit                      | `refactor(comments): remove internal vocabulary from published comments` | **Unit 1 fixtures must exist first — see ordering warning in Phase 4** |
| 4    | Wire guard to `postbuild`                                       | `build(scripts): enforce artifact vocabulary check on postbuild`         | Unit 3                                                                 |

## CRITICAL ORDERING CONSTRAINT (read before starting)

Per design DD7: **Phase 2 (guard, with fixtures copied verbatim from real `dist/` leaks) MUST be committed before Phase 4 (comment cleanup) touches any file.** Nothing in the codebase enforces this — it is executor discipline only. Consequence of violating it: once Phase 4's edits land, the original leak strings no longer exist anywhere in the tree; any fixture written after that point is a guess at what leaked, not a verified reproduction, and the guard's proof of effectiveness becomes worthless. If this order is broken, recover the original text from `git log -p` on the affected files before writing fixtures — do not invent fixture text from memory.

## Design/Spec note (not a contradiction, flag anyway)

Spec's Requirement 1 names exactly 4 published files (`index.d.ts`, `tonder-web-sdk.js`, `index.mjs`, `index.cjs`). Design's target derivation (C1/DD5) reads `package.json` `files` and also guards `tonder-web-sdk.min.js` — 5 targets. This does not violate the spec (spec never caps targets at 4), but the guard's output text and success criteria say "N of 5 published artifact(s)", not 4. Follow design's derivation; do not hardcode 4.

## Phase 1: Baseline capture

- [x] 1.1 Run `npm run lint`. Record the exact error count and every message verbatim (file, line, rule) — this is the baseline every later lint run must match exactly, not "two errors" per the now-corrected proposal figure (C4).

## Phase 2: Guard, unbuilt-into-lifecycle — commit 1

- [x] 2.1 Before any cleanup edit, copy verbatim (do not paraphrase) leak text from current `dist/index.d.ts`/`dist/tonder-web-sdk.js` (~lines 222, 892, 962, 1058) and their `src/` origins (`src/tonder.ts`, `src/ports/acquirer.port.ts`, `src/types/apple-pay.ts`, `src/models/business.model.ts`) into a scratch note for use as test fixtures in 2.6–2.11.
- [x] 2.2 Extend `vitest.config.ts` `include` to add `'scripts/**/*.test.mjs'` (C3), colocated with `scripts/`.
- [x] 2.3 Add a `files: ['scripts/**/*.mjs']` block to `eslint.config.mjs` declaring `process`, `console`, `URL` as readonly globals (C4) — prevents the new script from adding lint errors beyond the Phase 1 baseline.
- [x] 2.4 RED: create `scripts/check-dist-vocabulary.test.mjs`, import `findForbiddenVocabulary` from `scripts/check-dist-vocabulary.mjs` (does not exist yet) — import fails.
- [x] 2.5 GREEN: create `scripts/check-dist-vocabulary.mjs` exporting `findForbiddenVocabulary` returning `[]` — import succeeds.
- [x] 2.6 RED→GREEN: fixture = verbatim `dist/index.d.ts:222` `INTERNAL` comment from 2.1. Expect one `internal-tag` finding. Implement `ts.createScanner`-based block-comment extraction (DD2) until green.
- [x] 2.7 RED→GREEN: fixture `payflow: 'https://payflow.tonder.io'` as code, no comment. Expect `[]` — proves DD2 (scanner, not regex-over-raw-text).
- [x] 2.8 RED→GREEN: fixture `/** the internal controller merges signals */` (lowercase). Expect `[]` — proves DD3 per-term case rule (`internal-tag` is case-sensitive).
- [x] 2.9 RED→GREEN: fixture `/** see https://payflow.tonder.io for the hosted page */`. Expect `[]` — proves DD4 URL masking.
- [x] 2.10 RED→GREEN: fixture `/** the payflow iframe emits completion */`. Expect one `payflow` finding — proves masking does not over-mask.
- [x] 2.11 RED→GREEN: fixture `const s = "/* payflow */";` (comment sequence inside a string literal). Expect `[]` — proves scanner-based, not regex-based.
- [x] 2.12 Add remaining term fixtures, one finding each with correct `termId`: `usrv-payments`, `DD3`, `DEV-2277`, `phase 7`, `COMPOSITION SEAM`, `ionic-lite`, `zplit`.
- [x] 2.13 Add a line/column fixture with the leak on line 4 of a multi-line string — assert `finding.line === 4`.
- [x] 2.14 Implement target derivation from `package.json` `files` (keep entries ending `.js`/`.mjs`/`.cjs`/`.d.ts` — 5 targets per C1/design note above). Implement CLI exit codes 0/1/2 and the failure-output format from design DD5. Guard the CLI body with `pathToFileURL(process.argv[1]).href === import.meta.url` so importing the module in tests never touches the filesystem.
- [x] 2.15 Document in the script's header comment: (a) the known scanner limitation — cannot always disambiguate a regex literal from division (DD2); (b) that any future addition/removal of a term in `FORBIDDEN_VOCABULARY` must be re-validated against the current tree before landing (spec Requirement 5) — nothing automated enforces this, it is reviewer discipline.
- [x] 2.16 Confirm `npm run test` output actually lists `scripts/check-dist-vocabulary.test.mjs` as an executed file (C3) — do not trust a green summary alone; a misconfigured `include` would silently skip it.
- [x] 2.17 Do NOT add the `postbuild` hook yet. Run `npm run test`, `npm run typecheck`, `npm run build`, `npm run lint` (compare to Phase 1 baseline — must match exactly). Commit: `feat(scripts): add published-artifact vocabulary detector`.

## Phase 3: Fix false claim — commit 2

- [x] 3.1 Rewrite `src/core/services/direct-api.service.ts:82-95` JSDoc to state that an existing `AppError` IS re-wrapped (no `instanceof AppError` guard exists) — code unchanged. Run `npm run test`/`typecheck`/`build`/`lint` (baseline match). Commit: `docs(direct-api): correct AppError wrapping description`.

## Phase 4: Vocabulary cleanup — commit 3 (single commit; do not split into multiple commits per DD7)

**Do not start this phase until Phase 2 is committed.** See the ordering constraint above.

- [x] 4.1 Run `npm run build` then run `node scripts/check-dist-vocabulary.mjs` manually (still unwired) against the current, pre-cleanup `dist/`. Its output is the authoritative per-file/line finding list — it supersedes the ~57-line/19-file estimate from exploration. Cross-reference each finding's `comment` text to its `src/` origin via search.
- [x] 4.2 Edit batch — `src/tonder.ts`: apply DD8 substitution table to the `COMPOSITION SEAM` / `DD`/`phase` references found in 4.1. Leave `tonder.ts:166-181` (ctor `unknown` param) and `tonder.ts:249` (availability check) untouched — PROTECTED, no forbidden terms present.
- [x] 4.3 Edit batch — `src/ports/`: `acquirer.port.ts:1` ("COF subscription calls. INTERNAL.") plus any other `ports/` findings from 4.1. Leave `apple-pay.port.ts:45` and `checkout-messenger.port.ts` untouched unless 4.1 flags them.
- [x] 4.4 Edit batch — `src/types/`: `apple-pay.ts:4,7` ("internal modules", "phase that implements") plus any other `types/` findings. Leave `customization.ts:125` untouched unless 4.1 flags it.
- [x] 4.5 Edit batch — `src/models/business.model.ts:4`: DELETE the "Ported from ionic-lite's `Business` type" clause per DD8 (provenance, not a constraint); leave the rest of the comment.
- [x] 4.6 Edit batch — all remaining files 4.1 identifies (e.g. `core/services/`, `core/strategies/`, `adapters/`, `shared/`): apply DD8 procedure one file at a time, in the order the guard reported them. Do not edit `src/**/*.test.ts` or any runtime logic — comment text is the only permitted diff besides prettier whitespace.
- [x] 4.7 Run `npm run format` to normalize spacing after any DELETE-only edits.
- [x] 4.8 Re-run `npm run build` then `node scripts/check-dist-vocabulary.mjs` — must report 0 findings across all 5 published targets before proceeding.
- [x] 4.9 Manual verification (no command covers this): re-read all 7 PROTECTED entries from spec.md's PROTECTED table (`apple-pay-checkout.service.ts` `start()`, `tonder.ts` ctor `unknown` param, `apple-pay.strategy.ts` capability derivation, `payment-method-catalog.ts` prefix matching, `types/customization.ts` no-image-option, `apple-pay.port.ts`/`apple-pay.adapter.ts` `validationURL`, `tonder.ts` availability check). Confirm each still STATES its listed constraint in wording — not merely that some text survives at that location.
- [x] 4.10 Run `npm run test`, `npm run typecheck`, `npm run build`, `npm run lint` (must match Phase 1 baseline exactly). Commit: `refactor(comments): remove internal vocabulary from published comments`.

## Phase 5: Wire the guard — commit 4

- [x] 5.1 Add `"postbuild": "node scripts/check-dist-vocabulary.mjs"` to `package.json` `scripts`.
- [x] 5.2 Run `npm run build` — confirm `postbuild` fires and exits 0.
- [x] 5.3 Negative test, manual, do not commit: reintroduce `INTERNAL` into one JSDoc block in `src/`, run `npm run build`, confirm non-zero exit with an actionable file/line/term message, then `git checkout` the file to revert.
- [x] 5.4 Run `npm run test`, `npm run typecheck`, `npm run lint` (baseline match), `npm run format:check`. Commit: `build(scripts): enforce artifact vocabulary check on postbuild`.

## Phase 6: Forward findings (explicitly NOT this change's work)

- [x] 6.1 Do not move or edit these three README-candidate items now. Record them durably (this tasks.md + a note carried into Phase 9 planning) so they are not lost: (a) CVV never revealable, PCI DSS Req 3.2.1 — `src/types/card.ts:30-31`; (b) 2-decimal currency assumption, JPY/KWD unsupported — `src/core/strategies/apple-pay.strategy.ts:166-168`; (c) `on_success` fires on declines ("a decline is a result, not a failure") — `src/shared/types/index.ts:61-64`.

## Phase 7: Public repository source is a second merchant-reachable surface

Added after apply. Verified: `tonderio/web-sdk` is a PUBLIC repo and the docs
portal links merchants to it, so source comments are merchant-reachable even
though `package.json` `files` ships no `.map` and `tonder-web-sdk.js.map` has
`sourcesContent: null` (so source does NOT reach npm consumers). Requirement 1
previously defined the surface as the npm artifacts alone, which under-scoped it.

- [x] 7.1 Re-run the vocabulary sweep across non-test `src/` rather than trusting
      the exploration's file list. Result: it named three files (`payment-method.model.ts`,
      `customer.service.ts`, `card.service.ts`) with zero actual hits, and missed
      `process-body.strategy.ts:6` (`D3`) and `apple-pay-checkout.service.ts:8` (`D6`).
- [x] 7.2 SCANNER DEFECT, found while extending the guard: `ts.createScanner`
      standalone mis-tokenizes `${...}` because the parser normally drives
      `reScanTemplateToken`. The first substitution desynchronised tokenization and
      every later comment became invisible — `skyflow.adapter.ts` exposed 10 of its
      17 block comments. This had produced a FALSE "0 findings" on the published
      artifacts in Phase 4. RED test first, then brace-depth tracking to drive the
      re-scan. Re-measured: **21 findings** were hidden in `index.cjs`/`index.mjs`/
      `tonder-web-sdk.js`. `index.d.ts` was genuinely clean — declaration files
      contain no template literals, which is why the Phase 5 negative test still passed.
- [x] 7.3 RED→GREEN: `includeLineComments` opt-in. Default stays block-only per
      Requirement 4; source scanning enables it, because `// phase 1 extracted
    component.ts.` — the clearest DELETE in this change — was a line comment.
- [x] 7.4 RED→GREEN: `isScannableSourcePath` excludes `*.test.ts`, `*.d.ts`, non-`.ts`.
- [x] 7.5 RED→GREEN: add `design-label` (`/\bD\d+\b/g`) for bare `D3`/`D6` labels.
      Validated against the tree per Requirement 5: zero false positives, and
      `3DS` / `3-D Secure` / `DD3` are provably unaffected (no word boundary before
      the `D`). Regression tests assert all three.
- [x] 7.6 Extend the CLI to a second tier over non-test `src/`, with its own heading
      and remedy footer. Missing-`src/` is deliberately NOT an exit-2 condition —
      a source tree is not build output.
- [x] 7.7 Clean the source leaks the guard reported: `ports/apple-pay.port.ts`
      (DD1/DD2/DD3/DD9), `apple-pay-checkout.service.ts` (phase 3, D6, DD3, DD7),
      `poll.ts` (payflow), `direct-api.service.ts` (INTERNAL x2), `shared/types/index.ts`
      (INTERNAL), `browser-checkout-messenger.adapter.ts` (payflow),
      `process-body.strategy.ts` (D3), `skyflow.adapter.ts` (INTERNAL).
      `skyflow.adapter.ts` is vendor-internal and legitimate — reworded to name
      whose internals are meant rather than deleted.
- [x] 7.8 Re-verify the seven PROTECTED constraints. Three live in files edited here
      (`apple-pay.port.ts:45`, `apple-pay-checkout.service.ts` `start()`,
      `apple-pay.strategy.ts`); citations removed, constraints intact.
- [x] 7.9 Amend spec Requirement 1 to define the surface by merchant reachability
      with both channels named as instances, and state the enforcement asymmetry
      rather than implying the guard covers both equally. Update Requirements 4 and 6
      for the opt-in, the tokenization-completeness rule, and the two-tier script.
- [x] 7.10 Commits (green individually, cleanup before guard so neither leaves the
      build red): `refactor(comments): remove internal vocabulary from public
    repository source`, then `fix(scripts): stop template literals blinding the
    vocabulary scanner, guard public source`.

## Disagreements between design and spec

None that block implementation. One non-blocking note: design's guard scans 5 targets (adds `tonder-web-sdk.min.js`) while spec's Requirement 1 prose names 4 — not a contradiction, spec does not cap the target count; flagged above under "Design/Spec note" so the executor isn't confused by "5 published artifact(s)" in guard output.
