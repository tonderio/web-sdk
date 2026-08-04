# Tasks: A card field that fails to mount must be detectable

No spec/design phase ran; tasks derive directly from `proposal.md` (authoritative) plus verified source facts below.

## Corrections to inherited context (do not build on these as stated)

- The version is **not** to be bumped this change (delivery is commits only; whoever cuts the release decides). Proposal §6 says "tasks phase owns" a `0.2.0` recommendation — overridden; no version-bump task exists here.
- `openspec/specs/sdk-artifact-hygiene/spec.md` governs comment **vocabulary**, not error-code/thrower pairing — checked, no such requirement exists there. Moot anyway: this change adds no new error code.
- Proposal §5 non-goals already forecloses "a new `ErrorKeyEnum` member," so the error-copy decision (Phase 3) has only two live branches, not three.

## Review Workload Forecast

| Field                   | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Estimated changed lines | ~180–320 (Unit 1 ~60–70, Unit 2 ~100–130, Unit 3 ~15–25)     |
| 400-line budget risk    | Low                                                          |
| Chained PRs recommended | No — not applicable, commits only, no PR opened this session |
| Suggested split         | 3 sequential commits on `feature/DEV-2277`                   |
| Delivery strategy       | commits only                                                 |
| Chain strategy          | not applicable                                               |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                                     | Commit                                                                     | Notes                                                                        |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | Teardown-before-throw (fixes existing orphan-iframe bug) | `fix: unmount partial mount() progress before rethrow`                     | Independent of Unit 2; already reachable via `container.create` throws today |
| 2    | Throw on missing container (core conformance fix)        | `fix: card_fields.mount() throws MOUNT_COLLECT_ERROR on missing container` | Depends on Unit 1 landing first                                              |
| 3    | README Throws-table update                               | `docs: document mount() missing-container throw`                           | Depends on Unit 2                                                            |

## Phase 0: Verify the claimed failure chain (gate)

- [x] 0.1 Add a temporary (uncommitted) test in `skyflow.adapter.test.ts`: mount a field with no matching container present, then call `collect()` on that context against **current** (pre-fix) code; assert whether it rejects with `AppError` code `MOUNT_COLLECT_ERROR`.
- [x] 0.2 If it does NOT reject that way, STOP — do not proceed to Phase 2. Report the actual behavior; proposal §6's breaking-change analysis needs revision first.
- [x] 0.3 If confirmed, discard the temporary test (its coverage is superseded by AC1 in Phase 1) unless it reveals an assertion AC1 doesn't already cover.

## Phase 1: RED — pin the new contract (locate by function/test name, not line number — numbers are stale)

- [x] 1.1 In `skyflow.adapter.test.ts`, invert the test named `'does NOT throw and does NOT mount when the container node is missing'`: rename it and change `resolves.toBeUndefined()` to assert rejection with `AppError` `code === ErrorKeyEnum.MOUNT_COLLECT_ERROR`. Confirm RED against current code (AC1).
- [x] 1.2 Add a test asserting the rejected error's `originalError` carries the missing container's selector (AC2). Confirm RED.
- [x] 1.3 Add a fake-timers test: container inserted between retry attempts still mounts and resolves — regression fence, should already pass (AC3).
- [x] 1.4 Add a 3-field test, field 2's container absent: assert field 1's `element.unmount()` was called and no context is registered for that call (`collect()` on it then rejects). Confirm RED (AC4).
- [x] 1.5 Confirm existing reveal tests and the 5-field happy-path test (`skyflow.adapter.test.ts`, locate by test name) still pass unmodified — do not edit them (AC5, AC6).

## Phase 2: GREEN

- [x] 2.1 **Unit 1 — teardown-before-throw.** In `mount()`'s `catch` (`skyflow.adapter.ts`, around the field loop's try/catch), before rethrowing as `AppError`, iterate the local `elements` array built so far this call and call `element.unmount?.()` on each, wrapped per-element in try/catch (mirror `unmountContext`'s pattern) so one bad unmount can't mask the original error. End state: no orphaned iframes, no entry added to `this.contexts` for the failed call (already true — `contexts.set` runs after the try/catch).
- [x] 2.2 Run tests — confirm 1.4's teardown assertion passes via the existing `container.create`-throws path even before 2.4 exists; confirm 1.1/1.2 still RED.
- [x] 2.3 **Unit 2 — required/optional split.** Give `tryMountElement` an explicit options param `{ required: boolean }` (not a bare boolean — self-documenting at call sites). `mount()` call site passes `{ required: true }`; `reveal()` call site passes `{ required: false }`.
- [x] 2.4 When `required: true` and the retry budget is exhausted, throw `new Error(...)` carrying the `container_id` instead of only `console.warn`. When `required: false`, keep today's exact behavior (warn, return) — do not touch `reveal()`'s console output or resolution shape.
- [x] 2.5 Confirm the thrown error propagates through `mount()`'s existing try/catch unchanged into `AppError({ errorCode: MOUNT_COLLECT_ERROR, originalError: error })` with zero extra plumbing — satisfies AC2 for free. Run 1.2's test.
- [x] 2.6 Run full `npm run test` — AC1/AC2/AC4 green, AC3/AC5/AC6 unmodified and green.

## Phase 3: Error-copy decision (record, don't skip)

- [x] 3.1 DECISION: `MOUNT_COLLECT_ERROR`'s shared message (`messages.ts:54-55`) misdirects for a missing container. A new error code is out of scope (proposal non-goal). Default: leave the shared copy unchanged, rely on `originalError` (from 2.4/2.5) to carry the specific cause — zero extra diff, no risk to the unrelated collect-rejection callers of the same message. If a reviewer instead wants the copy reworded to cover both causes, update `messages.ts:54-55` and its case in `messages.test.ts` in this same unit.

## Phase 4: Docs (Unit 3)

- [x] 4.1 In `README.md`'s `card_fields.mount()` Throws table, make the `MOUNT_COLLECT_ERROR` row explicit about the missing-container case and the ~60 ms retry budget; add one sentence to the method description stating a configured field's container must exist in the DOM (immediately or within the retry budget) or `mount()` rejects. No new table row — no new code was introduced.
- [x] 4.2 No `CHANGELOG.md` entry (none exists) and no `package.json` version change — commits-only delivery, version left to whoever cuts the release.

## Phase 5: Full verification sweep (per unit, before each commit)

- [x] 5.1 `npm run test` — full suite green.
- [x] 5.2 `npm run typecheck` — covers `tsconfig.json`, `tsconfig.test.json`, `e2e/tsconfig.json`; test-file edits are now type-checked too.
- [x] 5.3 `npm run lint` — must stay at 0 errors, 0 warnings (current baseline); fix any new warning before committing.
- [x] 5.4 `npm run build` — `postbuild` runs `scripts/check-dist-vocabulary.mjs`; any new/edited comment in `skyflow.adapter.ts` must avoid `payflow`, `zplit`, `usrv-`, `ionic-lite`, `COMPOSITION SEAM`, an `INTERNAL` tag, and the `DD\d+`/`D\d+`/`phase \d+`/`DEV-\d+` patterns.
- [x] 5.5 Commit per work unit with a Conventional Commit message; no PR opened this session.
