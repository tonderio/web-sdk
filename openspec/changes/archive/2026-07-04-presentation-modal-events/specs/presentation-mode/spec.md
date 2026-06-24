# Delta for Presentation Mode

## MODIFIED Requirements

### Requirement: Card 3DS presentation

The system MUST present embedded card 3DS challenges in an SDK-owned overlay, not a merchant-supplied container. `presentationContainerId` MUST NOT be part of the public config.

- `embedded`: the SDK MUST open `next_action.redirect_to_url.url` in its own full-screen overlay appended to `document.body` (no merchant container required), race the messenger completion signal against `pollUntilFinal`, and return the FINAL transaction (paid/declined). The SDK MUST close the overlay on every exit path (completion, timeout, error). A still-`Pending` read MUST NOT be returned as final.
- `redirect`: navigate to the url; return the pending transaction before unload.

(Previously: embedded mode mounted the iframe into merchant-supplied `presentationContainerId`; auto-unmounted from that container.)

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

(Previously: embedded mode mounted the hosted page into merchant-supplied `presentationContainerId`.)

#### Scenario: APM hosted page presents without a merchant container

- GIVEN `presentationMode: 'embedded'` and an APM/SPEI payment producing a hosted-page `next_action`
- WHEN the SDK presents the hosted page
- THEN it opens its own overlay appended to `document.body`
- AND returns the `Pending` transaction immediately without polling

### Requirement: Closing an embedded APM overlay

The APM overlay MUST render a close control ("X"). When the shopper activates it, the SDK MUST close the overlay and MUST invoke the `TonderConfig.onClose` callback, if provided. The public `unmountPresentation()` method MUST NOT exist; there is no replacement method — closing is entirely callback-driven from the shopper's action on the overlay's own close control.

(Previously: `unmountPresentation(): void` was a public method the merchant called to remove the persistent embedded-APM iframe from `presentationContainerId`.)

#### Scenario: Shopper closes the APM overlay via its close control

- GIVEN an APM overlay is open and visible
- WHEN the shopper clicks the overlay's "X" close control
- THEN the SDK closes the overlay
- AND the SDK invokes `TonderConfig.onClose`, if the merchant provided one

#### Scenario: `unmountPresentation` is no longer part of the public API

- GIVEN a merchant integrating the SDK
- WHEN they inspect the SDK's public surface
- THEN `unmountPresentation()` does not exist
- AND no shim or deprecated alias is provided
