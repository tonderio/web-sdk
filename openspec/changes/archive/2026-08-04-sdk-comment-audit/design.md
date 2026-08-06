# Design: Remove internal vocabulary from published SDK artifacts

The comment edits are mechanical and need no architecture. The architecture is the **regression guard**: a pure `findForbiddenVocabulary(source)` in `scripts/check-dist-vocabulary.mjs`, driven by unit tests seeded with the four real leaks currently in `dist/index.d.ts`, wired as npm `postbuild` so it runs on fresh artifacts before every publish and every e2e run.

The single most important decision is **DD7 (commit ordering)**: the guard lands first as an unwired, fully tested CLI, so it is proven against the real leaks without ever leaving the tree red.

## Corrections to the proposal

Verified against the tree. Four proposal statements are wrong or incomplete.

| #   | Proposal says                                                    | Reality                                                                                                                                                      | Consequence                                                                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Guard targets are `index.d.ts`, `tonder-web-sdk.js`, `index.mjs` | `package.json` `files` also publishes **`dist/index.cjs`** and `dist/tonder-web-sdk.min.js`                                                                  | `index.cjs` is an unguarded published artifact. See DD6 — derive targets from `files`, do not hardcode three.                                 |
| C2  | Forbidden-vocabulary lines: 11 / 41 / 8                          | Those are raw seed-regex hits. Measured with the guard's actual word list and correct case: **`index.d.ts` = 4**, `tonder-web-sdk.js` = 10, `index.mjs` = 10 | Success criterion must read "zero guard findings", with the pre-cleanup baseline _measured by the guard_, not the 11/41/8 figures.            |
| C3  | Unit tests go in `scripts/*.test.ts` (or `src/__guards__`)       | `vitest.config.ts` `include` is `['src/**/*.test.ts']` **only**                                                                                              | A test under `scripts/` would silently never run. `vitest.config.ts` must be extended. See DD5.                                               |
| C4  | (unstated)                                                       | `eslint.config.mjs` declares Node globals for `e2e/**` only; `js.configs.recommended` enables `no-undef` for `.mjs`                                          | `scripts/check-dist-vocabulary.mjs` using `process`/`console` adds **new lint errors** unless a `scripts/**` globals block is added. See DD5. |

Confirmed correct: `build` = `rollup -c`; `prepublishOnly` = `npm run build`; `pretest:e2e` = `npm run build`. Both call the `build` script explicitly, so npm's `postbuild` lifecycle fires for both. `typescript` **is** a devDependency (`^5.7.2`) — DD2 is available at zero install cost. `.husky/pre-push` runs `npm test`, so the guard's unit tests run on every push.

Also confirmed: `src/core/services/direct-api.service.ts:91-92` does claim "An existing `AppError` is re-thrown unchanged (no double-wrap)", and no `instanceof AppError` guard exists. The comment is false. Fixing the comment (not the code) is in scope.

---

## DD1 — Signature and return shape

```js
/**
 * @typedef {Object} Finding
 * @property {string} termId    stable id from the word list, e.g. 'payflow'
 * @property {string} matched   the exact matched text
 * @property {string} reason    why this term is forbidden (from the word list)
 * @property {number} line      1-based, relative to `source`
 * @property {number} column    1-based
 * @property {number} offset    0-based absolute index into `source`
 * @property {string} comment   full comment text, whitespace-collapsed, capped at 200 chars
 */

/**
 * @param {string} source
 * @param {{ terms?: Term[], allowlist?: RegExp[], scriptKind?: import('typescript').ScriptKind }} [options]
 * @returns {Finding[]}  empty array = clean; sorted ascending by `offset`
 */
export function findForbiddenVocabulary(source, options = {}) {
  /* ... */
}
```

| Decision                                         | Rationale                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Returns `Finding[]`, not `boolean`               | A boolean tells a developer nothing. `line`/`column` gets them to the spot, `matched` tells them what tripped it, `reason` tells them why, `comment` lets them find the same text in `src/` (the finding is in `dist/`, which they must never edit). |
| **No file name in `Finding`**                    | The function is pure over a string. The CLI knows the path and prefixes it when formatting. Keeps the unit tests free of filesystem fixtures.                                                                                                        |
| `options.terms` / `options.allowlist` injectable | Tests drive edge cases (case sensitivity, boundaries, allowlist) with tiny purpose-built lists instead of the production list. Defaults are the production constants.                                                                                |
| `comment` collapsed + capped                     | Failure output stays one screen even when a JSDoc block is 40 lines.                                                                                                                                                                                 |
| Sorted by `offset`                               | Deterministic output — diffable failure logs, stable test assertions.                                                                                                                                                                                |

## DD2 — Block comments only, via the TypeScript scanner

**Decision: use `ts.createScanner` from the `typescript` devDependency. Collect only `SyntaxKind.MultiLineCommentTrivia`.**

```js
const scanner = ts.createScanner(
  ts.ScriptTarget.Latest,
  /* skipTrivia */ false,
  ts.LanguageVariant.Standard,
  source,
);
// loop scanner.scan() until EndOfFileToken;
// on MultiLineCommentTrivia -> scanner.getTokenStart() / scanner.getTextPos()
```

Why block comments only: of the 14 raw hits in `dist/index.mjs`, **4 are code** — `payflow: 'https://payflow.tonder.io'` and `new Set([this.env.payflow])`. `TonderBaseUrls.payflow` is a deliberately public API field (proposal non-goal). A guard that flags it is a guard that gets disabled. All 10 real leaks are inside `/** ... */`. Line comments add nothing: rollup's output has none carrying leaks.

Alternatives weighed:

| Approach                                                             | Cost                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regex `/\*[\s\S]*?\*/`                                               | **Rejected.** Matches inside string literals. `dist/` is bundled output — one minifier or template-literal change and the guard reads code as comment. Cheap to write, silently wrong later.                                                    |
| `ts.createSourceFile` + `ts.getLeadingCommentRanges(text, node.pos)` | **Rejected.** Full parser, correct regex/division disambiguation, but only finds comments attached to a node position. Comments at EOF or inside empty blocks are invisible. A guard with blind spots is worse than a slow guard.               |
| `ts.createScanner`                                                   | **Chosen.** Reaches every comment including EOF and empty blocks, and excludes string contents, with zero new dependencies. Not free, though — see the tokenization caveat below; a standalone scanner needs help the parser normally gives it. |
| A comment-extraction npm package                                     | **Rejected.** New dependency for something `typescript` already does, and most such packages are regex underneath.                                                                                                                              |

**Cost, stated plainly:** importing `typescript` into the script costs ~200-400 ms and ~8 MB of module load per invocation. Irrelevant — this runs after a rollup build that already loaded the same module. **Tokenization caveat — the scanner is not self-sufficient.** `ts.createScanner` is designed to be driven by the parser, and two of its re-scan entry points do not fire on their own:

- `reScanTemplateToken` — WITHOUT it, the first `${` in a template literal desynchronises tokenization and **every comment after that point in the file becomes invisible**. This is not theoretical: it was found in implementation, where `skyflow.adapter.ts:283`'s `` `update:${request.card_id}` `` hid 10 of that file's 17 block comments and produced a false `0 findings`. The fix is a brace-depth STACK, not a flag, because `${ { k: `${x}` } }` nests. Consumers of this design must implement it.
- `reScanSlashToken` — still undriven. A regex literal containing `/*` could be mis-tokenized. All forbidden terms are alphabetic and no such literal exists in either scan tier; accepted risk, documented at the definition.

The lesson generalises beyond this script: a scanner that stops seeing reports exactly what a scanner that finds nothing reports. Any comment-scanning guard MUST be proven against a leak placed after a template literal, not merely against a leak in a declaration file — `.d.ts` output contains no template literals, so it is the one path that is clean by construction.

## DD3 — Word list shape

**Decision: an exported array of objects, colocated in `scripts/check-dist-vocabulary.mjs`.**

```js
export const FORBIDDEN_VOCABULARY = [
  {
    id: 'payflow',
    pattern: /\bpayflow\b/gi,
    reason:
      'Internal service name. Merchants integrate against the public SDK, not this host.',
  },
  {
    id: 'zplit',
    pattern: /\bzplit\b/gi,
    reason: 'Internal routing service name.',
  },
  {
    id: 'usrv-prefix',
    pattern: /\busrv-[a-z0-9-]+/gi,
    reason: 'Internal microservice naming scheme.',
  },
  {
    id: 'ionic-lite',
    pattern: /\bionic-lite\b/gi,
    reason: 'Predecessor internal codebase name.',
  },
  {
    id: 'composition-seam',
    pattern: /COMPOSITION SEAM/gi,
    reason: 'Internal architecture jargon; meaningless to a merchant.',
  },
  {
    id: 'internal-tag',
    pattern: /\bINTERNAL\b/g,
    reason:
      'All-caps visibility tag. If it is internal, it must not be in a published comment.',
  },
  {
    id: 'design-decision',
    pattern: /\bDD\d+\b/g,
    reason: 'Internal design-decision reference. Merchants cannot read it.',
  },
  {
    id: 'plan-phase',
    pattern: /\bphase \d+\b/gi,
    reason: 'Internal delivery-plan reference.',
  },
  {
    id: 'ticket-id',
    pattern: /\bDEV-\d+\b/gi,
    reason: 'Internal issue tracker ID.',
  },
];
```

Object-with-`reason`, not a flat string array — three independent forces demand it:

1. **Self-explanatory failures.** A developer six months from now sees `reason` in the terminal and does not need this document. A flat list produces `found "phase 3"` and a confused human.
2. **Per-entry case sensitivity is mandatory, not optional.** `dist/index.d.ts` contains six legitimate lowercase uses — "internal modules", "secure-field internals", "polls internally", "its internal controller". A case-insensitive `internal` produces **six false positives in one file** and the guard dies in its first week. `internal-tag` must be case-**sensitive** (`/g`), matching only the all-caps tag. `payflow`/`zplit`/`ionic-lite` are proper nouns with no legitimate English use — case-insensitive is safe. A flat string array cannot express this.
3. **Per-entry word boundaries are mandatory.** `usrv-` ends in a hyphen; `\busrv-\b` never matches, because there is no word boundary between `-` and a space. Each entry needs a hand-authored `RegExp` with the boundaries that term actually needs. Auto-wrapping strings in `\b...\b` is wrong for at least two of the nine terms.

Colocated in the same file rather than a separate `forbidden-vocabulary.mjs`: ~120 lines total, and a failing developer should open exactly one file.

**The guard is a floor, not the classifier.** `dist/index.d.ts:1052` "Internal polling helper used by embedded card 3DS reconciliation" is arguably poor merchant-facing prose, but it contains no forbidden term and the guard will pass it. Comment _quality_ is the classifier's job during apply; the guard only enforces _vocabulary_.

## DD4 — URL masking, the `payflow.tonder.io` problem

A comment may legitimately name the host — `TonderBaseUrls.payflow` is public API, so `https://payflow.tonder.io` is not a secret. `\bpayflow\b` matches it anyway.

**Decision: mask URLs inside the comment text before matching, preserving offsets.**

```js
// Applied to the extracted comment text only, before term matching.
const masked = commentText.replace(/https?:\/\/\S+/g, (m) =>
  ' '.repeat(m.length),
);
```

Equal-length space replacement keeps every `offset`/`line`/`column` in the finding accurate against the original source. The regex is **scheme-anchored** deliberately: `https://payflow.tonder.io` is masked; a bare `the payflow iframe` is not; and a bare `payflow.tonder.io` without a scheme is _not_ masked, because at that point it reads as jargon rather than a citable URL.

**Allowlist**: `ALLOWLIST` is an array of `RegExp` tested against the collapsed comment text; a comment matching any entry is skipped entirely. It is an escape hatch with a required inline justification comment per entry, not the primary defense — DD2 (block comments only) plus DD3 (per-term case rules) plus URL masking are. Ship with `ALLOWLIST = []`. If cleanup cannot reach zero without allowlist entries, that is a signal the wording is wrong, not the guard.

## DD5 — Wiring, targets, failure output

| Concern                            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook                               | `"postbuild": "node scripts/check-dist-vocabulary.mjs"`. Fires after `npm run build`, and therefore inside `prepublishOnly` and `pretest:e2e`, both of which call `npm run build` explicitly. Verified.                                                                                                                                                                                                                     |
| Why not a Vitest test over `dist/` | `npm run test` never builds. It would pass against stale or absent `dist/`, i.e. pass exactly when it matters least.                                                                                                                                                                                                                                                                                                        |
| Dual module/CLI                    | Guard the CLI body with `pathToFileURL(process.argv[1]).href === import.meta.url` so importing the module in a unit test does not scan the filesystem or call `process.exit`.                                                                                                                                                                                                                                               |
| Unit test location                 | `src/__guards__/check-dist-vocabulary.test.ts` **or** extend `vitest.config.ts` `include` to `['src/**/*.test.ts', 'scripts/**/*.test.mjs']` and colocate. **Choose colocation** — one config line, and the test sits next to the thing it tests (work-unit principle). Import `describe`/`it`/`expect` explicitly from `vitest` rather than relying on `globals: true`, so ESLint `no-undef` stays quiet in a `.mjs` file. |
| ESLint                             | Add a `files: ['scripts/**/*.mjs']` block to `eslint.config.mjs` declaring `process`, `console`, `URL` as readonly globals. Without it, C4 introduces new lint errors and breaks the "lint baseline unchanged" criterion.                                                                                                                                                                                                   |
| Prettier                           | `format:check` does not cover `scripts/`, but `lint-staged` runs `prettier --write` on `*.mjs` at commit time. Write the script prettier-clean so the pre-commit hook does not silently restage it.                                                                                                                                                                                                                         |

### Targets — derive, do not hardcode

**Decision: read `package.json` `files`, keep entries ending in `.js`, `.mjs`, `.cjs`, `.d.ts`.**

That yields all five published artifacts including `index.cjs` (C1) and `tonder-web-sdk.min.js`. Scanning the minified file costs milliseconds and catches a future terser-config change that stops stripping comments. Deriving from `files` means a newly published artifact is guarded automatically, with no second list to forget. Cost: the script reads and parses `package.json` at runtime — trivial, and it also sidesteps `dist/.DS_Store`, which a naive glob would try to scan.

### Missing `dist/` — hard failure

**Decision: a missing target file is a hard failure, exit code 2. No skip, no warning, no `--allow-missing` flag.**

As `postbuild`, the script runs immediately after rollup. If a published artifact is missing at that moment, the build produced the wrong artifact set — that is a real defect, not an excuse to skip. A guard that skips when its inputs are absent is a guard that eventually protects nothing, because "absent" is precisely the failure mode nobody notices. If someone runs the script standalone without building, the exit-2 message tells them to run `npm run build`.

| Exit | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | All targets scanned, zero findings.                                                       |
| `1`  | Forbidden vocabulary found. Findings printed.                                             |
| `2`  | Cannot scan: a published target is missing, unreadable, or `package.json` is unparseable. |

Distinct codes so a human or CI can tell "you leaked internal wording" from "your build is broken".

### Failure output

Actionable without reading any document:

```
FORBIDDEN VOCABULARY IN PUBLISHED ARTIFACTS

dist/index.d.ts:222:52  [internal-tag]
  matched: INTERNAL
  reason:  All-caps visibility tag. If it is internal, it must not be in a published comment.
  comment: /** Detokenized card payload required by the COF subscription calls. INTERNAL. */

dist/index.d.ts:892:24  [design-decision]
  matched: DD3
  reason:  Internal design-decision reference. Merchants cannot read it.
  comment: * own session (DD3). With one service per `Tonder`, a second button's ...

2 finding(s) in 1 of 5 published artifact(s).

These files ship to merchant developers via npm and the CDN, and index.d.ts drives
every editor tooltip. Fix the COMMENT IN src/ -- never edit dist/ -- then re-run
`npm run build`. Search src/ for the comment text above to find the source.
Word list and rationale: scripts/check-dist-vocabulary.mjs
```

Every element earns its place: `file:line:column` for navigation, `[termId]` for grepping the word list, `matched` for what tripped it, `reason` for why it is forbidden, `comment` as the search key into `src/`, and an explicit "do not edit dist/" because the reported path is a build artifact.

## DD6 — Strict TDD, honestly scoped

No theatre. This change has two halves with genuinely different verifiability.

| Part                                                    | Test-drivable?                                                                                      | Verification                                                                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findForbiddenVocabulary` + word list                   | **Yes, fully.** Real red/green/refactor.                                                            | Vitest unit tests. Write the failing test first, every time.                                                                                                                                    |
| CLI wiring (`postbuild`, exit codes, target derivation) | Partially. Process-level behavior is awkward to unit test and not worth a spawn harness here.       | Executed for real in the verification steps: build with a leak present (must fail), build clean (must pass).                                                                                    |
| ~57 comment edits                                       | **No.** A comment has no behavior. There is no failing test to write, and inventing one is theatre. | The guard itself, run against a freshly rebuilt `dist/`, is the verification — plus `npm run test` staying green with **zero test-file edits**, which is what proves no runtime behavior moved. |

The TDD-drivable slice is the entire reason the guard exists as a pure function rather than as an inline regex in a shell one-liner. Concrete red-first sequence for unit 1:

1. `findForbiddenVocabulary` does not exist → import fails → red. Create it returning `[]` → green.
2. Fixture = the verbatim `dist/index.d.ts:222` comment. Expect one `internal-tag` finding → red. Implement scanning → green.
3. Fixture = `payflow: 'https://payflow.tonder.io'` as **code, not comment**. Expect `[]` → red if the implementation is regex-over-raw-text → forces DD2.
4. Fixture = `/** the internal controller merges signals */` (lowercase). Expect `[]` → forces DD3's per-term case flags.
5. Fixture = `/** see https://payflow.tonder.io for the hosted page */`. Expect `[]` → forces DD4 masking.
6. Fixture = `/** the payflow iframe emits completion */`. Expect one `payflow` finding → proves masking did not over-mask.
7. Fixture = `const s = "/* payflow */";` (comment sequence inside a string literal). Expect `[]` → proves the scanner, not a regex.
8. Fixtures for `usrv-payments`, `DD3`, `DEV-2277`, `phase 7`, `COMPOSITION SEAM`, `ionic-lite`, `zplit`.
9. Line/column correctness: a fixture with the leak on line 4 must report `line: 4`.

Steps 3, 4, 5, and 7 are the ones that matter — each is a false-positive class that would otherwise get the guard disabled by an annoyed developer.

## DD7 — Commit ordering (the decision that matters)

**Decision: four commits, guard first but unwired, using verbatim real-leak fixtures. Every commit is green.**

The dilemma is real: a guard written after the cleanup can never demonstrate it detects anything, because by then there is nothing to detect. But wiring the guard to `postbuild` before the cleanup leaves `npm run build` failing across at least one commit, violating "the repo still makes sense after applying only this commit".

The way out is recognising that the guard's _proof_ does not need to live in the tree state — it needs to live in the **test fixtures**. Copy the real leak strings out of `dist/` into unit-test fixtures _before_ the cleanup deletes them, and the guard is provably effective against the genuine article while the build stays green throughout.

| #   | Commit                                                                   | Contents                                                                                                                                                                                                | Green after this commit alone?                                           |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `feat(scripts): add published-artifact vocabulary detector`              | `scripts/check-dist-vocabulary.mjs` (pure fn + word list + CLI), `scripts/check-dist-vocabulary.test.mjs`, `vitest.config.ts` include, `eslint.config.mjs` scripts globals. **Not wired to postbuild.** | Yes. New passing tests, no lifecycle change.                             |
| 2   | `docs(direct-api): correct AppError wrapping description`                | `src/core/services/direct-api.service.ts:82-95` only.                                                                                                                                                   | Yes.                                                                     |
| 3   | `refactor(comments): remove internal vocabulary from published comments` | The ~57 edits across the remaining ~18 files.                                                                                                                                                           | Yes. Verified by running the CLI manually against a fresh build.         |
| 4   | `build(scripts): enforce artifact vocabulary check on postbuild`         | `package.json` `postbuild` hook.                                                                                                                                                                        | Yes — and this is the first build that _could_ have failed and does not. |

Why this ordering, defended:

- **Commit 1 must precede commit 3.** After the cleanup, the exact leak strings exist nowhere in the tree. Reconstructing them from memory produces fixtures that test what the author _thinks_ leaked, not what did. This ordering constraint is the whole point.
- **Rejected: wire the hook in commit 1.** Buys nothing that the fixtures do not already buy, and costs a red `npm run build` for two commits. `.husky/pre-push` runs `npm test` (not build), so it would not block the push — meaning the breakage would be discovered by whoever next runs `test:e2e` or `prepublishOnly`. Unacceptable.
- **Rejected: guard entirely after cleanup.** Vacuous first run; a bug in the detector is undetectable and the guard is decorative.
- **Commit 2 is separate** because it is a different work unit: correcting a factual claim about runtime behavior, not stripping vocabulary. It is also the one comment change a reviewer must read against the code. Burying it in a 57-edit diff guarantees nobody checks it.
- **Commit 3 is not split further.** ~150-250 lines, comments only, commits-only delivery with no PR budget. Any further split (by directory, by verdict) would be file-type splitting, which the work-unit rule forbids.

Rollback: `git revert` commit 4 disables enforcement; revert 3 restores the comments; each is independent.

## DD8 — Rewrite procedure for the ~57 edits

`sdd-apply` must not improvise 57 times. Fixed procedure, one file at a time, in the order the guard reports them.

**Per comment:**

1. Apply the proposal's classifier. **REWRITE is the default.** DELETE only when rule 1 (WHY vs WHAT) already fails independently of the vocabulary.
2. Write the sentence a merchant developer needs, then check it no longer contains the term. Never delete the term and leave the sentence limping.
3. If a rewrite cannot state the WHY without the internal name, the constraint is genuinely internal — DELETE the whole comment rather than shipping a half-explanation.

**Vocabulary substitution table** (binding, so the same term does not get four different treatments):

| Term as it appears                           | Replacement strategy                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `payflow` (the hosted page/iframe)           | "the hosted checkout page" / "the hosted checkout iframe"                                                                                 |
| `payflow` inside `https://payflow.tonder.io` | Leave the URL. Masked by DD4.                                                                                                             |
| `zplit`                                      | "the payment routing service"                                                                                                             |
| `usrv-*`                                     | "the payments API"                                                                                                                        |
| `ionic-lite`                                 | Provenance, not a constraint — DELETE the clause. "Ported from ionic-lite's `Business` type" becomes nothing; the type stands on its own. |
| `COMPOSITION SEAM (...)`                     | Rewrite as the WHY of the seam in merchant terms, or DELETE if the WHY is purely internal wiring.                                         |
| `INTERNAL` / `INTERNAL only`                 | Delete the tag. If the tag was the entire comment's content, DELETE the comment.                                                          |
| `DD3`, `DD7`                                 | Delete the reference, keep the surrounding sentence. `(DD3)` disappears; the sentence before it stays.                                    |
| `phase 3`, `phase 7`                         | Delete the reference. "exactly as phase 3 established" becomes "by design" or is dropped.                                                 |
| `DEV-2277`                                   | Delete the reference.                                                                                                                     |

**When a comment's ONLY content is internal vocabulary:** delete the entire comment block including its lines and any now-orphaned blank line. Do **not** leave `/** */`, do not leave `/** */`-shaped stubs, do not replace with a placeholder. Run `npm run format` afterwards so prettier normalises spacing.

**PROTECTED entries (the seven in the proposal):**

- Read the comment, identify the WHY sentence, and confirm it survives the edit _stating the same constraint_. Text merely existing is not enough.
- `tonder.ts:166-181` mentions `rollup-plugin-dts` — a real public npm package, not Tonder vocabulary. **No de-internalizing.** Touch only if an adjacent leak forces it.
- `apple-pay-checkout.service.ts:81-98` is on a non-exported class and never reaches `dist/index.d.ts`. **Leave verbatim.**
- The other five (`apple-pay.strategy.ts:61`, `payment-method-catalog.ts:59,65`, `customization.ts:125`, `apple-pay.port.ts:45` + `apple-pay.adapter.ts:116,119`, `tonder.ts:249`) contain no forbidden terms. **Do not touch them at all** — they appear in the PROTECTED list precisely so a broad sweep does not eat them.
- If any PROTECTED comment must change, record the before/after in `apply-progress` so verify can check the WHY survived.

**Do not edit** `src/**/*.test.ts` (out of scope) or any runtime code. The only permitted non-comment diff is whitespace produced by prettier.

---

## Verification

Run in this order. Each command proves something distinct.

| #   | Command                                                                                                                                                 | Proves                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `npm run lint` **before any edit**, record the exact error count and messages in `apply-progress`                                                       | The lint baseline. The proposal says "two known pre-existing errors in test files" — measure it, do not trust it. C4 means the `eslint.config.mjs` change could move this number, so the baseline must be captured first. |
| 1   | `npm run test`                                                                                                                                          | Unit tests green, including the new guard tests. Must pass with **zero edits to existing test files** — this is the evidence that no runtime behavior changed.                                                            |
| 2   | `npm run typecheck`                                                                                                                                     | `tsc --noEmit` on `src` plus the e2e project. Comment edits cannot break this, so a failure here means something non-comment was touched.                                                                                 |
| 3   | `npm run build`                                                                                                                                         | Rollup succeeds **and**, after commit 4, `postbuild` runs the guard and exits 0. This is the centrepiece: a freshly rebuilt `dist/` free of forbidden vocabulary.                                                         |
| 4   | `node scripts/check-dist-vocabulary.mjs` (standalone, after step 3)                                                                                     | Explicit re-run with visible output. Exit 0 and "0 findings in 5 published artifact(s)".                                                                                                                                  |
| 5   | Negative test: reintroduce `INTERNAL` into one JSDoc block in `src/`, `npm run build`, confirm **non-zero exit** and an actionable message; then revert | The guard actually fails a build. Without this, criterion 2 of the proposal is unverified. Do this manually; do not commit it.                                                                                            |
| 6   | `npm run lint`                                                                                                                                          | Error set identical to the step-0 baseline. Not "two errors" — identical to what was measured.                                                                                                                            |
| 7   | `npm run format:check`                                                                                                                                  | Prettier clean on `src/**/*.ts`.                                                                                                                                                                                          |
| 8   | Manual: re-read the seven PROTECTED entries                                                                                                             | Each still present and still stating its constraint, not merely still containing text.                                                                                                                                    |

`npm run test:e2e` is not required — `pretest:e2e` triggers the same build and guard already covered by step 3, and no runtime behavior changed.

## Checklist for `sdd-tasks`

- [ ] Four commits per DD7, in that order; commit 1 before commit 3 is non-negotiable.
- [ ] Guard test fixtures are copied **verbatim** from `dist/` before cleanup.
- [ ] `vitest.config.ts` include extended (C3) and `eslint.config.mjs` `scripts/**` globals added (C4) — both in commit 1.
- [ ] Guard targets derived from `package.json` `files`, covering `index.cjs` (C1).
- [ ] Lint baseline captured before the first edit.
- [ ] Success criterion restated as "zero guard findings", not "down from 11/41/8" (C2).
