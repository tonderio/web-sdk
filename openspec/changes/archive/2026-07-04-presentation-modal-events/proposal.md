# Proposal: SDK-owned presentation modal + config-level field/presentation events

## Intent

The SDK is UNRELEASED — we can set the correct public contract now with no back-compat cost. Two goals:

- **Goal A — own the presentation UX.** Embedded 3DS/APM currently mounts a bare iframe into a merchant-supplied `presentationContainerId` and forces the merchant to call `unmountPresentation()` to close it. This matches no mature SDK (Stripe/Adyen/MP all own the challenge chrome by default). Move presentation into an SDK-owned full-screen modal appended to `document.body`; the merchant supplies containers only for CARD INPUT fields.
- **Goal B — restore a regressed capability.** Both legacy Tonder SDKs (`ionic-lite`, `tonder-sdk`) wired per-field Skyflow events AND rendered their own default error labels on blur. The current SDK has ZERO of this — a regression, not a missing extra. Restore config-level field events and SDK-owned, Skyflow-native error labels.

## Scope

### In Scope
- **Modal (Goal A):** `ThreeDsHostPort`/`Browser3dsHost` contract changes from container-injection to `open(url)` / `close()`; adapter builds and appends its own overlay to `document.body`. Card 3DS auto-closes on completion/timeout (NO X). APM modal HAS an X → fires `onClose`.
- **Presentation events (`TonderConfig` level):** `onClose` (locked); `onOpen`/`onComplete` optional (design decision).
- **Field events (`MountCardFieldsRequest` level):** `onChange` / `onBlur` / `onFocus` / `onReady`, payload extends legacy `{ elementType, isEmpty, isFocused, isValid, value }`.
- **Skyflow-native error labels (Option 1):** on BLUR with invalid field, SDK calls `element.setError(msg)` THEN `element.update({ errorTextStyles })` (ordering is load-bearing) — message shown INSIDE the Skyflow input, no separate patch `<div>`. On CHANGE/FOCUS hide/`resetError`. Defaults SDK-owned, ENGLISH, overridable/localizable.
- **Retire** `presentationContainerId` (from `TonderConfig`) and `unmountPresentation()`.
- **Widen** `SkyflowElement` (`skyflow-loader.ts`) to type `.on()` / `.setError()` / `.resetError()` / `.update()`.
- Update tests, README, and the sibling demos in `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3` (`pay.html`, `apms.html`).

### Out of Scope
- No backend changes; `presentationMode` stays client-only.
- Card 3DS auto-close/poll mechanics (messenger race + `pollUntilFinal`) unchanged except container→modal swap.
- Return contract (bare `RawTransaction`) unchanged.
- Per-element Stripe-style `.on()` and a global emitter — explicitly rejected in favor of config-level callbacks.

## Capabilities

### New Capabilities
- `card-field-events`: config-level field callbacks (`onChange`/`onBlur`/`onFocus`/`onReady`) + SDK-owned Skyflow-native error labels with overridable English defaults.

### Modified Capabilities
- `presentation-mode`: SUPERSEDED — R1/R2 container mount → SDK-owned modal; R3 `unmountPresentation()` → APM modal X + `onClose`. 3DS modal is NOT closable.

## Approach

Keep the `ThreeDsHostPort` abstraction, change its contract to `open(url)`/`close()`; adapter owns modal DOM (overlay + frame + APM-only close X + focus trap). Reuse the existing messenger completion race for 3DS auto-close. For fields, port the legacy `handleSkyflowElementEvents`/`executeEvent` mechanism into `SkyflowAdapter`, TypeScript-strict: wire `element.on()` internally, normalize the merchant payload, and drive `setError`/`update`/`resetError` as SDK-owned side effects independent of whether the merchant passed a callback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/types/index.ts` | Modified | Remove `presentationContainerId`; add `onClose` (+ optional `onOpen`/`onComplete`), modal theming |
| `src/ports/threeds-host.port.ts` | Modified | `mountIframe(url, containerId)`/`unmount()` → `open(url)`/`close()` |
| `src/adapters/browser/browser-3ds-host.adapter.ts` | Modified | Build/append own modal to `body`; focus trap; APM close X |
| `src/tonder.ts` | Modified | `handleRequiresAction`, `handleApmResult`; retire `unmountPresentation`; wire `onClose` |
| `src/ports/checkout-messenger.port.ts` | Modified | Possible user-initiated close signal (or modal X calls host directly) |
| `src/adapters/skyflow/skyflow.adapter.ts` | Modified | Wire per-field `.on()`; drive `setError`/`update`/`resetError` |
| `src/adapters/skyflow/skyflow-loader.ts` | Modified | Widen `SkyflowElement` typed surface |
| `src/types/card.ts` | Modified | `MountCardFieldsRequest` gains field-event callbacks |
| `openspec/specs/presentation-mode/spec.md` | Removed/Replaced | Superseded by this change |
| `src/tonder.pay.test.ts`, `src/tonder.handleRequiresAction.test.ts` | Modified | Rewrite (port contract change) + new error-label/close tests |
| `e2e/support/fixtures.ts`, `e2e/tests/threeds.spec.ts` | Modified | Drop `presentationContainerId`; assert modal presence + close callback |
| `README.md` | Modified | Rewrite embedded-presentation + card-fields sections |
| `demos/web-sdk-v3/pay.html`, `apms.html` (sibling repo) | Modified | Drop `presentationContainerId`/`unmountPresentation`; use modal + `onClose` |

## Design Decisions Deferred to sdd-design

- **(a) CSS isolation:** shadow DOM vs scoped class names for the modal (recommend shadow DOM for isolation + a themeable surface) + focus-trap/`aria-modal`/`Escape` approach.
- **(b) Field-event payload:** exact shape and whether to expose `error: string | null` read-only (legacy did not; lean toward exposing it).
- **(c) `onOpen`/`onComplete`** inclusion now vs `onClose`-only first slice.
- **(d) Default-error-copy localization:** override map on `CardCustomization` vs an i18n hook.
- **(e) 3DS callback:** does the non-closable 3DS modal fire any callback on timeout/error even though it has no X.

## Acceptance Criteria (pins locked decisions)

- [ ] `presentationContainerId` removed from `TonderConfig`; no merchant container required for presentation. Merchant `<div>`s remain ONLY for card-input fields.
- [ ] `ThreeDsHostPort` exposes `open(url)`/`close()`; adapter appends its own overlay to `document.body`.
- [ ] Card 3DS modal has NO close X; auto-closes on completion/timeout only.
- [ ] APM modal has an X; clicking it closes the modal and fires `TonderConfig.onClose`.
- [ ] `unmountPresentation()` removed entirely; no shim.
- [ ] `MountCardFieldsRequest` accepts `onChange`/`onBlur`/`onFocus`/`onReady`; payload extends `{ elementType, isEmpty, isFocused, isValid, value }`.
- [ ] On blur with an invalid field, SDK calls `element.setError(msg)` BEFORE `element.update({ errorTextStyles })`; message rendered inside the Skyflow input; no separate patch `<div>`.
- [ ] Default error copy is SDK-owned, English, and overridable by the merchant.
- [ ] `SkyflowElement` typed with `.on()`/`.setError()`/`.resetError()`/`.update()`.
- [ ] Sibling demos updated; README updated; `presentation-mode` spec superseded.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SDK modal CSS clashes with merchant page | Med | Shadow DOM isolation (design decision a) |
| Skyflow real `.on()`/`setError` signatures differ from legacy assumptions | Med | Validate against live Skyflow SDK during apply; widen types to observed surface |
| `setError`/`update` ordering regression | Med | Encode ordering in acceptance + a dedicated vitest |
| Accessibility gaps (focus trap, `aria-modal`) now SDK-owned | Med | Explicit design-decision (a); a11y assertions in tests |
| Sibling-demo repo drift (uncommitted, separate folder) | Low | Update in the same change; note it is a separate uncommitted folder |

## Rollback Plan

Unreleased SDK — this IS the new contract. Rollback = revert the change branch; the superseded `presentation-mode` spec and `presentationContainerId`/`unmountPresentation()` return via git history. No shipped consumers to migrate.

## Dependencies

- Real Skyflow SDK element API (`.on`/`.setError`/`.resetError`/`.update`) available at runtime (already loaded via `skyflow-loader.ts`).

## Success Criteria

- [ ] All acceptance criteria met and covered by vitest (strict TDD at apply).
- [ ] E2E `threeds.spec.ts` passes against the modal (no `presentationContainerId`).
- [ ] Merchant integrates embedded presentation with zero container setup; APM close is callback-driven.
