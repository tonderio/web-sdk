# Component Lifecycle Documentation Specification

## Purpose

Declares what the SDK's documentation must tell an integrator about mounting
and unmounting a component, and what the internal onboarding guide must tell
Tonder staff about Apple Pay. Every requirement is verified by reading a
specific document location, not by inspecting a diff or commit.

## Requirements

### Requirement: A README sample a reader would copy as a starting point shows its own teardown

A README code sample that a reader is expected to copy as the STARTING POINT of
an integration — the quick start, and the end-to-end sample for each mountable
component — MUST show `.unmount()` on the same handle it mounted, inside the
sample itself, not only in prose the reader may skip.

This deliberately does NOT extend to every sample that calls `.mount()`.
Flow-specific and single-line excerpts exist to illustrate ONE step and repeat
the lifecycle only as noise; they rely on the canonical lifecycle section
instead. The test that separates the two: would a reader plausibly paste this
block and build on it, or are they reading it to understand a single call?

#### Scenario: The Apple Pay runnable sample includes unmount()

- GIVEN a reader copies the README's Apple Pay runnable sample
- WHEN they paste it as-is
- THEN the pasted code calls `.unmount()` on the button handle

#### Scenario: The Quick Start card_fields sample includes unmount()

- GIVEN a reader copies the README's Quick Start `card_fields` sample
- WHEN they paste it as-is
- THEN the pasted code calls `.unmount()` on the card-fields handle

### Requirement: The lifecycle section states when unmount() is required and the specific cost of skipping it

The README MUST state the `unmount()` rule as conditional on whether the page
navigates to a new route without a full page load, never on which framework
renders it, and never as universally mandatory. For Apple Pay it MUST state
the cost of skipping `unmount()` concretely — an orphaned session can still
be authorized and reach `processPayment()` with stale data — never softened
to "may leak".

#### Scenario: A page that fully reloads on navigation needs no defensive unmount()

- GIVEN a checkout page with no client-side router
- WHEN a reader consults the lifecycle section
- THEN it confirms a defensive `unmount()` call is unnecessary, because a
  full reload tears state down

#### Scenario: An app that changes routes without a reload must call unmount() before leaving

- GIVEN an app whose router changes views without a full page load
- WHEN a reader consults the lifecycle section
- THEN it states `unmount()` must run before the route changes, and names
  the Apple Pay stale-charge consequence

### Requirement: A framework lifecycle example is reachable by capability, not by section name

The README MUST include one runnable example showing a component-based UI
(e.g. a `useEffect`-style hook) mount a Tonder component and unmount it in
that framework's own cleanup path, covering both `card_fields` and
`apple_pay_button`.

#### Scenario: A reader building a component-based UI finds a copyable lifecycle example

- GIVEN a reader integrating the SDK inside a component-based UI framework
- WHEN they look in the README for how to wire mount/unmount into their
  component's lifecycle
- THEN one runnable example pairs a mount call with an unmount call in a
  cleanup path, for both component types

### Requirement: Neither document states the retracted freeze claim or the unverified single-session constraint

Neither the README nor the internal guide MUST state or imply that skipping
`unmount()` freezes a page or its UI. Neither MUST assert, hedged or not,
that a browser can hold only one active Apple Pay session at a time.

#### Scenario: No freeze claim appears in either document

- GIVEN the README and the internal guide
- WHEN their lifecycle content is read
- THEN neither describes skipping `unmount()` as freezing a page or UI

#### Scenario: No single-active-session claim appears in either document

- GIVEN the same two documents
- WHEN their lifecycle content is read
- THEN neither states a browser can run only one active Apple Pay session at
  a time

### Requirement: The internal guide routes an unregistered-merchant-domain support case

The internal guide's Support ownership table MUST include a row routing an
Apple Pay `validate-merchant` failure caused by an unregistered merchant
domain, naming a first owner and the escalation condition.

#### Scenario: A Support engineer routes a validate-merchant ticket from the table alone

- GIVEN a Support engineer with only the internal guide open
- WHEN they look up who owns a `validate-merchant` failure tied to an
  unregistered domain
- THEN the table names a first owner and states when to escalate

### Requirement: The internal guide documents Apple Pay's flow, diagram branch, concepts, and demo coverage

The internal guide MUST describe Apple Pay as a numbered flow alongside its
other flows, show an Apple Pay path in its mental-model diagram reaching
`/process`, list `isApplePayAvailable()` and `apple_pay_button` as one-line
concept rows, and list an Apple Pay demos row.

#### Scenario: Apple Pay is findable in the flow list, diagram, concepts table, and demos table

- GIVEN the internal guide
- WHEN a reader looks for Apple Pay in the flow list, the diagram, the
  concepts table, and the demos table
- THEN each location contains an Apple Pay entry

### Requirement: The internal guide points to README content by durable link, never by restating it

Any internal-guide reference to README content a reader needs exactly — a
signature, an options table, a runnable example — MUST link to it as an
absolute `https://github.com/tonderio/web-sdk/blob/main/...` URL, never a
bare `README.md → section` reference or a restatement. The internal guide
MUST carry only mental model, flow narrative, and ownership routing; a
paragraph with a signature, options table, or runnable code belongs in the
README.

#### Scenario: A README pointer resolves from Notion

- GIVEN any internal-guide reference to README content
- WHEN a reader outside the repository (e.g. on Notion) follows it
- THEN it resolves as an absolute GitHub `main`-branch link

#### Scenario: No internal-guide paragraph reproduces README-owned content

- GIVEN any paragraph added to the internal guide about Apple Pay or lifecycle
- WHEN compared against the README
- THEN it contains no signature, options table, or runnable code also in the
  README — only narrative and a link
