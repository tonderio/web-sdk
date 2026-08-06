# Tasks: config snapshot + instance sealing

Change: `sdk-mutation-hardening` (DEV-2277 / QA-AC-11). Phase: tasks.
Binding inputs: `design.md` (authoritative on mechanism and ordering),
`specs/sdk-instance-integrity/spec.md` (seven requirements below, `SR1`..`SR7`),
`proposal.md` (superseded wherever `design.md` corrects it — see design's
"Corrections to the proposal").

Delivery: **commits only, no PR, no PR chain.** Strict TDD is active for this
repo: `npm run test` is Vitest, tests for a behavior land before the
implementation that satisfies it, per task below.

## Spec requirement index (for traceability, used as `SR1`..`SR7` below)

| ID  | Requirement (spec.md heading)                                                          |
| --- | -------------------------------------------------------------------------------------- |
| SR1 | Instance internal state is not reachable from merchant code                            |
| SR2 | Config is read from a construction-time snapshot, not the merchant's live object       |
| SR3 | Mutating config before the first SDK call is inert                                     |
| SR4 | `config.events` stays live in both its present-and-replaced and absent-and-added forms |
| SR5 | The config clone recurses only plain objects and arrays                                |
| SR6 | The constructor-injection seam is unaffected                                           |
| SR7 | A single non-throwing warning signals config drift, without changing behavior          |

**Note on SR2/SR3 overlap:** these are two spec requirements but one
mechanism. Snapshotting at construction (before any SDK call can run)
satisfies both simultaneously — there is no separate "pre-first-call" code
path to build. Task 5 below implements and tests both together. Do not
read them as requiring two different guards.

**Design vs. spec agreement check:** read both documents fully against each
other before starting. No disagreement was found — `design.md`'s DD1..DD7
implement exactly the seven spec requirements above, including the
`events` carve-out placement (spec says "excluded from the snapshot,"
design's DD3 implements this via `Object.defineProperty` on the snapshot
object, not a per-call rebuild). If a disagreement surfaces during
implementation, stop and reconcile before continuing — do not silently
follow whichever document is more convenient.

## Correction to the orchestrator brief — verified against the actual scanner

The orchestrator's brief states the vocabulary guard "scans `src/**/*.ts`
including line comments" without qualification. That is only half true.
Read directly from `scripts/check-dist-vocabulary.mjs`:

- `isScannableSourcePath` (line 109-112): `if (!path.endsWith('.ts') ||
path.endsWith('.d.ts')) return false; return !path.endsWith('.test.ts');`
  — **`*.test.ts` files are explicitly excluded** from the source-tier scan.
  The function's own comment: _"Test files are excluded on purpose: nobody
  reads them as integration guidance, and they are dense with design
  references that would drown the signal."_
- `collectSourceFiles` (line 240-257) walks `src/` and calls
  `isScannableSourcePath` per file — this is what `postbuild` actually
  scans for the source tier.
- There is also an artifact tier (`resolveTargets`, scans `package.json`
  `files`: `dist/*.js`, `.mjs`, `.cjs`, `.d.ts`) — irrelevant to `src/`
  comments, relevant only to what ends up published.

**Consequence for this change:** `DD1`..`DD7`, `DEV-2277`, `AC-2`, etc. are
safe to write in `*.test.ts` file comments (Task 3, 5, 6, 8's test
additions). They are **not** safe in any non-test `.ts` file under `src/`
— `src/shared/config/snapshot.ts`, `src/core/TonderCore.ts`, `src/tonder.ts`,
and any new non-test source file are fully in scope for the ban. Keep the
discipline uniform anyway (write reasoning in prose, never the label) to
avoid a copy-paste mistake carrying a label from a test file into a source
file. `scripts/probe-mutation-hardening.mjs` (Task 9) lives outside `src/`
and outside `package.json` `files` — it is not scanned by either tier.

Forbidden terms confirmed in `FORBIDDEN_VOCABULARY` (line 40-97):
`payflow`, `zplit`, `usrv-[a-z0-9-]+`, `ionic-lite`, plus (per the
orchestrator brief, not re-verified line-by-line here but consistent with
the file's stated purpose) `COMPOSITION SEAM`, `INTERNAL`, `/\bDD\d+\b/`,
`/\bD\d+\b/`, `/phase \d+/i`, `/\bDEV-\d+\b/`.

**Failure mode, restated:** `postbuild` runs after `rollup` inside
`npm run build`, which runs after `npm run test` and `npm run typecheck`
have already passed in every gate sequence below. A forbidden term in a
non-test source comment is invisible to `test` and `typecheck` — it only
surfaces at `build`. Do not read a green `npm run test` as proof this gate
will pass.

## Task list

Each task states: dependencies, whether it can run in parallel with another
listed task, the spec requirement(s) it satisfies, the design commit number
it maps to (design.md's 5-commit plan, §"Commit plan"), concrete steps, and
its definition of done (the exact gate commands plus what "green" must mean
numerically, not just the word).

---

### Task 1 [x] — Capture the verified baseline

**Depends on:** nothing (first task). **Parallel with:** Task 2.
**Design commit:** none — pre-work, no source change.

On the current clean tree (before any edit in this change), run and record
verbatim output:

```bash
npm run lint 2>&1 | tail -3
npm run format:check 2>&1 | tail -3
npm run test 2>&1 | tail -5
npm run typecheck
```

Do not trust the orchestrator-supplied figure ("2 errors, 0 warnings, both
in test files: `src/tonder.handleRequiresAction.test.ts:184`,
`src/tonder.pay.test.ts:483`") — confirm it live and record the actual
numbers and locations observed. `npm run typecheck` must already be green;
if it is not, stop and report before proceeding — this change assumes a
green starting point.

Record, for reuse as the reference in every later task's gate:

- exact lint error count, warning count, and file:line locations
- exact prettier `format:check` result
- exact test file count and test count from the Vitest summary
- confirmation `typecheck` exits 0

**Note for later tasks:** `tsconfig.json` `exclude` lists `**/*.test.ts`, so
`npm run typecheck` never compiles test files. A lint delta that is
test-file-only (as the current baseline is) is invisible to `tsc` — do not
treat "typecheck stayed green" as proof the lint baseline held. Compare
against `npm run lint`'s own count, not against typecheck.

**Definition of done:** the four numbers/states above are written down
(in the commit history via an empty note, a scratch log, or carried
forward in the executor's own working notes — no source file changes).

## Apply record — observed numbers

| Gate                                        | Baseline (Task 1, clean tree)                                                                    | Final (Task 11)                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `npm run lint`                              | 2 errors, 0 warnings — `tonder.handleRequiresAction.test.ts:184:10`, `tonder.pay.test.ts:483:31` | identical: 2 errors, 0 warnings, same two locations |
| `npm run format:check`                      | clean                                                                                            | clean                                               |
| `npm run test`                              | 44 files, 524 tests                                                                              | 52 files, 571 tests                                 |
| `npm run typecheck`                         | exit 0                                                                                           | exit 0                                              |
| `npm run build`                             | n/a                                                                                              | green, 0 findings in 5 artifacts + 46 source files  |
| `node scripts/probe-mutation-hardening.mjs` | n/a                                                                                              | exit 0, 15/15 checks                                |

All 11 tasks marked complete [x]. Delivery: commits only, no PR, no PR chain.
Strict TDD enforced throughout.
