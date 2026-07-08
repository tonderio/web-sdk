# Card Field Events Specification

## Purpose

Config-level field callbacks for card-input fields mounted via `mountCardFields`,
plus SDK-owned, Skyflow-native default error labels rendered inside the card
input elements. Restores field-event and error-label behavior present in
Tonder's legacy SDKs, currently absent from `@tonder.io/web-sdk`.

## Requirements

### Requirement: Field lifecycle and interaction events

The system MUST allow a merchant to supply `onChange`, `onBlur`, `onFocus`,
and `onReady` callbacks per mounted card field, at `mountCardFields`
config level. Each callback, when invoked, MUST receive a payload containing
at least `{ elementType, isEmpty, isFocused, isValid, value }`.

#### Scenario: `onReady` fires when a field finishes mounting

- GIVEN a merchant calls `mountCardFields` with an `onReady` callback for a field
- WHEN that field finishes mounting and becomes interactive
- THEN the SDK invokes `onReady` with a payload containing `elementType`, `isEmpty`, `isFocused`, `isValid`, and `value`

#### Scenario: `onChange` fires as the shopper types

- GIVEN a mounted card field with an `onChange` callback
- WHEN the shopper types into the field
- THEN the SDK invokes `onChange` with the current `elementType`, `isEmpty`, `isFocused`, `isValid`, and `value`

#### Scenario: `onFocus` fires when the shopper enters the field

- GIVEN a mounted card field with an `onFocus` callback
- WHEN the shopper focuses the field
- THEN the SDK invokes `onFocus` with a payload reflecting `isFocused: true`

#### Scenario: `onBlur` fires when the shopper leaves the field

- GIVEN a mounted card field with an `onBlur` callback
- WHEN the shopper blurs the field
- THEN the SDK invokes `onBlur` with a payload reflecting the field's current validity and value state

#### Scenario: Callbacks are optional

- GIVEN a merchant calls `mountCardFields` without any field-event callbacks
- WHEN the shopper interacts with the fields
- THEN mounting and validation behave normally
- AND no error occurs from the absence of callbacks

### Requirement: SDK-owned default error labels on blur

On blur, if a field is invalid, the SDK MUST render a default error message
INSIDE the Skyflow field itself by calling `element.setError(message)`
FIRST, THEN `element.update({ errorTextStyles })`. This behavior MUST occur
regardless of whether the merchant supplied an `onBlur` callback. The SDK
MUST NOT render a separate error element layered over the field. Default
error copy MUST be in English and MUST be overridable by the merchant.

#### Scenario: Invalid field shows a default error label on blur

- GIVEN a mounted card field with an invalid value
- WHEN the shopper blurs the field
- THEN the SDK calls `element.setError(message)` before calling `element.update({ errorTextStyles })`
- AND the error message renders inside the Skyflow field
- AND no separate error element is added over the field

#### Scenario: Error ordering is preserved even with a merchant `onBlur` callback

- GIVEN a mounted card field with both an invalid value and a merchant-supplied `onBlur` callback
- WHEN the shopper blurs the field
- THEN the SDK invokes the merchant's `onBlur` callback
- AND the SDK still calls `element.setError(message)` before `element.update({ errorTextStyles })` as an independent, SDK-owned side effect

#### Scenario: Error label clears when the field becomes valid

- GIVEN a field is currently showing a default error label
- WHEN the shopper edits the field until it becomes valid
- THEN the SDK clears the error label
- AND the field no longer displays the error message

#### Scenario: Merchant overrides the default error copy

- GIVEN a merchant configures custom error message text for a field
- WHEN that field becomes invalid and is blurred
- THEN the SDK renders the merchant-supplied message instead of the SDK default
- AND the `setError` → `update` ordering is unchanged
