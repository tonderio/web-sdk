# Design: SDK-owned presentation modal + config-level field/presentation events

Change: `presentation-modal-events` · Package: `@tonder.io/web-sdk` (v3, unreleased)
Store: hybrid. Depends on: `sdd/presentation-modal-events/proposal`.

## 1. Architecture approach

Two independent capability slices land in the same change, both governed by the
same principle already present in the codebase: **the SDK owns behavior, the
merchant owns nothing but empty `<div>`s for card INPUTS**.

- **Presentation (Goal A)** stays behind the existing driven-port abstraction
  `ThreeDsHostPort`. We keep hexagonal boundaries: the facade (`Tonder`) and core
  remain DOM-free; ALL `window`/`document`/shadow-DOM work lives in the browser
  adapter. We change only the port CONTRACT (`open(url)`/`close()`), not its
  place in the architecture. The modal is SDK-owned chrome appended to
  `document.body` — no merchant container, `presentationContainerId` deleted.
- **Field events + error labels (Goal B)** are restored inside the existing
  `SkyflowAdapter`, the ONLY place that touches Skyflow elements. We port the
  legacy `handleSkyflowElementEvents`/`executeEvent` mechanism (read in full from
  both legacy SDKs) into the adapter, typed strictly, with English defaults. The
  merchant supplies per-field callbacks declaratively in `MountCardFieldsRequest`
  (matching the existing declarative request-object pattern); the SDK drives
  `setError`/`update`/`resetError` as its OWN side effects, in parallel with the
  merchant callback.

Layering is unchanged. Boundaries touched:

```
Tonder (facade, DOM-free)
  ├── ThreeDsHostPort ── Browser3dsHost (shadow-DOM modal, APM X, focus trap)   [Goal A]
  ├── CheckoutMessengerPort ── unchanged (3DS auto-close completion signal)
  └── TokenizerPort ── SkyflowAdapter (field .on() wiring + error labels)        [Goal B]
                          └── SkyflowElement (widened surface)
```

No backend changes. `presentationMode` stays client-only. Return contract (bare
`RawTransaction`) unchanged.

---

## 2. Public types (the contract)

### 2.1 `TonderConfig` (`src/shared/types/index.ts`)

REMOVE `presentationContainerId`. ADD presentation callbacks + error-copy
override map. Keep `presentationMode`.

```ts
export interface TonderConfig {
  apiKey: string;
  mode: TonderMode;
  returnUrl: string;
  customization?: CardCustomization;
  secureToken?: string;
  getSignature?: (ctx: SignatureContext) => Promise<string>;
  customer?: CustomerInput;

  /** How a hosted next_action flow is presented. Default 'redirect'.
   *  'embedded' now renders an SDK-owned modal appended to document.body
   *  (no merchant container). */
  presentationMode?: 'redirect' | 'embedded';

  // ── Presentation events (instance-scoped: only one presentation at a time) ──

  /** Fired when the merchant-closable APM/SPEI modal is dismissed — via the
   *  modal "X" or the Escape key. NOT fired for the 3DS modal (not closable). */
  onClose?: () => void;

  /** OPTIONAL. Fired when any presentation modal is appended to the DOM. */
  onOpen?: () => void;

  /** OPTIONAL. Fired when the non-closable 3DS modal auto-closes because the
   *  flow COMPLETED (a FINAL status was reached). NOT fired on timeout/error —
   *  those surface through the existing AppError path. */
  onComplete?: () => void;

  /** OPTIONAL. Merchant overrides for the SDK-owned default field error copy.
   *  Any key omitted falls back to the SDK's English default. */
  errorMessages?: FieldErrorMessages;
}
```

`FieldErrorMessages` lives in `src/types/card.ts` (co-located with field types):

```ts
/** Override map for the SDK-owned default field error copy (English defaults).
 *  - 'required' / 'invalid' are the generic fallbacks.
 *  - a per-CardField key overrides the message for that specific field. */
export type FieldErrorMessages = Partial<
  Record<CardField | 'required' | 'invalid', string>
>;
```

Decision (d): a flat override map, NOT a full i18n hook. Rationale below (§7d).

### 2.2 `MountCardFieldsRequest` + field-event payload (`src/types/card.ts`)

```ts
/** camelCase element-type discriminator carried in every field-event payload.
 *  1:1 with CardField — a stable public enum independent of Skyflow's own
 *  elementType strings. */
export type FieldName = CardField;

/** Read-only state delivered to every field-event callback. Extends the legacy
 *  { elementType, isEmpty, isFocused, isValid, value } shape with `error`. */
export interface CardFieldState {
  /** The field this event belongs to. */
  readonly elementType: FieldName;
  readonly isEmpty: boolean;
  readonly isFocused: boolean;
  readonly isValid: boolean;
  /** Skyflow's masked/format value string (never the raw PAN). */
  readonly value: string;
  /** The message the SDK CURRENTLY rendered inside the field, or null when no
   *  error is shown. Read-only mirror of the SDK's setError/resetError state. */
  readonly error: string | null;
}

/** Per-field callback bag. Every callback is optional. */
export interface CardFieldEvents {
  onChange?: (state: CardFieldState) => void;
  onBlur?: (state: CardFieldState) => void;
  onFocus?: (state: CardFieldState) => void;
  /** Fired once, when the element finishes mounting into its container. */
  onReady?: (state: CardFieldState) => void;
}

export interface MountCardFieldsRequest {
  fields: MountCardFieldEntry[];
  cardId?: string;
  unmountContext?: 'all' | 'none' | 'current' | 'create' | string;

  /** OPTIONAL per-field callbacks, keyed by CardField. The SDK wires these to
   *  the underlying element AND, in parallel, drives its own error-label UX
   *  (setError/update/resetError) regardless of whether callbacks are present. */
  events?: Partial<Record<FieldName, CardFieldEvents>>;
}
```

Decision (b): payload is the legacy shape PLUS `error: string | null`,
`readonly`, reflecting exactly what the SDK rendered (not a merchant-owned
string). Rationale §7b.

Naming note: `events` is keyed by `FieldName` (per-field object of callbacks),
matching the legacy `events: { cardNumberEvents, cvvEvents, ... }` intent but
using the current camelCase `CardField` keys directly — no `*Events` suffix,
cleaner for the new SDK.

---

## 3. Modal component design (decision a)

### 3.1 Structure

`Browser3dsHost.open(url)` builds and appends to `document.body`:

```
<div data-tonder-modal-root>          ← host node appended to body
  #shadow-root (mode: 'open')          ← CSS isolation boundary
    <div class="overlay">              ← backdrop, role="presentation"
      <div class="dialog"              ← role="dialog" aria-modal="true"
           aria-label="Payment authentication">
        <button class="close" ...>×</button>   ← APM ONLY (omitted for 3DS)
        <iframe class="frame" src=url> ← the hosted 3DS/APM page
      </div>
    </div>
</div>
```

### 3.2 Isolation — shadow DOM (recommended, adopted)

Attach an **open** shadow root to the host node and inject a `<style>` inside it.
Merchant page CSS cannot reach into the shadow tree and the modal's styles cannot
leak out. This eliminates the highest-rated risk (modal CSS clash) structurally
rather than by class-name convention.

- z-index: the HOST node gets `z-index: 2147483647` and `position: fixed; inset:
  0` inline (outside the shadow boundary, since z-index must apply to the host in
  the merchant's stacking context). Everything else is styled inside the shadow.
- backdrop: `.overlay` is `position: fixed; inset: 0; background: rgba(0,0,0,.5)`
  with `display: flex; align-items: center; justify-content: center`.
- frame: `.dialog` is a bounded box (e.g. `width: min(420px, 100%); height:
  min(640px, 100%)`), `.frame` fills it (`width/height: 100%; border: 0`).

### 3.3 Closability + a11y

`open(url, options)` — the adapter needs to know whether to render the "X" and
wire Escape. The port contract carries an `options` object (§4).

- **3DS modal** (`closable: false`): NO close button rendered. Escape key does
  NOTHING. Only `close()` (called by the facade on completion/timeout) removes
  it.
- **APM modal** (`closable: true`): renders the "X" button; clicking it OR
  pressing Escape invokes the adapter's close handler, which (1) removes the DOM
  and (2) calls the `onClose` callback wired by the facade.
- Focus trap: on open, focus moves into the dialog; a keydown handler on the
  shadow root keeps Tab/Shift+Tab cycling within focusable nodes (the close
  button + the iframe). `aria-modal="true"` + `aria-label` on the dialog.
- The adapter fires the injected `onOpen` hook after append.

The adapter stays behavior-owning but callback-agnostic in wiring: the facade
passes plain functions (`onUserClose`, `onOpen`) into `open()`; the adapter never
imports `TonderConfig`.

---

## 4. `ThreeDsHostPort` + `Browser3dsHost` (decision a)

### 4.1 Port (`src/ports/threeds-host.port.ts`)

```ts
export interface ThreeDsHostOptions {
  /** Whether the modal renders a close affordance (X) and honors Escape.
   *  false → 3DS (auto-managed); true → APM/SPEI (merchant-dismissable). */
  closable: boolean;
  /** Invoked after the modal is appended to the DOM. */
  onOpen?: () => void;
  /** Invoked when the USER dismisses a closable modal (X or Escape).
   *  Never called for closable=false or for programmatic close(). */
  onUserClose?: () => void;
}

export interface ThreeDsHostPort {
  /** Navigate the top window to the hosted page (redirect mode). */
  redirect(url: string): void;
  /** Open the SDK-owned modal (appended to document.body) with the hosted page. */
  open(url: string, options: ThreeDsHostOptions): void;
  /** Programmatically remove the modal. No-op when nothing is open. Does NOT
   *  fire onUserClose. */
  close(): void;
}
```

`mountIframe(url, containerId)` and `unmount()` are REMOVED (renamed to
`open`/`close` with new semantics — no container param, SDK-owned DOM).

### 4.2 Adapter (`src/adapters/browser/browser-3ds-host.adapter.ts`)

- `redirect` unchanged.
- `open(url, { closable, onOpen, onUserClose })`:
  - build host node + shadow root + overlay + dialog + iframe (§3);
  - if `closable`, append the "X" button and register `click`→`handleUserClose`
    and a shadow-root `keydown` Escape→`handleUserClose`;
  - install focus trap; append host node to `document.body`; call `onOpen?.()`.
  - `handleUserClose` = `this.close()` (removes DOM) then `onUserClose?.()`.
    Guard against double-invoke.
- `close()`: remove the host node, tear down listeners, null the refs. Idempotent.
- The old `THREEDS_REDIRECTION_ERROR` "container not found" throw DISAPPEARS —
  there is no container to miss anymore.

---

## 5. Skyflow error-label wiring (decision c/d + LOCKED item 3)

### 5.1 Widen `SkyflowElement` (`src/adapters/skyflow/skyflow-loader.ts`)

```ts
export interface SkyflowElementState {
  elementType: string;
  isEmpty: boolean;
  isFocused: boolean;
  isValid: boolean;
  value: string;
}

export interface SkyflowElement {
  mount(domSelector: string): void;
  unmount?(): void;
  on(eventName: string, handler: (state: SkyflowElementState) => void): void;
  setError(message: string): void;
  resetError(): void;
  update(options: Record<string, unknown>): void;
}
```

Add `EventName: { CHANGE: string; BLUR: string; FOCUS: string; READY: string }`
to `SkyflowStatic` so the adapter references `skyflow.EventName.*` instead of
string literals (the loader fake supplies these in tests).

### 5.2 Wiring in `SkyflowAdapter.mount()` (`skyflow.adapter.ts`)

After `container.create(...)` and BEFORE (or right after) `tryMountElement`, for
each element wire the three Skyflow events. New private method
`wireFieldEvents(element, field, merchantEvents)`:

```
element.on(EventName.CHANGE, (state) => {
  this.emit('onChange', field, state, merchantEvents);   // merchant passthrough
  this.hideError(element, field);                         // color: transparent
});

element.on(EventName.BLUR, (state) => {
  this.emit('onBlur', field, state, merchantEvents);
  if (!state.isValid) {
    const msg = this.resolveErrorMessage(field, state);   // English default / override
    element.setError(msg);        // (1) setError FIRST  — LOAD-BEARING ORDER
    this.currentError.set(field, msg);
  }
  element.update({ errorTextStyles: this.errorStylesFor(field) }); // (2) THEN update
});

element.on(EventName.FOCUS, (state) => {
  this.emit('onFocus', field, state, merchantEvents);
  element.update({ errorTextStyles: hiddenColor });       // hide label
  element.resetError();
  this.currentError.delete(field);
});
```

- **Ordering is load-bearing and encoded in a RED test**: `setError(msg)` MUST be
  called before `element.update(...)` on blur+invalid, or `update` overwrites the
  custom message (explicit legacy comment, `tonder-sdk/skyflow.js:375`).
- `resetError()` on FOCUS (and error cleared on valid CHANGE) restores the field.
- `onReady`: fire from an `EventName.READY` handler if the real Skyflow exposes
  it; otherwise the adapter fires `onReady` synchronously right after
  `tryMountElement` resolves. Emit path builds the same `CardFieldState`.

### 5.3 Payload normalization (`emit`)

`emit(eventName, field, state, merchantEvents)` builds the public
`CardFieldState` — narrowing Skyflow's `state` to `{ elementType: field, isEmpty,
isFocused, isValid, value }` and attaching `error: this.currentError.get(field)
?? null`. Then calls `merchantEvents?.[field]?.[eventName]?.(payload)` if present.
This is the deliberate normalization layer (never a raw Skyflow passthrough),
matching legacy `executeEvent`.

### 5.4 Default error copy + override (decision d)

`resolveErrorMessage(field, state)`:

- `state.isEmpty` → `errorMessages.required ?? 'This field is required.'`
- not empty, invalid, per-field override present →
  `errorMessages[field]` (e.g. `errorMessages.cardNumber`)
- otherwise → `errorMessages.invalid ?? 'This field is invalid.'`

English defaults (SDK-owned): `required` = "This field is required.",
`invalid` = "This field is invalid.". The override map arrives via
`SkyflowAdapterDeps` (new `errorMessages?: FieldErrorMessages`), wired from
`config.errorMessages` in the `Tonder` constructor (same place `customization` is
already threaded).

---

## 6. Facade changes (`src/tonder.ts`)

### 6.1 `handleRequiresAction` (3DS — non-closable, auto-close, fires `onComplete`)

- Replace `this.host.mountIframe(redirectUrl, containerId)` with
  `this.host.open(redirectUrl, { closable: false, onOpen: config.onOpen })`.
- Delete the `containerId`/`DEFAULT_PRESENTATION_CONTAINER_ID` lookup.
- Keep the messenger-vs-poll race unchanged.
- In the `finally`, `this.host.close()` (was `unmount()`). On the SUCCESS path
  (a FINAL status resolved) call `config.onComplete?.()` AFTER close. On
  timeout/abort/error, do NOT call `onComplete` — the existing `AppError`
  propagates (decision e).

### 6.2 `handleApmResult` (APM — closable, X fires `onClose`)

- Replace `mountIframe(...)` with
  `this.host.open(redirectUrl, { closable: true, onOpen: config.onOpen,
  onUserClose: config.onClose })`.
- Leave the modal visible; return the pending tx immediately (unchanged async
  contract). The modal now closes via the user clicking "X"/Escape → adapter
  calls `onClose`.

### 6.3 Delete `unmountPresentation()`

- Remove the public method (`src/tonder.ts:197-206`) entirely — no shim.
- Remove `DEFAULT_PRESENTATION_MODE` stays; `DEFAULT_PRESENTATION_CONTAINER_ID`
  is deleted.

### 6.4 Wire error-messages into the tokenizer

In the constructor, pass `errorMessages: config.errorMessages` into the
`SkyflowAdapter` deps (next to `customization`).

---

## 7. ADR-style decisions

### (a) Modal DOM/CSS isolation — SHADOW DOM. ACCEPTED.
- **Decision**: open shadow root on a body-appended host node; z-index +
  `position: fixed` on the host, all visual CSS inside the shadow. Focus trap,
  `aria-modal="true"`, labelled dialog. Escape closes ONLY closable (APM) modals.
- **Why**: structurally kills the top risk (merchant CSS breaking the modal)
  instead of relying on class-name hygiene; matches Stripe/Adyen/MP "SDK owns the
  chrome" default. Open (not closed) shadow so tests can traverse
  `hostNode.shadowRoot.querySelector(...)`.
- **Rejected**: scoped BEM/prefixed classes (still leakable both ways; weaker
  guarantee); styling the merchant container (does not fulfill Goal A at all).

### (b) Field-event payload — legacy shape + `error: string | null`. ACCEPTED.
- **Decision**: `{ elementType, isEmpty, isFocused, isValid, value, error }`, all
  `readonly`; `error` mirrors the message the SDK rendered (null when none).
- **Why**: legacy shape is the proven, migration-friendly contract; `error` is
  near-zero cost (the SDK already computes it for `setError`) and lets merchants
  render supplementary UI without reimplementing message logic — closes the gap
  Stripe fills with `error.message`, WITHOUT handing error ownership to the
  merchant.
- **Rejected**: legacy shape only (loses a cheap, useful signal); exposing
  Skyflow's raw `state` (leaks vendor internals, unstable).

### (c) Presentation callbacks — `onClose` + optional `onOpen`/`onComplete`. ACCEPTED.
- **Decision**: ship all three at `TonderConfig` level. `onClose` required for
  APM; `onOpen` on any modal append; `onComplete` when the 3DS modal auto-closes
  on completion.
- **Why**: instance-scoped (only one presentation active at a time); `onOpen`/
  `onComplete` are cheap symmetry that give merchants lifecycle hooks (analytics,
  spinners) without a second mechanism. Config-level matches the existing two-tier
  split (instance config vs per-mount request).
- **Rejected**: `onClose`-only first slice (the other two are trivial and useful
  now); a global emitter / `.on()` (no researched competitor uses it as primary;
  rejected in proposal).

### (d) Default-error-copy localization — flat override MAP. ACCEPTED.
- **Decision**: `errorMessages?: Partial<Record<CardField|'required'|'invalid',
  string>>` on `TonderConfig`. English defaults, per-key overridable.
- **Why**: covers the real need (merchant relabeling / their own language)
  with the smallest possible surface; no runtime i18n dependency; keys are
  discoverable and typed.
- **Rejected**: full i18n hook / locale bundles (over-engineered for an unreleased
  SDK; merchants who need locales can pass their own strings through the map).

### (e) Non-closable 3DS modal callbacks. ACCEPTED.
- **Decision**: the 3DS modal fires `onComplete` when it auto-closes on a FINAL
  status. On timeout/error it does NOT fire `onClose` or `onComplete`; the
  existing `AppError` (`POLL_TIMEOUT_ERROR`/`REQUEST_ABORTED`/etc.) path applies
  and the modal is still torn down in the `finally`.
- **Why**: `onClose` semantically means "the user dismissed a dismissable modal";
  3DS is never user-dismissable, so reusing it would be misleading. Errors already
  have a first-class channel (thrown `AppError`) — no need to duplicate.

---

## 8. Data flow

**3DS embedded (card):** `pay()` → `handleRequiresAction` →
`host.open(url,{closable:false,onOpen})` → messenger/poll race → FINAL →
`finally { host.close() }` → `onComplete()` → return final tx.

**APM embedded:** `pay()` → `handleApmResult` →
`host.open(url,{closable:true,onOpen,onUserClose:onClose})` → return pending tx →
(later) user clicks X/Escape → adapter `close()` + `onClose()`.

**Field event:** user types/blurs/focuses → Skyflow fires element `on(...)` →
adapter `emit(...)` builds `CardFieldState` → merchant callback + SDK
`setError`/`update`/`resetError` side effects.

---

## 9. Migration + test surface (Strict TDD — RED tests explicit)

### Types / source touched
- `src/shared/types/index.ts` — remove `presentationContainerId`; add
  `onClose`/`onOpen?`/`onComplete?`/`errorMessages?`; edit `presentationMode` doc.
- `src/types/card.ts` — add `FieldName`, `CardFieldState`, `CardFieldEvents`,
  `FieldErrorMessages`, `events?` on `MountCardFieldsRequest`.
- `src/ports/threeds-host.port.ts` — `open(url,options)`/`close()` +
  `ThreeDsHostOptions`.
- `src/adapters/browser/browser-3ds-host.adapter.ts` — shadow-DOM modal.
- `src/adapters/skyflow/skyflow-loader.ts` — widen `SkyflowElement`, add
  `EventName`.
- `src/adapters/skyflow/skyflow.adapter.ts` — `wireFieldEvents`, `emit`,
  `resolveErrorMessage`; `SkyflowAdapterDeps.errorMessages`.
- `src/tonder.ts` — `handleRequiresAction`/`handleApmResult` use `open`/`close`,
  fire `onComplete`/`onClose`; delete `unmountPresentation()` + the container
  constant; thread `errorMessages` into the adapter.

### RED tests (write failing first)
- **browser-3ds-host.adapter.test.ts** (rewrite):
  - `open()` appends a host node to `document.body` with an OPEN shadow root
    containing an iframe whose `src` is the url.
  - `closable:false` renders NO close button; Escape does NOT remove it.
  - `closable:true` renders the "X"; clicking it removes the modal AND calls
    `onUserClose`; Escape also removes + calls `onUserClose`.
  - `close()` removes the host node; is idempotent/no-op when nothing open;
    programmatic `close()` does NOT call `onUserClose`.
  - `onOpen` fires after append.
  - dialog has `role="dialog"`, `aria-modal="true"`, an `aria-label`.
- **skyflow.adapter.test.ts** (extend, fake element records call order):
  - on BLUR+invalid: `setError(msg)` is called BEFORE `element.update(...)`
    (assert recorded call order) — THE ordering test.
  - on BLUR+empty: message = `required` default ("This field is required.");
    override via `errorMessages.required` wins.
  - on BLUR+invalid non-empty with `errorMessages.cardNumber` set: that message
    is used for the cardNumber field.
  - on FOCUS: `resetError()` called; on valid CHANGE: error hidden.
  - merchant `events[field].onChange/onBlur/onFocus` receive a `CardFieldState`
    with `{ elementType: field, isEmpty, isFocused, isValid, value, error }` and
    `error` reflects the rendered message (null after reset).
  - `onReady` fires once per field after mount.
- **tonder.handleRequiresAction.test.ts** (rewrite): fake host asserts
  `open(url,{closable:false})` was called (no container arg); `close()` in
  finally on every exit; `onComplete` fired on FINAL success, NOT on
  timeout/abort.
- **tonder.pay.test.ts** (rewrite APM section): `handleApmResult` calls
  `open(url,{closable:true, onUserClose})`; triggering the fake host's user-close
  fires `config.onClose`.
- **Delete** all `unmountPresentation`/`mountIframe`/`presentationContainerId`
  references from tests and the fake host used in `_createTonderWithDeps`.

### e2e + docs + demos
- `e2e/support/fixtures.ts` — drop `presentationContainerId` wiring.
- `e2e/tests/threeds.spec.ts` — assert SDK-owned modal present in DOM (shadow
  host), no `#tonder-3ds` container; embedded flow still settles.
- `README.md` — rewrite Embedded-presentation + Card-fields sections
  (remove container/`unmountPresentation`; document callbacks + `errorMessages`).
- Sibling demos `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/pay.html` +
  `apms.html` — remove the `#tonder-3ds` container and `unmountPresentation()`
  call; wire `onClose` (apms), optional `onOpen`/`onComplete`, and per-field
  `events`.
- `openspec/specs/presentation-mode/spec.md` — mark superseded (R1/R2 container
  mount → SDK modal; R3 `unmountPresentation` → APM X + `onClose`).

---

## 10. Risks / open validation
- **Real Skyflow `.on()`/`setError`/`update`/`EventName` signatures** may differ
  from the legacy assumption — validate against the live SDK at apply; unit tests
  use a fake element, so a signature mismatch only surfaces in e2e.
- **`onReady`** may not exist as a Skyflow `EventName`; fallback is firing it
  post-mount. Confirm at apply which path the real SDK supports.
- **Focus trap + iframe**: focus inside a cross-origin iframe is not fully
  controllable; the trap covers the shadow-root focusables (X button) — acceptable
  for v1.
- **Shadow-DOM in jsdom**: `attachShadow` is supported; open mode lets tests
  traverse. Confirm the vitest/jsdom version supports it (it does in current dep).
- **Sibling demo drift**: demos live in a separate uncommitted folder — update in
  the same change; call out in the PR that they are outside the SDK repo.
