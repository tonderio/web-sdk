# Apply progress: card-field-mount-visibility

**Status:** complete — 22/22 tasks. **Mode:** Strict TDD. **Delivery:** 3 commits on `feature/DEV-2277`, no PR, no version bump.

## Phase 0 gate: PASSED — chain reproduced, mechanism corrected

The in-repo probe could not settle it: `makeCollectContainer()` stubs `collect()` to resolve unconditionally, ignoring mount state, so it measures the fake rather than Skyflow. Probe output was `{"settled":"resolved"}`. Discarded per task 0.3.

Settled instead against the real shipped SDK (`https://js.skyflow.com/v1/index.js`, HTTP 200, 413,606 bytes):

| Link                             | Evidence                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Elements register at creation    | `create()` → `Tn[elementName] = o`, with `isMounted = false` set on the record                                                        |
| `collect()` gates on mount state | `Object.values(Tn).forEach(e => { if (!e.isMounted()) throw new SkyflowError(ELEMENTS_NOT_MOUNTED, [], true); e.isValidElement(); })` |
| The throw rejects, not throws    | Body sits in `new Promise((res, rej) => { try { ... } catch (e) { log(e.message); rej(e); } })`                                       |
| Error copy                       | `ELEMENTS_NOT_MOUNTED: "Collect failed. Make sure all elements are mounted before calling 'collect' on the container."`, code 400     |
| SDK normalization                | `skyflow.adapter.ts` collect catch → `AppError(MOUNT_COLLECT_ERROR)` → `tonder.ts:823-827` → `PAYMENT_PROCESS_ERROR`                  |

**Two corrections to the proposal — conclusion holds, mechanism does not:**

1. The proposal blamed `:315`'s unconditional `elements.push` for making the unmounted element participate in `collect()`. False. That array is local bookkeeping used only by `unmountContext`. Skyflow registers the element at `create()`, so it participates regardless. The chain is _more_ robust than claimed — removing the push would not have saved the merchant.
2. The proposal blamed `validationsByField`'s non-empty regex rejecting an empty value. False. The `isMounted()` gate runs _before_ `isValidElement()` and short-circuits. Validation never runs.

**This closes the real breaking-change risk.** The gate is container-wide and unconditional: one unmounted element rejects the entire `collect()`. So there is no "the missing field was optional to the backend, so the merchant was fine" case — a merchant missing _any_ configured field's container, even `cardholder_name`, cannot complete a payment today. Throwing relocates an existing failure; it does not create one.

## Work units

| #   | Commit                                                                              | Content                                        |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | `d103b86` `fix(card-fields): unmount partial mount() progress before rethrowing`    | Teardown-before-throw + 3 tests                |
| 2   | `6ff5ed3` `fix(card-fields): mount() rejects when a configured container is absent` | `{ required }` split + inverted test + 4 tests |
| 3   | `457e952` `docs(card-fields): document the missing-container rejection on mount()`  | README method description + Throws row         |

Unit 1 shipped before Unit 2 deliberately: the orphan-iframe bug is reachable today via the `container.create` throw path, and without the fix a throwing `mount()` would be strictly worse than the silent failure it replaces.

## TDD cycle evidence

| Task                                     | RED                                                        | GREEN | Proof it can fail                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| Teardown before rethrow                  | `expected "vi.fn()" to be called 1 times, but got 0 times` | pass  | native RED                                                                                                      |
| Teardown cannot mask the cause           | `expected "vi.fn()" to be called 1 times, but got 0 times` | pass  | native RED                                                                                                      |
| No context registered for a failed mount | passed first run (fence)                                   | pass  | mutation: `contexts.set` inside the catch → `expected { card_number: 'tok_pan' } to be an instance of AppError` |
| 1.1 Inverted missing-container test      | `expected undefined to be an instance of AppError`         | pass  | native RED                                                                                                      |
| 1.2 `originalError` names the selector   | `expected undefined to be an instance of Error`            | pass  | native RED                                                                                                      |
| 1.3 Container arrives within budget      | passed first run (fence)                                   | pass  | mutation: `MOUNT_RETRIES = 0` → fails                                                                           |
| 1.4 Teardown on missing later container  | RED                                                        | pass  | native RED                                                                                                      |
| AC5 `reveal()` stays partial-success     | passed first run (fence)                                   | pass  | mutation: reveal call site `{ required: true }` → fails, and takes the existing CVV-skip test with it           |

Every fence that passed on first run was mutation-proved rather than trusted.

## Error-copy decision (Phase 3)

**Left `messages.ts` unchanged.** `MOUNT_COLLECT_ERROR`'s copy — "Mount failed. Make sure all inputs are complete and valid." — does misdirect for a missing container, but it is shared with the collect-rejection path where it is accurate. Rewording it to cover both causes makes it vaguer for the case it currently serves well, and the merchant-visible contract does not change: the code, the message, and the throwing method are all as documented. The specific cause travels on `originalError`, which now carries the exact selector (`[card_fields] Container #pan_box not found after 3 attempts`), is asserted by a test, and is documented in the README Throws row.

## Deliberately not changed

- **The test fake's `collect()`** still resolves regardless of mount state, so unit tests can never catch an `ELEMENTS_NOT_MOUNTED` regression. Real fidelity gap, but out of scope and it would ripple through the collect/reveal suites.
- **Retry budget** — `MOUNT_RETRIES = 2`, `MOUNT_RETRY_DELAY_MS = 30` untouched, per non-goals.
- **`reveal()`** — partial-success contract intact, now fenced by a test.
- **Version / changelog** — no bump, no file; release owner decides.
- **The error-code reference table** (`README.md:1590`) already said "Ensure all field containers exist", which remains accurate.

## Verification (final)

| Check                              | Baseline                          | After                             |
| ---------------------------------- | --------------------------------- | --------------------------------- |
| `npm run test`                     | 53 files, 580 tests               | 53 files, **587** tests           |
| `npm run typecheck`                | clean                             | clean                             |
| `npm run lint`                     | 0 errors, 0 warnings              | 0 errors, 0 warnings              |
| `npm run build` + vocabulary guard | 0 findings, 5 artifacts, 49 files | 0 findings, 5 artifacts, 49 files |

Diff: ~107 insertions / ~10 deletions across 3 files. Well inside the 400-line budget.
