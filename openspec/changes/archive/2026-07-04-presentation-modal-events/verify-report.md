# Verification Report: presentation-modal-events

**Change**: presentation-modal-events (Slices A + B)
**Mode**: Full artifact set (proposal, spec, design, tasks, apply-progress all present)
**Branch**: feature/DEV-2245 (clean working tree, all changes committed, not pushed)

## Completeness Table

| Task Group | Status | Evidence |
|---|---|---|
| 1 — Types/config foundation | DONE | `src/shared/types/index.ts`, `src/types/card.ts` |
| 2 — Skyflow field events + error labels | DONE | `src/adapters/skyflow/skyflow.adapter.ts`, `skyflow-loader.ts` |
| 3 — Presentation modal adapter | DONE | `src/adapters/browser/browser-3ds-host.adapter.ts` |
| 4 — Facade wiring | DONE | `src/tonder.ts` (`handleRequiresAction`, `handleApmResult`) |
| 5 — Regression/e2e | DONE | `e2e/tests/threeds.spec.ts`, `e2e/fixture/checkout.html`, `e2e/support/fixtures.ts` |
| 6 — Docs | DONE | `README.md`; sibling demos (uncommitted, separate repo) |

No unchecked tasks found in `tasks.md`.

## Build/Test Evidence (executed fresh, this session)

- `npm test` → **253/253 passing**, 29 files. Matches apply-progress claim exactly.
- `npm run typecheck` (`tsc --noEmit` + e2e tsconfig) → **PASS**, zero errors.
- `npm run lint` → **PASS**, 0 errors, 1 pre-existing warning at `e2e/support/fixtures.ts:207` (unused eslint-disable, not introduced by this change) — confirmed, not a new finding.

## Spec Compliance Matrix

### Domain: presentation-mode (delta)

| Requirement | Scenario | Evidence | Status |
|---|---|---|---|
| Card 3DS presentation | presents without container | `Browser3dsHost.open()` appends to `document.body`, no container param anywhere; `ThreeDsHostPort` has no container arg | PASS |
| | auto-closes on completion | `handleRequiresAction` `finally { this.host.close() }` on every exit | PASS |
| | auto-closes on timeout/error | same `finally`; `onComplete` only fires on the success line before `finally`, confirmed by code read | PASS |
| Card 3DS not closable | no X rendered, only SDK closes | `open()` only appends close button `if (options.closable)`; 3DS call site passes `closable:false` | PASS |
| APM/SPEI presentation | no polling, returns Pending immediately | `handleApmResult` calls `open()` then `return tx` — no poll call | PASS |
| Closing embedded APM overlay | X + onClose fires | APM call site: `closable:true, onUserClose:config.onClose`; `userClose()` invokes callback, programmatic `close()` sets `onUserClose = undefined` first — never fires | PASS |
| | `unmountPresentation` absent | grep: zero occurrences in `src/` except the intentional RED test asserting it's `undefined` (`tonder.handleRequiresAction.test.ts:592-600`) | PASS |

### Domain: card-field-events (new)

| Requirement | Scenario | Evidence | Status |
|---|---|---|---|
| Field lifecycle events | onReady/onChange/onFocus/onBlur, optional | `wireFieldEvents` wires all four via `element.on(EventName.*, ...)`, guards `typeof element.on !== 'function'`; payload built by `toCardFieldState` includes `elementType,isEmpty,isFocused,isValid,value,error` | PASS |
| SDK-owned default error labels | setError before update, ordering load-bearing | `skyflow.adapter.ts:433-443`: `element.setError?.(message)` called, THEN `element.update?.({errorTextStyles...})` unconditionally after the if/else — order confirmed by direct code read | PASS |
| | errorMessages override threaded from config | `tonder.ts:159` — `errorMessages: config.errorMessages` passed into `SkyflowAdapterDeps` construction; `resolveErrorMessage` reads `this.deps.errorMessages` | PASS |

## Correctness Checks (task-specific instructions from the user)

1. `MountCardFieldsRequest.events` full per-field payload with `error: string|null` — **CONFIRMED** (`src/types/card.ts:31-44`, `src/adapters/skyflow/skyflow.adapter.ts:460-469`).
2. Blur+invalid `setError` before `update`; `errorMessages` override; Skyflow event names match real enum — **CONFIRMED**. Note: `EventName` in `skyflow-loader.ts` is a hand-authored type (no `skyflow-js` npm package exists in this repo — it's loaded via runtime `<script>` tag from `js.skyflow.com`, not a compile-time dependency). See CRITICAL/WARNING below.
3. `ThreeDsHostPort` is exactly `redirect`/`open(url,{closable,onOpen?,onUserClose?})`/`close()`, no `mountIframe`/`unmount`, no `TonderConfig` import — **CONFIRMED** (`src/ports/threeds-host.port.ts`).
4. `Browser3dsHost`: body-appended, OPEN shadow root, `role=dialog`/`aria-modal`, focus trap, backdrop, z-index `2147483647`; 3DS non-closable (no X, Escape ignored); APM closable (X+Escape→close()+onUserClose; programmatic close does NOT fire onUserClose) — **CONFIRMED**, all behaviors read directly from `browser-3ds-host.adapter.ts`.
5. `handleRequiresAction`/`handleApmResult` wiring, still-Pending-not-final invariant — **CONFIRMED**. `handleRequiresAction` races messenger/poll, `onComplete` only after race resolves to FINAL (timeout/error throw before reaching that line). `handleApmResult` opens closable modal, returns pending immediately, no poll.
6. `presentationContainerId` removed from `TonderConfig`; `onClose`/`onOpen`/`onComplete` added; `unmountPresentation()` and `DEFAULT_PRESENTATION_CONTAINER_ID` deleted — **CONFIRMED** via grep across `src/`, tests, `dist/index.d.ts`, `e2e/`. Zero leftover except the intentional RED assertion test.
7. `errorMessages` threaded into `SkyflowAdapter` construction site — **CONFIRMED** (`tonder.ts:159`), fixing the Slice A gap as claimed.
8. Return contract intact — `pay()`/`getTransaction()`/`pollTransaction()` all return bare `Promise<RawTransaction>` — **CONFIRMED**.
9. Test suite — **253/253 passing**, typecheck clean, lint clean except the pre-existing warning — **CONFIRMED**, all executed fresh this session.

## Demos Consistency (SUGGESTION-level)

`/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3` (separate uncommitted git repo, confirmed via `git status`):
- `pay.html`/`apms.html` grep-clean of `presentationContainerId`/`unmountPresentation`/`#tonder-3ds`.
- `pay.html` wires `onOpen`/`onComplete`; `apms.html` wires `onOpen`/`onClose`. Matches claim.

## Issues

### CRITICAL
None blocking.

### WARNING
1. **Unverified external dependency claim carried as "VERIFIED".** apply-progress (and the design doc before it) states the Skyflow `.on()`/`setError()`/`resetError()`/`update()`/`EventName`/`onReady` signatures were "VERIFIED against real type defs." This repo has **no `skyflow-js` npm dependency** (not in `package.json`, not in `node_modules`) — the SDK is loaded at runtime via a `<script src="https://js.skyflow.com/v1/index.js">` tag with no bundled/committed type definitions anywhere in this repository. There is no artifact in this repo that substantiates "verified against real type defs" — it can only have been checked against external docs/memory, which is unfalsifiable from source inspection alone. Unit tests exercise a fake Skyflow object (`skyflow.adapter.test.ts`), so a real-world signature mismatch (e.g., if `onReady` doesn't fire per-element the way assumed, or `EventName.READY` differs) would NOT be caught by the test suite; it would only surface in a live browser against the real vault. Recommend a manual smoke test against a real Skyflow sandbox vault before this ships to production, since this was explicitly flagged as a CRITICAL apply-time risk in the tasks/design docs and the resolution evidence is not verifiable from the codebase.
2. **Delivery-strategy chaining was not applied.** `tasks.md`'s Review Workload Forecast flagged `400-line budget risk: High`, `Chained PRs recommended: Yes`, `Decision needed before apply: Yes` (ask-on-risk). Actual diff from before Slice A to end of Slice B is **1189 insertions / 240 deletions across 16 files** (~1429 changed lines) landed as a single sequential commit chain on `feature/DEV-2245`, not yet split into separate PRs. This is not a defect in the code, but the chaining/PR-splitting decision that the forecast said must happen before apply appears to not have been surfaced/decided — flagging so it isn't skipped at PR-creation time.

### SUGGESTION
1. Demos repo (`/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3`) is fully uncommitted — consider committing there once this SDK version is ready to ship, so the demo stays in sync with the release rather than sitting as local-only changes.

## Verdict

**PASS WITH WARNINGS**

Both slices are functionally complete, all spec requirements/scenarios are covered by code and passing tests, task lists are 100% done, and build/typecheck/lint are clean. The two warnings are process/traceability concerns (an unverifiable external-signature claim, and a still-pending PR-chaining decision), not functional defects — nothing here blocks correctness of the shipped behavior, but both should be resolved/acknowledged before merge to main.
