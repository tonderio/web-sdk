# Verification Report: sdk-comment-audit

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 1 SUGGESTION)

## What

Independently re-verified `sdk-comment-audit` (commits `9eec62e..HEAD`, 9 commits) against spec/tasks/design/apply-progress. Did NOT trust the apply-progress's reported numbers — re-ran every command fresh and independently falsified the guard twice in the region that produced the earlier false-green.

## Why

This change's own apply history already produced one false "0 findings" (scanner blindness after the first `${` in a template literal). Verification treated that as a live risk, not settled history.

## Commands run fresh, all matched claims

- `npm run build` → rollup succeeds, `postbuild` fires, prints `0 findings in 5 published artifact(s) and 45 source file(s)`.
- `npm run test` → 524/524 passed, 44 files, zero edits to existing test files (diff-confirmed).
- `npm run typecheck` → clean (`tsc --noEmit` src + e2e).
- `npm run lint` → 2 errors, 0 warnings, both at `tonder.handleRequiresAction.test.ts:184` and `tonder.pay.test.ts:483` — exact baseline match.

## Guard falsification (centerpiece), both directions, twice

1. Injected `/** INTERNAL probe payflow leak */` after the template literal at `skyflow.adapter.ts:283` (the exact spot that previously desynchronized tokenization). `npm run build` → exit 1, correctly named `dist/index.cjs:759`, `dist/index.mjs:757`, `dist/tonder-web-sdk.js:760`, terms `internal-tag` + `payflow`. Reverted → exit 0, clean tree.
2. Second probe in a shape the first didn't cover: nested template interpolation `` `${ { k: `${'x'}` } }` `` immediately followed by a block comment at true EOF of the file. Rationale: tests the brace-depth STACK (not a boolean flag) plus true-EOF comment visibility — a naive single-level fix for probe 1 could still fail a depth-2 nesting. Result: exit 1, correctly named across 3 artifact targets. Reverted → exit 0, clean tree. `git status --porcelain` empty after both.

## Guard unit tests

`vitest.config.ts` `include` correctly extended to `['src/**/*.test.ts', 'scripts/**/*.test.mjs']`. Verbose run confirms `scripts/check-dist-vocabulary.test.mjs` executes — 33 tests, including explicit "template literals do not blind the scanner" describe block (finds comment after substitution template, after nested object literal, still ignores comment-sequence inside template). Deliberately broke assertion `expect(findings[0].matched).toBe('INTERNAL')` → `'NOT-INTERNAL'`: suite FAILED as expected (1/33). Reverted → 33/33 green. Suite proven capable of failing.

## Seven PROTECTED comments

Read each, quoted surviving constraint, all 7 confirmed to still STATE (not merely contain text near) their listed constraint: `apple-pay-checkout.service.ts start()` (DELIBERATELY NOT async, TS2705), `tonder.ts` ctor unknown param (TS2503 `@types/applepayjs` conflict), `apple-pay.strategy.ts` capability derivation (absent flag = do not filter), `payment-method-catalog.ts` prefix matching (missing variant leaks vs over-match asymmetry, bare `apple_pay` excluded), `types/customization.ts` (Apple HIG forbids custom artwork), `apple-pay.port.ts` merchant validation (`validationURL` deliberately unread, SSRF rationale; no `await` before sync session creation), `tonder.ts` availability check (`mount()` doesn't call it because it needs to report which precondition failed).

## Classifier fidelity

Sampled 15+ rewritten comments across `git diff 9eec62e..HEAD -- 'src/**'`. Every sampled rewrite kept the WHY while removing vocabulary; several REWRITEs actively improved clarity (e.g. `direct-api.service.ts` "The ONE `on_error` site... (see DD7)" → states the actual reason inline: "a merchant callback that throws must not disturb an already-settled sheet"; `skyflow.adapter.ts` "INTERNAL only" → names whose internals, "keyed by Skyflow's own column names rather than this SDK's field names"). No comment found that lost reasoning.

## Non-goals honored

`git diff 9eec62e..HEAD -- 'src/**/*.test.ts'` empty. `src/shared/config/env.ts` diff empty (payflow field untouched). No README/docs edits outside `openspec/`. Every added/removed line in `src/**` diff starts with a comment marker (`*`, `//`, `/**`, `/*`, `*/`) — verified via regex-filtered diff inspection, zero non-comment lines found in either direction, zero blank-only additions/removals. Config changes (`vitest.config.ts`, `eslint.config.mjs`) are tooling-only, not SDK runtime.

## direct-api.service.ts correction verified TRUE

Read all 4 catch blocks (processPayment, getTransaction, getPaymentMethods, getPaymentMethodBanks) — none has an `instanceof AppError` guard, all unconditionally wrap. New comment "There is no `instanceof AppError` re-throw guard on any method here... Collapsing a double wrap is the CONSUMER's job" now matches code exactly. Code unchanged (confirmed via comment-only diff check above).

## Tasks

44/44 checked (`rg -c '\\[x\\]'` = 44, `rg -c '\\[ \\]'` = 0 matches).

## WARNING (spec durability)

`specs/sdk-artifact-hygiene/spec.md` line ~133-134, the first PROTECTED scenario's GIVEN clause reads "after the vocabulary cleanup described in this change's tasks has been applied" — change-scoped wording (\"this change's tasks\") embedded in a spec destined for canonical merge at archive. Once merged, \"this change\" has no stable referent for a future reader of the canonical spec. Does NOT forbid future work (unlike the earlier incident's \"MUST remain exactly X in this phase\" pattern) but is a dangling/stale reference. The very next scenario (\"A future edit to a PROTECTED location...\") is already written in fully generic, durable language and should be the template — recommend rewording the first scenario's GIVEN to drop \"in this change's tasks\" before archive.

NOTE: This has been fixed by the orchestrator in the committed version.

## SUGGESTION

The guard's `main()` returns immediately on any artifact-tier finding (`if (results.length > 0) ... return 1`), before scanning the source tier at all — verified in `scripts/check-dist-vocabulary.mjs:334-344`. This is an intentional, already-documented tradeoff (apply-progress learned #10) and does not violate spec Requirement 6 (which only requires distinguishing channels per match, not simultaneous multi-tier reporting), but a future dev fixing an artifact leak could be surprised by a second, previously-invisible source leak on the next run. No spec/task defect — just worth a one-line note in the script's header comment for future maintainers.

NOTE: This has been addressed by the orchestrator in the committed version.

## Where

Verification touched `src/adapters/skyflow/skyflow.adapter.ts` (two probes, reverted) and `scripts/check-dist-vocabulary.test.mjs` (one broken assertion, reverted). Working tree confirmed clean (`git status --porcelain` empty) at session end.

## Learned

Re-verification independent of trusted "0 findings" claims is essential for scanner-based guards — this session's two probes (simple `${...}` recovery, then nested-template + EOF) both caught real detection in the exact previously-blind class of bug, proving the fix generalizes rather than just patching the one reported case.
