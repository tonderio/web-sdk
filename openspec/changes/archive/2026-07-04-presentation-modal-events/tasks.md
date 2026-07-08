# Tasks: presentation-modal-events

Source: `openspec/changes/presentation-modal-events/design.md`, `openspec/changes/presentation-modal-events/specs/**`.
Strict TDD (vitest): every implementation task follows RED (failing test committed/verified first) -> GREEN (minimal impl) -> REFACTOR (if needed) inside the same task. Do not write production code before its RED test exists.

Legend: `[P]` = can run in parallel with sibling `[P]` tasks in the same group (independent files, no shared edit). Unmarked tasks are sequential — they depend on the immediately preceding task(s).

---

## Group 1 — Types & config (foundation, sequential; everything else depends on this)

### 1.1 Remove `presentationContainerId`, add lifecycle/error-message config
- **Satisfies**: spec `presentation-mode` MODIFIED requirements (container removed); `card-field-events` error-labels requirement (config carries `errorMessages`).
- **File**: `src/shared/types/index.ts`
- RED: add/adjust a type-level test (or extend an existing config test) asserting `TonderConfig` has no `presentationContainerId` property and does accept `onClose?`, `onOpen?`, `onComplete?`, `errorMessages?`. If no type-only test file exists, add a compile-time check (e.g. a `.test-d.ts` or a runtime test constructing configs with/without these fields) — do not skip RED just because this is "just types".
- GREEN: remove `presentationContainerId` from `TonderConfig`; add `onClose?(): void`, `onOpen?(): void`, `onComplete?(): void`, `errorMessages?: FieldErrorMessages` (type defined in 1.2, imported here).
- Update the JSDoc on `presentationMode` (currently references `presentationContainerId` and `unmountPresentation`) to describe the new modal + callback contract.

### 1.2 Card field events & payload types [P with 1.3] — DONE (Slice A)
- **Satisfies**: spec `card-field-events` (payload shape, per-field callbacks).
- **File**: `src/types/card.ts`
- RED: type-level/runtime test asserting `MountCardFieldsRequest.events?: Partial<Record<CardField, CardFieldEvents>>` compiles and that `CardFieldState` has exactly `{ elementType, isEmpty, isFocused, isValid, value, error: string | null }`.
- GREEN: add `FieldName = CardField` alias (per design) or reuse `CardField` directly per design note; add:
  ```ts
  export interface CardFieldState {
    readonly elementType: CardField;
    readonly isEmpty: boolean;
    readonly isFocused: boolean;
    readonly isValid: boolean;
    readonly value: string;
    readonly error: string | null;
  }
  export interface CardFieldEvents {
    onChange?(state: CardFieldState): void;
    onBlur?(state: CardFieldState): void;
    onFocus?(state: CardFieldState): void;
    onReady?(state: CardFieldState): void;
  }
  export type FieldErrorMessages = Partial<Record<CardField | 'required' | 'invalid', string>>;
  ```
  Add `events?: Partial<Record<CardField, CardFieldEvents>>` to `MountCardFieldsRequest`.

### 1.1 — DONE (Slice B): removed `presentationContainerId`; added `onClose`/`onOpen`/`onComplete` (errorMessages added in Slice A).

### 1.3 `ThreeDsHostPort` contract [P with 1.2] — DONE (Slice B)
- **Satisfies**: spec `presentation-mode` (SDK-owned overlay, no container param; APM closable via callback).
- **File**: `src/ports/threeds-host.port.ts`
- RED: a port-shape test (type-only or via a fake implementing the interface) asserting the port no longer has `mountIframe`/`unmount` and instead exposes `redirect(url)`, `open(url, options)`, `close()`; `ThreeDsHostOptions` has `closable: boolean`, `onOpen?()`, `onUserClose?()`. Assert the port file has NO import of `TonderConfig` (adapter must stay config-agnostic — grep-based test or ESLint import check acceptable).
- GREEN: rewrite the port:
  ```ts
  export interface ThreeDsHostOptions {
    closable: boolean;
    onOpen?(): void;
    onUserClose?(): void;
  }
  export interface ThreeDsHostPort {
    redirect(url: string): void;
    open(url: string, options: ThreeDsHostOptions): void;
    close(): void;
  }
  ```

---

## Group 2 — Skyflow field events & error labels (depends on Group 1) — DONE (Slice A)

Slice A note: `errorMessages` was added to `TonderConfig` (task 1.1's error-message
portion only); `presentationContainerId` removal and `onClose`/`onOpen`/`onComplete`
config callbacks remain deferred to Slice B. Real Skyflow signatures validated
against `skyflow-js` type defs — `EventName` is `{CHANGE,READY,FOCUS,BLUR,SUBMIT}`
(READY confirmed real, `onReady` wired), `on(name, handler)`, `setError(msg)`,
`resetError()`, `update(opts)` all confirmed; setError-before-update order confirmed.

### 2.1 Widen `SkyflowElement`/`SkyflowStatic` typings — DONE (Slice A)
- **Satisfies**: spec `card-field-events` (SDK-owned default error labels; event wiring).
- **File**: `src/adapters/skyflow/skyflow-loader.ts`
- RED: extend `skyflow.adapter.test.ts` fake-Skyflow fixture to require `on()`, `setError()`, `resetError()`, `update()` on the fake element and `EventName` on the fake static — this will fail to compile/type-check against the current narrow `SkyflowElement`/`SkyflowStatic` before GREEN.
- GREEN: add to `SkyflowElement`: `on(event: string, cb: (state: SkyflowElementState) => void): void`, `setError(message: string): void`, `resetError(): void`, `update(options: Record<string, unknown>): void`; add `SkyflowElementState` interface (Skyflow's native per-element state shape — value/isEmpty/isValid/isFocused, whatever fields the adapter reads); add `EventName: { CHANGE: string; BLUR: string; FOCUS: string; READY: string }` to `SkyflowStatic`.
- **Risk flag**: real Skyflow `.on()`/`setError`/`EventName`/`onReady` signatures are UNVERIFIED against the live Skyflow SDK docs/runtime. This task ships against a documented-but-unconfirmed shape; `sdd-apply` MUST cross-check against Skyflow's actual collect-SDK type defs (or a quick manual smoke test) before merge, since a mismatch here silently breaks event wiring in production (unit tests use the fake element and will pass regardless).

### 2.2 Error-message resolution helper — DONE (Slice A)
- **Satisfies**: spec `card-field-events` "SDK-owned default error labels" (default copy + per-field override).
- **File**: `src/adapters/skyflow/skyflow.adapter.ts`
- RED: unit tests in `skyflow.adapter.test.ts` for a `resolveErrorMessage(field, state, errorMessages)`-shaped helper (or equivalent): empty value → `errorMessages.required ?? 'This field is required.'`; non-empty invalid → `errorMessages[field] ?? errorMessages.invalid ?? 'This field is invalid.'`; valid → no error.
- GREEN: implement the helper (private method or module function) and thread `errorMessages` into `SkyflowAdapterDeps`.

### 2.3 Wire field events (`wireFieldEvents`) with load-bearing setError-before-update order — DONE (Slice A)
- **Satisfies**: spec `card-field-events` (lifecycle events; SDK-owned error labels, ordering).
- **File**: `src/adapters/skyflow/skyflow.adapter.ts`
- RED (each is its own failing test in `skyflow.adapter.test.ts` before GREEN):
  - `on(BLUR)` with invalid state calls fake `element.setError(msg)` BEFORE `element.update({ errorTextStyles })` — assert call order via a shared spy/log array, not just "both were called".
  - `on(BLUR)` with valid state calls `element.resetError()` and does NOT call `setError`.
  - `on(FOCUS)` on a previously-invalid field calls `element.resetError()`.
  - `on(CHANGE)` emits `CardFieldEvents.onChange` with a fully-populated `CardFieldState` including `error` (null when valid, message when invalid-but-not-yet-blurred per design normalization — confirm against design's `emit` behavior).
  - `on(READY)` emits `onReady` exactly once per element (not on every mount retry).
  - Each field event fires the merchant callback (`events[field][evt]`) only when provided — omitting `events` must not throw.
  - Merchant-provided `errorMessages` override the default copy while ordering (setError before update) is preserved.
- GREEN: implement `wireFieldEvents(element, field, deps)` called from `mount()` after `element.create(...)`; `emit()` normalizes native Skyflow element state into `CardFieldState` (never pass raw Skyflow state to merchant callbacks) and dispatches to `request.events?.[field]?.[eventName]`.
- Wire this into `SkyflowAdapter.mount()` for every created element.

---

## Group 3 — Presentation modal (depends on Group 1.3; independent of Group 2) — DONE (Slice B)

### 3.1 Modal adapter: shadow-DOM host, dialog semantics, focus trap [P with Group 2] — DONE (Slice B)
- **Satisfies**: spec `presentation-mode` (SDK-owned overlay appended to body, no merchant container; 3DS not closable; APM closable with X + Escape).
- **File**: `src/adapters/browser/browser-3ds-host.adapter.ts` (rewrite `Browser3dsHost`); test file `src/adapters/browser/browser-3ds-host.adapter.test.ts` (full rewrite per design).
- RED (write/verify each fails before GREEN):
  - `open(url, { closable: false })` appends a host node to `document.body` with an attached OPEN `shadowRoot` (assert `.shadowRoot` is truthy and mode `'open'`).
  - Shadow content includes an element with `role="dialog"` and `aria-modal="true"` (plus an aria-label).
  - Shadow content includes an iframe/frame pointed at `url`.
  - `open(url, { closable: false })` renders NO close control (query the shadow root for a close button/X — must be absent).
  - Simulating `Escape` keydown while `closable: false` does NOT call `close()` / `onUserClose`.
  - `open(url, { closable: true, onUserClose })` renders a close control; clicking it calls `close()` AND `onUserClose`.
  - `open(url, { closable: true, onUserClose })` + `Escape` keydown calls `close()` AND `onUserClose`.
  - Programmatic `close()` (not user-triggered) does NOT call `onUserClose`.
  - `open(url, { onOpen })` calls `onOpen` once the host node is mounted.
  - `close()` removes the host node from `document.body` (idempotent — calling twice does not throw).
  - Old `THREEDS_REDIRECTION_ERROR`/container-not-found throw path is gone (no container lookup anymore) — confirm by asserting `open()` never throws for a missing selector (there is no selector anymore).
  - Focus trap: after `open()`, focus starts inside the shadow dialog; `Tab`/`Shift+Tab` cycling does not move focus outside the shadow-root focusable set (test the trap logic directly against the shadow root's focusable elements, not real browser focus behavior if jsdom limits apply — see design's noted jsdom/shadow caveat).
  - Host node has inline `position: fixed` and a high z-index (`2147483647`) applied directly on the host element (verifiable outside the shadow boundary, since CSS inside the shadow root cannot style the host from outside).
- GREEN: implement `Browser3dsHost implements ThreeDsHostPort` per design: `redirect()` unchanged (`window.location.href`); `open(url, options)` creates host node + attaches shadow root + builds dialog/overlay/iframe inside shadow + wires close control (only when `closable`) + Escape listener (only when `closable`) + focus trap; `close()` removes host node and listeners, guards double-close.
- Delete the old `mountIframe`/`unmount` methods and the `AppError`/`ErrorKeyEnum` container-not-found import if no longer used elsewhere in this file.

---

## Group 4 — Facade wiring (depends on Groups 1, 3; Group 2 not required but should land first for a coherent diff) — DONE (Slice B)

### 4.1 `handleRequiresAction`: open/close + onComplete/onOpen — DONE (Slice B)
- **Satisfies**: spec `presentation-mode` MODIFIED "Card 3DS presentation" + "not closable by the shopper".
- **File**: `src/tonder.ts`; test: `src/tonder.handleRequiresAction.test.ts` (or existing equivalent — rewrite per design).
- RED:
  - Embedded 3DS calls `host.open(redirectUrl, { closable: false, onOpen })` (no container id anywhere in the call).
  - `onComplete` fires only when the race settles to a FINAL success/completion status — NOT on timeout/error (assert error/timeout paths do not call `onComplete`).
  - `host.close()` is called in the `finally` on every exit path (success, decline, timeout, abort, error) — port over existing finally-coverage tests.
  - Redirect mode is unchanged (still calls `host.redirect(url)`, no `open`/`close`).
- GREEN: replace `this.host.mountIframe(redirectUrl, containerId)` with `this.host.open(redirectUrl, { closable: false, onOpen: config.onOpen })`; replace `this.host.unmount()` in the `finally` with `this.host.close()`; call `config.onComplete?.()` only on the final-success branch per design decision (e). Remove `DEFAULT_PRESENTATION_CONTAINER_ID` usage from this method.

### 4.2 `handleApmResult`: open closable + onUserClose wiring — DONE (Slice B)
- **Satisfies**: spec `presentation-mode` MODIFIED "APM/SPEI presentation" + "Closing an embedded APM overlay".
- **File**: `src/tonder.ts`; test: `src/tonder.pay.test.ts` (APM section) or dedicated APM presentation test.
- RED:
  - Embedded APM calls `host.open(redirectUrl, { closable: true, onOpen: config.onOpen, onUserClose: config.onClose })`.
  - APM overlay is left mounted (no `close()` call after `open()` — async settlement contract preserved).
  - Shopper-driven close (simulated via the modal's close path in 3.1, exercised end-to-end here or asserted via a fake host spy) results in `config.onClose` firing through `onUserClose`.
- GREEN: replace `this.host.mountIframe(redirectUrl, containerId)` with `this.host.open(redirectUrl, { closable: true, onOpen: config.onOpen, onUserClose: config.onClose })`. Remove `DEFAULT_PRESENTATION_CONTAINER_ID` usage from this method.

### 4.3 Delete `unmountPresentation()` and dead config coupling — DONE (Slice B)
- **Satisfies**: spec `presentation-mode` MODIFIED "Closing an embedded APM overlay" — "`unmountPresentation()` MUST NOT exist".
- **File**: `src/tonder.ts`
- RED: a test (or type-check assertion) confirming `Tonder.prototype.unmountPresentation` is `undefined` / the method does not exist on the public facade; grep-based CI-style check is acceptable as a supplementary RED but must be paired with a runtime/type assertion, not grep alone.
- GREEN: delete the `unmountPresentation()` method and its JSDoc; delete the module-level `DEFAULT_PRESENTATION_CONTAINER_ID` constant (now fully unused after 4.1/4.2); remove any leftover `presentationContainerId` references in `tonder.ts` comments/JSDoc (lines currently referencing it in `handleRequiresAction`/`handleApmResult`/`unmountPresentation` docblocks).
- Thread `errorMessages` from `TonderConfig` into the `SkyflowAdapterDeps` construction (wherever `SkyflowAdapter` is instantiated — check `Tonder` constructor/factory) so Group 2.2's helper receives merchant overrides.

---

## Group 5 — Regression & integration tests (depends on Groups 1-4) — DONE (Slice B: 5.1/5.2/5.3 rewritten; 5.4 e2e fixtures updated, #tonder-3ds container removed, modal assertion added)

### 5.1 [P] Rewrite/extend `browser-3ds-host.adapter.test.ts`
- Already covered by 3.1's RED list — ensure the full old test file (`mountIframe`/`unmount`/container-not-found tests) is removed, not left dangling alongside the new ones.

### 5.2 [P] Rewrite `tonder.handleRequiresAction.test.ts` and APM section of `tonder.pay.test.ts`
- Already covered by 4.1/4.2's RED lists — remove old `presentationContainerId`/`mountIframe` assertions.

### 5.3 [P] Extend `skyflow.adapter.test.ts`
- Already covered by 2.1-2.3's RED lists — confirm no regressions in existing `mount`/`collect`/`reveal`/`unmount` tests (unrelated to events) still pass unmodified.

### 5.4 e2e fixtures
- **File**: `e2e/fixture/checkout.html`, `e2e/tests/threeds.spec.ts`, `e2e/tests/apms.spec.ts`
- Drop `presentationContainerId` from any fixture config. Update `threeds.spec.ts` to assert against the new shadow-host modal (no fixed container id to query) instead of the removed iframe-in-container pattern. Update `apms.spec.ts` if it references `unmountPresentation` or the old container.
- This is Playwright, not vitest/strict-TDD — treat as a direct update task, not RED/GREEN.

---

## Group 6 — Docs (depends on Groups 1-5 being functionally complete; can start once APIs are stable) — DONE (Slice B: 6.1 README rewritten; 6.2 sibling demos updated, uncommitted; 6.3 supersession noted — actual archive in sdd-archive)

### 6.1 README rewrite
- **File**: `README.md` (repo root, `@tonder.io/web-sdk`)
- Remove all `presentationContainerId`/`unmountPresentation` references. Document `onClose`/`onOpen`/`onComplete`, `errorMessages`, `mountCardFields({ events })`, `CardFieldState` payload shape, and the new SDK-owned modal behavior (3DS non-closable, APM closable with X/Escape).

### 6.2 [P] Sibling demos update (uncommitted, separate folder — outside this repo's git tree)
- **Path**: `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/pay.html`, `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/apms.html`
- Remove `presentationContainerId` config and any DOM container markup (`#tonder-3ds` or similar) added solely for the old iframe mount.
- Remove any `unmountPresentation()` call sites; replace with `onClose` config callback wiring if the demo previously called `unmountPresentation()` on a "close" button — the button should now just be UX (the SDK's own X/Escape drives the actual close), or the demo should demonstrate `onClose` for merchant-side bookkeeping only.
- Note: this folder is outside `tonder-js`'s git tree (sibling repo/dir) — confirm write access and separate commit/PR boundary at apply time; do not assume it shares the tonder-js PR.

### 6.3 Supersede legacy spec file
- **File**: `openspec/specs/presentation-mode/spec.md`
- Mark as superseded by this change once merged (per standard OpenSpec archive flow — actual archive happens in `sdd-archive`, but note the supersession here so `sdd-apply` doesn't need to rediscover it).

---

## Review Workload Forecast

**Estimated changed lines**: ~950-1300 (production + tests), broken down roughly:
- Group 1 (types/config): ~60-90 lines
- Group 2 (Skyflow events/errors + tests): ~280-360 lines (typings +40, adapter logic +80-120, new/extended tests +160-200)
- Group 3 (modal adapter + tests): ~320-420 lines (this is the largest single unit — shadow DOM, focus trap, a11y, full test rewrite)
- Group 4 (facade wiring + tests): ~150-220 lines
- Group 5 (e2e): ~40-70 lines
- Group 6 (README + demos): ~60-120 lines (demos are outside this repo's diff budget but still real work)

**400-line budget risk**: **High**. This is a genuine multi-concern change (new UI component with accessibility requirements, event system, error-label restoration) — no single-PR path stays under 400 changed lines without cutting scope artificially.

**Chained PRs recommended**: **Yes.**

**Suggested split** (3 PRs, each independently mergeable and testable):
1. **PR 1 — Types + Skyflow events/error labels** (Groups 1, 2, part of 5.3): config/type changes are additive-only here except removing `presentationContainerId` from the type (facade still references it until PR 3, so PR 1 alone would NOT compile against `tonder.ts` — recommend keeping `presentationContainerId` removal bundled with PR 3's facade change instead, OR do the type removal in PR 3 and let PR 1 only ADD new types). Est. ~300-350 lines.
2. **PR 2 — Presentation modal adapter** (Group 3, part of 5.1): purely additive at the port/adapter level if PR 2 lands before the facade switches over — port signature change (`ThreeDsHostPort`) still needs the facade update to compile, so this PR must include the minimal facade call-site swap or be sequenced last. Recommend PR 2 = Group 1.3 (port) + Group 3 (modal) + Group 5.1, ~350-450 lines.
3. **PR 3 — Facade wiring + config cleanup + docs** (Groups 1.1, 4, 5.2, 5.4, 6): removes `presentationContainerId`/`unmountPresentation`, wires `open`/`close`/callbacks, updates README + demos. Est. ~300-400 lines.

Given the compile-time coupling between the port contract change (3) and the facade (4), **PR 1 (types + Skyflow) is the only fully independent slice**; PR 2 and PR 3 have a hard sequential dependency (port must land before facade rewires to it, though both can be in the same PR if the split above is too tight). If the user prefers fewer PRs, the minimum safe chain is **2 PRs**: PR A = Group 1 + Group 2 (types + Skyflow, ~350-440 lines), PR B = Group 1.3 + Group 3 + Group 4 + Group 5 + Group 6 (port + modal + facade + tests + docs, ~600-750 lines — still over budget but this is the port+modal+facade atomic unit that cannot be split further without leaving the port contract in an inconsistent state).

**Decision needed before apply**: **Yes** — delivery strategy is `ask-on-risk`, so the orchestrator MUST stop and ask whether to use the 2-PR or 3-PR chain (or accept `size:exception` for a single PR) before launching `sdd-apply`. If chained, also confirm `chain_strategy` (`stacked-to-main` vs `feature-branch-chain`).

**Additional risks**:
- Real Skyflow `.on()`/`setError()`/`resetError()`/`update()`/`EventName`/`onReady` signatures are **unverified** against the live Skyflow Collect SDK. Unit tests use a fake element and will pass regardless of a real-SDK mismatch. `sdd-apply` MUST validate these against Skyflow's actual type definitions or a manual smoke test before merge — flagged as a CRITICAL verification item, not just a nice-to-have.
- Focus trap inside an open shadow root has known jsdom limitations for cross-origin iframe focus — the RED tests in 3.1 must scope the trap assertion to shadow-root-internal focusables only, not the iframe's internal document.
- The demos folder (`/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3`) is a **separate, uncommitted sibling directory** outside `tonder-js`'s git tree — confirm at apply time whether it is even a git repo, and do not assume it shares this PR's commit/branch.
