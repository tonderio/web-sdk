# Exploration: presentation-modal-events

## Current State

**Embedded 3DS/APM presentation (Goal A):**
- `TonderConfig.presentationMode?: 'redirect' | 'embedded'` and `presentationContainerId?: string` (default `'#tonder-3ds'`) — `src/shared/types/index.ts:54-60`.
- `ThreeDsHostPort` (`src/ports/threeds-host.port.ts`) exposes `redirect(url)`, `mountIframe(url, containerId)`, `unmount()`. Implemented by `Browser3dsHost` (`src/adapters/browser/browser-3ds-host.adapter.ts`) — creates a plain 100%x100% `<iframe>` inside `document.querySelector(containerId)`; throws `THREEDS_REDIRECTION_ERROR` if the merchant's container is missing.
- `Tonder.handleRequiresAction` (`src/tonder.ts:360-410`, card 3DS): embedded mode mounts the iframe into `presentationContainerId`, races `CheckoutMessengerPort.waitForCompletion` (primary, `src/ports/checkout-messenger.port.ts`) against `pollUntilFinal` (fallback), auto-unmounts in a `finally` on every exit path.
- `Tonder.handleApmResult` (`src/tonder.ts:431-453`, APM/SPEI): embedded mode mounts the iframe and LEAVES IT VISIBLE (settles async via webhook), returns the pending tx immediately, no poll, no auto-unmount.
- `Tonder.unmountPresentation()` (`src/tonder.ts:204-206`) — public method, just calls `this.host.unmount()`. This is the ONLY way to close a persistent embedded APM iframe today.
- Interim design already documented in `openspec/specs/presentation-mode/spec.md` — its own "Notes" section explicitly flags this as INTERIM and previews the modal + `onClose` follow-up (R3 + Notes, lines 33-42).
- E2E coverage: `e2e/tests/threeds.spec.ts` exercises both `presentationMode: 'redirect'` and `'embedded'`; `e2e/support/fixtures.ts` wires `presentationContainerId` through `initInstance`.

**Card field input events (Goal B) — VERIFIED ZERO today:**
- `MountCardFieldsRequest = { fields, cardId?, unmountContext? }` (`src/types/card.ts:48-58`) — no event/callback field of any kind.
- `SkyflowElement` interface (`src/adapters/skyflow/skyflow-loader.ts:11-14`) is typed narrowly as `{ mount(selector): void; unmount?(): void }` — `.on(...)`, `.setError(...)`, `.resetError(...)`, `.update(...)` are NOT part of the typed surface at all, even though the adapter (`src/adapters/skyflow/skyflow.adapter.ts`) creates elements via `container.create(...)` which in the real Skyflow SDK returns a richer element.
- `SkyflowAdapter.mount()` (`src/adapters/skyflow/skyflow.adapter.ts:145-184`) creates each element with static config and calls `tryMountElement` — no `.on()` wiring exists anywhere. Confirmed via grep: zero `element.on(` / `Skyflow.EventName` occurrences in `src/`.

**CheckoutMessengerPort** (`src/ports/checkout-messenger.port.ts`): signal-only `waitForCompletion(signal): Promise<void>` — the iframe posts a `MessageEvent` on completion; the port only signals, the facade re-reads status via `getTransaction`. This is the existing pattern a modal's "flow complete" signal would reuse; it does NOT currently carry a manual-close/cancel signal.

## Legacy SDK Research (answers Goal B's field-events payload)

Read in full, both confirm the SAME mechanism:
- `/Volumes/MacDev/Tonder/SDKs/ionic/ionic-lite/src/helpers/skyflow.ts` (`handleSkyflowElementEvents` 335-387; `executeEvent` 409-427)
- `/Volumes/MacDev/Tonder/SDKs/tonder-sdk/src/helpers/skyflow.js` (`handleSkyflowElementEvents` 352-385; `executeEvent` 515-524)

**Exact mechanism (identical intent):**
1. Skyflow's real `CollectElement` supports `element.on(Skyflow.EventName.CHANGE | BLUR | FOCUS, (state) => ...)`. `state` carries: `elementType`, `isEmpty`, `isFocused`, `isValid`, `value`.
2. On `CHANGE`: fire merchant `onChange`, then clear the error label color (hide previously shown error while typing).
3. On `BLUR`: fire `onBlur`, THEN — if `!state.isValid` — the SDK itself computes and injects a CUSTOM error message via `element.setError(msg)` (empty → required message; invalid+known field → field-specific; otherwise generic). Then `element.update({ errorTextStyles })` re-applies error styles. **Ordering matters: `setError()` BEFORE `update()`** or the message is overwritten (explicit code comment in `tonder-sdk/skyflow.js:375`).
4. On `FOCUS`: fire `onFocus`, hide error label, call `element.resetError()`.
5. `executeEvent()` normalizes payload to a fixed shape before calling the merchant callback: `{ elementType, isEmpty, isFocused, isValid, value }` — deliberate narrowing, not raw passthrough.
6. Config shape: `events: { cardNumberEvents, cvvEvents, monthEvents, yearEvents, cardHolderEvents }`, each `{ onChange?, onBlur?, onFocus? }` — **per-field, at mount-config level**, NOT `element.on()` exposed to the merchant. The merchant never touches a live element; the SDK internally wires callbacks AND drives its own error-label UX in parallel.

**Key facts:**
1. Payload consumed: `{ elementType, isEmpty, isFocused, isValid, value }`. No `errorMessage` string forwarded — the SDK keeps computed copy internal (`element.setError`); merchant gets booleans + field/value/focus.
2. Did Tonder supply error copy itself? YES — hardcoded (Spanish-only), applied automatically regardless of whether the merchant supplied a callback.
3. Material constraint: the current codebase has ZERO of this — a REGRESSION vs the legacy SDKs, not a missing nice-to-have.

## Research: mature SDK patterns (2026)

- **Stripe.js**: 3DS opens Stripe's OWN modal by default; container-injection is an opt-out escape hatch. Elements `element.on('change'|'ready'|'focus'|'blur'|'escape')`; `change` payload `{ elementType, complete, empty, error }` (`error.message` surfaced directly). Per-element `.on()`.
- **Adyen Web**: config-level callbacks (`onChange`, `onSubmit`, `onAdditionalDetails`, `onError`, `onCancel`). 3DS2 owned by Drop-in by default; custom challenge only via lower-level Advanced API.
- **Mercado Pago**: Bricks lifecycle callbacks at brick-config level (`onReady`, `onSubmit`, `onError`); StatusScreen Brick is MP-owned challenge UI. Secure Fields v2 keeps merchant `<div>`s for INPUTS (validates keeping merchant containers for inputs).

**Common patterns:** (1) SDK owns challenge/3DS presentation chrome by default; container-injection is the exception. (2) Field events: Stripe per-element `.on()` vs Adyen/MP config-level callbacks — Tonder's own legacy used config-level, matching the existing `MountCardFieldsRequest` shape. (3) Close/cancel is callback-driven (`onCancel`, lifecycle callbacks), never a forced merchant-invoked teardown — supports retiring `unmountPresentation()`.

## Affected Areas
- `src/shared/types/index.ts` — `TonderConfig`: remove `presentationContainerId`; add presentation callbacks (`onClose`, optional `onOpen`/`onComplete`), modal theming.
- `src/ports/threeds-host.port.ts` + `src/adapters/browser/browser-3ds-host.adapter.ts` — `mountIframe(url, containerId)`/`unmount()` → `open(url)`/`close()`; SDK-owned modal DOM, focus trap, stacking, close-affordance wiring.
- `src/tonder.ts` — `handleRequiresAction`, `handleApmResult`, retire `unmountPresentation`, wire `onClose`.
- `src/ports/checkout-messenger.port.ts` — may need a user-initiated close signal distinct from completion (or the modal's X calls a host method directly).
- `src/adapters/skyflow/skyflow.adapter.ts` + `skyflow-loader.ts` — widen `SkyflowElement` to type `.on()`/`.setError()`/`.resetError()`/`.update()`; wire per-field events using the legacy `handleSkyflowElementEvents` pattern.
- `src/types/card.ts` — `MountCardFieldsRequest` gains field-event callbacks.
- `openspec/specs/presentation-mode/spec.md` — SUPERSEDED (R1–R3 + Notes).
- Tests: `src/tonder.pay.test.ts`, `src/tonder.handleRequiresAction.test.ts` — rewrites (host port contract changes); new tests for error-label behavior + modal close.
- `e2e/support/fixtures.ts`, `e2e/tests/threeds.spec.ts` — drop `presentationContainerId`; add modal-presence + close-callback assertions.
- `README.md` — full rewrite of embedded-presentation + card-fields sections.
- Real demos live in the SIBLING folder `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3` (pay.html/apms.html use `presentationContainerId`/`unmountPresentation`) — must be updated (uncommitted, separate folder). No in-repo demo app.

## Open Questions (resolved by LOCKED decisions at propose)
1. Events API shape → LOCKED: config-level callbacks (option b).
2. Field-event payload → legacy shape; exposing `error` is a design decision.
3. Default error copy language/i18n → LOCKED: SDK-owned, English, overridable; mechanism is a design decision.
4. Modal styling extent → design decision.
5. Shadow DOM vs scoped classes → design decision (lean shadow DOM).
6. `onComplete`/`onOpen` inclusion → design decision.
7. Presentation callbacks home → LOCKED: `TonderConfig` level.
8. Does 3DS modal get the X → LOCKED: NO for 3DS (auto-close only); APM gets the X.

## Ready for Proposal
Yes. Codebase surface fully mapped; external research done across 3 mature SDKs; legacy institutional precedent (2 Tonder SDKs) read in full. No blockers.
