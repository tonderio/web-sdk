# Spec: Presentation Mode (SDK-driven hosted-flow presentation)

## Scope
How `@tonder.io/web-sdk` presents a hosted `next_action` flow (card 3DS or
APM/SPEI hosted page) returned by the backend. Client-side only — no value is
sent to the backend.

## Config
- `presentationMode: 'embedded' | 'redirect'` (default `'redirect'`). Renamed
  from `threeDsMode`.
- Client-only: `presentationMode` is NEVER included in the `POST /process`
  request body.
- Presentation callbacks: `events.presentation.onClose?: () => void` (required for APM), `events.presentation.onOpen?: () => void`, `events.presentation.onComplete?: () => void` (optional). All are instance-scoped: only one presentation modal at a time.
- Error-label overrides: `errorMessages?: Partial<Record<CardField | 'required' | 'invalid', string>>` for SDK-owned default error copy.

## Requirements

### Requirement: Card 3DS presentation

The system MUST present embedded card 3DS challenges in an SDK-owned overlay, not a merchant-supplied container. `presentationContainerId` MUST NOT be part of the public config.

- `embedded`: the SDK MUST open `next_action.redirect_to_url.url` in its own full-screen overlay appended to `document.body` (no merchant container required), race the messenger completion signal against `pollUntilFinal`, and return the FINAL transaction (paid/declined). The SDK MUST close the overlay on every exit path (completion, timeout, error). A still-`Pending` read MUST NOT be returned as final.
- `redirect`: navigate to the url; return the pending transaction before unload.

#### Scenario: Card 3DS challenge presents without a merchant container

- GIVEN `presentationMode: 'embedded'` and no `presentationContainerId` in config
- WHEN a card payment requires a 3DS challenge
- THEN the SDK opens its own overlay appended to `document.body`
- AND no merchant-supplied element is required for the challenge to render

#### Scenario: Card 3DS challenge auto-closes on completion

- GIVEN the card 3DS overlay is open
- WHEN the challenge completes (paid or declined) via the messenger or polling fallback
- THEN the SDK closes the overlay automatically
- AND returns the final transaction

#### Scenario: Card 3DS challenge auto-closes on timeout or error

- GIVEN the card 3DS overlay is open
- WHEN the challenge times out or errors before reaching a final state
- THEN the SDK closes the overlay automatically on that exit path

### Requirement: Card 3DS challenge is not closable by the shopper

The card 3DS overlay MUST NOT render a close control. The shopper MUST NOT be able to dismiss it mid-challenge; it closes ONLY via the SDK's own completion/timeout logic.

#### Scenario: No close affordance is rendered during a card 3DS challenge

- GIVEN the card 3DS overlay is open
- WHEN the shopper inspects the overlay
- THEN no "X" or other close control is present
- AND the only way the overlay closes is completion, timeout, or error handled by the SDK

### Requirement: APM/SPEI presentation (async settlement)

APMs settle via webhook — the SDK MUST NOT poll them.

- `embedded`: the SDK MUST open the hosted page in its own full-screen overlay appended to `document.body` (no merchant container required), leave it VISIBLE, and return the `Pending` transaction IMMEDIATELY (no poll). The overlay persists so the shopper sees the CLABE/voucher inline.
- `redirect`: navigate to the url; return pending.
- instructions-only (no url): return the transaction unchanged.

#### Scenario: APM hosted page presents without a merchant container

- GIVEN `presentationMode: 'embedded'` and an APM/SPEI payment producing a hosted-page `next_action`
- WHEN the SDK presents the hosted page
- THEN it opens its own overlay appended to `document.body`
- AND returns the `Pending` transaction immediately without polling

### Requirement: Closing an embedded APM overlay

The APM overlay MUST render a close control ("X"). When the shopper activates it, the SDK MUST close the overlay and MUST invoke the `config.events.presentation.onClose` callback, if provided. The public `unmountPresentation()` method MUST NOT exist; there is no replacement method — closing is entirely callback-driven from the shopper's action on the overlay's own close control.

#### Scenario: Shopper closes the APM overlay via its close control

- GIVEN an APM overlay is open and visible
- WHEN the shopper clicks the overlay's "X" close control
- THEN the SDK closes the overlay
- AND the SDK invokes `config.events.presentation.onClose`, if the merchant provided one

#### Scenario: `unmountPresentation` is no longer part of the public API

- GIVEN a merchant integrating the SDK
- WHEN they inspect the SDK's public surface
- THEN `unmountPresentation()` does not exist
- AND no shim or deprecated alias is provided

### Requirement: Presentation callbacks live under events.presentation

The system MUST expose presentation lifecycle callbacks exclusively at
`config.events.presentation.{onOpen?, onClose?, onComplete?}`. Flat
`TonderConfig.onOpen` / `onClose` / `onComplete` fields MUST NOT exist.

#### Scenario: onOpen fires from the namespaced config location

- GIVEN `config.events.presentation.onOpen` is set
- WHEN a presentation overlay (card 3DS or APM) opens
- THEN the SDK invokes `config.events.presentation.onOpen`

#### Scenario: onComplete fires from the namespaced config location

- GIVEN `config.events.presentation.onComplete` is set
- WHEN a presentation flow reaches a final state
- THEN the SDK invokes `config.events.presentation.onComplete`

#### Scenario: Flat presentation callback keys are absent from config

- GIVEN a merchant inspects the `TonderConfig` type
- WHEN they look for top-level `onOpen`, `onClose`, or `onComplete` fields
- THEN none of these flat fields exist

## Notes
Further refined by change `public-api-consistency`. All presentation happens via SDK-owned modals with callback-driven closing for APM overlays and auto-closing for 3DS overlays. As of `public-api-consistency`, all presentation callbacks live under `config.events.presentation.*` rather than flat `TonderConfig` fields.
